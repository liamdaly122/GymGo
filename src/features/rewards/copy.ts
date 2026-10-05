import type { Badge, SessionReward, Streak } from '@/domain/rewards';

/** A badge as a tile: its number in the display face, and what it counts. */
export function tileText(badge: Badge): { big: string; small: string } {
  const n = badge.threshold;
  switch (badge.family) {
    case 'sessions':
      return { big: n.toLocaleString('en-GB'), small: n === 1 ? 'session' : 'sessions' };
    case 'streak':
      return { big: String(n), small: 'weeks' };
    case 'records':
      return { big: String(n), small: n === 1 ? 'record' : 'records' };
    case 'lifted':
      return { big: `${(n / 1000).toLocaleString('en-GB')}t`, small: 'lifted' };
    case 'blocks':
      return { big: String(n), small: n === 1 ? 'full block' : 'full blocks' };
    case 'plates': {
      const plates = (n - 20) / 40;
      return { big: String(plates), small: plates === 1 ? 'plate a side' : 'plates a side' };
    }
    case 'moments':
      return { big: badge.name, small: '' };
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
