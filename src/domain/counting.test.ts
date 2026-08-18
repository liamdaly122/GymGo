import { describe, expect, it } from 'vitest';
import { makeDropSet, makeExercise, makeSet } from './testFactories';
import { personalRecords, prsHitInSession, recordEligibleSets } from './prs';
import { bestEstimated1RM, setsPerMuscle, totalTonnage, totalWorkingSets } from './volume';
import { previousPerformance } from './previousPerformance';
import { estimate1RM } from './epley';
import { countsTowardVolume, isChildSet, isTopWorkingSet } from './sets';

/**
 * These are the brief's counting rules. They are stated as hard invariants
 * because breaking them corrupts history silently — a drop set that overwrites
 * a personal record looks like progress, not like a bug.
 */
describe('the drop set rule', () => {
  const { parent, children } = makeDropSet({ weight_kg: 100, reps: 5 }, [80, 60, 40]);
  const all = [parent, ...children];

  it('does not let a 40kg drop set overwrite a 100kg PR', () => {
    const records = personalRecords(all);
    expect(records.heaviest?.weight_kg).toBe(100);
  });

  it('excludes every child set from record eligibility', () => {
    expect(recordEligibleSets(all)).toEqual([parent]);
  });

  it('still counts the child sets toward volume', () => {
    // 100x5 + 80x8 + 60x8 + 40x8 = 500 + 640 + 480 + 320
    expect(totalTonnage(all)).toBe(1940);
    expect(totalWorkingSets(all)).toBe(4);
  });

  it('does not report a drop set as previous performance', () => {
    const result = previousPerformance([
      { workout_id: 'w1', performed_at: '2026-08-01T10:00:00.000Z', sets: all },
    ]);
    expect(result?.top_set.weight_kg).toBe(100);
    expect(result?.working_sets).toHaveLength(1);
  });

  it('keeps a drop set out of the estimated 1RM trend', () => {
    // The 40kg child would estimate far lower and drag the chart down.
    expect(bestEstimated1RM(all)).toBeCloseTo(estimate1RM(100, 5), 6);
  });
});

describe('warm-up sets', () => {
  const warmup = makeSet({ type: 'warmup', weight_kg: 60, reps: 5 });
  const working = makeSet({ type: 'working', weight_kg: 120, reps: 3, set_index: 1 });

  it('never count toward volume', () => {
    expect(countsTowardVolume(warmup)).toBe(false);
    expect(totalTonnage([warmup, working])).toBe(360);
  });

  it('never set a record', () => {
    const heavyWarmup = makeSet({ type: 'warmup', weight_kg: 200, reps: 1 });
    expect(personalRecords([heavyWarmup, working]).heaviest?.weight_kg).toBe(120);
  });
});

describe('incomplete sets', () => {
  it('do not count for anything — a set you did not do is not a set you did', () => {
    const planned = makeSet({ completed: false, weight_kg: 300, reps: 10 });
    expect(countsTowardVolume(planned)).toBe(false);
    expect(isTopWorkingSet(planned)).toBe(false);
    expect(personalRecords([planned]).heaviest).toBeNull();
    expect(totalTonnage([planned])).toBe(0);
  });
});

describe('soft-deleted sets', () => {
  it('are ignored, because deleted rows physically remain for sync', () => {
    const removed = makeSet({ deleted_at: '2026-08-02T10:00:00.000Z', weight_kg: 500 });
    const kept = makeSet({ weight_kg: 100 });
    expect(personalRecords([removed, kept]).heaviest?.weight_kg).toBe(100);
    expect(totalWorkingSets([removed, kept])).toBe(1);
  });
});

describe('isChildSet', () => {
  it('is decided by parent_set_id alone', () => {
    expect(isChildSet(makeSet({ parent_set_id: null }))).toBe(false);
    expect(isChildSet(makeSet({ parent_set_id: 'set-1' }))).toBe(true);
  });
});

describe('personal records', () => {
  it('breaks a weight tie on reps', () => {
    const fewer = makeSet({ weight_kg: 100, reps: 5 });
    const more = makeSet({ weight_kg: 100, reps: 8 });
    expect(personalRecords([fewer, more]).heaviest?.reps).toBe(8);
  });

  it('tracks best estimated 1RM separately from heaviest weight', () => {
    const heavySingle = makeSet({ weight_kg: 140, reps: 1 }); // e1RM 144.67
    const volumeSet = makeSet({ weight_kg: 120, reps: 8 }); // e1RM 152
    const records = personalRecords([heavySingle, volumeSet]);
    expect(records.heaviest?.weight_kg).toBe(140);
    expect(records.bestE1rm?.set.weight_kg).toBe(120);
  });

  it('returns nulls rather than throwing when there is no history', () => {
    expect(personalRecords([])).toEqual({
      heaviest: null,
      bestE1rm: null,
      bestRepsAtTopWeight: null,
    });
  });
});

