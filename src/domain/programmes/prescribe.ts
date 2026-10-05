/**
 * How many sets, what rep range, how far from failure.
 *
 * The figures come straight from the brief, which matches the published volume
 * landmarks: hypertrophy 10-20 working sets per muscle per week at 6-12 reps,
 * strength 8-12 sets at 3-6 on the main lifts, general 8-12 sets at 8-15.
 *
 * Rest is not prescribed here. It follows the lift (`restSecondsFor` in
 * `../rest`), the same on every goal, so a plan's rows carry none of their own.
 */
import type { Goal } from '../types';
import type { SessionSlot } from './templates';

export interface Prescription {
  sets: number;
  repLow: number;
  repHigh: number;
  targetRir: number | null;
}

type Role = SessionSlot['role'];

const TABLE: Record<Goal, Record<Role, Prescription>> = {
  hypertrophy: {
    primary: { sets: 4, repLow: 6, repHigh: 10, targetRir: 2 },
    secondary: { sets: 3, repLow: 8, repHigh: 12, targetRir: 2 },
    accessory: { sets: 3, repLow: 10, repHigh: 15, targetRir: 1 },
  },
  strength: {
    primary: { sets: 5, repLow: 3, repHigh: 5, targetRir: 2 },
    secondary: { sets: 3, repLow: 5, repHigh: 8, targetRir: 2 },
    accessory: { sets: 3, repLow: 8, repHigh: 12, targetRir: 1 },
  },
  general: {
    primary: { sets: 3, repLow: 8, repHigh: 12, targetRir: 2 },
    secondary: { sets: 3, repLow: 10, repHigh: 15, targetRir: 2 },
    accessory: { sets: 2, repLow: 12, repHigh: 15, targetRir: 1 },
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
 * role. Rest is no help: it belongs to the lift, not the role.
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

/** What a role is given under a goal: sets, rep range and RIR target. */
export function prescribe(profile: Goal, role: Role): Prescription {
  return { ...TABLE[profile][role] };
}

/**
 * The rest the generator wrote onto a row, by goal and role, before rest
 * followed the lift. Kept only to recognise those rows: `clearGeneratedRests`
 * hands them back to the lift, and leaves any other figure, which the lifter
 * typed, alone.
 */
const RETIRED_REST: Record<Goal, Record<Role, number>> = {
  hypertrophy: { primary: 180, secondary: 120, accessory: 75 },
  strength: { primary: 210, secondary: 150, accessory: 90 },
  general: { primary: 120, secondary: 90, accessory: 60 },
};

/** Fat-loss goals took 0.75 of it, Build strength 1.2. */
const RETIRED_MULTIPLIERS = [0.75, 1, 1.2];

/**
 * Whether `seconds` is a rest the old generator could have written for this
 * role: for a compound, or for an isolation lift in a primary slot (0.6 of the
 * figure), under any goal's multiplier, rounded to 5s with a 30s floor.
 */
export function wasGeneratedRest(profile: Goal, role: Role, seconds: number | null): boolean {
  if (seconds === null) return false;
  const base = RETIRED_REST[profile][role];
  const lifts = role === 'primary' ? [base, Math.round(base * 0.6)] : [base];
  return lifts.some((rest) =>
    RETIRED_MULTIPLIERS.some((multiplier) => Math.max(30, Math.round((rest * multiplier) / 5) * 5) === seconds),
  );
}
