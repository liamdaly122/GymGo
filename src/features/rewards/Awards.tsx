import { useState } from 'react';
import { useRewards } from '@/db/queries';
import { BADGES, describeRemaining, XP, type Badge, type FamilyProgress, type Rewards, type WeekStatus } from '@/domain/rewards';
import { localIsoDate } from '@/domain/schedule';
import { Sheet, Stat } from '@/components/ui';
import { formatShortDate } from '@/lib/dates';
import { BadgeFace, type TileState } from './BadgeTile';
import { formatXp } from './copy';

/** How many weeks the streak's row of squares shows. */
const WEEKS_SHOWN = 12;

const WEEK_WORDS: Record<WeekStatus, string> = {
  hit: 'hit',
  banked: 'covered by a banked week',
  short: 'short',
  open: 'under way',
};

const earnedOn = (at: string) => formatShortDate(localIsoDate(new Date(at)));

/**
 * Progress → Awards: the level, the streak and every badge.
 *
 * All of it worked out from the training log, so it is already right on the
 * day it first opens — two years of sessions arrive as the level they earned.
 */
export default function Awards() {
  const rewards = useRewards();
  const [open, setOpen] = useState<Badge | null>(null);
  if (rewards === undefined) return null;

  const { level, streak } = rewards;
  const earned = rewards.families.reduce((total, family) => total + family.earned.length, 0);
  const weeks = streak.weeks.slice(-WEEKS_SHOWN);
  const familyOf = (badge: Badge) => rewards.families.find((family) => family.family === badge.family)!;

  return (
    <>
      <section className="card" aria-labelledby="awards-level">
        <h2 className="t-section" id="awards-level" style={{ margin: 0 }}>
          Level
        </h2>
        <div className="awards-level">
          <span className="awards-level-num num">{level.level}</span>
          <span className="awards-level-txt">
            <strong>{level.title}</strong>
            <span className="t-meta">{formatXp(rewards.xp)} XP in all</span>
          </span>
        </div>
        <div className="xp-bar lg" aria-hidden="true">
          <i style={{ width: `${Math.round(level.fraction * 1000) / 10}%` }} />
        </div>
        <p className="t-meta">
          {formatXp(level.toNext)} XP to level {level.level + 1}
        </p>
      </section>

      <section className="card" aria-labelledby="awards-streak">
        <h2 className="t-section" id="awards-streak" style={{ margin: 0 }}>
          Streak
        </h2>
        <div className="stats">
          <Stat label="Weeks" value={streak.current} />
          <Stat label="Best" value={streak.best} />
          <Stat label="Banked" value={streak.banked} />
        </div>
        <p className="t-meta">
          This week: {streak.thisWeek.sessions} of {streak.thisWeek.target}
          {streak.thisWeek.hit ? ', hit.' : '.'}
        </p>
        {weeks.length > 0 ? (
          <ol className="streak-weeks">
            {weeks.map((week) => (
              <li key={week.start} className={`sw ${week.status}`}>
                <span className="sr-only">
                  Week of {formatShortDate(week.start)}: {WEEK_WORDS[week.status]}, {week.sessions} of {week.target}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="t-meta">
          A week counts when you train as many sessions as your plan has. Every fourth week in a row banks a
          free one, for a holiday or a cold.
        </p>
      </section>

      <section className="stack" aria-labelledby="awards-badges">
        <div className="card-head">
          <h2 className="t-section" id="awards-badges" style={{ margin: 0 }}>
            Badges
          </h2>
          <span className="t-meta">
            {earned} of {BADGES.length}
          </span>
        </div>
        {rewards.families.map((family) => (
          <div key={family.family} className="badge-family">
            <h3 className="t-label">{family.name}</h3>
            <ul className="badge-tiles">
              {BADGES.filter((badge) => badge.family === family.family).map((badge) => {
                const { state, note } = tileState(family, badge);
                return (
                  <li key={badge.id} className={`badge-tile ${state}`}>
                    <button type="button" className="badge-btn" onClick={() => setOpen(badge)}>
                      <BadgeFace badge={badge} state={state} note={note} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <HowXpWorks />

      {open ? <BadgeSheet badge={open} family={familyOf(open)} rewards={rewards} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function tileState(family: FamilyProgress, badge: Badge): { state: TileState; note?: string } {
  const won = family.earned.find((entry) => entry.badge.id === badge.id);
  if (won) return { state: 'earned', note: earnedOn(won.at) };
  if (family.next?.badge.id === badge.id) {
    return { state: 'next', note: describeRemaining(family.family, family.next.remaining) };
  }
  return { state: 'locked' };
}

/** Where a family stands, in its own words: "37 of 50 sessions". */
function standing(family: FamilyProgress, badge: Badge): string {
  const value = family.value;
  switch (family.family) {
    case 'sessions':
      return `${value} of ${badge.threshold} sessions`;
    case 'streak':
      return `Best streak: ${value} ${value === 1 ? 'week' : 'weeks'}`;
    case 'records':
      return `${value} of ${badge.threshold} records`;
    case 'lifted':
      return `${(Math.floor(value / 100) / 10).toLocaleString('en-GB')} of ${(badge.threshold / 1000).toLocaleString('en-GB')} tonnes`;
    case 'blocks':
      return `${value} of ${badge.threshold} full blocks`;
    case 'plates':
      return value > 0 ? `Heaviest barbell set: ${value}kg` : 'No barbell sets yet';
    case 'moments':
      return 'Not yet';
  }
}

function BadgeSheet({
  badge,
  family,
  rewards,
  onClose,
}: {
  badge: Badge;
  family: FamilyProgress;
  rewards: Rewards;
  onClose: () => void;
}) {
  const won = family.earned.find((entry) => entry.badge.id === badge.id);
  const session = won ? rewards.sessions.get(won.workoutId) : undefined;
  return (
    <Sheet label={badge.name} onClose={onClose}>
      <p className="t-label">{family.name}</p>
      <h2>{badge.name}</h2>
      <p className="sheet-note">{badge.description}</p>
      <p className={won ? 'reward-week' : 't-meta'}>
        {won
          ? `Earned ${earnedOn(won.at)}${session ? `, in a session worth ${formatXp(session.xp)} XP` : ''}.`
          : standing(family, badge)}
      </p>
    </Sheet>
  );
}

/** The XP table, said plainly, including what it deliberately does not pay for. */
function HowXpWorks() {
  const rows: Array<[string, number]> = [
    ['A session of three sets or more', XP.session],
    [`Each set, up to ${XP.setCap}`, XP.perSet],
    ['A session from your plan', XP.plan],
    ['Each record you beat', XP.record],
    ['The session that hits your week', XP.week],
    ['A block with every session trained', XP.block],
    ['Back after two weeks away', XP.comeback],
    ['Each badge', XP.badge],
  ];
  return (
    <section className="stack-sm" aria-labelledby="awards-how">
      <h2 className="t-section" id="awards-how" style={{ margin: 0 }}>
        How XP works
      </h2>
      <ul className="reward-lines">
        {rows.map(([label, xp]) => (
          <li key={label}>
            <span>{label}</span>
            <span className="num">+{xp}</span>
          </li>
        ))}
      </ul>
      <p className="t-meta">
        Rest days and the deload week never cost you anything. Sets past {XP.setCap} in a session earn nothing
        extra: more junk volume is not more progress.
      </p>
    </section>
  );
}
