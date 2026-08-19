/**
 * Turning a template's slots into actual exercises.
 *
 * Two properties matter here and both are required by the brief.
 *
 * DETERMINISM — the same inputs and the same seed must always produce the same
 * plan, so a plan can be regenerated and compared rather than being a lucky
 * roll you cannot get back.
 *
 * GRACEFUL DEGRADATION — a slot that cannot be filled is reported, never
 * fabricated and never thrown. This is not theoretical: measured against the
 * seed data, a dumbbell-and-bodyweight gym has no hamstring isolation at all,
 * and a bodyweight-only gym has exactly one vertical press. The honest answer
 * is "five of six slots filled", not a blank row or a crash.
 */
import type { Exercise } from '@/db/schema';
import type { Equipment, ExperienceLevel, MovementPattern } from '../types';
import type { SessionSlot, SessionTemplate } from './templates';
import { STAPLE_SCORE, stapleTier } from './staples';

export interface FillOptions {
  /** Equipment the chosen gym has. Null or empty means "assume everything". */
  equipment?: Equipment[] | null;
  experience?: ExperienceLevel;
  /** Injuries, dislikes, anything the user has ruled out. */
  excludeExerciseIds?: readonly string[];
  /** Same seed, same plan. */
  seed?: number;
  /** Exercises already used elsewhere this week, deprioritised for variety. */
  usedThisWeek?: ReadonlySet<string>;
}

export interface FilledSlot {
  slot: SessionSlot;
  exercise: Exercise;
}

export interface FillResult {
  template: SessionTemplate;
  filled: FilledSlot[];
  /** Slots the gym could not cover. The UI says so rather than hiding it. */
  unfilled: SessionSlot[];
}

/** FNV-1a. Small, stable, and good enough to break ties reproducibly. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const EXPERIENCE_RANK: Record<ExperienceLevel, number> = {
  beginner: 0,
  intermediate: 1,
  expert: 2,
};

function patternsFor(slot: SessionSlot): MovementPattern[] {
  return [slot.pattern, ...(slot.fallback ?? [])];
}

/**
 * Scores a candidate for a slot. Higher is better; ties are broken by a stable
 * hash of the seed and the exercise, never by array order.
 */
function score(
  exercise: Exercise,
  slot: SessionSlot,
  patternIndex: number,
  options: FillOptions,
): number {
  let total = 0;

  // A fallback pattern is a compromise, so rank it below the real thing.
  total -= patternIndex * 20;

  // Reach for the lifts a coach would actually write down. Without this every
  // variant of a bench press scores identically and the tiebreak picks one at
  // random, which is how a plan ends up opening with a guillotine press.
  total += STAPLE_SCORE[stapleTier(exercise.source_id, exercise.name)];

  if (slot.muscle && exercise.primary_muscle === slot.muscle) total += 10;
  else if (slot.muscle && exercise.secondary_muscles.includes(slot.muscle)) total += 3;

  // Primaries want the big lifts; accessories want the small ones.
  if (slot.role === 'primary') {
    total += exercise.is_compound ? 6 : 0;
    total += exercise.fatigue_cost;
  } else if (slot.role === 'accessory') {
    total += exercise.is_compound ? 0 : 4;
    total += 5 - exercise.fatigue_cost;
  } else {
    total += exercise.is_compound ? 3 : 1;
  }

  // Prefer lifts at or below the lifter's level: an expert can do a beginner
  // movement, but handing a beginner an expert one is how people get hurt.
  const level = options.experience ?? 'intermediate';
  const gap = EXPERIENCE_RANK[exercise.experience_level] - EXPERIENCE_RANK[level];
  total += gap <= 0 ? 3 + gap : -6 * gap;

  // Spread work across the week rather than repeating one lift everywhere.
  if (options.usedThisWeek?.has(exercise.id)) total -= 12;

  return total;
}

function candidatesFor(
  slot: SessionSlot,
  exercises: Exercise[],
  options: FillOptions,
  taken: ReadonlySet<string>,
): Array<{ exercise: Exercise; patternIndex: number }> {
  const equipment = options.equipment;
  const restrictEquipment = Array.isArray(equipment) && equipment.length > 0;
  const excluded = new Set(options.excludeExerciseIds ?? []);
  const patterns = patternsFor(slot);

  const results: Array<{ exercise: Exercise; patternIndex: number }> = [];

  for (const exercise of exercises) {
    if (exercise.deleted_at !== null) continue;
    if (taken.has(exercise.id) || excluded.has(exercise.id)) continue;
    if (restrictEquipment && !equipment.includes(exercise.equipment)) continue;
    if (slot.compoundOnly && !exercise.is_compound) continue;
    if (slot.requireMuscle && slot.muscle && exercise.primary_muscle !== slot.muscle) continue;

    const patternIndex = patterns.indexOf(exercise.movement_pattern);
    if (patternIndex === -1) continue;

    results.push({ exercise, patternIndex });
  }

  return results;
}

export function fillSession(
  template: SessionTemplate,
  exercises: Exercise[],
  options: FillOptions = {},
): FillResult {
  const seed = options.seed ?? 0;
  const taken = new Set<string>();
  const filled: FilledSlot[] = [];
  const unfilled: SessionSlot[] = [];

  for (const [slotIndex, slot] of template.slots.entries()) {
    const candidates = candidatesFor(slot, exercises, options, taken);

    if (candidates.length === 0) {
      unfilled.push(slot);
      continue;
    }

    const best = candidates
      .map((candidate) => ({
        ...candidate,
        value: score(candidate.exercise, slot, candidate.patternIndex, options),
        tiebreak: hash(`${seed}:${template.id}:${slotIndex}:${candidate.exercise.id}`),
      }))
      .sort((a, b) => b.value - a.value || a.tiebreak - b.tiebreak)[0]!;

    taken.add(best.exercise.id);
    filled.push({ slot, exercise: best.exercise });
  }

  return { template, filled, unfilled };
}

/**
 * Fills a whole week, threading the exercises already chosen through each
 * session so the same lift does not turn up on every day.
 */
export function fillWeek(
  templates: SessionTemplate[],
  exercises: Exercise[],
  options: FillOptions = {},
): FillResult[] {
  const usedThisWeek = new Set<string>(options.usedThisWeek ?? []);

  return templates.map((template) => {
    const result = fillSession(template, exercises, { ...options, usedThisWeek });
    for (const entry of result.filled) usedThisWeek.add(entry.exercise.id);
    return result;
  });
}
