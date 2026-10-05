import { Link, useLocation } from 'react-router-dom';
import {
  useLiftSummaries,
  usePastBlocks,
  usePlanSchedule,
  useProgressOverview,
  useSessionList,
  useSettings,
} from '@/db/queries';
import { EmptyState, Screen, ScreenHeader, SectionLabel } from '@/components/ui';
import { Icon } from '@/components/icons';
import SessionListRow from '@/components/SessionListRow';
import { describeBlockProgress } from '@/features/plan/blockCopy';
import { formatShortDate } from '@/lib/dates';
import { localIsoDate } from '@/domain/schedule';
import { MuscleBars, Sparkline } from './charts';
import BodyWeight from './BodyWeight';
import Awards from '@/features/rewards/Awards';

/**
 * What you have done: the sessions, and the lifts.
 *
 * History and Progress were two tabs for one question. Sessions leads with the
 * week's sets per muscle and lists every workout; Lifts lists every exercise
 * you have trained with the shape of its top set, and opens its chart; Body is
 * the weight log; Awards is what the training has earned.
 */
export default function ProgressScreen() {
  const { pathname } = useLocation();
  const segment = pathname.endsWith('/lifts')
    ? 'lifts'
    : pathname.endsWith('/body')
      ? 'body'
      : pathname.endsWith('/awards')
        ? 'awards'
        : 'sessions';
  const overview = useProgressOverview();

  return (
    <Screen>
      <ScreenHeader title="Progress" />
      <div className="stack">
        <nav className="seg" aria-label="Show">
          <Link to="/progress" aria-current={segment === 'sessions' ? 'page' : undefined}>
            Sessions
          </Link>
          <Link to="/progress/lifts" aria-current={segment === 'lifts' ? 'page' : undefined}>
            Lifts
          </Link>
          <Link to="/progress/body" aria-current={segment === 'body' ? 'page' : undefined}>
            Body
          </Link>
          <Link to="/progress/awards" aria-current={segment === 'awards' ? 'page' : undefined}>
            Awards
          </Link>
        </nav>

        {/* Body weight is logged on its own, so it does not wait for a workout;
            Awards shows what there is to earn before anything is. */}
        {segment === 'body' ? (
          <BodyWeight />
        ) : segment === 'awards' ? (
          <Awards />
        ) : overview === undefined ? null : overview.workoutCount === 0 ? (
          <EmptyState
            title="Nothing to show yet."
            hint="Finish a workout or two and your sessions, volume and lifts will appear here."
          />
        ) : segment === 'lifts' ? (
          <Lifts />
        ) : (
          <Sessions weekly={overview.weeklyVolume} />
        )}
      </div>
    </Screen>
  );
}

function Sessions({ weekly }: { weekly: Array<{ muscle: string; sets: number }> }) {
  const rows = useSessionList(60);
  const planned = usePlanSchedule();
  const pastBlocks = usePastBlocks();
  const lastWeek = rows?.filter((row) => Date.parse(row.workout.started_at) >= Date.now() - 7 * 86_400_000) ?? [];

  return (
    <>
      {weekly.length > 0 ? (
        <section className="card" aria-labelledby="weekly-sets">
          <div className="card-head">
            <h2 className="t-section" id="weekly-sets" style={{ margin: 0 }}>
              Sets in the last 7 days
            </h2>
            <span className="t-meta">
              {lastWeek.length} {lastWeek.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>
          <MuscleBars data={weekly} idPrefix="bar" />
        </section>
      ) : null}

      {planned ? (
        <section aria-labelledby="this-block">
          <SectionLabel id="this-block">This block</SectionLabel>
          <p className="t-meta">
            Week {planned.week.week} of {planned.week.totalWeeks} · {planned.week.label} ·{' '}
            {describeBlockProgress(planned.progress)}
          </p>
          <Link to={`/progress/blocks/${planned.plan.id}`} className="btn-text hot mt-1 inline-block">
            See the block so far
          </Link>
        </section>
      ) : null}

      {pastBlocks && pastBlocks.length > 0 ? (
        <section aria-labelledby="past-blocks">
          <SectionLabel id="past-blocks">Past blocks</SectionLabel>
          <ul className="list">
            {pastBlocks.map((block) => (
              <li key={block.id}>
                <Link to={`/progress/blocks/${block.id}`} className="list-row">
                  <span className="list-main">
                    <strong>
                      {block.split} · block {block.number}
                    </strong>
                    <span className="t-meta">
                      {block.sessions} {block.sessions === 1 ? 'session' : 'sessions'} · ended{' '}
                      {formatShortDate(localIsoDate(new Date(block.completedAt)))}
                    </span>
                  </span>
                  <Icon name="chev" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="all-sessions">
        <SectionLabel id="all-sessions">All sessions</SectionLabel>
        <ul className="list">
          {(rows ?? []).map((row) => (
            <li key={row.workout.id}>
              <SessionListRow row={row} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Lifts() {
  const lifts = useLiftSummaries();
  const settings = useSettings();
  const pro = settings?.mode === 'pro';

  return (
    <>
      <ul className="list">
        {(lifts ?? []).map((lift) => (
          <li key={lift.id}>
            <Link to={`/exercises/${lift.id}`} className="list-row">
              <span className="list-main">
                <strong>{lift.name}</strong>
                <span className="t-meta first-letter:uppercase">{lift.muscle}</span>
              </span>
              <Sparkline values={lift.series} />
              <span className="list-end">
                <span className="num">{pro ? `${Math.round(lift.bestE1rm)} kg` : `${lift.best.weight} × ${lift.best.reps}`}</span>
                <span className="t-meta">{pro ? 'est. 1RM' : 'best set'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/exercises" className="btn btn-secondary btn-block">
        <Icon name="search" />
        All exercises
      </Link>
      <p className="t-meta">
        Records come from top working sets only. Drop sets and warm-ups count toward volume,
        never toward a record.
      </p>
    </>
  );
}
