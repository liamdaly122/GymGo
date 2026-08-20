/**
 * Exercise search and filtering. Pure, so the picker and the library screen
 * share one definition of what "matching" means.
 */
import type { Exercise } from '@/db/schema';
import type { Equipment, MovementPattern, Muscle } from './types';
import { STAPLE_SCORE, stapleTier } from './programmes/staples';

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

export interface SwapSuggestions {
  /** Same movement, same muscle. The closest thing to what you were going to do. */
  direct: Exercise[];
  /** Same movement OR same muscle, not both. Looser, still worth doing. */
  alternative: Exercise[];
}

/** Everything a candidate is scored on, beyond which tier it lands in. */
function swapScore(candidate: Exercise, original: Exercise): number {
  // Reach for lifts a coach would name. Without this the list opens with a
  // Barbell Guillotine Bench Press, for the same reason generated plans used to.
  let score = STAPLE_SCORE[stapleTier(candidate.source_id, candidate.name)];

  if (candidate.is_compound === original.is_compound) score += 6;
  if (candidate.equipment === original.equipment) score += 3;
  if (candidate.is_unilateral === original.is_unilateral) score += 2;
  if (candidate.experience_level === original.experience_level) score += 1;

  // Secondary muscles overlapping is a real signal that it trains the same thing.
  const shared = candidate.secondary_muscles.filter((muscle) =>
    original.secondary_muscles.includes(muscle),
  ).length;
  score += Math.min(shared, 3);

  return score;
}

/**
 * Alternatives for an exercise, for when a rack is taken.
 *
 * Two tiers, because "give me something else" has two different answers. The
 * direct tier trains the same muscle through the same movement — the swap you
 * would make without thinking. The alternative tier matches on one or the other:
 * the same press pattern led by a different muscle, or the same muscle worked a
 * different way. Both are useful; conflating them buries the obvious choice.
 */
export function swapSuggestions(
  exercise: Exercise,
  candidates: Exercise[],
  options: { availableEquipment?: Equipment[] | null; limit?: number } = {},
): SwapSuggestions {
  const available = options.availableEquipment ?? null;
  const limit = options.limit ?? 8;
  const restrict = Array.isArray(available) && available.length > 0;

  const direct: Exercise[] = [];
  const alternative: Exercise[] = [];

  for (const candidate of candidates) {
    if (candidate.id === exercise.id) continue;
    if (candidate.deleted_at !== null) continue;
    if (restrict && !available.includes(candidate.equipment)) continue;

    const samePattern = candidate.movement_pattern === exercise.movement_pattern;
    const sameMuscle = candidate.primary_muscle === exercise.primary_muscle;

    if (samePattern && sameMuscle) direct.push(candidate);
    else if (samePattern || sameMuscle) alternative.push(candidate);
  }

  const rank = (list: Exercise[]) =>
    list
      .map((candidate) => ({ candidate, score: swapScore(candidate, exercise) }))
      .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, 'en'))
      .slice(0, limit)
      .map((entry) => entry.candidate);

  return { direct: rank(direct), alternative: rank(alternative) };
}
