/**
 * What the phone sends the watch: the session, worked out in advance.
 *
 * iOS freezes the phone app's JavaScript while the phone is locked, so the
 * watch cannot ask the phone what comes next. Instead the phone walks the
 * session the way the set in hand would — warm-ups first, then working sets
 * round by round across a superset, each child straight after its parent —
 * and sends the whole list, with every number, rest and "Up next" line the
 * phone's own screen would show. The watch follows the list, and keeps only
 * these rules of its own (docs/watch-protocol.md, "The watch's own rules"):
 *
 *  1. carry forward: from the second set on, start at the set just done, a
 *     notch lighter when it fell short of the range (`carryForward`);
 *  2. the back-off target: a pyramid's other sets aim off today's top set;
 *  3. the record check: the same marks and the same gate as the phone;
 *  4. where the session goes after a station (`nextStation`), for a station
 *     tapped or a set skipped on the wrist;
 *  5. how Up next words the set that follows (`upNextFor`), once the wrist
 *     has gone off the list's order.
 *
 * Each entry carries what those rules need: whether it carries, the bottom of
 * the range and whether a set is AMRAP, which top set it aims off, and the
 * marks to beat. Everything else is decided here, from the same functions the
 * phone's screen uses, so a rule still lives in one place. A new snapshot goes
 * every time the phone can send one, and that corrects anything the watch had
 * to work out for itself.
 *
 * Pure. The database layer assembles the input.
 */
import type { WorkoutSet } from '@/db/schema';
import type { PreviousPerformance } from './previousPerformance';
import { SUGGESTION_VERB, type RepRange, type Suggestion, type SuggestionKind } from './progression';
import type { RecordMarks } from './prs';
import {
  nextLoadableAbove,
  type LoadingProfile,
} from './plates';
import { localIsoDate } from './schedule';
import { setHints, startingNumbers } from './setHints';
import { restsAfterSet, setInHand, type OrderedSet } from './supersets';
import { isTopWorkingSet, setOrdinals } from './sets';
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
  /** What the engine suggests for the lift: the numbers, and the word and reason for them. */
  suggestion: Pick<Suggestion, 'weight_kg' | 'reps' | 'kind' | 'reason'> | null;
  previous: PreviousPerformance | null;
  /** Where the lift's records stood before today. Null for a first. */
  priorMarks: RecordMarks | null;
  /** The range the routine prescribes (`WorkoutExerciseView.repRange`). Null for freestyle. */
  repRange: RepRange | null;
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

/**
 * Where a set's starting numbers came from. `stepped` is the set just done, a
 * notch lighter because it fell short of the range (`carryForward`).
 */
export type WatchHintSource = 'typed' | 'scheme' | 'carried' | 'stepped' | 'suggestion' | 'last' | 'none';

/** What the rest screen says is next. */
export interface WatchUpNext {
  name: string;
  detail: string;
}

/** The engine's plan for a lift, as the watch shows it: the phone's own word, and why. */
export interface WatchPlan {
  kind: SuggestionKind;
  /** `SUGGESTION_VERB[kind]`: "Go up", "More reps", "Hold", "Back off", "Estimate". */
  verb: string;
  /** Plain English, clamped to `WATCH_REASON_MAX` characters. */
  reason: string;
}

/** The last session the lift was done in (`previousPerformance`). */
export interface WatchLastTime {
  /**
   * The lifter's own calendar day it was finished, YYYY-MM-DD. Never relative
   * words: the watch may be days past the phone's last context.
   */
  day: string;
  /** The best working set: the previous-performance line. The watch never re-derives that rule. */
  top: { weight: number; reps: number };
  /** Every top-level working set, in the order done. */
  sets: Array<{ weight: number; reps: number }>;
}

/** The longest plan reason sent. The watch's lift sheet scrolls, so this only guards the context's size. */
export const WATCH_REASON_MAX = 320;

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
  upNext: WatchUpNext;
  /** Marked AMRAP on the phone. Sent only when true: rule 1 never steps down off an AMRAP set. */
  amrap?: true;
}

