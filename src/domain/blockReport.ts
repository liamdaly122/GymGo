/**
 * What a block did: the sessions trained, how each main lift's estimated max
 * moved, the records it set, and the weekly sets each muscle got against the
 * goal's target.
 *
 * Read from the workout tables, through the same gates as every other number
 * in the app: a record and an estimated max come from top working sets only
 * (`prs.ts`, `bestEstimated1RM`), and volume counts drop sets and the rest of
 * the child sets (`volume.ts`). A drop set can pad the week's sets and never
 * a record.
 *
 * The deload week is left out of the comparisons. It is half the sets at 90%
 * load on purpose, so a lift's last session reading lighter than its peak, or
 * a muscle's average sinking below target, would be the plan working rather
 * than the lifter slipping.
 *
 * Pure — the query layer assembles the history.
 */
import type { Exercise, Plan, Workout, WorkoutSet } from '@/db/schema';
import type { Muscle } from './types';
import { weekModifier } from './programmes/block';
import { WEEKLY_SET_TARGET } from './programmes/prescribe';
import { personalRecords } from './prs';
import { countsTowardVolume } from './sets';
import { bestEstimated1RM, setsPerMuscle, totalTonnage, totalWorkingSets } from './volume';

export interface ReportSession {
  workout: Workout;
  exercises: Array<{ exercise: Exercise; sets: WorkoutSet[] }>;
}

export interface BlockReportInput {
  plan: Plan;
  /** From the block's schedule: every slot, and the ones trained. */
  sessionsPlanned: number;
  sessionsDone: number;
  /** Every finished workout, this block's and everything before, oldest first. */
  history: ReportSession[];
  /** The block's main lifts, in the order it runs them. */
  mainLiftIds: readonly string[];
}

export interface MainLiftChange {
  exercise: Exercise;
  /** Best estimated max of its first session in the block. */
  start: number;
  /** Of its last session before the deload — or its last, if that is all there is. */
  end: number;
  change: number;
  /** Each session's best estimated max, in order, deload left out as above. */
  series: number[];
  sessions: number;
}

export interface BlockRecord {
  exercise: Exercise;
  /** The heaviest top set the block reached, when it beat everything before it. */
  heaviest: { weight: number; reps: number; previous: number } | null;
  /** The best estimated max the block reached, when it beat everything before it. */
  e1rm: { value: number; previous: number } | null;
}

export interface BlockReport {
  sessionsPlanned: number;
  sessionsDone: number;
  /** Closed before every session was trained. */
  endedEarly: boolean;
  /** When the block's first and last sessions were trained. */
  firstSession: string | null;
  lastSession: string | null;
  setCount: number;
  tonnageKg: number;
  mainLifts: MainLiftChange[];
  records: BlockRecord[];
  /** Average sets a training week for each muscle worked directly, most first. */
  muscles: Array<{ muscle: Muscle; sets: number }>;
  /** How many weeks the average is over. */
  weeksAveraged: number;
  /** Whether a deload week was trained and left out of the average. */
  deloadLeftOut: boolean;
  target: { low: number; high: number };
}

/** Lifts the report leads with when none can be named from the plan. */
const FALLBACK_MAIN_LIFTS = 6;

/** One session's sets per exercise, with a lift entered twice merged. */
function setsByExercise(session: ReportSession): Map<string, { exercise: Exercise; sets: WorkoutSet[] }> {
  const merged = new Map<string, { exercise: Exercise; sets: WorkoutSet[] }>();
  for (const { exercise, sets } of session.exercises) {
    const entry = merged.get(exercise.id);
    if (entry) entry.sets.push(...sets);
    else merged.set(exercise.id, { exercise, sets: [...sets] });
  }
  return merged;
}

export function buildBlockReport(input: BlockReportInput): BlockReport {
  const { plan } = input;
  const inBlock = (session: ReportSession) => session.workout.plan_id === plan.id;
  const block = input.history.filter(inBlock);

  const isDeload = (session: ReportSession) =>
    session.workout.plan_week !== null && weekModifier(session.workout.plan_week, plan.block_weeks).isDeload;
  const training = block.filter((session) => !isDeload(session));
  // A block ended in its deload week still has to say something.
  const compared = training.length > 0 ? training : block;

  const mainLifts = mainLiftChanges(block, isDeload, mainLiftsOf(block, input.mainLiftIds));
  // The main lifts' records first, in the order the block runs them.
  const order = mainLifts.map((lift) => lift.exercise.id);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);

  return {
    sessionsPlanned: input.sessionsPlanned,
    sessionsDone: input.sessionsDone,
    endedEarly: plan.completed_at !== null && input.sessionsDone < input.sessionsPlanned,
    firstSession: block[0]?.workout.started_at ?? null,
    lastSession: block.at(-1)?.workout.started_at ?? null,
    setCount: totalWorkingSets(block.flatMap(allSets)),
    tonnageKg: totalTonnage(block.flatMap(allSets)),
    mainLifts,
    records: recordsSet(input.history, inBlock).sort(
      (a, b) => rank(a.exercise.id) - rank(b.exercise.id),
    ),
    ...weeklyMuscles(compared),
    deloadLeftOut: training.length > 0 && training.length < block.length,
    target: WEEKLY_SET_TARGET[plan.goal],
  };
}

