/**
 * Dates are stored as ISO 8601 strings in UTC, everywhere, without exception.
 * Formatting for display happens here and nowhere else.
 */

/** Current instant as an ISO 8601 UTC string. The only way to stamp a record. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Date-only ISO string (YYYY-MM-DD) for body metrics: the lifter's own
 * calendar day, as "today" is everywhere else. In UTC, a weigh-in at 00:30
 * in summer would be filed under yesterday, and today's weight would read as
 * missing.
 */
export function isoDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Milliseconds between two ISO instants. Negative if `to` precedes `from`. */
export function elapsedMs(from: string, to: string = nowIso()): number {
  return Date.parse(to) - Date.parse(from);
}

/** "1h 12m" / "48m" / "35s" — session durations, read at a glance. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** "2:30" — a countdown, always mm:ss. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "Mon 28 Sep" for a date-only ISO string (YYYY-MM-DD), read in local time. */
export function formatShortDate(isoDate: string): string {
  // Noon, not midnight: a date-only string parsed at 00:00 can land on the
  // previous day either side of a clock change.
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * "Today" / "Tomorrow" / "3 days ago" / "Tue 12 Aug", in local time.
 *
 * Handles the future as well as the past. It originally assumed the past,
 * because history is the only thing that had dates — once the calendar started
 * passing it upcoming sessions it rendered them as "-2 days ago".
 */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 7) return `${days} days ago`;
  // Within the coming week, the weekday name beats counting days forward.
  if (days < -1 && days > -7) return then.toLocaleDateString('en-GB', { weekday: 'long' });
  return then.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * "just now" / "4 min ago" / "3 hours ago" / then the day — how long since
 * something happened, for "Last backed up …". Recent enough to matter in
 * minutes; older than today, the day says more than a count of hours.
 */
export function formatSince(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return formatDayLabel(iso, now).toLowerCase();
}
