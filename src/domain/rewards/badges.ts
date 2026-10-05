/**
 * The badges: seven families, thirty-eight in all.
 *
 * Six families climb in tiers — sessions, streak weeks, records, tonnes
 * lifted, full blocks and plates on the bar — and one holds the moments. Every
 * one is earned from the workout tables through the usual gates: a record is
 * `recordsBrokenPerSession`'s, tonnage is `volume.ts`'s (drop sets count), and
 * the plates count record-eligible sets only, so a drop set at 140kg is not
 * three plates.
 *
 * Pure: definitions and wording. The walk in `rewards.ts` decides when each
 * is earned.
 */

export type BadgeFamily = 'sessions' | 'streak' | 'records' | 'lifted' | 'blocks' | 'plates' | 'moments';

export interface Badge {
  id: string;
  family: BadgeFamily;
  name: string;
  /** How to earn it, in one line. */
  description: string;
  /** The count, weeks, kg or tonnage it takes. One for a moment. */
  threshold: number;
}

/** A 20kg bar with a 20kg plate a side per plate. */
const BAR_KG = 20;
const PLATE_KG = 20;
const PLATE_WORDS = ['One', 'Two', 'Three', 'Four', 'Five'];

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

const tiered = (
  family: BadgeFamily,
  thresholds: number[],
  name: (threshold: number) => string,
  description: (threshold: number) => string,
): Badge[] =>
  thresholds.map((threshold) => ({
    id: `${family}-${threshold}`,
    family,
    name: name(threshold),
    description: description(threshold),
    threshold,
  }));

export const BADGES: readonly Badge[] = [
  ...tiered(
    'sessions',
    [1, 10, 25, 50, 100, 250, 500, 1000],
    (n) => (n === 1 ? 'First session' : plural(n, 'session', 'sessions')),
    (n) => (n === 1 ? 'Finish a session.' : `Finish ${n.toLocaleString('en-GB')} sessions.`),
  ),
  ...tiered(
    'streak',
    [4, 8, 12, 26, 52],
    (n) => `${n}-week streak`,
    (n) => `Hit your weekly target ${n} weeks in a row.`,
  ),
  ...tiered(
    'records',
    [1, 10, 25, 50, 100, 250],
    (n) => (n === 1 ? 'First record' : plural(n, 'record', 'records')),
    (n) => (n === 1 ? 'Beat one of your own records.' : `Beat your own records ${n} times.`),
  ),
  ...tiered(
    'lifted',
    [1, 10, 50, 100, 250, 500, 1000].map((tonnes) => tonnes * 1000),
    (kg) => `${plural(kg / 1000, 'tonne', 'tonnes')} lifted`,
    (kg) => `Lift ${plural(kg / 1000, 'tonne', 'tonnes')} in all, every set counted.`,
  ),
  ...tiered(
    'blocks',
    [1, 3, 5, 10],
    (n) => (n === 1 ? 'First full block' : `${n} full blocks`),
    (n) => (n === 1 ? 'Train every session of a block.' : `Train every session of ${n} blocks.`),
  ),
  ...tiered(
    'plates',
    [1, 2, 3, 4, 5].map((plates) => BAR_KG + 2 * PLATE_KG * plates),
    (kg) => `${PLATE_WORDS[(kg - BAR_KG) / (2 * PLATE_KG) - 1]} plate${kg > BAR_KG + 2 * PLATE_KG ? 's' : ''}`,
    (kg) => {
      const plates = (kg - BAR_KG) / (2 * PLATE_KG);
      return `A barbell lift at ${kg}kg: ${plates === 1 ? 'a 20kg plate' : `${plates} 20kg plates`} each side.`;
    },
  ),
  {
    id: 'moments-comeback',
    family: 'moments',
    name: 'Comeback',
    description: 'Train again after two weeks or more away.',
    threshold: 1,
  },
  {
    id: 'moments-early',
    family: 'moments',
    name: 'Early bird',
    description: 'Start a session before 7am.',
    threshold: 1,
  },
  {
    id: 'moments-late',
    family: 'moments',
    name: 'Night owl',
    description: 'Start a session after 9pm.',
    threshold: 1,
  },
];

export const FAMILY_NAMES: Record<BadgeFamily, string> = {
  sessions: 'Sessions',
  streak: 'Streak',
  records: 'Records',
  lifted: 'Lifted',
  blocks: 'Full blocks',
  plates: 'Plates',
  moments: 'Moments',
};

/** Families in the order the Awards screen shows them. */
export const FAMILIES: readonly BadgeFamily[] = ['sessions', 'streak', 'records', 'lifted', 'blocks', 'plates', 'moments'];

/**
 * What is left to earn a badge, in words: "3 more sessions", "2.5 tonnes to
 * go". The value is in the family's own unit.
 */
export function describeRemaining(family: BadgeFamily, remaining: number): string {
  switch (family) {
    case 'sessions':
      return `${plural(remaining, 'more session', 'more sessions')}`;
    case 'streak':
      return `${plural(remaining, 'more week', 'more weeks')} in a row`;
    case 'records':
      return `${plural(remaining, 'more record', 'more records')}`;
    case 'lifted': {
      const tonnes = Math.max(0.1, Math.round(remaining / 100) / 10);
      return `${tonnes.toLocaleString('en-GB')} ${tonnes === 1 ? 'tonne' : 'tonnes'} to go`;
    }
    case 'blocks':
      return `${plural(remaining, 'more full block', 'more full blocks')}`;
    case 'plates':
      return `${Math.ceil(remaining * 10) / 10}kg more on a barbell lift`;
    case 'moments':
      return '';
  }
}
