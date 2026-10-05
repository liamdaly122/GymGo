import { Link } from 'react-router-dom';
import { useRewards } from '@/db/queries';
import { formatXp, streakLabel } from './copy';

/**
 * Today's quiet line about the game: the level, how far to the next, and the
 * week's streak. It sits under the day's work and above the poster, small,
 * so the next session is still the headline. Opens the Awards.
 *
 * Nothing shows before the first session: a level 1 bar with nothing in it
 * says nothing a new lifter needs to hear.
 */
export default function LevelStrip() {
  const rewards = useRewards();
  if (!rewards || rewards.xp === 0) return null;

  const { level, streak } = rewards;
  const week = streak.thisWeek;
  const streakText = streakLabel(streak);
  const weekText = week.hit ? 'week hit' : `${week.sessions} of ${week.target} this week`;

  return (
    <Link
      to="/progress/awards"
      className="lvl-strip"
      aria-label={`Level ${level.level}, ${level.title}: ${formatXp(level.toNext)} XP to level ${level.level + 1}. ${
        streakText ? `${streakText}, ` : ''
      }${weekText}.`}
    >
      <span className="lvl-row">
        <span className="lvl-num">Level {level.level}</span>
        <span className="lvl-title">{level.title}</span>
        {streakText ? <span className="lvl-streak">{streakText}</span> : null}
      </span>
      <span className="xp-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(level.fraction * 100)}%` }} />
      </span>
      <span className="lvl-meta">
        {formatXp(level.toNext)} XP to level {level.level + 1} · {weekText}
      </span>
    </Link>
  );
}
