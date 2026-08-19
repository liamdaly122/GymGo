/**
 * Builders for domain tests. Kept out of the test file so several suites can
 * share one definition of "a set" without drifting apart.
 */
import type { Exercise, Workout, WorkoutSet } from '@/db/schema';
import type { Muscle, SetType } from './types';

let counter = 0;

export function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  counter += 1;
  return {
    id: `set-${counter}`,
    workout_exercise_id: 'we-1',
    parent_set_id: null,
    set_index: 0,
    type: 'working' as SetType,
    weight_kg: 100,
    reps: 5,
    rir: null,
    is_amrap: false,
    completed: true,
    completed_at: '2026-08-01T10:00:00.000Z',
    user_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

/** A drop set: a working top set plus child sets at reduced weight. */
export function makeDropSet(
  top: Partial<WorkoutSet>,
  dropWeights: number[],
): { parent: WorkoutSet; children: WorkoutSet[] } {
  const parent = makeSet(top);
  const children = dropWeights.map((weight, index) =>
    makeSet({
      parent_set_id: parent.id,
      type: 'drop',
      weight_kg: weight,
      reps: 8,
      set_index: parent.set_index + index + 1,
      workout_exercise_id: parent.workout_exercise_id,
    }),
  );
  return { parent, children };
}

export function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  counter += 1;
  return {
    id: `ex-${counter}`,
    name: 'Barbell Squat',
    primary_muscle: 'quadriceps' as Muscle,
    secondary_muscles: ['glutes', 'hamstrings'] as Muscle[],
    equipment: 'barbell',
    movement_pattern: 'squat',
    is_compound: true,
    is_unilateral: false,
    experience_level: 'intermediate',
    fatigue_cost: 5,
    demo_url: null,
    default_rest_seconds: 180,
    setup_notes: null,
    is_custom: false,
    source_id: 'Barbell_Squat',
    increment_kg: null,
    user_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  counter += 1;
  return {
    id: `workout-${counter}`,
    routine_id: null,
    plan_id: null,
    plan_week: null,
    plan_session_index: null,
    gym_id: null,
    started_at: '2026-08-01T10:00:00.000Z',
    finished_at: '2026-08-01T11:00:00.000Z',
    bodyweight_kg: null,
    readiness: null,
    notes: null,
    user_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T11:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}
