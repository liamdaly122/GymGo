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

/**
 * Which lift a name is a version of: "deadlift" for a Sumo Deadlift, "chest
 * press" for an Incline Dumbbell Press.
 *
 * Most specific first, so a leg curl is not filed with biceps curls and a rear
 * delt fly not with chest flyes. Null for a name that is no recognisable
 * family, which simply means it has no variations to offer.
 */
const LIFT_FAMILIES: Array<[RegExp, string]> = [
  [/\bleg press\b/, 'leg press'],
  [/\bleg curls?\b/, 'leg curl'],
  [/\bleg extensions?\b/, 'leg extension'],
  [/\bleg raises?\b/, 'leg raise'],
  [/\bcalf raises?\b/, 'calf raise'],
  [/\brear delt|\breverse fl(y|ye|yes|ies)\b/, 'rear delt fly'],
  [/\bface pulls?\b/, 'face pull'],
  [/\bupright rows?\b/, 'upright row'],
  [/\bhip thrusts?\b|\b(glute|hip) bridges?\b/, 'hip thrust'],
  [/\bgood mornings?\b/, 'good morning'],
  [/\bstep ups?\b/, 'step up'],
  [/\bdeadlifts?\b/, 'deadlift'],
  [/\bsquats?\b/, 'squat'],
  [/\bclean|\bsnatch|\bjerk\b/, 'olympic'],
  [/\blunges?\b/, 'lunge'],
  [/\bpull ?downs?\b/, 'pulldown'],
  [/\bpull ?ups?\b|\bchin ?ups?\b/, 'pull up'],
  [/\bpush ?downs?\b/, 'pushdown'],
  [/\bpush ?ups?\b/, 'push up'],
  [/\bpull ?overs?\b/, 'pullover'],
  [/\bdips?\b/, 'dip'],
  [/\b(bench|chest|floor|incline|decline)( \w+)? press\b/, 'chest press'],
  [/\b(military|overhead|shoulder|arnold|push)( \w+)? press\b/, 'overhead press'],
  [/\b(lateral|side) raises?\b|\bside laterals?\b|\blaterals?\b/, 'lateral raise'],
  [/\bfront\b.*\braises?\b/, 'front raise'],
  [/\bfl(y|ye|yes|ies)\b|\bcrossovers?\b/, 'chest fly'],
  [/\brows?\b/, 'row'],
  [/\bskull ?crushers?\b|\b(triceps?|overhead) extensions?\b|\blying triceps press\b/, 'triceps extension'],
  [/\bhyper ?extensions?\b|\bback extensions?\b/, 'back extension'],
  [/\bcurls?\b/, 'curl'],
  [/\bshrugs?\b/, 'shrug'],
  [/\bcrunch(es)?\b|\bsit ?ups?\b/, 'crunch'],
  [/\bplanks?\b/, 'plank'],
  [/\bswings?\b/, 'swing'],
];

export function liftFamily(name: string): string | null {
  const text = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const [pattern, family] of LIFT_FAMILIES) {
    if (pattern.test(text)) return family;
  }
  return null;
}

/** Primary muscle in full, each secondary at a half — how volume is counted too. */
function muscleProfile(exercise: Exercise): Map<string, number> {
  const profile = new Map<string, number>();
  for (const muscle of exercise.secondary_muscles) profile.set(muscle, 0.5);
  profile.set(exercise.primary_muscle, 1);
  return profile;
}

/**
 * How much two exercises train the same muscles, from 0 to 1: the shared
 * weight over the combined weight. A lift with a long list of secondaries does
 * not get to look like everything.
 */
export function muscleOverlap(a: Exercise, b: Exercise): number {
  const left = muscleProfile(a);
  const right = muscleProfile(b);
  let shared = 0;
  let combined = 0;
  for (const muscle of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(muscle) ?? 0;
    const y = right.get(muscle) ?? 0;
    shared += Math.min(x, y);
    combined += Math.max(x, y);
  }
  return combined === 0 ? 0 : shared / combined;
}

