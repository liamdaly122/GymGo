import { useEffect, useState } from 'react';
import { elapsedMs } from '@/lib/dates';

/**
 * Milliseconds since an ISO instant, re-rendered once a second.
 *
 * Derived from the timestamp on every tick rather than accumulated, so
 * backgrounding the phone — which iOS does aggressively, and which throttles
 * timers to a crawl — cannot make the clock drift.
 */
export function useElapsed(since: string | null | undefined, intervalMs = 1000): number {
  const [elapsed, setElapsed] = useState(() => (since ? elapsedMs(since) : 0));

  useEffect(() => {
    if (!since) return;
    setElapsed(elapsedMs(since));
    const id = window.setInterval(() => setElapsed(elapsedMs(since)), intervalMs);

    // Recompute the moment the app comes back, rather than waiting a tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setElapsed(elapsedMs(since));
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [since, intervalMs]);

  return elapsed;
}
