import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './native';

/**
 * The small keys that matter, kept where iOS does not reclaim them.
 *
 * iOS can clear a web view's localStorage and IndexedDB when the phone runs
 * short of space. The database has the backup and the snapshots behind it;
 * these keys have this. Each stays in localStorage, because every reader is
 * synchronous and the website has nothing else, and inside the app each write
 * is mirrored into UserDefaults (Preferences) and copied back at launch when
 * localStorage has lost it.
 *
 * The once-per-phone flags matter most: with localStorage cleared and the
 * database intact, `clearGeneratedRests` would run a second time and could
 * clear a 3:00 rest typed by hand, then back that up. The running rest
 * (gymgo.rest) is throwaway by design and stays where it is.
 */
const DURABLE_PREFIXES = ['gymgo.once.', 'gymgo.builder', 'gymgo.backup.'] as const;

export function isDurableKey(key: string): boolean {
  return DURABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Mirrors a localStorage write. Outside the app, or for any other key, nothing happens. */
export function remember(key: string, value: string | null): void {
  if (!isNativeApp() || !isDurableKey(key)) return;
  void (value === null ? Preferences.remove({ key }) : Preferences.set({ key, value })).catch(() => {});
}

/**
 * Puts back every mirrored key that localStorage has lost, and mirrors any it
 * holds that UserDefaults does not yet, for an install made before the mirror
 * existed. Runs before the app renders, so nothing reads a missing flag
 * first. Returns how many came back.
 */
export async function restoreDurableKeys(): Promise<number> {
  if (!isNativeApp()) return 0;
  try {
    const storage = globalThis.localStorage;
    const { keys } = await Preferences.keys();
    const mirrored = new Set(keys.filter(isDurableKey));
    let restored = 0;
    for (const key of mirrored) {
      if (storage.getItem(key) !== null) continue;
      const { value } = await Preferences.get({ key });
      if (value === null) continue;
      storage.setItem(key, value);
      restored += 1;
    }
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !isDurableKey(key) || mirrored.has(key)) continue;
      const value = storage.getItem(key);
      if (value !== null) await Preferences.set({ key, value });
    }
    return restored;
  } catch {
    return 0;
  }
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Where the Supabase session lives inside the app: UserDefaults rather than
 * localStorage, so a reclaimed web view does not sign the backup out.
 * Undefined on the website, where supabase-js keeps its own default.
 */
export function nativeSessionStore(): KeyValueStore | undefined {
  if (!isNativeApp()) return undefined;
  return {
    getItem: async (key) => (await Preferences.get({ key })).value,
    setItem: async (key, value) => Preferences.set({ key, value }),
    removeItem: async (key) => Preferences.remove({ key }),
  };
}