export interface ExerciseAlternatives {
  /** Trains what the original trains, through a different exercise. */
  different: Exercise[];
  /** The same lift another way: another bar, stance, grip or angle. */
  variations: Exercise[];
}

/**
 * What to do instead of an exercise, in two groups, because "swap this" has two
 * meanings.
 *
 * Someone who does not want to deadlift wants something else that trains the
 * hamstrings, glutes and lower back — a hip thrust, a good morning, a swing —
 * not a deadlift with chains. Someone whose rack is taken wants the same lift
 * on other kit. So exercises that are a version of the same lift (by name:
 * every deadlift is a deadlift) are split from the ones that are not, and each
 * group is ranked on its own.
 *
 * The pool is the same as `swapSuggestions` — same movement or same primary
 * muscle — and so is the base scoring: staples first, then a matching role and
 * kit. On top of that, how much the muscles overlap, and Olympic lifts sink
 * unless the original is one: a power clean is a hinge, and a poor answer to
 * "not deadlifts".
 *
 * `excludeIds` keeps out exercises that would land twice in one session.
 */
export function exerciseAlternatives(
  exercise: Exercise,
  candidates: Exercise[],
  options: {
    availableEquipment?: Equipment[] | null;
    excludeIds?: ReadonlySet<string>;
    limit?: number;
  } = {},
): ExerciseAlternatives {
  const available = options.availableEquipment ?? null;
  const restrict = Array.isArray(available) && available.length > 0;
  const limit = options.limit ?? 8;
  const family = liftFamily(exercise.name);

  type Ranked = { candidate: Exercise; score: number; family: string | null };
  const different: Ranked[] = [];
  const variations: Ranked[] = [];

  for (const candidate of candidates) {
    if (candidate.id === exercise.id || candidate.deleted_at !== null) continue;
    if (options.excludeIds?.has(candidate.id)) continue;
    if (restrict && !available.includes(candidate.equipment)) continue;

    const samePattern = candidate.movement_pattern === exercise.movement_pattern;
    const sameMuscle = candidate.primary_muscle === exercise.primary_muscle;
    const overlap = muscleOverlap(candidate, exercise);
    // "Isolation" and "core" are catch-alls, not movements: a curl and a calf
    // raise share the label and nothing else. Elsewhere the movement counts,
    // but only with muscles in common — the dataset files a glute-ham raise
    // under rows.
    const movementCounts =
      samePattern && !LOOSE_PATTERNS.has(exercise.movement_pattern) && overlap >= MIN_OVERLAP;
    if (!sameMuscle && !movementCounts) continue;

    const candidateFamily = liftFamily(candidate.name);
    let score = swapScore(candidate, exercise);
    if (samePattern) score += 8;
    if (sameMuscle) score += 6;
    score += Math.round(overlap * 12);
    if (candidateFamily === 'olympic' && family !== 'olympic') score -= 40;
    // "Other" kit is kegs, sleds and ropes: fine if you have them, a strange
    // first answer to "something instead of squats".
    if (candidate.equipment === 'other' && exercise.equipment !== 'other') score -= 10;

    const entry = { candidate, score, family: candidateFamily };
    if (family !== null && candidateFamily === family) variations.push(entry);
    else different.push(entry);
  }

  const byScore = (a: { candidate: Exercise; score: number }, b: { candidate: Exercise; score: number }) =>
    b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, 'en');

  // One of each kind of exercise: three good mornings is one idea, not three.
  const seenFamilies = new Set<string>();
  const varied = different.sort(byScore).filter((entry) => {
    if (entry.family === null) return true;
    if (seenFamilies.has(entry.family)) return false;
    seenFamilies.add(entry.family);
    return true;
  });

  return {
    different: varied.slice(0, limit).map((entry) => entry.candidate),
    variations: variations.sort(byScore).slice(0, limit).map((entry) => entry.candidate),
  };
}

/** Pattern labels that group exercises without describing a movement. */
const LOOSE_PATTERNS = new Set<string>(['isolation', 'core']);

/** The least muscle overlap at which a shared movement makes a fair swap. */
const MIN_OVERLAP = 0.15;
