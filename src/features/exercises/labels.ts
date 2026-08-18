import type { Equipment, MovementPattern } from '@/domain/types';

export const PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge',
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
  carry: 'Carry',
  core: 'Core',
  isolation: 'Isolation',
};

/** Shorter forms for filter chips, where horizontal space is tight. */
export const PATTERN_LABELS_SHORT: Record<MovementPattern, string> = {
  ...PATTERN_LABELS,
  horizontal_push: 'Horiz push',
  vertical_push: 'Vert push',
  horizontal_pull: 'Horiz pull',
  vertical_pull: 'Vert pull',
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  cable: 'Cable',
  machine: 'Machine',
  bands: 'Bands',
  bodyweight: 'Bodyweight',
  ez_bar: 'EZ bar',
  exercise_ball: 'Exercise ball',
  medicine_ball: 'Medicine ball',
  other: 'Other',
};
