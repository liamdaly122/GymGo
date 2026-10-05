/**
 * The goals a person picks from, and what they actually mean for programming.
 *
 * Six labels, three engines. This is deliberate and worth stating plainly,
 * because the alternative is dishonest: the evidence on training in a calorie
 * deficit is that you lift the SAME WAY you do when building muscle — rep
 * ranges barely move and diet does the fat loss. Inventing a different split
 * for "Lose Weight" would be marketing, not training.
 *
 * So the labels people search for are all here, and each maps onto one of the
 * three profiles the brief already specifies. Where two goals share a profile
 * the app says so rather than pretending otherwise.
 */
import type { Goal } from '../types';

export const TRAINING_GOAL_IDS = [
  'build_muscle',
  'get_lean',
  'lose_weight',
  'build_strength',
  'get_in_shape',
  'overall_fitness',
] as const;

export type TrainingGoalId = (typeof TRAINING_GOAL_IDS)[number];

export interface TrainingGoal {
  id: TrainingGoalId;
  label: string;
  /** One line, shown on the card. */
  blurb: string;
  /** Which of the three programming engines this goal runs on. */
  profile: Goal;
  /**
   * Honest note about what this goal does and does not change, shown when the
   * goal shares a profile with another. Null when the goal is its own thing.
   */
  sameProgrammeAs: string | null;
  /** Whether to offer an optional conditioning finisher. */
  conditioningFinisher: boolean;
}

export const TRAINING_GOALS: TrainingGoal[] = [
  {
    id: 'build_muscle',
    label: 'Build muscle',
    blurb: 'Moderate reps, plenty of volume, progressive overload.',
    profile: 'hypertrophy',
    sameProgrammeAs: null,
    conditioningFinisher: false,
  },
  {
    id: 'get_lean',
    label: 'Get lean',
    blurb: 'Hold onto muscle while you lose fat. Same lifting; the diet does the work.',
    profile: 'hypertrophy',
    sameProgrammeAs:
      'Same lifting as Build muscle. Keeping muscle while losing fat is a kitchen job — ' +
      'the training just has to protect what you have.',
    conditioningFinisher: true,
  },
  {
    id: 'lose_weight',
    label: 'Lose weight',
    blurb: 'Lift to keep the muscle while the diet takes the weight off.',
    profile: 'hypertrophy',
    sameProgrammeAs:
      'Same lifting as Build muscle. The research is blunt about this: in a deficit you ' +
      'train the way you would to grow, and the diet does the fat loss.',
    conditioningFinisher: true,
  },
  {
    id: 'build_strength',
    label: 'Build strength',
    blurb: 'Heavier, lower reps, fewer exercises.',
    profile: 'strength',
    sameProgrammeAs: null,
    conditioningFinisher: false,
  },
  {
    id: 'get_in_shape',
    label: 'Get in shape',
    blurb: 'Balanced full-body work at a manageable volume.',
    profile: 'general',
    sameProgrammeAs: null,
    conditioningFinisher: true,
  },
  {
    id: 'overall_fitness',
    label: 'Overall fitness',
    blurb: 'A bit of everything, sustainable week to week.',
    profile: 'general',
    sameProgrammeAs: 'Same programme as Get in shape, framed for keeping it up long term.',
    conditioningFinisher: true,
  },
];

export function findGoal(id: string): TrainingGoal | undefined {
  return TRAINING_GOALS.find((goal) => goal.id === id);
}

/** Goals sharing a profile, so the UI can be upfront about the overlap. */
export function goalsSharingProfile(goal: TrainingGoal): TrainingGoal[] {
  return TRAINING_GOALS.filter((other) => other.profile === goal.profile && other.id !== goal.id);
}
