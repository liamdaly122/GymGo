/**
 * What the phone sends the watch: the session, worked out in advance.
 *
 * iOS freezes the phone app's JavaScript while the phone is locked, so the
 * watch cannot ask the phone what comes next. Instead the phone walks the
 * session the way the set in hand would — warm-ups first, then working sets
 * round by round across a superset, each child straight after its parent —
 * and sends the whole list, with every number, rest and "Up next" line the
 * phone's own screen would show. The watch follows the list, and keeps only
 * three rules of its own (docs/native-roadmap.md, 4.6):
 *
 *  1. carry forward: from the second set on, start at the set just done;
 *  2. the back-off target: a pyramid's other sets aim off today's top set;
 *  3. the record check: the same marks and the same gate as the phone.
 *
 * Each entry carries what those rules need: whether it carries, which top set
 * it aims off, and the marks to beat. Everything else is decided here, from
 * the same functions the phone's screen uses, so a rule still lives in one
 * place. A new snapshot goes every time the phone can send one, and that
 * corrects anything the watch had to work out for itself.
 *
 * Pure. The database layer assembles the input.
 */
import type { WorkoutSet } from '@/db/schema';
import type { PreviousPerformance } from './previousPerformance';
import type { RecordMarks } from './prs';
import {
  nextLoadableAbove,
  type LoadingProfile,
} from './plates';
import { restsAfterSet, setInHand, type OrderedSet } from './supersets';
import { CHILD_NAMES, isChildSet, isTopWorkingSet, latestWorkingSet, setOrdinals } from './sets';
import { schemeTarget, stepsFromTop } from './schemes';
import type { Equipment, Technique } from './types';

export const WATCH_SNAPSHOT_VERSION = 1;

/** One exercise of the session, as the database layer hands it over. */
export interface WatchEntryInput {
  workoutExerciseId: string;
  exerciseId: string;
  name: string;
  equipment: Equipment;
  technique: Technique;
  /** Already resolved: the routine's override, else the lift's own tier. */
  restSeconds: number;
  setupNote: string | null;
  loading: LoadingProfile;
  /** Live sets, in set order. */
  sets: WorkoutSet[];
  suggestion: { weight_kg: number; reps: number } | null;
  previous: PreviousPerformance | null;
  /** Where the lift's records stood before today. Null for a first. */
  priorMarks: RecordMarks | null;
}

export interface WatchStationInput {
  /** Indexes into `entries`, in the station's order. */
  members: number[];
  /** "Leg Press", or a superset's members joined. */
  name: string;
  /** "Machine · 3 × 10–15", as the phone's rest screen says it. */
  outline: string;
}

export interface WatchInput {
  workoutId: string;
  title: string;
  startedAt: string;
  entries: WatchEntryInput[];
  stations: WatchStationInput[];
  sentAt: string;
}

/** Where a set's starting numbers came from. */
export type WatchHintSource = 'typed' | 'scheme' | 'carried' | 'suggestion' | 'last' | 'none';

export interface WatchSet {
  id: string;
  exerciseId: string;
  workoutExerciseId: string;
  /** Index into `stations`. */
  station: number;
  type: string;
  parentSetId: string | null;
  /** "Set 2 of 4", "Warm-up 1 of 3", "Drop · set 2", "Set 3 of 3 · Back-off". */
  label: string;
  /** The numbers to start at. Weight in kg; zero for unloaded bodyweight work. */
  weight: number | null;
  reps: number | null;
  source: WatchHintSource;
  /**
   * Rule 1. True for a top-level working set the phone has not started typing
   * and that is not part of a pyramid: once a set of this lift is logged on
   * the wrist, this one starts at that instead.
   */
  carries: boolean;
  /**
   * Rule 2. For a pyramid's back-off set, how far it sits from the top set and
   * which set that is: once the top set is logged, this one aims at
   * `schemeTarget` of it.
   */
  scheme: { stepsFromTop: number; topSetId: string } | null;
  /** Seconds of rest after this set, or null for none (a warm-up, a continuation, A1 of a pair). */
  restAfter: number | null;
  /** What the rest screen says is next. */
  upNext: { name: string; detail: string };
}

export interface WatchLift {
  name: string;
  unit: 'kg' | 'kg each' | 'kg added';
  /** Every weight the equipment can make, ascending, for the Crown. */
  ladder: number[];
  setupNote: string | null;
  /** Rule 3: the marks to beat. Null for a lift never done before. */
  priorMarks: RecordMarks | null;
  /** Working sets already logged today, oldest first: the carry and the record check start from these. */
  doneToday: Array<{ setId: string; weight: number; reps: number; completedAt: string | null }>;
  /** Plate rounding for a back-off target on the watch. */
  loading: LoadingProfile;
}

