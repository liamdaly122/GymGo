/**
 * Exercise search and filtering. Pure, so the picker and the library screen
 * share one definition of what "matching" means.
 */
import type { Exercise } from '@/db/schema';
import type { Equipment, MovementPattern, Muscle } from './types';

export interface ExerciseFilters {
  query?: string;
  muscle?: Muscle | null;
  pattern?: MovementPattern | null;
  equipment?: Equipment | null;
  /** Restricts to equipment present at the selected gym. */
  availableEquipment?: Equipment[] | null;
  customOnly?: boolean;
}

/** Case- and punctuation-insensitive, so "pull up" finds "Pull-Up". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * All query terms must appear somewhere in the exercise's searchable text, in
 * any order — so "db incline" and "incline dumbbell" both find the same lift.
 */
function matchesQuery(exercise: Exercise, query: string): boolean {
  const terms = normalise(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalise(
    [exercise.name, exercise.primary_muscle, ...exercise.secondary_muscles, exercise.equipment]
      .join(' '),
  );
  return terms.every((term) => haystack.includes(term));
}

export function filterExercises(exercises: Exercise[], filters: ExerciseFilters): Exercise[] {
  return exercises.filter((exercise) => {
    if (exercise.deleted_at !== null) return false;
    if (filters.customOnly && !exercise.is_custom) return false;
    if (filters.muscle && exercise.primary_muscle !== filters.muscle) return false;
    if (filters.pattern && exercise.movement_pattern !== filters.pattern) return false;
    if (filters.equipment && exercise.equipment !== filters.equipment) return false;
    if (
      filters.availableEquipment &&
      filters.availableEquipment.length > 0 &&
      !filters.availableEquipment.includes(exercise.equipment)
    ) {
      return false;
    }
    if (filters.query && !matchesQuery(exercise, filters.query)) return false;
    return true;
  });
}

/**
 * Alternatives for an exercise, for when a rack is taken.
 *
 * Same movement pattern is the requirement — that is what makes the swap
 * train the same thing. Sharing the primary muscle and being available at the
 * current gym rank a candidate higher.
 */
export function swapSuggestions(
  exercise: Exercise,
  candidates: Exercise[],
  options: { availableEquipment?: Equipment[] | null; limit?: number } = {},
): Exercise[] {
  const available = options.availableEquipment ?? null;

  return candidates
    .filter(
      (candidate) =>
        candidate.id !== exercise.id &&
        candidate.deleted_at === null &&
        candidate.movement_pattern === exercise.movement_pattern &&
        (!available || available.length === 0 || available.includes(candidate.equipment)),
    )
    .map((candidate) => {
      let score = 0;
      if (candidate.primary_muscle === exercise.primary_muscle) score += 4;
      if (candidate.is_compound === exercise.is_compound) score += 2;
      if (candidate.equipment === exercise.equipment) score += 1;
      if (candidate.is_unilateral === exercise.is_unilateral) score += 1;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, 'en'))
    .slice(0, options.limit ?? 8)
    .map((entry) => entry.candidate);
}