const allSets = (session: ReportSession) => session.exercises.flatMap((entry) => entry.sets);

/**
 * The lifts the plan names as its main ones, or, when it names none — every
 * row re-prescribed by hand — the compound lifts trained most often.
 */
function mainLiftsOf(block: ReportSession[], named: readonly string[]): string[] {
  if (named.length > 0) return [...new Set(named)];
  const sessions = new Map<string, number>();
  for (const session of block) {
    for (const { exercise, sets } of setsByExercise(session).values()) {
      if (!exercise.is_compound || bestEstimated1RM(sets) === 0) continue;
      sessions.set(exercise.id, (sessions.get(exercise.id) ?? 0) + 1);
    }
  }
  return [...sessions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FALLBACK_MAIN_LIFTS)
    .map(([id]) => id);
}

function mainLiftChanges(
  block: ReportSession[],
  isDeload: (session: ReportSession) => boolean,
  ids: string[],
): MainLiftChange[] {
  return ids.flatMap((id) => {
    let exercise: Exercise | undefined;
    const points: Array<{ value: number; deload: boolean }> = [];
    for (const session of block) {
      const entry = setsByExercise(session).get(id);
      if (!entry) continue;
      const value = bestEstimated1RM(entry.sets);
      if (value === 0) continue;
      exercise = entry.exercise;
      points.push({ value, deload: isDeload(session) });
    }
    if (!exercise || points.length === 0) return [];

    const compared = points.some((point) => !point.deload) ? points.filter((point) => !point.deload) : points;
    const start = compared[0]!.value;
    const end = compared.at(-1)!.value;
    return [{ exercise, start, end, change: end - start, series: compared.map((point) => point.value), sessions: points.length }];
  });
}

/**
 * Records the block set: each lift's best that beat every session before it,
 * this block's earlier ones included. A lift's first session ever is a first,
 * not a record — there was nothing to beat. `previous` is what stood before
 * the block's first improvement, so the line reads how far the block moved it.
 */
function recordsSet(history: ReportSession[], inBlock: (session: ReportSession) => boolean): BlockRecord[] {
  const best = new Map<string, { weight: number; e1rm: number }>();
  const records = new Map<string, BlockRecord>();

  for (const session of history) {
    const updates: Array<[string, { weight: number; e1rm: number }]> = [];
    for (const [id, { exercise, sets }] of setsByExercise(session)) {
      const during = personalRecords(sets);
      if (!during.heaviest || !during.bestE1rm) continue;
      const weight = during.heaviest.weight_kg;
      const e1rm = during.bestE1rm.value;
      const before = best.get(id);

      if (inBlock(session) && before && (weight > before.weight || e1rm > before.e1rm)) {
        const record = records.get(id) ?? { exercise, heaviest: null, e1rm: null };
        if (weight > before.weight) {
          record.heaviest = { weight, reps: during.heaviest.reps, previous: record.heaviest?.previous ?? before.weight };
        }
        if (e1rm > before.e1rm) {
          record.e1rm = { value: e1rm, previous: record.e1rm?.previous ?? before.e1rm };
        }
        records.set(id, record);
      }
      updates.push([id, { weight: Math.max(weight, before?.weight ?? 0), e1rm: Math.max(e1rm, before?.e1rm ?? 0) }]);
    }
    for (const [id, value] of updates) best.set(id, value);
  }

  return [...records.values()];
}

function weeklyMuscles(sessions: ReportSession[]): Pick<BlockReport, 'muscles' | 'weeksAveraged'> {
  const exerciseBySetId = new Map<string, Exercise>();
  const direct = new Set<Muscle>();
  for (const session of sessions) {
    for (const { exercise, sets } of session.exercises) {
      for (const set of sets) exerciseBySetId.set(set.id, exercise);
      if (sets.some(countsTowardVolume)) direct.add(exercise.primary_muscle);
    }
  }

  const weeks = new Set(sessions.map((session) => session.workout.plan_week).filter((week) => week !== null));
  const weeksAveraged = Math.max(1, weeks.size);
  const totals = setsPerMuscle(sessions.flatMap(allSets), exerciseBySetId);

  return {
    muscles: [...totals.entries()]
      // Muscles only ever worked as a secondary — forearms on a row — have no
      // target of their own.
      .filter(([muscle]) => direct.has(muscle))
      .map(([muscle, sets]) => ({ muscle, sets: sets / weeksAveraged }))
      .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle, 'en')),
    weeksAveraged,
  };
}
