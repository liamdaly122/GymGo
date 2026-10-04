import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBlockReport } from '@/db/queries';
import { BackLink, Button, Screen, ScreenHeader, SectionLabel, Stat } from '@/components/ui';
import { formatShortDate } from '@/lib/dates';
import { localIsoDate } from '@/domain/schedule';
import type { BlockRecord, MainLiftChange } from '@/domain/blockReport';
import NextBlockPanel from '@/features/plan/NextBlockPanel';
import { MuscleBars, Sparkline } from './charts';

/** Estimated maxes to a tenth, the way the rest of the app shows them. */
const kg = (value: number) => Math.round(value * 10) / 10;

const day = (iso: string) => formatShortDate(localIsoDate(new Date(iso)));

/** Records shown before "Show all": the main lifts', and a few more. */
const RECORDS_SHOWN = 8;

const TARGET_NAMES: Record<string, string> = {
  hypertrophy: 'the target for building muscle',
  strength: 'the target for strength, which the brief sets for the main lifts',
  general: 'the target for general fitness',
};

/**
 * What a block did, and — when it has just finished — the way into the next.
 *
 * The sessions trained, how each main lift's estimated max moved, the records
 * it set, and the weekly sets each muscle got against the goal's target. Any
 * block can be opened, so a finished one is a record you can come back to:
 * Progress lists them.
 */
export default function BlockReportScreen() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const view = useBlockReport(planId);
  const [allRecords, setAllRecords] = useState(false);

  if (view === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }
  if (view === null) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/progress')}>Back to Progress</Button>
      </Screen>
    );
  }

  const { report, plan } = view;
  const soFar = view.running && !view.complete;
  const trained = report.sessionsDone > 0;
  const under = report.muscles.filter((entry) => entry.sets < report.target.low);
  const over = report.muscles.filter((entry) => entry.sets > report.target.high);

  return (
    <Screen>
      <BackLink to="/progress">Progress</BackLink>
      <ScreenHeader
        title={soFar ? 'Block so far' : 'Block report'}
        label={`${view.split} · block ${view.number}`}
      />

      <div className="stack">
        <div className="stats">
          <Stat label="Sessions" value={`${report.sessionsDone}/${report.sessionsPlanned}`} />
          <Stat label="Records" value={report.records.length} />
          <Stat label="Sets" value={report.setCount} />
        </div>
        <p className="t-meta">
          {view.goal}
          {report.firstSession && report.lastSession
            ? ` · ${day(report.firstSession)} – ${day(report.lastSession)}`
            : ''}
          {report.endedEarly ? ' · ended early' : ''}
        </p>

        {!trained ? <p>Nothing was trained in this block.</p> : null}

        {report.mainLifts.length > 0 ? (
          <section className="card" aria-labelledby="main-lifts">
            <h2 className="t-section" id="main-lifts" style={{ margin: 0 }}>
              Main lifts
            </h2>
            <ul className="list">
              {report.mainLifts.map((lift) => (
                <li key={lift.exercise.id}>
                  <MainLiftRow lift={lift} />
                </li>
              ))}
            </ul>
            <p className="t-meta">
              Estimated max from your best working set each session, first session to last.
              {report.deloadLeftOut ? ' The deload week is left out: it is lighter on purpose.' : ''}
            </p>
          </section>
        ) : null}

        {trained ? (
          <section aria-labelledby="block-records">
            <SectionLabel id="block-records">Records</SectionLabel>
            {report.records.length === 0 ? (
              <p className="t-meta">No records this block.</p>
            ) : (
              <>
                <div>
                  {(allRecords ? report.records : report.records.slice(0, RECORDS_SHOWN)).map((record) => (
                    <RecordRow key={record.exercise.id} record={record} />
                  ))}
                </div>
                {report.records.length > RECORDS_SHOWN && !allRecords ? (
                  <button type="button" className="btn-text mt-2" onClick={() => setAllRecords(true)}>
                    Show all {report.records.length} records
                  </button>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {report.muscles.length > 0 ? (
          <section className="card" aria-labelledby="block-muscles">
            <h2 className="t-section" id="block-muscles" style={{ margin: 0 }}>
              Sets per muscle, a week
            </h2>
            <MuscleBars
              data={report.muscles}
              idPrefix="block-bar"
              target={report.target}
              targetName={TARGET_NAMES[plan.goal] ?? 'the weekly target'}
            />
            <p className="t-meta">
              The average of {report.weeksAveraged} training {report.weeksAveraged === 1 ? 'week' : 'weeks'}
              {report.deloadLeftOut ? ', deload left out' : ''}. A set credits its primary muscle in full
              and each secondary at a half.
            </p>
            {under.length > 0 ? (
              <p className="text-sm">
                Under target: {under.map((entry) => `${entry.muscle} (${kg(entry.sets)})`).join(', ')}.
              </p>
            ) : null}
            {over.length > 0 ? (
              <p className="text-sm">
                Over target: {over.map((entry) => `${entry.muscle} (${kg(entry.sets)})`).join(', ')}.
              </p>
            ) : null}
          </section>
        ) : null}

        {view.running && view.complete ? (
          <section aria-labelledby="next-block">
            <SectionLabel id="next-block">Next block</SectionLabel>
            <NextBlockPanel planId={plan.id} blockWeeks={plan.block_weeks} />
          </section>
        ) : null}
      </div>
    </Screen>
  );
}

function MainLiftRow({ lift }: { lift: MainLiftChange }) {
  const change = kg(lift.change);
  return (
    <Link
      to={`/exercises/${lift.exercise.id}`}
      className="list-row"
      aria-label={`${lift.exercise.name}: estimated max ${kg(lift.start)} to ${kg(lift.end)} kilograms`}
    >
      <span className="list-main">
        <strong>{lift.exercise.name}</strong>
        <span className="t-meta">
          {lift.sessions} {lift.sessions === 1 ? 'session' : 'sessions'}
        </span>
      </span>
      <Sparkline values={lift.series} />
      <span className="list-end">
        <span className="num">{kg(lift.end)} kg</span>
        <span className={`t-meta ${change > 0 ? 'text-hot' : ''}`}>
          {lift.sessions === 1
            ? 'one session'
            : `${change > 0 ? '+' : ''}${change} from ${kg(lift.start)}`}
        </span>
      </span>
    </Link>
  );
}

function RecordRow({ record }: { record: BlockRecord }) {
  const parts = [
    record.heaviest
      ? `${record.heaviest.weight}kg × ${record.heaviest.reps} (was ${record.heaviest.previous}kg)`
      : null,
    record.e1rm ? `est. max ${kg(record.e1rm.value)}kg (was ${kg(record.e1rm.previous)}kg)` : null,
  ].filter(Boolean);
  return (
    <div className="pr-row">
      <span className="pr-badge">PR</span>
      <span className="list-main">
        <span className="font-semibold">{record.exercise.name}</span>
        <span className="t-meta">{parts.join(' · ')}</span>
      </span>
    </div>
  );
}
