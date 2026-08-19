/**
 * Which lifts a generated plan should reach for first.
 *
 * Without this the ranking has no idea what a normal exercise is. Every
 * variant scores the same, so a plan would open with a Barbell Guillotine Bench
 * Press, a Frankenstein Squat and a Snatch Deadlift — technically the right
 * movement patterns, and obviously wrong to anyone who has been in a gym.
 *
 * Keyed by the dataset's stable slug, so a reseed cannot break the mapping.
 * This is the same hand-written override pattern used for movement patterns in
 * `scripts/build-seed.ts`: rules do most of the work, a short curated list
 * handles what rules cannot know.
 */

/** The first thing you would put in a programme for that slot. */
const STAPLE = [
  // Squat
  'Barbell_Squat', 'Barbell_Full_Squat', 'Front_Barbell_Squat', 'Leg_Press', 'Goblet_Squat',
  // Hinge
  'Barbell_Deadlift', 'Romanian_Deadlift', 'Sumo_Deadlift', 'Barbell_Hip_Thrust',
  'Stiff-Legged_Barbell_Deadlift',
  // Lunge
  'Barbell_Lunge', 'Dumbbell_Lunges', 'Dumbbell_Step_Ups',
  // Horizontal push
  'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'Dumbbell_Bench_Press', 'Incline_Dumbbell_Press', 'Pushups', 'Dips_-_Chest_Version',
  // Vertical push
  'Standing_Military_Press', 'Seated_Barbell_Military_Press', 'Dumbbell_Shoulder_Press',
  'Push_Press', 'Arnold_Dumbbell_Press',
  // Horizontal pull
  'Bent_Over_Barbell_Row', 'Seated_Cable_Rows', 'One-Arm_Dumbbell_Row',
  'T-Bar_Row_with_Handle', 'Inverted_Row',
  // Vertical pull
  'Pullups', 'Chin-Up', 'Wide-Grip_Lat_Pulldown', 'Close-Grip_Front_Lat_Pulldown',
  // Arms
  'Barbell_Curl', 'Dumbbell_Bicep_Curl', 'Hammer_Curls',
  'Triceps_Pushdown', 'Lying_Triceps_Press', 'EZ-Bar_Skullcrusher', 'Seated_Triceps_Press',
  // Shoulders and back accessories
  'Seated_Side_Lateral_Raise', 'One-Arm_Side_Laterals', 'Front_Dumbbell_Raise',
  'Cable_Rear_Delt_Fly', 'Face_Pull', 'Barbell_Shrug',
  // Chest accessories
  'Cable_Crossover', 'Bodyweight_Flyes',
  // Legs accessories
  'Leg_Extensions', 'Lying_Leg_Curls', 'Seated_Leg_Curl',
  'Standing_Calf_Raises', 'Seated_Calf_Raise',
  // Core
  'Hanging_Leg_Raise', 'Plank', 'Cable_Crunch', 'Ab_Roller', 'Crunches',
];

/** Perfectly good, just not the first thing you would write down. */
const COMMON = [
  'Front_Squat_Clean_Grip', 'Narrow_Stance_Leg_Press', 'Front_Squats_With_Two_Kettlebells',
  'Romanian_Deadlift_from_Deficit', 'One-Arm_Kettlebell_Swings', 'Good_Morning',
  'Barbell_Step_Ups', 'Decline_Dumbbell_Bench_Press', 'Dumbbell_Bench_Press_with_Neutral_Grip',
  'Cable_Chest_Press', 'Leverage_Chest_Press', 'Decline_Push-Up',
  'Kettlebell_Arnold_Press', 'One-Arm_Kettlebell_Push_Press',
  'Lying_T-Bar_Row', 'One_Arm_Lat_Pulldown', 'Full_Range-Of-Motion_Lat_Pulldown',
  'Incline_Hammer_Curls', 'Cable_Hammer_Curls_-_Rope_Attachment', 'Cable_Preacher_Curl',
  'Machine_Preacher_Curls', 'Close-Grip_Standing_Barbell_Curl',
  'Reverse_Grip_Triceps_Pushdown', 'Close-Grip_Barbell_Bench_Press',
  'Cable_Seated_Lateral_Raise', 'Dumbbell_Lying_Rear_Lateral_Raise',
  'Low_Cable_Crossover', 'Cable_Shrugs', 'Dumbbell_Shrug',
  'Ball_Leg_Curl', 'Calf_Raise_On_A_Dumbbell', 'Rocking_Standing_Calf_Raise',
  'Ab_Crunch_Machine', 'Hanging_Pike', 'Natural_Glute_Ham_Raise', 'Glute_Ham_Raise',
];

const STAPLE_SET = new Set(STAPLE);
const COMMON_SET = new Set(COMMON);

/**
 * Variants that need kit, a training partner, or a reason. Fine to pick
 * deliberately from the library; wrong to hand someone unprompted in a plan.
 */
const SPECIALIST = /\b(band|bands|chain|chains|pin|pins|guillotine|smith|suspended|suspension|sled|plyo|bosu|zottman|tate|frankenstein|bradford|cuban|deficit|behind the (back|head)|one arm|single-arm|isometric|iso-explosive|partner|rocking|clock|spider|walking|kneeling cable crunch)\b/i;

export type StapleTier = 'staple' | 'common' | 'other' | 'specialist';

export function stapleTier(sourceId: string | null, name: string): StapleTier {
  if (sourceId && STAPLE_SET.has(sourceId)) return 'staple';
  if (sourceId && COMMON_SET.has(sourceId)) return 'common';
  if (SPECIALIST.test(name)) return 'specialist';
  return 'other';
}

/** Ranking weight. Large enough to beat the other signals, which is the point. */
export const STAPLE_SCORE: Record<StapleTier, number> = {
  staple: 45,
  common: 22,
  other: 0,
  specialist: -30,
};

/** Exposed so the check script can report coverage. */
export const STAPLE_IDS: readonly string[] = STAPLE;
