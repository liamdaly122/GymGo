/**
 * Levels: how much XP each one takes, and what it is called.
 *
 * Each level asks 100 XP more than the one before, starting at 300. Early on
 * that is a level every couple of sessions, which is the point — the habit is
 * young and needs the most feeding. By level 10 it is about one a week, and a
 * year of steady training lands around level 30.
 *
 * Pure.
 */

/** XP to go from level 1 to level 2. */
export const FIRST_LEVEL_XP = 300;
/** How much more each level after that asks. */
export const LEVEL_XP_STEP = 100;

/** XP needed to go from `level` to the next one. */
export function xpForNextLevel(level: number): number {
  return FIRST_LEVEL_XP + LEVEL_XP_STEP * (Math.max(1, level) - 1);
}

/** Total XP at which `level` begins. Level 1 begins at nothing. */
export function xpAtLevel(level: number): number {
  const steps = Math.max(0, Math.floor(level) - 1);
  return FIRST_LEVEL_XP * steps + (LEVEL_XP_STEP * steps * (steps - 1)) / 2;
}

/** Names worn from each level on. Gym words, not ranks in somebody's army. */
const TITLES: ReadonlyArray<{ from: number; title: string }> = [
  { from: 1, title: 'Rookie' },
  { from: 5, title: 'Regular' },
  { from: 10, title: 'Grinder' },
  { from: 15, title: 'Iron' },
  { from: 20, title: 'Steel' },
  { from: 30, title: 'Titan' },
  { from: 40, title: 'Legend' },
];

export function titleFor(level: number): string {
  let title = TITLES[0]!.title;
  for (const band of TITLES) if (level >= band.from) title = band.title;
  return title;
}

export interface LevelProgress {
  level: number;
  title: string;
  /** XP earned since this level began. */
  into: number;
  /** XP this level takes, start to finish. */
  span: number;
  /** XP still to go to the next level. */
  toNext: number;
  /** How far through the level, 0 to 1. */
  fraction: number;
}

export function levelFor(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpAtLevel(level + 1) <= total) level += 1;
  const span = xpForNextLevel(level);
  const into = total - xpAtLevel(level);
  return { level, title: titleFor(level), into, span, toNext: span - into, fraction: into / span };
}