describe('PRs hit in a session', () => {
  it('reports a weight PR against prior history', () => {
    const prior = [makeSet({ weight_kg: 100, reps: 5 })];
    const session = [makeSet({ weight_kg: 105, reps: 5 })];
    const hits = prsHitInSession(session, prior);
    expect(hits.find((hit) => hit.kind === 'weight')).toMatchObject({
      value: 105,
      previous: 100,
    });
  });

  it('reports no weight PR when the session merely equals the record', () => {
    const prior = [makeSet({ weight_kg: 100, reps: 5 })];
    const session = [makeSet({ weight_kg: 100, reps: 5 })];
    expect(prsHitInSession(session, prior).some((hit) => hit.kind === 'weight')).toBe(false);
  });

  it('treats a first-ever session as a PR with no previous value', () => {
    const hits = prsHitInSession([makeSet({ weight_kg: 60, reps: 10 })], []);
    expect(hits.find((hit) => hit.kind === 'weight')?.previous).toBeNull();
  });

  it('does not award a PR for a drop set that beat nothing', () => {
    const prior = [makeSet({ weight_kg: 100, reps: 5 })];
    const { parent, children } = makeDropSet({ weight_kg: 90, reps: 5 }, [70, 50]);
    expect(prsHitInSession([parent, ...children], prior)).toEqual([]);
  });
});

describe('previous performance', () => {
  const older = makeSet({ weight_kg: 90, reps: 8 });
  const newer = makeSet({ weight_kg: 95, reps: 8 });

  const sessions = [
    { workout_id: 'w1', performed_at: '2026-07-01T10:00:00.000Z', sets: [older] },
    { workout_id: 'w2', performed_at: '2026-08-01T10:00:00.000Z', sets: [newer] },
  ];

  it('reports the most recent session, not the best one', () => {
    expect(previousPerformance(sessions)?.workout_id).toBe('w2');
  });

  it('can exclude the session in progress', () => {
    const result = previousPerformance(sessions, { excludeWorkoutId: 'w2' });
    expect(result?.workout_id).toBe('w1');
    expect(result?.top_set.weight_kg).toBe(90);
  });

  it('skips past sessions that logged only warm-ups', () => {
    const warmupOnly = {
      workout_id: 'w3',
      performed_at: '2026-08-10T10:00:00.000Z',
      sets: [makeSet({ type: 'warmup', weight_kg: 40, reps: 10 })],
    };
    expect(previousPerformance([...sessions, warmupOnly])?.workout_id).toBe('w2');
  });

  it('returns null when the exercise has never been performed', () => {
    expect(previousPerformance([])).toBeNull();
  });

  it('reports the heaviest working set of that session as the top set', () => {
    const session = {
      workout_id: 'w4',
      performed_at: '2026-08-12T10:00:00.000Z',
      sets: [
        makeSet({ weight_kg: 80, reps: 10, set_index: 0 }),
        makeSet({ weight_kg: 100, reps: 5, set_index: 1 }),
        makeSet({ weight_kg: 90, reps: 8, set_index: 2 }),
      ],
    };
    expect(previousPerformance([session])?.top_set.weight_kg).toBe(100);
    expect(previousPerformance([session])?.working_sets).toHaveLength(3);
  });
});

describe('sets per muscle group', () => {
  it('credits the primary muscle in full and secondaries at half', () => {
    const squat = makeExercise({
      primary_muscle: 'quadriceps',
      secondary_muscles: ['glutes', 'hamstrings'],
    });
    const sets = [makeSet(), makeSet()];
    const map = new Map(sets.map((set) => [set.id, squat]));

    const totals = setsPerMuscle(sets, map);
    expect(totals.get('quadriceps')).toBe(2);
    expect(totals.get('glutes')).toBe(1);
    expect(totals.get('hamstrings')).toBe(1);
  });

  it('counts child sets toward the muscle total', () => {
    const squat = makeExercise({ primary_muscle: 'quadriceps', secondary_muscles: [] });
    const { parent, children } = makeDropSet({ weight_kg: 100, reps: 5 }, [80, 60]);
    const all = [parent, ...children];
    const map = new Map(all.map((set) => [set.id, squat]));

    expect(setsPerMuscle(all, map).get('quadriceps')).toBe(3);
  });
});

describe('Epley estimate', () => {
  it('matches the formula in the brief', () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 10);
  });

  it('returns the weight itself for a single', () => {
    expect(estimate1RM(140, 1)).toBeCloseTo(140 * (1 + 1 / 30), 10);
  });

  it('returns zero for a set that was not performed', () => {
    expect(estimate1RM(100, 0)).toBe(0);
    expect(estimate1RM(0, 5)).toBe(0);
  });
});