/** A working set of the lift already logged today. */
export interface WatchDoneSet {
  setId: string;
  weight: number;
  reps: number;
  completedAt: string | null;
  /** Sent only when true. */
  amrap?: true;
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
  doneToday: WatchDoneSet[];
  /** Plate rounding for a back-off target and a step-down on the watch. */
  loading: LoadingProfile;
  /** Why the first set's numbers are what they are. Null with no suggestion. Absent from a build 6 phone. */
  plan?: WatchPlan | null;
  /** The last session of this lift. Null for a first. Absent from a build 6 phone. */
  lastTime?: WatchLastTime | null;
  /** Rule 1: the bottom of the rep range, which a short set steps down to. Null for freestyle. Absent from a build 6 phone. */
  repLow?: number | null;
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

/** Up next after the last set of the session. */
export const WATCH_FINISH: WatchUpNext = { name: 'Finish', detail: 'Last set done' };

function unitFor(equipment: Equipment): WatchLift['unit'] {
  if (equipment === 'dumbbell' || equipment === 'kettlebell') return 'kg each';
  if (equipment === 'bodyweight') return 'kg added';
  return 'kg';
}

/** A number the way the big fields show it: no trailing zeros, no float dust. */
function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function clampReason(reason: string): string {
  if (reason.length <= WATCH_REASON_MAX) return reason;
  return `${reason.slice(0, WATCH_REASON_MAX - 1).trimEnd()}…`;
}

/** The set that comes up next, as much of it as Up next reads. */
export interface UpNextSet {
  /** Index into the stations. */
  station: number;
  /** The lift's name. */
  name: string;
  /** "Set 3 of 4", "Warm-up 1 of 3". */
  label: string;
  /** The numbers it starts at: the list's, or the watch's once its own rules have had their say. */
  weight: number | null;
  reps: number | null;
}

/**
 * What the rest screen says is next, after a set at station `fromStation`.
 *
 * - The same station (the lift's next set, or a superset partner's): the
 *   lift's name, and its label with the numbers it starts at, "BW" for
 *   unloaded bodyweight work: "Set 3 of 4 · 100 × 5". No numbers until it has
 *   reps above zero.
 * - Another station: its name and outline, "Machine · 3 × 10–15".
 * - Nothing left: Finish.
 *
 * The list carries it worked out for every set; the watch words it this way
 * itself once a station tapped or a set skipped takes it off the list's order.
 */
export function upNextFor(
  fromStation: number,
  next: UpNextSet | null,
  stations: ReadonlyArray<{ name: string; outline: string }>,
): WatchUpNext {
  if (!next) return WATCH_FINISH;
  if (next.station === fromStation) {
    const numbers =
      next.weight !== null && next.reps !== null && next.reps > 0
        ? ` · ${next.weight > 0 ? formatNumber(next.weight) : 'BW'} × ${next.reps}`
        : '';
    return { name: next.name, detail: `${next.label}${numbers}` };
  }
  const station = stations[next.station]!;
  return { name: station.name, detail: station.outline };
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
    const { suggestion, previous } = entry;
    lifts[entry.exerciseId] = {
      name: entry.name,
      unit: unitFor(entry.equipment),
      ladder: weightLadder(entry.loading, Math.max(reach, existing?.ladder.at(-1) ?? 0)),
      setupNote: entry.setupNote,
      priorMarks: entry.priorMarks,
      doneToday: [
        ...(existing?.doneToday ?? []),
        ...done.map((set) => ({
          setId: set.id,
          weight: set.weight_kg,
          reps: set.reps,
          completedAt: set.completed_at,
          ...(set.is_amrap ? { amrap: true as const } : {}),
        })),
      ],
      loading: entry.loading,
      plan: suggestion
        ? { kind: suggestion.kind, verb: SUGGESTION_VERB[suggestion.kind], reason: clampReason(suggestion.reason) }
        : null,
      lastTime: previous
        ? {
            day: localIsoDate(new Date(previous.performed_at)),
            top: { weight: previous.top_set.weight_kg, reps: previous.top_set.reps },
            sets: previous.working_sets.map((set) => ({ weight: set.weight_kg, reps: set.reps })),
          }
        : null,
      repLow: entry.repRange?.low ?? null,
    };
  }

  const order = walk(input);

  const sets: WatchSet[] = order.map(({ station, set }) => {
    const entry = entryByWorkoutExercise.get(set.workout_exercise_id)!;
    const ordinal = setOrdinals(entry.sets).get(set.id) ?? 0;
    // The phone's own rule (`setHints`), field by field as the set in hand
    // reads it: a field typed on the phone keeps its number, and the other
    // starts at its placeholder.
    const hints = setHints(entry, set, ordinal, entry.suggestion, entry.previous);
    const { weight, reps, weightTyped, repsTyped } = startingNumbers(set, hints, entry.equipment === 'bodyweight');
    const source: WatchHintSource =
      weightTyped && repsTyped
        ? 'typed'
        : ((weightTyped ? null : hints.weightSource) ??
          (repsTyped ? null : hints.repsSource) ??
          (weightTyped || repsTyped ? 'typed' : 'none'));

    return {
      id: set.id,
      exerciseId: entry.exerciseId,
      workoutExerciseId: entry.workoutExerciseId,
      station,
      type: set.type,
      parentSetId: set.parent_set_id,
      label: hints.label,
      weight,
      reps,
      source,
      // Never over a number typed on the phone, which the watch's carry would replace.
      carries: hints.hintable && hints.fromTop === null && !weightTyped && !repsTyped,
      scheme: hints.fromTop !== null && hints.topSet ? { stepsFromTop: hints.fromTop, topSetId: hints.topSet.id } : null,
      restAfter: null,
      upNext: WATCH_FINISH,
      ...(set.is_amrap ? { amrap: true as const } : {}),
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
    current.upNext = upNextFor(
      current.station,
      next
        ? { station: next.station, name: lifts[next.exerciseId]!.name, label: next.label, weight: next.weight, reps: next.reps }
        : null,
      input.stations,
    );
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
