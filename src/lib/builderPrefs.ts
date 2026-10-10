/**
 * What the lifter told the plan builder: a time limit, their experience, the
 * muscles they want more of and the lifts they will not do.
 *
 * Device-local, in localStorage like the backup ledger and the rest timer,
 * because these are inputs to a generator rather than records: losing them
 * costs re-ticking a few chips. A synced home would need a new column, and a
 * new column is a migration the owner runs by hand or backups fail.
 *
 * The avoid list is read again when a block ends, so rotation never brings
 * back a lift the lifter ruled out.
 */
import type { ExperienceLevel, Muscle } from '@/domain/types';
import { remember } from '@/platform/durable';

export interface BuilderPrefs {
  /** The hardest week has to fit in this. Null: no limit. */
  minutes: number | null;
  experience: ExperienceLevel;
  priorities: Muscle[];
  /** Lift families, as `liftFamily` names them. */
  avoidFamilies: string[];
}

export const DEFAULT_BUILDER_PREFS: BuilderPrefs = {
  minutes: null,
  experience: 'intermediate',
  priorities: [],
  avoidFamilies: [],
};

const KEY = 'gymgo.builder';

/** Where localStorage is missing or refuses: tests, private windows. */
let memory: BuilderPrefs | null = null;

export function loadBuilderPrefs(): BuilderPrefs {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored) return { ...DEFAULT_BUILDER_PREFS, ...(JSON.parse(stored) as Partial<BuilderPrefs>) };
  } catch {
    // Unreadable or unparseable: fall through to memory, then to the defaults.
  }
  return memory ?? DEFAULT_BUILDER_PREFS;
}

export function saveBuilderPrefs(prefs: BuilderPrefs): void {
  memory = prefs;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
    remember(KEY, JSON.stringify(prefs));
  } catch {
    // Kept in memory for this session; the builder simply starts fresh next time.
  }
}
