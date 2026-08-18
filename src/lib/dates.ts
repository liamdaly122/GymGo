/**
 * Dates are stored as ISO 8601 strings in UTC, everywhere, without exception.
 * Formatting for display happens here and nowhere else.
 */

/** Current instant as an ISO 8601 UTC string. The only way to stamp a record. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Date-only ISO string (YYYY-MM-DD) in UTC, for body metrics. */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
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

/** "Today" / "Yesterday" / "Tue 12 Aug" — history lists, in local time. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
