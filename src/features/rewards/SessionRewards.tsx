import { useEffect, useState } from 'react';
import { useRewards } from '@/db/queries';
import { describeRemaining, type LevelProgress } from '@/domain/rewards';
import BadgeTile from './BadgeTile';
import { formatXp, weekLine } from './copy';

/**
 * What a session earned: the XP and where it came from, the level it moved,
 * its week and its badges.
 *
 * Straight after Finish this is the reward: the bar fills from where the
 * session started, a level-up gets a poster of its own, and the nearest badge
 * says how close it is. Reopened later, the same facts sit still — the summary
 * you see in the gym is the record you find later.
 */
export default function SessionRewards({ workoutId, fresh }: { workoutId: string; fresh: boolean }) {
  const rewards = useRewards();
  const reward = rewards?.sessions.get(workoutId);
  // A session still under way has earned nothing yet.
  if (!rewards || !reward) return null;

  const levelledUp = reward.after.level > reward.before.level;
  const next = fresh ? rewards.next[0] : undefined;

  return (
    <section className="reward" aria-labelledby="xp-earned">
      <div className="card-head">
        <h2 className="t-section" id="xp-earned" style={{ margin: 0 }}>
          XP earned
        </h2>
        <span className="reward-xp">+{formatXp(reward.xp)} XP</span>
      </div>

      {levelledUp ? (
        <div className={`reward-up ${fresh ? 'fresh' : ''}`}>
          <p className="kicker">Level up</p>
          <h3 className="reward-up-num">Level {reward.after.level}</h3>
          <p className="reward-up-title">{reward.after.title}</p>
        </div>
      ) : null}

      <LevelBar before={reward.before} after={reward.after} fresh={fresh} />

      <ul className="reward-lines">
        {reward.lines.map((line) => (
          <li key={line.source}>
            <span>{line.label}</span>
            <span className="num">+{formatXp(line.xp)}</span>
          </li>
        ))}
      </ul>

      <p className="reward-week">{weekLine(reward, fresh)}</p>

      {reward.badges.length > 0 ? (
        <section className="stack-sm" aria-labelledby="badges-earned">
          <h3 className="t-section" id="badges-earned" style={{ margin: 0 }}>
            {reward.badges.length === 1 ? 'Badge earned' : 'Badges earned'}
          </h3>
          <ul className="badge-tiles">
            {reward.badges.map(({ badge }, index) => (
              // Fresh from the workout, each one stamps itself in, one after another.
              <BadgeTile key={badge.id} badge={badge} state="earned" stamp={fresh} delay={300 + index * 160} />
            ))}
          </ul>
        </section>
      ) : null}

      {next ? (
        <p className="t-meta">
          Next badge: {next.badge.name}, {describeRemaining(next.family, next.remaining)}.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The level the session ended on. Fresh, it fills from where the session
 * began — from empty, after a level-up — so the gain is something you watch.
 */
function LevelBar({ before, after, fresh }: { before: LevelProgress; after: LevelProgress; fresh: boolean }) {
  const start = after.level > before.level ? 0 : before.fraction;
  const [width, setWidth] = useState(fresh ? start : after.fraction);

  useEffect(() => {
    if (!fresh) return;
    // Long enough for the starting width to be painted, so the fill is seen.
    const id = window.setTimeout(() => setWidth(after.fraction), 150);
    return () => window.clearTimeout(id);
  }, [fresh, after.fraction]);

  return (
    <div className="stack-xs">
      <div className="xp-bar lg" aria-hidden="true">
        <i style={{ width: `${Math.round(width * 1000) / 10}%` }} />
      </div>
      <p className="t-meta">
        Level {after.level}
        {fresh ? ` · ${formatXp(after.toNext)} XP to level ${after.level + 1}` : ' after this session'}
      </p>
    </div>
  );
}
