import { describe, expect, it } from 'vitest';
import type { Exercise, Plan, WorkoutSet } from '@/db/schema';
import { buildBlockReport, type BlockReportInput, type ReportSession } from './blockReport';
import { estimate1RM } from './epley';
import { makeDropSet, makeExercise, makeSet, makeWorkout } from './testFactories';

const SQUAT = makeExercise({ id: 'squat', name: 'Barbell Squat' });
const BENCH = makeExercise({
  id: 'bench',
  name: 'Barbell Bench Press',
  primary_muscle: 'chest',
  secondary_muscles: ['triceps', 'shoulders'],
  movement_pattern: 'horizontal_push',
});
const CURL = makeExercise({
  id: 'curl',
  name: 'Barbell Curl',
  primary_muscle: 'biceps',
  secondary_muscles: ['forearms'],
  movement_pattern: 'isolation',
  is_compound: false,
});

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'block-1',
    name: 'Build muscle · Upper / Lower',
    goal: 'hypertrophy',
    days_per_week: 2,
    block_weeks: 5,
    current_week: 1,
    started_at: '2026-08-03T08:00:00.000Z',
    routine_ids: ['routine-a', 'routine-b'],
    training_days: [1, 4],
    phase_name: 'Foundations',
    deload_week: 5,
    completed_at: null,
    user_id: null,
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T08:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

let day = 0;
/** One finished session; `week` files it under the block, null leaves it outside. */
function session(
  week: number | null,
  lifts: Array<[Exercise, WorkoutSet[]]>,
  plan: Plan | null = makePlan(),
): ReportSession {
  day += 1;
  const at = new Date(Date.UTC(2026, 7, 3 + day, 9)).toISOString();
  return {
    workout: makeWorkout({
      plan_id: week === null ? null : (plan?.id ?? null),
      plan_week: week,
      started_at: at,
      finished_at: at,
    }),
    exercises: lifts.map(([exercise, sets]) => ({ exercise, sets })),
  };
}

const sets = (...pairs: Array<[number, number]>) =>
  pairs.map(([weight_kg, reps]) => makeSet({ weight_kg, reps }));

function report(overrides: Partial<BlockReportInput> & Pick<BlockReportInput, 'history'>) {
  return buildBlockReport({
    plan: makePlan(),
    sessionsPlanned: 10,
    sessionsDone: 10,
    mainLiftIds: [SQUAT.id, BENCH.id],
    ...overrides,
  });
}

describe('sessions', () => {
  it('counts what was trained against what was planned', () => {
    const result = report({ history: [], sessionsPlanned: 10, sessionsDone: 7 });
    expect(result.sessionsDone).toBe(7);
    expect(result.sessionsPlanned).toBe(10);
    expect(result.endedEarly).toBe(false);
  });

  it('says a block was ended early only once it is closed short', () => {
    const closed = makePlan({ completed_at: '2026-09-01T10:00:00.000Z' });
    expect(report({ plan: closed, history: [], sessionsDone: 7 }).endedEarly).toBe(true);
    expect(report({ plan: closed, history: [], sessionsDone: 10 }).endedEarly).toBe(false);
  });
});

describe('how the main lifts moved', () => {
  it('compares the first session with the last before the deload', () => {
    const history = [
      session(1, [[SQUAT, sets([100, 5])]]),
      session(2, [[SQUAT, sets([102.5, 5])]]),
      session(4, [[SQUAT, sets([107.5, 5])]]),
      // The deload is lighter on purpose; ending on it would read as a loss.
      session(5, [[SQUAT, sets([95, 5])]]),
    ];
    const [squat] = report({ history }).mainLifts;

    expect(squat!.start).toBeCloseTo(estimate1RM(100, 5));
    expect(squat!.end).toBeCloseTo(estimate1RM(107.5, 5));
    expect(squat!.change).toBeGreaterThan(0);
    // The sparkline agrees: it ends on week 4, not on the deload's dip.
    expect(squat!.series).toHaveLength(3);
    expect(squat!.series.at(-1)).toBeCloseTo(estimate1RM(107.5, 5));
    expect(squat!.sessions).toBe(4);
  });

  it('reads the estimate from top working sets only', () => {
    const drop = makeDropSet({ weight_kg: 100, reps: 5 }, [80, 60]);
    const warmup = makeSet({ weight_kg: 140, reps: 3, type: 'warmup' });
    const history = [
      session(1, [[SQUAT, [warmup, drop.parent, ...drop.children]]]),
      session(2, [[SQUAT, sets([100, 6])]]),
    ];
    const [squat] = report({ history }).mainLifts;
    expect(squat!.start).toBeCloseTo(estimate1RM(100, 5));
  });

  it('leaves out a main lift the block never trained, and keeps the plan’s order', () => {
    const history = [session(1, [[BENCH, sets([80, 8])], [CURL, sets([30, 10])]])];
    const lifts = report({ history, mainLiftIds: [SQUAT.id, BENCH.id] }).mainLifts;
    expect(lifts.map((lift) => lift.exercise.id)).toEqual([BENCH.id]);
  });

  it('falls back to the compound lifts trained most when the plan names none', () => {
    const history = [
      session(1, [[SQUAT, sets([100, 5])], [CURL, sets([30, 10])]]),
      session(2, [[SQUAT, sets([100, 5])], [BENCH, sets([80, 8])]]),
    ];
    const lifts = report({ history, mainLiftIds: [] }).mainLifts;
    expect(lifts.map((lift) => lift.exercise.id)).toEqual([SQUAT.id, BENCH.id]);
  });
});

