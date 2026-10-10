/**
 * A one-off tidy-up, run once on this phone and never again.
 *
 * Remembered in localStorage, beside the rest timer and the backup ledger,
 * because it is about this install's copy of the data rather than the data:
 * another phone runs it against its own copy. Held in memory too, so
 * StrictMode's double mount runs it once.
 *
 * Where storage cannot be read it is skipped rather than repeated every
 * launch, since repeating it could undo something the lifter set after it
 * first ran. A failure is logged and tried again next launch. It never stops
 * the app opening.
 */

import { remember } from '@/platform/durable';

const PREFIX = 'gymgo.once.';

const running = new Map<string, Promise<void>>();

export function onceOnThisPhone(key: string, task: () => Promise<unknown>): Promise<void> {
  const existing = running.get(key);
  if (existing) return existing;

  const run = (async () => {
    const flag = PREFIX + key;
    try {
      if (globalThis.localStorage.getItem(flag) !== null) return;
    } catch {
      return;
    }
    try {
      await task();
      const at = new Date().toISOString();
      globalThis.localStorage.setItem(flag, at);
      remember(flag, at);
    } catch (cause) {
      console.warn(`The one-off "${key}" did not finish, and will run again next launch.`, cause);
    }
  })();
  running.set(key, run);
  return run;
}
