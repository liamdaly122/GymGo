import { describe, expect, it } from 'vitest';
import type { RoutineExercise } from '@/db/schema';
import { weekModifier } from './programmes/block';
import { layoutFromRoutine, parseStartLayout, rowsFromLayout, type StartLayout } from './startLayout';

let counter = 0;
function row(overrides: Partial<RoutineExercise> = {}): RoutineExercise {
  counter += 1;
  return {
    id: `re-${counter}`,
    routine_id: 'routine-1',
    exercise_id: `exercise-${counter}`,
    position: counter,
    superset_group: null,
    technique: 'straight',
    target_sets: 3,
    rep_range_low: 8,
    rep_range_high: 12,
    target_rir: null,
    tempo: null,
    rest_seconds: null,
    user_id: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

/** Deterministic UUIDs, so a layout can be compared and parsed. */
function idMaker() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

const HEADER = { routineId: 'routine-1', gymId: 'gym-1', slot: null };

describe('laying a routine out', () => {
  it('keeps the routine order by position and skips removed rows', () => {
    const rows = [
      row({ position: 2, exercise_id: 'c' }),
      row({ position: 0, exercise_id: 'a' }),
      row({ position: 1, exercise_id: 'gone', deleted_at: '2026-10-02T10:00:00.000Z' }),
      row({ position: 1, exercise_id: 'b' }),
    ];
    const layout = layoutFromRoutine(rows, HEADER, null, idMaker());
    expect(layout.exercises.map((entry) => entry.exerciseId)).toEqual(['a', 'b', 'c']);
  });

  it('copies the superset, technique, typed rest and tempo; a generated row rests as its lift', () => {
    const rows = [
      row({ position: 0, superset_group: 'g1', rest_seconds: 210, tempo: '3-1-1-0' }),
      row({ position: 1, superset_group: 'g1', technique: 'drop_set' }),
    ];
    const [first, second] = layoutFromRoutine(rows, HEADER, null, idMaker()).exercises;
    expect(first).toMatchObject({ supersetGroup: 'g1', technique: 'straight', restSeconds: 210, tempo: '3-1-1-0' });
    expect(second).toMatchObject({ supersetGroup: 'g1', technique: 'drop_set', restSeconds: null, tempo: null });
  });

  it('lays out at least one set, even for a row that asks for none', () => {
    const layout = layoutFromRoutine([row({ target_sets: 0 })], HEADER, null, idMaker());
    expect(layout.exercises[0]!.sets).toHaveLength(1);
  });

  it('reshapes the count by the block week: week 3 adds two, the deload halves', () => {
    const rows = [row({ target_sets: 4 })];
    const count = (week: number | null) =>
      layoutFromRoutine(rows, HEADER, week === null ? null : weekModifier(week, 5), idMaker()).exercises[0]!.sets.length;
    expect(count(null)).toBe(4);
    expect(count(1)).toBe(4);
    expect(count(3)).toBe(6);
    expect(count(5)).toBe(2);
  });

  it('lays out a pyramid as back-off sets around one working top set', () => {
    const rows = [row({ position: 0, technique: 'pyramid', target_sets: 3 }), row({ position: 1, technique: 'reverse_pyramid', target_sets: 3 })];
    const [pyramid, reverse] = layoutFromRoutine(rows, HEADER, null, idMaker()).exercises;
    expect(pyramid!.sets.map((set) => set.type)).toEqual(['back_off', 'back_off', 'working']);
    expect(reverse!.sets.map((set) => set.type)).toEqual(['working', 'back_off', 'back_off']);
  });

  it('gives every row its own ID and carries the header', () => {
    const slot = { planId: 'plan-1', week: 2, sessionIndex: 1 };
    const layout = layoutFromRoutine([row(), row()], { ...HEADER, slot }, null, idMaker());
    const ids = [layout.workoutId, ...layout.exercises.flatMap((entry) => [entry.id, ...entry.sets.map((set) => set.id)])];
    expect(new Set(ids).size).toBe(ids.length);
    expect(layout).toMatchObject({ routineId: 'routine-1', gymId: 'gym-1', slot });
  });
});

describe('the rows a layout becomes', () => {
  const layout = layoutFromRoutine(
    [row({ position: 0, superset_group: 'g1', rest_seconds: 90, tempo: '2-0-1-0' }), row({ position: 1, technique: 'reverse_pyramid', target_sets: 2 })],
    { ...HEADER, slot: { planId: 'plan-1', week: 3, sessionIndex: 0 } },
    null,
    idMaker(),
  );
  const at = { startedAt: '2026-10-14T17:00:00.000Z', now: '2026-10-14T17:05:00.000Z', readiness: null };

  it('heads the workout with the filing, not the slot it was offered', () => {
    const { workout } = rowsFromLayout(layout, { planId: 'plan-1', week: null, sessionIndex: null }, at);
    expect(workout).toMatchObject({
      id: layout.workoutId,
      routine_id: 'routine-1',
      plan_id: 'plan-1',
      plan_week: null,
      plan_session_index: null,
      gym_id: 'gym-1',
      started_at: at.startedAt,
      finished_at: null,
      readiness: null,
      created_at: at.now,
      updated_at: at.now,
      deleted_at: null,
      user_id: null,
    });
  });

  it('writes the layout IDs, positions and prescription, and every set empty, unticked and unjudged', () => {
    const { workoutExercises, sets } = rowsFromLayout(layout, { planId: null, week: null, sessionIndex: null }, at);
    expect(workoutExercises.map((we) => [we.id, we.position, we.workout_id])).toEqual(
      layout.exercises.map((entry, index) => [entry.id, index, layout.workoutId]),
    );
    expect(workoutExercises[0]).toMatchObject({ superset_group: 'g1', rest_seconds: 90, tempo: '2-0-1-0', notes: null });
    expect(sets.map((set) => set.id)).toEqual(layout.exercises.flatMap((entry) => entry.sets.map((set) => set.id)));
    expect(sets.filter((set) => set.workout_exercise_id === layout.exercises[1]!.id).map((set) => [set.set_index, set.type])).toEqual([
      [0, 'working'],
      [1, 'back_off'],
    ]);
    for (const set of sets) {
      expect(set).toMatchObject({ weight_kg: 0, reps: 0, rir: null, is_amrap: false, completed: false, completed_at: null, parent_set_id: null });
    }
  });
});

describe('reading a layout back from the watch', () => {
  const good = (): StartLayout =>
    layoutFromRoutine(
      [row({ position: 0, technique: 'pyramid' }), row({ position: 1, superset_group: 'g', rest_seconds: 60 })],
      { ...HEADER, slot: { planId: 'plan-1', week: 1, sessionIndex: 2 } },
      null,
      idMaker(),
    );

  it('reads back exactly what was laid out, through JSON', () => {
    const layout = good();
    expect(parseStartLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });

  it('leaves unknown fields behind', () => {
    const layout = good();
    expect(parseStartLayout({ ...layout, extra: true })).toEqual(layout);
  });

  it('refuses anything that is not a layout', () => {
    expect(parseStartLayout(null)).toBeNull();
    expect(parseStartLayout('layout')).toBeNull();
    expect(parseStartLayout([])).toBeNull();
    expect(parseStartLayout({ ...good(), exercises: 'none' })).toBeNull();
  });

  it('refuses an ID that is not a UUID', () => {
    expect(parseStartLayout({ ...good(), workoutId: 'w-1' })).toBeNull();
    const layout = good();
    layout.exercises[0]!.sets[0]!.id = 'set-1';
    expect(parseStartLayout(layout)).toBeNull();
  });

  it('refuses an ID used twice', () => {
    const layout = good();
    layout.exercises[1]!.sets[0]!.id = layout.exercises[0]!.sets[0]!.id;
    expect(parseStartLayout(layout)).toBeNull();
    const sameAsWorkout = good();
    sameAsWorkout.exercises[0]!.id = sameAsWorkout.workoutId.toUpperCase();
    expect(parseStartLayout(sameAsWorkout)).toBeNull();
  });

  it('refuses an unknown set type or technique', () => {
    const badType = good() as unknown as { exercises: Array<{ sets: Array<{ type: string }>; technique: string }> };
    badType.exercises[0]!.sets[0]!.type = 'giant';
    expect(parseStartLayout(badType)).toBeNull();
    const badTechnique = good() as unknown as { exercises: Array<{ technique: string }> };
    badTechnique.exercises[0]!.technique = 'chaos';
    expect(parseStartLayout(badTechnique)).toBeNull();
  });

  it('refuses a slot or a rest that cannot be right', () => {
    expect(parseStartLayout({ ...good(), slot: { planId: 'plan-1', week: 0, sessionIndex: 0 } })).toBeNull();
    expect(parseStartLayout({ ...good(), slot: { planId: 'plan-1', week: 1, sessionIndex: -1 } })).toBeNull();
    const negative = good();
    negative.exercises[0]!.restSeconds = -5;
    expect(parseStartLayout(negative)).toBeNull();
  });

  it('accepts a session with nothing in it', () => {
    const empty = layoutFromRoutine([], HEADER, null, idMaker());
    expect(parseStartLayout(empty)).toEqual(empty);
  });
});
