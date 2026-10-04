/**
 * What this phone has done for an account: when everything on it last went up
 * in full, and when the daily catch-up last ran.
 *
 * Device-local on purpose, so in localStorage rather than the settings row:
 * settings syncs between devices, and these describe one phone, not the
 * account. Losing them costs nothing but bandwidth — the next round sends
 * everything again, and the server keeps the newest copy of each row — which
 * is also exactly what should happen on a phone whose storage was wiped.
 */
export interface BackupLedger {
  /** The last time every row on this phone was uploaded. */
  fullUploadAt: string | null;
  /** The last daily pass over rows changed since the one before. */
  catchUpAt: string | null;
  /** The last round that finished with nothing left to send. */
  lastBackupAt: string | null;
}

const EMPTY: BackupLedger = { fullUploadAt: null, catchUpAt: null, lastBackupAt: null };
const key = (userId: string) => `gymgo.backup.${userId}`;

/** Where localStorage is missing or refuses — tests, private windows. */
const memory = new Map<string, BackupLedger>();

export function readLedger(userId: string): BackupLedger {
  try {
    const stored = globalThis.localStorage?.getItem(key(userId));
    if (stored) return { ...EMPTY, ...(JSON.parse(stored) as Partial<BackupLedger>) };
  } catch {
    // Unreadable or unparseable: fall through to memory, then to empty.
  }
  return memory.get(userId) ?? EMPTY;
}

export function writeLedger(userId: string, patch: Partial<BackupLedger>): void {
  const next = { ...readLedger(userId), ...patch };
  memory.set(userId, next);
  try {
    globalThis.localStorage?.setItem(key(userId), JSON.stringify(next));
  } catch {
    // Kept in memory for this session; the worst case is one more full upload.
  }
}

/** For a wiped phone in tests: forget every account's ledger. */
export function forgetLedgers(): void {
  memory.clear();
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const name = storage.key(index);
      if (name?.startsWith('gymgo.backup.')) storage.removeItem(name);
    }
  } catch {
    // Nothing to forget.
  }
}
