import { describe, expect, it } from 'vitest';
import { summariseSession } from './sessionSummary';
import { makeDropSet, makeExercise, makeSet } from './testFactories';
import type { Workout } from '@/db/schema';

const workout = (overrides: Partial<Workout> = {}): Workout => ({
  id: 'w1',
  routine_id: null,
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
});

describe('session summary', () => {
  it('reports duration, volume and set count', () => {
    const squat = makeExercise({ secondary_muscles: [] });
    const summary = summariseSession({
      workout: workout(),
      exercises: [
        {
          exercise: squat,
          sets: [makeSet({ weight_kg: 100, reps: 5 }), makeSet({ weight_kg: 100, reps: 5 })],
          priorSets: [],
        },
      ],
    });

    expect(summary.duration_ms).toBe(3_600_000);
    expect(summary.tonnage_kg).toBe(1000);
    expect(summary.set_count).toBe(2);
    expect(summary.rep_count).toBe(10);
    expect(summary.exercise_count).toBe(1);
  });

  it('counts drop sets in the volume but not in the PRs', () => {
    const squat = makeExercise({ secondary_muscles: [] });
    const { parent, children } = makeDropSet({ weight_kg: 100, reps: 5 }, [60]);

    const summary = summariseSession({
      workout: workout(),
      exercises: [
        {
          exercise: squat,
          sets: [parent, ...children],
          priorSets: [makeSet({ weight_kg: 95, reps: 5 })],
        },
      ],
    });

    expect(summary.set_count).toBe(2);
    // 100x5 + 60x8
    expect(summary.tonnage_kg).toBe(980);
    const weightPr = summary.prs.find((pr) => pr.kind === 'weight');
    expect(weightPr?.value).toBe(100);
  });

  it('names the exercise a PR was hit on', () => {
    const bench = makeExercise({ name: 'Barbell Bench Press', secondary_muscles: [] });
    const summary = summariseSession({
      workout: workout(),
      exercises: [
        { exercise: bench, sets: [makeSet({ weight_kg: 110, reps: 3 })], priorSets: [makeSet({ weight_kg: 100, reps: 3 })] },
      ],
    });
    expect(summary.prs[0]?.exercise_name).toBe('Barbell Bench Press');
  });

  it('compares against the last run of the same routine', () => {
    const squat = makeExercise({ secondary_muscles: [] });
    const summary = summariseSession({
      workout: workout({ routine_id: 'r1' }),
      exercises: [{ exercise: squat, sets: [makeSet({ weight_kg: 100, reps: 5 })], priorSets: [] }],
      previousSameRoutine: {
        workout: workout({ id: 'w0', started_at: '2026-07-25T10:00:00.000Z', finished_at: '2026-07-25T11:00:00.000Z' }),
        sets: [makeSet({ weight_kg: 90, reps: 5 })],
      },
    });

    expect(summary.comparison?.tonnage_delta_kg).toBe(50);
    expect(summary.comparison?.set_delta).toBe(0);
  });

  it('ranks muscle groups by how much work they took', () => {
    const squat = makeExercise({ primary_muscle: 'quadriceps', secondary_muscles: ['glutes'] });
    const curl = makeExercise({ primary_muscle: 'biceps', secondary_muscles: [] });
    const summary = summariseSession({
      workout: workout(),
      exercises: [
        { exercise: squat, sets: [makeSet(), makeSet(), makeSet()], priorSets: [] },
        { exercise: curl, sets: [makeSet()], priorSets: [] },
      ],
    });

    expect(summary.sets_per_muscle[0]).toEqual({ muscle: 'quadriceps', sets: 3 });
    expect(summary.sets_per_muscle.find((m) => m.muscle === 'glutes')?.sets).toBe(1.5);
  });

  it('leaves duration null while the workout is still running', () => {
    const summary = summariseSession({
      workout: workout({ finished_at: null }),
      exercises: [],
    });
    expect(summary.duration_ms).toBeNull();
  });
});
