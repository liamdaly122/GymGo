import type { Badge, SessionReward, Streak } from '@/domain/rewards';

/**
 * The line under a badge's art: what its number counts. The number itself is
 * in the art; a moment has none, so its line is its name.
 */
export function tileCaption(badge: Badge): string {
  const n = badge.threshold;
  switch (badge.family) {
    case 'sessions':
      return n === 1 ? 'session' : 'sessions';
    case 'streak':
      return 'weeks';
    case 'records':
      return n === 1 ? 'record' : 'records';
    case 'lifted':
      return 'lifted';
    case 'blocks':
      return n === 1 ? 'full block' : 'full blocks';
    case 'plates':
      return 'kg on the bar';
    case 'moments':
      return badge.name;
  }
}

/** "6-week streak", or nothing worth saying yet. */
export function streakLabel(streak: Pick<Streak, 'current'>): string | null {
  return streak.current > 0 ? `${streak.current}-week streak` : null;
}

/**
 * Where a session left its week. Straight after Finish it says what is still
 * to do; reopened later, only what happened.
 */
export function weekLine(reward: SessionReward, fresh: boolean): string {
  if (!reward.counts) return 'Under three sets, so this one does not count toward the week.';
  const { sessions, target, hit, hitHere } = reward.week;
  if (hitHere) {
    return reward.streak > 1
      ? `Week hit, ${sessions} of ${target}: ${reward.streak} weeks in a row.`
      : `Week hit, ${sessions} of ${target}: a streak starts here.`;
  }
  if (hit) return `Week already hit: that makes ${sessions} this week.`;
  if (!fresh) return `Session ${sessions} of ${target} that week.`;
  const left = target - sessions;
  return reward.streak > 0
    ? `${sessions} of ${target} this week: ${left} more keeps your ${reward.streak}-week streak.`
    : `${sessions} of ${target} this week: ${left} more starts a streak.`;
}

export const formatXp = (xp: number) => xp.toLocaleString('en-GB');