export interface WatchSnapshot {
  version: typeof WATCH_SNAPSHOT_VERSION;
  workoutId: string;
  title: string;
  startedAt: string;
  sentAt: string;
  stations: Array<{ name: string; outline: string; exerciseIds: string[] }>;
  /** Every set still to do, in the order it comes up. */
  sets: WatchSet[];
  lifts: Record<string, WatchLift>;
}

const FINISH = { name: 'Finish', detail: 'Last set done' } as const;

function unitFor(equipment: Equipment): WatchLift['unit'] {
  if (equipment === 'dumbbell' || equipment === 'kettlebell') return 'kg each';
  if (equipment === 'bodyweight') return 'kg added';
  return 'kg';
}

/** A number the way the big fields show it: no trailing zeros, no float dust. */
function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Every weight this equipment can make, from the lightest up to comfortably
 * past anything this lift is likely to need. The Crown moves through it, so
 * one notch is always one real increment, the same as the phone's steppers.
 */
export function weightLadder(loading: LoadingProfile, reach: number): number[] {
  const ceiling = Math.max(reach * 1.5, reach + 40, 60);
  const ladder: number[] = [];
  let weight = loading.mode === 'barbell' ? (loading.barWeight ?? 20) : 0;
  if (loading.mode !== 'barbell') ladder.push(0);
  else ladder.push(weight);
  while (ladder.length < 600) {
    const next = Math.round(nextLoadableAbove(weight, loading) * 100) / 100;
    if (!(next > weight) || next > ceiling) break;
    ladder.push(next);
    weight = next;
  }
  return ladder;
}

/** The order the sets come up in, across the whole session, as the watch will walk it. */
function walk(input: WatchInput): Array<{ station: number; member: number; set: WorkoutSet; rests: boolean }> {
  const order: Array<{ station: number; member: number; set: WorkoutSet; rests: boolean }> = [];
  input.stations.forEach((station, stationIndex) => {
    // A working copy of the station, ticked off as the walk goes.
    const members: OrderedSet[][] = station.members.map((entryIndex) =>
      input.entries[entryIndex]!.sets.map((set) => ({
        id: set.id,
        type: set.type,
        completed: set.completed,
        parent_set_id: set.parent_set_id,
      })),
    );
    for (let guard = 0; guard < 1000; guard += 1) {
      const next = setInHand(members);
      if (!next) break;
      const list = members[next.member]!;
      const at = list.findIndex((set) => set.id === next.setId);
      list[at] = { ...list[at]!, completed: true };
      const entry = input.entries[station.members[next.member]!]!;
      order.push({
        station: stationIndex,
        member: next.member,
        set: entry.sets.find((set) => set.id === next.setId)!,
        rests: restsAfterSet(members, next.member, next.setId),
      });
    }
  });
  return order;
}

