import { describe, expect, it } from 'vitest';
import type { WorkoutSet } from '@/db/schema';
import { buildWatchSnapshot, upNextFor, WATCH_FINISH, WATCH_REASON_MAX, weightLadder, type WatchEntryInput, type WatchInput } from './watch';
import type { LoadingProfile } from './plates';
import type { PreviousPerformance } from './previousPerformance';
import { makeSet } from './testFactories';

const BAR: LoadingProfile = { mode: 'barbell', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
const DUMBBELL: LoadingProfile = { mode: 'fixed_step', step: 2.5 };
const STACK: LoadingProfile = { mode: 'fixed_step', step: 5 };

/** A set still to do, typed into nothing. */
function todo(we: string, index: number, overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return makeSet({
    id: `${we}-s${index}`, workout_exercise_id: we, set_index: index,
    weight_kg: 0, reps: 0, completed: false, completed_at: null, ...overrides,
  });
}

function done(we: string, index: number, weight: number, reps: number, at: string, overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return makeSet({
    id: `${we}-s${index}`, workout_exercise_id: we, set_index: index,
    weight_kg: weight, reps, completed: true, completed_at: at, ...overrides,
  });
}

function entry(we: string, overrides: Partial<WatchEntryInput> = {}): WatchEntryInput {
  return {
    workoutExerciseId: we,
    exerciseId: `ex-${we}`,
    name: `Lift ${we}`,
    equipment: 'barbell',
    technique: 'straight',
    restSeconds: 150,
    setupNote: null,
    loading: BAR,
    sets: [todo(we, 0), todo(we, 1), todo(we, 2)],
    suggestion: { weight_kg: 100, reps: 5, kind: 'add_weight', reason: 'You hit 5 on every set last time, so add 2.5kg.' },
    previous: null,
    priorMarks: null,
    repRange: null,
    ...overrides,
  };
}

function previous(day: string, sets: Array<[number, number]>): PreviousPerformance {
  const working = sets.map(([weight, reps], index) => done('old', index, weight, reps, `${day}T17:0${index}:00.000Z`));
  const top = working.reduce((best, set) => (set.weight_kg > best.weight_kg || (set.weight_kg === best.weight_kg && set.reps > best.reps) ? set : best));
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return { workout_id: 'w-0', performed_at: new Date(y, m - 1, d, 12).toISOString(), top_set: top, working_sets: working };
}

function input(entries: WatchEntryInput[], stations?: WatchInput['stations']): WatchInput {
  return {
    workoutId: 'w-1',
    title: 'Push A',
    startedAt: '2026-10-14T17:00:00.000Z',
    sentAt: '2026-10-14T17:05:00.000Z',
    entries,
    stations: stations ?? entries.map((e, index) => ({ members: [index], name: e.name, outline: `Barbell · ${e.sets.length} × 5` })),
  };
}

describe('the list the watch walks', () => {
  it('holds every set still to do, in order, with the phone\'s labels and numbers', () => {
    const snapshot = buildWatchSnapshot(input([entry('a')]));
    expect(snapshot.sets.map((set) => set.label)).toEqual(['Set 1 of 3', 'Set 2 of 3', 'Set 3 of 3']);
    expect(snapshot.sets[0]).toMatchObject({ weight: 100, reps: 5, source: 'suggestion', carries: true });
  });

  it('leaves out what is already done, and carries the set just done', () => {
    const a = entry('a', {
      sets: [done('a', 0, 102.5, 6, '2026-10-14T17:03:00.000Z'), todo('a', 1), todo('a', 2)],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.sets.map((set) => set.id)).toEqual(['a-s1', 'a-s2']);
    expect(snapshot.sets[0]).toMatchObject({ weight: 102.5, reps: 6, source: 'carried' });
    expect(snapshot.lifts['ex-a']!.doneToday).toEqual([
      { setId: 'a-s0', weight: 102.5, reps: 6, completedAt: '2026-10-14T17:03:00.000Z' },
    ]);
  });

  it('keeps what was typed on the phone and does not carry over it', () => {
    const a = entry('a', { sets: [todo('a', 0, { weight_kg: 90, reps: 8 })] });
    expect(buildWatchSnapshot(input([a])).sets[0]).toMatchObject({ weight: 90, reps: 8, source: 'typed', carries: false });
  });

  /**
   * Reps typed into a set's sheet on the phone, and no weight. The phone shows
   * and would log the placeholder weight; the list sent 0kg, the bottom of the
   * Crown's ladder, so Done on the wrist logged a barbell lift at nothing.
   */
  it('starts a set with only its reps typed at the weight the phone shows, and does not carry over it', () => {
    const a = entry('a', { sets: [todo('a', 0, { reps: 8 }), todo('a', 1)] });
    expect(buildWatchSnapshot(input([a])).sets[0]).toMatchObject({ weight: 100, reps: 8, source: 'suggestion', carries: false });
  });

  it('starts a set with only its weight typed at the reps the phone shows, and does not carry over it', () => {
    const a = entry('a', { sets: [todo('a', 0, { weight_kg: 90 }), todo('a', 1)] });
    expect(buildWatchSnapshot(input([a])).sets[0]).toMatchObject({ weight: 90, reps: 5, source: 'suggestion', carries: false });
  });

  it('fills the untyped field from the set just done, from the second set on', () => {
    const a = entry('a', { sets: [done('a', 0, 102.5, 6, '2026-10-14T17:03:00.000Z'), todo('a', 1, { reps: 8 })] });
    expect(buildWatchSnapshot(input([a])).sets[0]).toMatchObject({ weight: 102.5, reps: 8, source: 'carried', carries: false });
  });

  it('rests after each working set, and says what is next', () => {
    const snapshot = buildWatchSnapshot(input([entry('a'), entry('b', { restSeconds: 90, sets: [todo('b', 0)] })]));
    const [first, , last, other] = snapshot.sets;
    expect(first).toMatchObject({ restAfter: 150, upNext: { name: 'Lift a', detail: 'Set 2 of 3 · 100 × 5' } });
    // The last set of a station names the next station, as the phone's rest does.
    expect(last).toMatchObject({ restAfter: 150, upNext: { name: 'Lift b', detail: 'Barbell · 1 × 5' } });
    expect(other).toMatchObject({ restAfter: 90, upNext: { name: 'Finish', detail: 'Last set done' } });
  });

  it('runs warm-ups first, numbered on their own, with no rest after them', () => {
    const a = entry('a', {
      sets: [todo('a', 0, { type: 'warmup', weight_kg: 20, reps: 10 }), todo('a', 1, { type: 'warmup', weight_kg: 60, reps: 5 }), todo('a', 2)],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.sets.map((set) => set.label)).toEqual(['Warm-up 1 of 2', 'Warm-up 2 of 2', 'Set 1 of 1']);
    expect(snapshot.sets.map((set) => set.restAfter)).toEqual([null, null, 150]);
    expect(snapshot.sets[0]).toMatchObject({ carries: false, source: 'typed' });
  });

  it('alternates a superset round by round, resting after the pair', () => {
    const a = entry('a', { sets: [todo('a', 0), todo('a', 1)] });
    const b = entry('b', { sets: [todo('b', 0), todo('b', 1)], restSeconds: 90 });
    const snapshot = buildWatchSnapshot(input([a, b], [{ members: [0, 1], name: 'Lift a + Lift b', outline: 'Superset · Barbell' }]));
    expect(snapshot.sets.map((set) => set.id)).toEqual(['a-s0', 'b-s0', 'a-s1', 'b-s1']);
    expect(snapshot.sets.map((set) => set.restAfter)).toEqual([null, 90, null, 90]);
    expect(snapshot.sets[0]!.upNext.name).toBe('Lift b');
  });

  it('puts a continuation straight after its parent, with no rest between', () => {
    const a = entry('a', {
      sets: [todo('a', 0), todo('a', 1, { type: 'drop', parent_set_id: 'a-s0', weight_kg: 80 }), todo('a', 2)],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.sets.map((set) => set.id)).toEqual(['a-s0', 'a-s1', 'a-s2']);
    expect(snapshot.sets[0]!.restAfter).toBeNull();
    expect(snapshot.sets[1]).toMatchObject({ label: 'Drop · set 1', carries: false });
  });

  it('tells a pyramid\'s back-off sets which set they aim off', () => {
    const a = entry('a', {
      technique: 'reverse_pyramid',
      sets: [todo('a', 0), todo('a', 1, { type: 'back_off' }), todo('a', 2, { type: 'back_off' })],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.sets[0]).toMatchObject({ scheme: null, carries: true });
    expect(snapshot.sets[1]).toMatchObject({ label: 'Set 2 of 3 · Back-off', source: 'scheme', scheme: { stepsFromTop: 1, topSetId: 'a-s0' }, carries: false });
    // 10% lighter than the suggested top set, down through the plates, two more reps.
    expect(snapshot.sets[1]).toMatchObject({ weight: 90, reps: 7 });
    expect(snapshot.sets[2]).toMatchObject({ weight: 80, reps: 9 });
  });

  it('starts unloaded bodyweight work at zero', () => {
    const a = entry('a', { equipment: 'bodyweight', loading: { mode: 'free' }, suggestion: null, sets: [todo('a', 0)] });
    expect(buildWatchSnapshot(input([a])).sets[0]).toMatchObject({ weight: 0, reps: null });
    expect(buildWatchSnapshot(input([a])).lifts['ex-a']!.unit).toBe('kg added');
  });

  it('passes on the marks to beat and the setup note', () => {
    const a = entry('a', { priorMarks: { weight: 110, e1rm: 125, unloadedReps: 0 }, setupNote: 'Seat 4, pins at 6' });
    const lift = buildWatchSnapshot(input([a])).lifts['ex-a']!;
    expect(lift.priorMarks).toEqual({ weight: 110, e1rm: 125, unloadedReps: 0 });
    expect(lift.setupNote).toBe('Seat 4, pins at 6');
  });

  it('sends nothing to do once every set is done', () => {
    const a = entry('a', { sets: [done('a', 0, 100, 5, '2026-10-14T17:03:00.000Z')] });
    expect(buildWatchSnapshot(input([a])).sets).toEqual([]);
  });

  it('sends the plan in the phone\'s own word, and its reason', () => {
    const lift = buildWatchSnapshot(input([entry('a')])).lifts['ex-a']!;
    expect(lift.plan).toEqual({ kind: 'add_weight', verb: 'Go up', reason: 'You hit 5 on every set last time, so add 2.5kg.' });
    const none = buildWatchSnapshot(input([entry('a', { suggestion: null })])).lifts['ex-a']!;
    expect(none.plan).toBeNull();
  });

  it('clamps a long reason, and leaves one that fits alone', () => {
    const long = 'A'.repeat(WATCH_REASON_MAX + 40);
    const plan = buildWatchSnapshot(input([entry('a', { suggestion: { weight_kg: 50, reps: 8, kind: 'estimate', reason: long } })])).lifts['ex-a']!.plan!;
    expect(plan.reason).toHaveLength(WATCH_REASON_MAX);
    expect(plan.reason.endsWith('…')).toBe(true);
    expect(plan.verb).toBe('Estimate');
    const fits = 'B'.repeat(WATCH_REASON_MAX);
    expect(buildWatchSnapshot(input([entry('a', { suggestion: { weight_kg: 50, reps: 8, kind: 'repeat', reason: fits } })])).lifts['ex-a']!.plan!.reason).toBe(fits);
  });

  it('sends last time: the day it was done, its best working set, and every working set in order', () => {
    const a = entry('a', { previous: previous('2026-10-03', [[95, 8], [97.5, 8], [97.5, 7]]) });
    expect(buildWatchSnapshot(input([a])).lifts['ex-a']!.lastTime).toEqual({
      day: '2026-10-03',
      top: { weight: 97.5, reps: 8 },
      sets: [{ weight: 95, reps: 8 }, { weight: 97.5, reps: 8 }, { weight: 97.5, reps: 7 }],
    });
    expect(buildWatchSnapshot(input([entry('a')])).lifts['ex-a']!.lastTime).toBeNull();
  });

  it('sends the bottom of the range, or null for freestyle', () => {
    expect(buildWatchSnapshot(input([entry('a', { repRange: { low: 8, high: 10 } })])).lifts['ex-a']!.repLow).toBe(8);
    expect(buildWatchSnapshot(input([entry('a')])).lifts['ex-a']!.repLow).toBeNull();
  });

  it('steps the set after a short one down a notch, as the phone does', () => {
    const a = entry('a', {
      repRange: { low: 8, high: 10 },
      sets: [done('a', 0, 100, 5, '2026-10-14T17:03:00.000Z'), todo('a', 1), todo('a', 2)],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.sets[0]).toMatchObject({ weight: 90, reps: 8, source: 'stepped', carries: true });
    expect(snapshot.sets[0]!.upNext.detail).toBe('Set 3 of 3 · 90 × 8');
  });

  it('marks an AMRAP set, still to do or done, and only when it is one', () => {
    const a = entry('a', {
      repRange: { low: 8, high: 10 },
      sets: [done('a', 0, 100, 5, '2026-10-14T17:03:00.000Z', { is_amrap: true }), todo('a', 1), todo('a', 2, { is_amrap: true })],
    });
    const snapshot = buildWatchSnapshot(input([a]));
    expect(snapshot.lifts['ex-a']!.doneToday).toEqual([
      { setId: 'a-s0', weight: 100, reps: 5, completedAt: '2026-10-14T17:03:00.000Z', amrap: true },
    ]);
    // An AMRAP set that fell short is carried as done.
    expect(snapshot.sets[0]).toMatchObject({ weight: 100, reps: 5, source: 'carried' });
    expect('amrap' in snapshot.sets[0]!).toBe(false);
    expect(snapshot.sets[1]!.amrap).toBe(true);
  });
});

describe('Up next', () => {
  const stations = [{ name: 'Bench Press', outline: 'Barbell · 3 × 6–10' }, { name: 'Fly + Raise', outline: 'Superset · Cable + Dumbbell' }];
  const set = (station: number, name: string, label: string, weight: number | null, reps: number | null) => ({ station, name, label, weight, reps });

  it('names the same lift\'s next set with the numbers it starts at', () => {
    expect(upNextFor(0, set(0, 'Bench Press', 'Set 2 of 3', 102.5, 6), stations)).toEqual({ name: 'Bench Press', detail: 'Set 2 of 3 · 102.5 × 6' });
  });

  it('says BW for unloaded bodyweight work, and leaves the numbers off until there are reps', () => {
    expect(upNextFor(0, set(0, 'Pull-up', 'Set 2 of 3', 0, 8), stations).detail).toBe('Set 2 of 3 · BW × 8');
    expect(upNextFor(0, set(0, 'Pull-up', 'Set 2 of 3', 0, null), stations).detail).toBe('Set 2 of 3');
    expect(upNextFor(0, set(0, 'Pull-up', 'Set 2 of 3', 50, 0), stations).detail).toBe('Set 2 of 3');
  });

  it('names a superset partner by its own lift', () => {
    expect(upNextFor(1, set(1, 'Side Lateral Raise', 'Set 1 of 3', 10, 12), stations)).toEqual({ name: 'Side Lateral Raise', detail: 'Set 1 of 3 · 10 × 12' });
  });

  it('names another station by its name and outline', () => {
    expect(upNextFor(0, set(1, 'Cable Crossover', 'Set 1 of 3', 25, 12), stations)).toEqual({ name: 'Fly + Raise', detail: 'Superset · Cable + Dumbbell' });
  });

  it('says Finish after the last set', () => {
    expect(upNextFor(1, null, stations)).toEqual(WATCH_FINISH);
    expect(WATCH_FINISH).toEqual({ name: 'Finish', detail: 'Last set done' });
  });

  it('is what the list says for every set', () => {
    const a = entry('a', { sets: [todo('a', 0), todo('a', 1)] });
    const b = entry('b', { sets: [todo('b', 0)], suggestion: null });
    const c = entry('c', { sets: [todo('c', 0)], restSeconds: 90 });
    const snapshot = buildWatchSnapshot(input([a, b, c], [
      { members: [0], name: 'Lift a', outline: 'Barbell · 2 × 5' },
      { members: [1, 2], name: 'Lift b + Lift c', outline: 'Superset · Barbell' },
    ]));
    snapshot.sets.forEach((current, index) => {
      const next = snapshot.sets[index + 1];
      expect(current.upNext, current.id).toEqual(upNextFor(
        current.station,
        next ? { station: next.station, name: snapshot.lifts[next.exerciseId]!.name, label: next.label, weight: next.weight, reps: next.reps } : null,
        snapshot.stations,
      ));
    });
  });
});

describe('the weight ladder the Crown moves through', () => {
  it('starts at the bare bar and moves in real plate steps', () => {
    const ladder = weightLadder(BAR, 100);
    expect(ladder.slice(0, 4)).toEqual([20, 22.5, 25, 27.5]);
    expect(ladder).toContain(100);
    expect(ladder.at(-1)!).toBeGreaterThanOrEqual(140);
  });

  it('starts at nothing for dumbbells and stacks, in their own steps', () => {
    expect(weightLadder(DUMBBELL, 20).slice(0, 4)).toEqual([0, 2.5, 5, 7.5]);
    expect(weightLadder(STACK, 50).slice(0, 3)).toEqual([0, 5, 10]);
  });

  it('is strictly ascending', () => {
    for (const profile of [BAR, DUMBBELL, STACK]) {
      const ladder = weightLadder(profile, 120);
      expect(ladder.every((weight, index) => index === 0 || weight > ladder[index - 1]!)).toBe(true);
    }
  });
});
