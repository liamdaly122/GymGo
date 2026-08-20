/**
 * Keeping a rest running across a reload.
 *
 * A phone in a gym is backgrounded constantly, and an installed PWA can be
 * killed and restored between two sets. The countdown lived in React state, so
 * it did not survive any of that.
 *
 * localStorage rather than Dexie on purpose: this is ephemeral interface state
 * with no `updated_at` and nothing to sync. Putting it in the database would
 * push it through the outbox and into every backup.
 */

const KEY = 'gymgo.rest';

export interface PersistedRest {
  /** Epoch ms the rest ends at. */
  endsAt: number;
  totalMs: number;
  /** The workout it belongs to, so a stale rest cannot leak into a new one. */
  scopeId: string | null;
}

/**
 * How long after the buzzer a stored rest is still worth restoring.
 *
 * Coming back thirty seconds late you want to see "Rest over". Coming back an
 * hour later, that was a different workout.
 */
const GRACE_MS = 120_000;

/** Pure, so the decision is testable without a DOM. */
export function restorable(
  raw: unknown,
  scopeId: string | null,
  now: number,
): PersistedRest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<PersistedRest>;

  if (typeof candidate.endsAt !== 'number' || !Number.isFinite(candidate.endsAt)) return null;
  if (typeof candidate.totalMs !== 'number' || !Number.isFinite(candidate.totalMs)) return null;
  if (candidate.scopeId !== scopeId) return null;
  if (now > candidate.endsAt + GRACE_MS) return null;

  return { endsAt: candidate.endsAt, totalMs: candidate.totalMs, scopeId };
}

export function readRest(scopeId: string | null, now = Date.now()): PersistedRest | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? null : restorable(JSON.parse(stored), scopeId, now);
  } catch {
    // Private browsing throws on access. A lost timer is a degraded session,
    // never a broken one.
    return null;
  }
}

export function writeRest(state: PersistedRest): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearRest(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
