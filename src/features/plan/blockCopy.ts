import type { BlockProgress, ScheduledSession } from '@/domain/schedule';
import { formatShortDate } from '@/lib/dates';

/**
 * "6 of 18 sessions done · ends Sun 8 Nov · 2 days later than planned".
 *
 * Sessions are never missed any more — a skipped one rolls forward — so the
 * honest thing to report is when the block will now finish, not a tally of
 * failures.
 */
export function describeBlockProgress(progress: BlockProgress): string {
  const parts = [`${progress.done} of ${progress.total} sessions done`];
  if (progress.endsOn && progress.done < progress.total) {
    parts.push(`ends ${formatShortDate(progress.endsOn)}`);
  }
  if (progress.daysBehind > 0) {
    parts.push(`${progress.daysBehind} day${progress.daysBehind === 1 ? '' : 's'} later than planned`);
  }
  return parts.join(' · ');
}

/** "Moved from Mon 28 Sep" for a session that rolled, otherwise null. */
export function movedLabel(session: Pick<ScheduledSession, 'movedFrom'>): string | null {
  return session.movedFrom ? `Moved from ${formatShortDate(session.movedFrom)}` : null;
}
