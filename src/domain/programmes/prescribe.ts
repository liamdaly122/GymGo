/**
 * How many sets, what rep range, how long to rest.
 *
 * The figures come straight from the brief, which matches the published volume
 * landmarks: hypertrophy 10-20 working sets per muscle per week at 6-12 reps,
 * strength 8-12 sets at 3-6 on the main lifts, general 8-12 sets at 8-15. Rest
 * is 150-180s for compounds and 60-90s for isolation.
 */
import type { Goal } from '../types';
import type { SessionSlot } from './templates';

export interface Prescription {
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  targetRir: number | null;
}

type Role = SessionSlot['role'];

const TABLE: Record<Goal, Record<Role, Prescription>> = {
  hypertrophy: {
    primary: { sets: 4, repLow: 6, repHigh: 10, restSeconds: 180, targetRir: 2 },
    secondary: { sets: 3, repLow: 8, repHigh: 12, restSeconds: 120, targetRir: 2 },
    accessory: { sets: 3, repLow: 10, repHigh: 15, restSeconds: 75, targetRir: 1 },
  },
  strength: {
    primary: { sets: 5, repLow: 3, repHigh: 5, restSeconds: 210, targetRir: 2 },
    secondary: { sets: 3, repLow: 5, repHigh: 8, restSeconds: 150, targetRir: 2 },
    accessory: { sets: 3, repLow: 8, repHigh: 12, restSeconds: 90, targetRir: 1 },
  },
  general: {
    primary: { sets: 3, repLow: 8, repHigh: 12, restSeconds: 120, targetRir: 2 },
    secondary: { sets: 3, repLow: 10, repHigh: 15, restSeconds: 90, targetRir: 2 },
    accessory: { sets: 2, repLow: 12, repHigh: 15, restSeconds: 60, targetRir: 1 },
  },
};

/**
 * Working sets per muscle per week, as the brief sets them: 10 to 20 to build
 * muscle, 8 to 12 for strength — on the main lifts — and for general fitness.
 */
export const WEEKLY_SET_TARGET: Record<Goal, { low: number; high: number }> = {
  hypertrophy: { low: 10, high: 20 },
  strength: { low: 8, high: 12 },
  general: { low: 8, high: 12 },
};

/**
 * Which role a routine row was written for, read back off its prescription.
 *
 * No column records it: a generated row carries the role only as the numbers
 * `prescribe` gave it. Within one goal every role has its own rep range, and
 * only accessories aim for RIR 1, so the range and the RIR together name the
 * role. Rest is no help, because the goal and the lift both stretch it.
 *
 * Null for anything else. A row added by hand has no RIR target, and one the
 * lifter has re-prescribed no longer matches. Either way it is the lifter's
 * choice, and reading a role into it would let the app rotate it away.
 */
export function roleForPrescription(
  profile: Goal,
  row: { rep_range_low: number; rep_range_high: number; target_rir: number | null },
): Role | null {
  const roles = Object.keys(TABLE[profile]) as Role[];
  return (
    roles.find((role) => {
      const base = TABLE[profile][role];
      return (
        base.repLow === row.rep_range_low &&
        base.repHigh === row.rep_range_high &&
        base.targetRir === row.target_rir
      );
    }) ?? null
  );
}

/**
 * `restMultiplier` comes from the goal — fat-loss goals shorten rest to raise
 * session density. That is a real difference; a different split would not be.
 */
export function prescribe(
  profile: Goal,
  role: Role,
  options: { isCompound?: boolean; restMultiplier?: number } = {},
): Prescription {
  const base = TABLE[profile][role];
  const multiplier = options.restMultiplier ?? 1;

  // An isolation lift in a primary slot — an arm day, say — does not need the
  // rest a heavy compound does.
  const compoundAdjusted =
    options.isCompound === false && role === 'primary'
      ? { ...base, restSeconds: Math.round(base.restSeconds * 0.6) }
      : base;

  return {
    ...compoundAdjusted,
    restSeconds: Math.max(30, Math.round((compoundAdjusted.restSeconds * multiplier) / 5) * 5),
  };
}
