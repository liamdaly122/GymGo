import { useEffect, useState } from 'react';
import { localIsoDate } from '@/domain/schedule';

/**
 * Today's local date (YYYY-MM-DD), kept current.
 *
 * A skipped session rolls forward at midnight, but a live query only re-runs
 * when the database changes: a phone left on the Today screen overnight would
 * still be showing yesterday's plan in the morning. This ticks just after
 * local midnight and whenever the app comes back to the foreground — an
 * installed PWA is usually resumed, not reloaded.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localIsoDate(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => setToday(localIsoDate(new Date()));

    const armMidnight = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        refresh();
        armMidnight();
      }, next.getTime() - now.getTime());
    };
    armMidnight();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return today;
}

/** The Date to hand the schedule for a given local ISO date: its noon. */
export const scheduleDay = (today: string): Date => new Date(`${today}T12:00:00`);