describe('records', () => {
  it('reports a record the block set, against what stood before it', () => {
    const history = [
      session(null, [[BENCH, sets([95, 5])]]),
      session(1, [[BENCH, sets([97.5, 5])]]),
      session(3, [[BENCH, sets([100, 5])]]),
    ];
    const [bench] = report({ history }).records;

    expect(bench!.exercise.id).toBe(BENCH.id);
    expect(bench!.heaviest).toEqual({ weight: 100, reps: 5, previous: 95 });
    expect(bench!.e1rm!.value).toBeCloseTo(estimate1RM(100, 5));
    expect(bench!.e1rm!.previous).toBeCloseTo(estimate1RM(95, 5));
  });

  it('does not call a lift’s first session ever a record', () => {
    const history = [session(1, [[CURL, sets([30, 10])]])];
    expect(report({ history }).records).toEqual([]);
  });

  it('counts a new lift’s improvement within the block', () => {
    const history = [session(1, [[CURL, sets([30, 10])]]), session(2, [[CURL, sets([32.5, 10])]])];
    const [curl] = report({ history }).records;
    expect(curl!.heaviest).toEqual({ weight: 32.5, reps: 10, previous: 30 });
  });

  it('never lets a drop set set a record', () => {
    const drop = makeDropSet({ weight_kg: 100, reps: 5 }, [80]);
    // Twenty reps at 80 would estimate far past the top set.
    drop.children[0]!.reps = 20;
    const history = [session(null, [[BENCH, sets([100, 5])]]), session(1, [[BENCH, [drop.parent, ...drop.children]]])];
    expect(report({ history }).records).toEqual([]);
  });

  it('lists the main lifts’ records first', () => {
    const history = [
      session(1, [[CURL, sets([30, 10])], [BENCH, sets([80, 8])], [SQUAT, sets([100, 5])]]),
      session(2, [[CURL, sets([32.5, 10])], [BENCH, sets([82.5, 8])], [SQUAT, sets([102.5, 5])]]),
    ];
    const ids = report({ history, mainLiftIds: [SQUAT.id, BENCH.id] }).records.map((record) => record.exercise.id);
    expect(ids).toEqual([SQUAT.id, BENCH.id, CURL.id]);
  });

  it('records more reps with nothing added for bodyweight work', () => {
    const PULL_UP = makeExercise({
      id: 'pull-up',
      name: 'Pullups',
      equipment: 'bodyweight',
      primary_muscle: 'lats',
      movement_pattern: 'vertical_pull',
    });
    const history = [session(null, [[PULL_UP, sets([0, 8])]]), session(1, [[PULL_UP, sets([0, 11])]])];
    const [pullUps] = report({ history }).records;
    expect(pullUps!.reps).toEqual({ reps: 11, previous: 8 });
    expect(pullUps!.heaviest).toBeNull();
    expect(pullUps!.e1rm).toBeNull();
  });

  it('counts other training as history, but not as the block’s records', () => {
    const history = [
      session(1, [[BENCH, sets([100, 5])]]),
      // A freestyle session mid-block: a record, but not this block's.
      session(null, [[BENCH, sets([110, 5])]]),
      session(2, [[BENCH, sets([105, 5])]]),
    ];
    expect(report({ history }).records).toEqual([]);
  });
});

describe('sets per muscle against the target', () => {
  it('averages a training week, with the deload left out', () => {
    const history = [
      session(1, [[BENCH, sets([80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8])]]),
      session(1, [[BENCH, sets([80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8])]]),
      session(2, [[BENCH, sets([80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8], [80, 8])]]),
      session(5, [[BENCH, sets([70, 8], [70, 8])]]),
    ];
    const result = report({ history });

    expect(result.weeksAveraged).toBe(2);
    expect(result.deloadLeftOut).toBe(true);
    expect(result.muscles.find((entry) => entry.muscle === 'chest')!.sets).toBe(10);
    expect(result.target).toEqual({ low: 10, high: 20 });
  });

  it('counts drop sets toward volume, and not warm-ups', () => {
    const drop = makeDropSet({ weight_kg: 30, reps: 10 }, [25, 20]);
    const warmup = makeSet({ weight_kg: 15, reps: 10, type: 'warmup' });
    const history = [session(1, [[CURL, [warmup, drop.parent, ...drop.children]]])];
    expect(report({ history }).muscles.find((entry) => entry.muscle === 'biceps')!.sets).toBe(3);
  });

  it('lists only the muscles trained directly, crediting secondaries at a half', () => {
    const history = [session(1, [[BENCH, sets([80, 8], [80, 8])], [CURL, sets([30, 10])]])];
    const muscles = report({ history }).muscles;

    expect(muscles.map((entry) => entry.muscle).sort()).toEqual(['biceps', 'chest']);
    // Forearms only ever came along on the curl.
    expect(muscles.find((entry) => entry.muscle === 'forearms')).toBeUndefined();
  });

  it('measures each goal against its own target', () => {
    expect(report({ plan: makePlan({ goal: 'strength' }), history: [] }).target).toEqual({ low: 8, high: 12 });
  });
});
