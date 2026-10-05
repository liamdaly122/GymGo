/**
 * How long to rest after a working set: set by the size of the lift, the same
 * on every goal.
 *
 * The owner's numbers, from their first evening of training with the app: big
 * lifts 2:30, medium 2:00, light and isolation work 1:30. Rest used to come
 * from the plan — a role's figure stretched by the goal — so a muscle-building
 * main lift rested 3:00, a strength one 4:10, and a leg extension swapped into
 * a squat's slot kept the squat's rest.
 *
 * Worked out each time rather than stored, like the schedule: a library seeded
 * under an older rule cannot keep it, and changing a number here changes every
 * rest that has not been set by hand.
 */

export const REST_SECONDS = { big: 150, medium: 120, light: 90 } as const;

export type RestTier = keyof typeof REST_SECONDS;

/** What the tier reads off an exercise. */
export interface RestLift {
  is_compound: boolean;
  /** 1 to 5, from the seed: 5 a barbell squat or hinge, 4 any other squat, hinge or free-weight compound. */
  fatigue_cost: number;
}

/**
 * Big: a compound at fatigue 4 or 5, which the seed gives a squat or hinge, or
 * a barbell or dumbbell compound — squats, deadlifts, hip thrusts, bench,
 * overhead press, rows, lunges, the leg press.
 *
 * Medium: any other compound — machines, cables and bodyweight work, such as
 * pull-ups, dips, pulldowns and cable rows.
 *
 * Light: isolation and core.
 */
export function restTier(lift: RestLift): RestTier {
  if (!lift.is_compound) return 'light';
  return lift.fatigue_cost >= 4 ? 'big' : 'medium';
}

/** Seconds of rest for a lift that has not been given its own. */
export function restSecondsFor(lift: RestLift): number {
  return REST_SECONDS[restTier(lift)];
}