export function buildWatchSnapshot(input: WatchInput): WatchSnapshot {
  const entryByWorkoutExercise = new Map(input.entries.map((entry) => [entry.workoutExerciseId, entry]));

  const lifts: Record<string, WatchLift> = {};
  for (const entry of input.entries) {
    const done = entry.sets
      .filter((set) => isTopWorkingSet(set) && set.reps > 0)
      .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? '') || a.set_index - b.set_index);
    const reach = Math.max(
      entry.suggestion?.weight_kg ?? 0,
      entry.previous?.top_set.weight_kg ?? 0,
      entry.priorMarks?.weight ?? 0,
      ...entry.sets.map((set) => set.weight_kg),
    );
    // Two entries can share a lift (the same exercise twice in a session):
    // their sets are one history for the carry and the record check.
    const existing = lifts[entry.exerciseId];
    lifts[entry.exerciseId] = {
      name: entry.name,
      unit: unitFor(entry.equipment),
      ladder: weightLadder(entry.loading, Math.max(reach, existing?.ladder.at(-1) ?? 0)),
      setupNote: entry.setupNote,
      priorMarks: entry.priorMarks,
      doneToday: [
        ...(existing?.doneToday ?? []),
        ...done.map((set) => ({ setId: set.id, weight: set.weight_kg, reps: set.reps, completedAt: set.completed_at })),
      ],
      loading: entry.loading,
    };
  }

  const order = walk(input);

  const sets: WatchSet[] = order.map(({ station, set }) => {
    const entry = entryByWorkoutExercise.get(set.workout_exercise_id)!;
    const ordinals = setOrdinals(entry.sets);
    const ordinal = ordinals.get(set.id) ?? 0;
    const child = isChildSet(set);
    const hintable = !child && set.type === 'working';

    const nonWarmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type !== 'warmup');
    const warmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type === 'warmup');
    const fromTop = stepsFromTop(
      entry.technique,
      nonWarmups.map((candidate) => candidate.type),
      nonWarmups.findIndex((candidate) => candidate.id === set.id),
    );
    const workingSets = nonWarmups.filter((candidate) => candidate.type === 'working');
    const topSet = entry.technique === 'reverse_pyramid' ? workingSets[0] : workingSets.at(-1);
    const topDone = topSet?.completed && (topSet.weight_kg > 0 || topSet.reps > 0) ? topSet : null;
    const topTarget = topDone ?? entry.suggestion ?? entry.previous?.top_set ?? null;
    const schemeHint = fromTop !== null && topTarget ? schemeTarget(topTarget, fromTop, entry.loading) : null;
    const schemeRole = set.type === 'back_off' ? (entry.technique === 'pyramid' ? 'Ramp' : 'Back-off') : null;

    const lastTime = hintable ? entry.previous?.working_sets[ordinal] : undefined;
    const carried = hintable ? latestWorkingSet(entry.sets) : null;

    // The same order of preference as the phone's set in hand: what was
    // typed, then the scheme, the set just done, the suggestion, last time.
    let weight: number | null = null;
    let reps: number | null = null;
    let source: WatchHintSource = 'none';
    if (set.weight_kg > 0 || set.reps > 0) {
      weight = set.weight_kg;
      reps = set.reps > 0 ? set.reps : null;
      source = 'typed';
    } else if (schemeHint) {
      ({ weight_kg: weight, reps } = schemeHint);
      source = 'scheme';
    } else if (hintable && carried) {
      ({ weight_kg: weight, reps } = carried);
      source = 'carried';
    } else if (hintable && entry.suggestion) {
      ({ weight_kg: weight, reps } = entry.suggestion);
      source = 'suggestion';
    } else if (lastTime) {
      ({ weight_kg: weight, reps } = lastTime);
      source = 'last';
    }
    if (weight === null && entry.equipment === 'bodyweight') weight = 0;

    const label = child
      ? `${CHILD_NAMES[set.type] ?? 'Continuation'} · set ${ordinal + 1}`
      : set.type === 'warmup'
        ? `Warm-up ${ordinal + 1} of ${warmups.length}`
        : `Set ${ordinal + 1} of ${nonWarmups.length}${schemeRole ? ` · ${schemeRole}` : ''}`;

    return {
      id: set.id,
      exerciseId: entry.exerciseId,
      workoutExerciseId: entry.workoutExerciseId,
      station,
      type: set.type,
      parentSetId: set.parent_set_id,
      label,
      weight,
      reps,
      source,
      carries: hintable && fromTop === null && source !== 'typed',
      scheme: fromTop !== null && topSet ? { stepsFromTop: fromTop, topSetId: topSet.id } : null,
      restAfter: null,
      upNext: FINISH,
    };
  });

  // Rest and "Up next" depend on the set that follows.
  order.forEach(({ rests, set }, index) => {
    const entry = entryByWorkoutExercise.get(set.workout_exercise_id)!;
    const current = sets[index]!;
    const next = sets[index + 1];
    // A continuation already hanging off this set follows straight on: a drop
    // is done the moment the top set ends.
    const continues = next !== undefined && next.parentSetId === current.id;
    current.restAfter = rests && !continues ? entry.restSeconds : null;
    if (!next) return;
    if (next.station === current.station) {
      const logged = next.weight !== null && next.reps !== null && next.reps > 0
        ? ` · ${next.weight > 0 ? formatNumber(next.weight) : 'BW'} × ${next.reps}`
        : '';
      current.upNext = { name: lifts[next.exerciseId]!.name, detail: `${next.label}${logged}` };
    } else {
      const station = input.stations[next.station]!;
      current.upNext = { name: station.name, detail: station.outline };
    }
  });

  return {
    version: WATCH_SNAPSHOT_VERSION,
    workoutId: input.workoutId,
    title: input.title,
    startedAt: input.startedAt,
    sentAt: input.sentAt,
    stations: input.stations.map((station) => ({
      name: station.name,
      outline: station.outline,
      exerciseIds: station.members.map((index) => input.entries[index]!.exerciseId),
    })),
    sets,
    lifts,
  };
}
