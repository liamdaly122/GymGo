import { describe, expect, it } from 'vitest';
import type { WorkoutSet } from '@/db/schema';
import { buildWatchSnapshot, weightLadder, type WatchEntryInput, type WatchInput } from './watch';
import type { LoadingProfile } from './plates';
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

function done(we: string, index: number, weight: number, reps: number, at: string): WorkoutSet {
  return makeSet({
    id: `${we}-s${index}`, workout_exercise_id: we, set_index: index,
    weight_kg: weight, reps, completed: true, completed_at: at,
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
    suggestion: { weight_kg: 100, reps: 5 },
    previous: null,
    priorMarks: null,
    ...overrides,
  };
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
