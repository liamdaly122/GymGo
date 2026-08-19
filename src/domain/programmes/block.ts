/**
 * The five-week training block.
 *
 * The brief: "plans run in five week blocks. Weeks one to four progress, week
 * five is a deload at roughly half the working volume." That matches the
 * accumulation model in the literature — start a couple of reps shy of failure,
 * add sets and close that gap week by week, then take a week off the gas.
 *
 * Pure. Feeds the existing `prescribe()` rather than duplicating its table.
 */

export interface WeekModifier {
  week: number;
  totalWeeks: number;
  /** "Foundations", "Build", "Peak", "Deload" — shown as "Week 2/5 — Build". */
  label: string;
  /** Extra working sets added to each exercise this week. */
  extraSets: number;
  /** Multiplies the prescribed sets. Only the deload uses this. */
  setMultiplier: number;
  /** Multiplies the suggested load. Only the deload uses this. */
  loadMultiplier: number;
  /** How many reps short of failure to stop, this week. */
  targetRir: number;
  isDeload: boolean;
  /** One line explaining what this week is for. */
  intent: string;
}

const DEFAULT_BLOCK: Omit<WeekModifier, 'week' | 'totalWeeks'>[] = [
  {
    label: 'Foundations',
    extraSets: 0,
    setMultiplier: 1,
    loadMultiplier: 1,
    targetRir: 3,
    isDeload: false,
    intent: 'Find your weights and leave a few reps in the tank.',
  },
  {
    label: 'Build',
    extraSets: 1,
    setMultiplier: 1,
    loadMultiplier: 1,
    targetRir: 2,
    isDeload: false,
    intent: 'One more set per exercise, pushed a little closer to failure.',
  },
  {
    label: 'Build',
    extraSets: 2,
    setMultiplier: 1,
    loadMultiplier: 1,
    targetRir: 2,
    isDeload: false,
    intent: 'More volume again. This is where most of the work happens.',
  },
  {
    label: 'Peak',
    extraSets: 2,
    setMultiplier: 1,
    loadMultiplier: 1,
    targetRir: 1,
    isDeload: false,
    intent: 'The hardest week. Take your sets close to failure.',
  },
  {
    label: 'Deload',
    extraSets: 0,
    setMultiplier: 0.5,
    loadMultiplier: 0.9,
    targetRir: 4,
    isDeload: true,
    intent: 'Half the sets, slightly lighter. This is where the growth catches up.',
  },
];

export const DEFAULT_BLOCK_WEEKS = 5;

/**
 * What week `week` of a block asks for.
 *
 * Weeks outside the block clamp to the nearest real week rather than throwing,
 * so a stale `current_week` can never break the screen.
 */
export function weekModifier(week: number, totalWeeks = DEFAULT_BLOCK_WEEKS): WeekModifier {
  const total = Math.max(1, Math.round(totalWeeks));
  const index = Math.min(Math.max(1, Math.round(week)), total) - 1;

  // A block shorter or longer than five weeks keeps the deload last and
  // stretches the accumulation weeks to fill what is left.
  const accumulationWeeks = DEFAULT_BLOCK.slice(0, -1);
  const deload = DEFAULT_BLOCK[DEFAULT_BLOCK.length - 1]!;

  const isLast = index === total - 1;
  const source = isLast
    ? deload
    : accumulationWeeks[Math.min(index, accumulationWeeks.length - 1)]!;

  return { ...source, week: index + 1, totalWeeks: total };
}

/** Every week of a block, for rendering the whole plan at a glance. */
export function blockWeeks(totalWeeks = DEFAULT_BLOCK_WEEKS): WeekModifier[] {
  const total = Math.max(1, Math.round(totalWeeks));
  return Array.from({ length: total }, (_unused, index) => weekModifier(index + 1, total));
}

/** "Week 2/5 — Build" */
export function formatWeekLabel(modifier: WeekModifier): string {
  return `Week ${modifier.week}/${modifier.totalWeeks} — ${modifier.label}`;
}

/**
 * Applies the week's shape to a prescribed set count.
 *
 * Deload halves rather than adds, and always leaves at least one set: a
 * prescription of zero sets is not a deload, it is a missing exercise.
 */
export function setsForWeek(baseSets: number, modifier: WeekModifier): number {
  const adjusted = modifier.isDeload
    ? baseSets * modifier.setMultiplier
    : baseSets + modifier.extraSets;
  return Math.max(1, Math.round(adjusted));
}
