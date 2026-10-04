import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBlockOverview, useProgramme, type ProgrammeRoutine } from '@/db/queries';
import { completePlan, createRoutine, startNextBlock } from '@/db/mutations';
import { Button, Screen, ScreenHeader, SectionLabel, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useToday } from '@/hooks/useToday';
import { formatDayLabel } from '@/lib/dates';
import { weekModifier } from '@/domain/programmes/block';
import type { ScheduledSession } from '@/domain/schedule';
import BlockOverview from './BlockOverview';
import { describeBlockProgress, movedLabel } from './blockCopy';

/**
 * The plan you are on: the block, what is coming up, and the routines it is
 * made of — plus the way into building another.
 *
 * Programme and Plans were two tabs for one idea. The owner tested the merge
 * in the drafts and chose it; the plan builder now hangs off this screen.
 */
export default function PlanScreen() {
  const view = useProgramme();
  const weeks = useBlockOverview();
  const today = useToday();
  const navigate = useNavigate();
  const [showWeeks, setShowWeeks] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  if (view === undefined) {
    return (
      <Screen>
        <ScreenHeader title="Plan" />
      </Screen>
    );
  }

  const plan = view.plan;
  const routineById = new Map(
    [...view.sessions, ...view.standalone].map((entry) => [entry.routine.id, entry]),
  );

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const routineId = await createRoutine(trimmed);
    setName('');
    setNaming(false);
    void navigate(`/routines/${routineId}`);
  };

  const handleNextBlock = async () => {
    if (!plan) return;
    await startNextBlock(plan.id);
    void navigate('/');
  };

  const handleClose = async () => {
    if (!plan) return;
    await completePlan(plan.id);
    setConfirmingEnd(false);
  };

  // "Build muscle · Push / Pull / Legs (block 2)": the goal is the label, the
  // split is the headline.
  const [goal, ...rest] = (plan?.name ?? '').split(' · ');
  const split = rest.join(' · ') || plan?.name || '';

  // What happens next: anything trained today, then the next sessions still to do.
  const comingUp: ScheduledSession[] = [
    ...view.schedule.filter((session) => session.status === 'done' && session.date === today),
    ...view.schedule.filter((session) => session.status !== 'done'),
  ].slice(0, 3);

  const week = view.week;
  const blockWeeks = plan?.block_weeks ?? 5;
  const thisWeek = view.schedule.filter((session) => session.week === week?.week);
  const weekFill = thisWeek.length
    ? thisWeek.filter((session) => session.status === 'done').length / thisWeek.length
    : 0;

  return (
    <Screen>
      <ScreenHeader title="Plan" />
      <div className="stack">
        {plan && week && view.progress ? (
          <section className="card" aria-label="This block">
            <div className="stack-sm">
              <p className="t-label">
                {goal} · {plan.training_days.length} days a week
              </p>
              <h2 className="t-h2">{split}</h2>
              <p className="t-meta">
                Week {week.week} of {week.totalWeeks} · {week.label} ·{' '}
                {describeBlockProgress(view.progress)}
              </p>
            </div>

            <button
              type="button"
              className="block-track"
              onClick={() => setShowWeeks((open) => !open)}
              aria-expanded={showWeeks}
              aria-controls="block-weeks"
              aria-label={`See the whole ${blockWeeks}-week block`}
            >
              {Array.from({ length: blockWeeks }, (_unused, index) => {
                const number = index + 1;
                const state = number < week.week ? 'done' : number === week.week ? 'cur' : '';
                return (
                  <span
                    key={number}
                    className={`bt-week ${state}`}
                    style={state === 'cur' ? ({ '--fill': `${Math.round(weekFill * 100)}%` } as React.CSSProperties) : undefined}
                  >
                    <i />
                    <span>{weekModifier(number, blockWeeks).label}</span>
                  </span>
                );
              })}
            </button>
            {showWeeks && weeks ? <BlockOverview weeks={weeks} id="block-weeks" /> : null}

            {view.complete ? (
              <div className="stack-sm rounded-md bg-surface p-4">
                <p className="t-h2">This block is finished.</p>
                <p className="t-meta">
                  The next one runs the same sessions for another {plan.block_weeks} weeks. Your
                  weights carry over — suggestions pick up where this block left off.
                </p>
                <Button variant="primary" block onClick={() => void handleNextBlock()}>
                  Start the next block
                </Button>
                <button type="button" className="btn-text" onClick={() => void handleClose()}>
                  Just close it — I'll pick a new plan
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="card" aria-label="No plan">
            <h2 className="t-h2">No plan running.</h2>
            <p className="t-meta">
              A plan turns a goal and a split into a five-week block with sessions on real days.
            </p>
            <Button variant="primary" block onClick={() => void navigate('/plan/new')}>
              Pick a plan
            </Button>
          </section>
        )}

        {plan && comingUp.length > 0 ? (
          <section aria-labelledby="coming-up">
            <SectionLabel id="coming-up">Coming up</SectionLabel>
            <ul className="list">
              {comingUp.map((session) => (
                <li key={`${session.week}-${session.sessionIndex}`}>
                  <ComingUpRow session={session} entry={routineById.get(session.routineId ?? '')} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {view.sessions.length > 0 ? (
          <section aria-labelledby="sessions-in-plan">
            <SectionLabel id="sessions-in-plan">Sessions in this plan</SectionLabel>
            <p className="t-meta mb-2">
              Editing one changes future sessions only. Workouts you have already done keep
              exactly what you performed.
            </p>
            <ul className="list">
              {view.sessions.map((entry) => (
                <li key={entry.routine.id}>
                  <RoutineRow entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="own-routines">
          <SectionLabel id="own-routines">Your own routines</SectionLabel>
          {view.standalone.length === 0 ? (
            <p className="t-meta">
              Nothing of your own yet. A routine is a template: starting a workout copies it, so
              editing it later never changes a session you have already done.
            </p>
          ) : (
            <ul className="list">
              {view.standalone.map((entry) => (
                <li key={entry.routine.id}>
                  <RoutineRow entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-3" block onClick={() => setNaming(true)}>
            New routine
          </Button>
        </section>

        <div className="stack-sm">
          <Button block onClick={() => void navigate('/plan/new')}>
            Build a new plan
          </Button>
          {plan && !view.complete ? (
            <button type="button" className="btn-text" onClick={() => setConfirmingEnd(true)}>
              End this block early
            </button>
          ) : null}
        </div>
      </div>

      {naming ? (
        <Sheet label="New routine" onClose={() => setNaming(false)}>
          <h2>New routine</h2>
          <label htmlFor="routine-name" className="field-label">
            Routine name
          </label>
          <input
            id="routine-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
            placeholder="Lower A, Push, Full body…"
            className="field"
          />
          <Button variant="primary" onClick={() => void handleCreate()}>
            Create
          </Button>
          <Button onClick={() => setNaming(false)}>Cancel</Button>
        </Sheet>
      ) : null}

      {confirmingEnd ? (
        <Sheet label="End this block early" onClose={() => setConfirmingEnd(false)}>
          <h2>End this block early?</h2>
          <p className="sheet-note">
            Sessions you have already logged stay in your history either way. Skipped ones stop
            rolling forward.
          </p>
          <Button variant="danger" onClick={() => void handleClose()}>
            End block
          </Button>
          <Button onClick={() => setConfirmingEnd(false)}>Keep going</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}

function ComingUpRow({ session, entry }: { session: ScheduledSession; entry: ProgrammeRoutine | undefined }) {
  const when =
    session.status === 'done'
      ? 'Done'
      : session.status === 'today'
        ? 'Today'
        : formatDayLabel(`${session.date}T12:00:00`);
  const moved = movedLabel(session);
  const body = (
    <>
      <span className="list-main">
        <strong>{session.name}</strong>
        <span className="t-meta">
          {entry ? `${entry.exerciseCount} exercises · about ${entry.estimatedMinutes} min` : `Week ${session.week}`}
          {moved ? ` · ${moved}` : ''}
        </span>
      </span>
      <span className="list-end">
        <span className={`status-chip ${session.status}`}>{when}</span>
      </span>
      <Icon name="chev" />
    </>
  );
  if (session.workoutId) {
    return (
      <Link to={`/history/${session.workoutId}`} className="list-row">
        {body}
      </Link>
    );
  }
  return session.routineId ? (
    <Link to={`/routines/${session.routineId}`} className="list-row">
      {body}
    </Link>
  ) : (
    <div className="list-row">{body}</div>
  );
}

function RoutineRow({ entry }: { entry: ProgrammeRoutine }) {
  return (
    <Link to={`/routines/${entry.routine.id}`} className="list-row">
      <span className="list-main">
        <strong>{entry.label}</strong>
        <span className="t-meta">
          {entry.exerciseCount === 0
            ? 'Empty — add some exercises.'
            : `${entry.exerciseCount} exercises · about ${entry.estimatedMinutes} min · ${entry.muscles.join(', ')}`}
        </span>
      </span>
      <span className="list-end">
        <span className="status-chip">Edit</span>
      </span>
      <Icon name="chev" />
    </Link>
  );
}
