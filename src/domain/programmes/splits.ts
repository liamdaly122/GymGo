/**
 * How a week is carved up.
 *
 * The important thing here, and the reason `daysSupported` exists: choosing a
 * split is a scheduling decision, not a physiological one. Meta-analyses
 * consistently find no split beats another once weekly volume is equated. What
 * actually differs is how cleanly it divides into the days you have — full body
 * fits 3, upper/lower fits 4, push/pull/legs fits 6.
 *
 * So the app never offers a combination that does not divide sensibly. There is
 * no such thing as a two-day bro split.
 */
import type { SessionTemplateId } from './templates';

export const SPLIT_IDS = ['full_body', 'upper_lower', 'push_pull_legs', 'bro'] as const;
export type SplitId = (typeof SPLIT_IDS)[number];

export interface Split {
  id: SplitId;
  label: string;
  blurb: string;
  /** Day counts this split divides into sensibly. Nothing else is offered. */
  daysSupported: number[];
  /** The honest catch, shown on the card. Every split has one. */
  tradeoff: string;
  /** How often each muscle gets trained per week, at the given day count. */
  frequencyNote: (days: number) => string;
}

/** The weekly rotation for a split at a given number of days. */
export function sessionsFor(splitId: SplitId, days: number): SessionTemplateId[] {
  switch (splitId) {
    case 'full_body':
      if (days <= 2) return ['fb_a', 'fb_b'];
      if (days === 3) return ['fb_a', 'fb_b', 'fb_c'];
      return ['fb_a', 'fb_b', 'fb_c', 'fb_a'];

    case 'upper_lower':
      if (days <= 2) return ['upper_a', 'lower_a'];
      return ['upper_a', 'lower_a', 'upper_b', 'lower_b'];

    case 'push_pull_legs':
      if (days === 3) return ['push', 'pull', 'legs'];
      // Five days is the classic PPL+UL hybrid: it reuses the upper/lower
      // templates rather than inventing two more.
      if (days === 5) return ['push', 'pull', 'legs', 'upper_a', 'lower_a'];
      return ['push', 'pull', 'legs', 'push', 'pull', 'legs'];

    case 'bro':
      return ['bro_chest', 'bro_back', 'bro_shoulders', 'bro_arms', 'bro_legs'];
  }
}

export const SPLITS: Split[] = [
  {
    id: 'full_body',
    label: 'Full body',
    blurb: 'Every session trains everything. Best use of two or three days.',
    daysSupported: [2, 3, 4],
    tradeoff:
      'Sessions are long and legs come round every time. If you can train four or more ' +
      'days, upper/lower usually fits better.',
    frequencyNote: (days) => `Each muscle trained ${Math.min(days, 4)}× a week.`,
  },
  {
    id: 'upper_lower',
    label: 'Upper / Lower',
    blurb: 'Alternating upper and lower days. The sweet spot at four days.',
    daysSupported: [2, 4],
    tradeoff:
      'Upper days carry a lot of work — chest, back, shoulders and arms in one session.',
    frequencyNote: (days) => `Each muscle trained ${days === 2 ? 1 : 2}× a week.`,
  },
  {
    id: 'push_pull_legs',
    label: 'Push / Pull / Legs',
    blurb: 'Pressing, pulling and legs on separate days. Scales to six.',
    daysSupported: [3, 5, 6],
    tradeoff:
      'At three days each muscle is only trained once a week, which is on the light side. ' +
      'It comes into its own at six.',
    frequencyNote: (days) =>
      days === 3 ? 'Each muscle trained once a week.' : 'Each muscle trained 2× a week.',
  },
  {
    id: 'bro',
    label: 'Bro split',
    blurb: 'One body part per day. Chest, back, shoulders, arms, legs.',
    daysSupported: [5],
    tradeoff:
      'Each muscle is trained once a week, and a session can only use about 6 to 8 hard ' +
      'sets per muscle before the extra ones stop adding much — so some of a long body-part ' +
      'day goes to waste. It still works, and a plan you enjoy beats one you skip.',
    frequencyNote: () => 'Each muscle trained once a week.',
  },
];

export function findSplit(id: string): Split | undefined {
  return SPLITS.find((split) => split.id === id);
}

/** Splits that divide sensibly into the given number of days. */
export function splitsForDays(days: number): Split[] {
  return SPLITS.filter((split) => split.daysSupported.includes(days));
}

/** Every day count any split supports, ascending. Drives the day picker. */
export const SUPPORTED_DAYS: number[] = [
  ...new Set(SPLITS.flatMap((split) => split.daysSupported)),
].sort((a, b) => a - b);
