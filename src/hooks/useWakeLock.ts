import { useEffect, useRef, useState } from 'react';

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> };

/**
 * Keeps the screen awake during a workout.
 *
 * The brief is explicit that background timers on iOS are unreliable, so the
 * approach is to keep the timer on screen rather than rely on a background
 * notification. Two details matter:
 *
 *  - The lock is dropped automatically whenever the page is hidden, so it has
 *    to be re-acquired on visibilitychange or the screen sleeps the first time
 *    you glance away.
 *  - The API is unavailable on some browsers and in insecure contexts. That is
 *    a degraded experience, not an error, so failures are swallowed.
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const [held, setHeld] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (sentinel.current && !sentinel.current.released) return;
      try {
        const lock = await (
          navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }
        ).wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel.current = lock;
        setHeld(true);
      } catch {
        // Denied, unsupported, or the tab lost focus mid-request. Not fatal.
        setHeld(false);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else setHeld(false);
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const lock = sentinel.current;
      sentinel.current = null;
      setHeld(false);
      if (lock && !lock.released) void lock.release().catch(() => {});
    };
  }, [active, supported]);

  return { supported, held };
}
