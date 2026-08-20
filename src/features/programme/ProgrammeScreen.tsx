import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProgramme, type ProgrammeRoutine } from '@/db/queries';
import { completePlan, createRoutine, startNextBlock } from '@/db/mutations';
import { Button, Card, EmptyState, Pill, Screen, ScreenTitle } from '@/components/ui';
import { formatWeekLabel } from '@/domain/programmes/block';

/**
 * The programme you are on, and the routines it is made of.
 *
 * This replaced a flat list of every routine in the database, which showed the
 * four sessions a plan generated and one you wrote yourself as five
 * interchangeable rows — no dates, no contents, no way to tell them apart. The
 * plan is the thing you actually think in, so the plan is what this screen is
 * about; its routines are listed as the sessions inside it.
 */
export default function ProgrammeScreen() {
  const view = useProgramme();
  const navigate = useNavigate();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmingFinish, setConfirmingFinish] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const routineId = await createRoutine(trimmed);
    setName('');
    setNaming(false);
    void navigate(`/routines/${routineId}`);
  };

  const handleNextBlock = async () => {
    if (!view?.plan) return;
    await startNextBlock(view.plan.id);
    setConfirmingFinish(false);
    void navigate('/');
  };

  const handleFinishOnly = async () => {
    if (!view?.plan) return;
    await completePlan(view.plan.id);
    setConfirmingFinish(false);
  };

  if (view === undefined) {
    return (
      <Screen>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenTitle
        action={
          <button onClick={() => setNaming(true)} className="text-xs text-accent">
            New routine
          </button>
        }
      >
        Programme
      </ScreenTitle>

      {naming ? (
        <Card className="mb-4 p-4">
          <label htmlFor="routine-name" className="eyebrow mb-2 block">
            Routine name
          </label>
          <input
            id="routine-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
              if (event.key === 'Escape') setNaming(false);
            }}
            placeholder="Lower A, Push, Full body…"
            className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-base text-white placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => void handleCreate()}>
              Create
            </Button>
            <Button className="flex-1" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {view.plan && view.week && view.progress ? (
        <Card className="mb-4 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 truncate text-sm font-medium text-white">{view.plan.name}</h2>
            <span className="shrink-0 text-xs text-blue-400">{formatWeekLabel(view.week)}</span>
          </div>

          <p className="mt-1 text-xs text-muted">
            {view.progress.done} of {view.progress.total} sessions done
            {view.progress.missed > 0 ? ` · ${view.progress.missed} missed` : ''}
          </p>

          {/* The block had no ending: completed_at was in the schema and nothing
              ever wrote it, so a finished plan sat on Train forever showing
              "Week 5/5" with every session behind it marked missed. */}
          {view.complete ? (
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs text-white">This block is finished.</p>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                The next one runs the same sessions for another {view.plan.block_weeks} weeks.
                Your weights carry over — suggestions pick up where this block left off.
              </p>
              <Button
                variant="primary"
                className="mt-3 w-full"
                onClick={() => void handleNextBlock()}
              >
                Start the next block
              </Button>
              <button
                onClick={() => void handleFinishOnly()}
                className="mt-2 w-full py-1 text-[11px] text-muted"
              >
                Just close it — I'll pick a new plan
              </button>
            </div>
          ) : confirmingFinish ? (
            <div className="mt-3 rounded-xl border border-line bg-raised p-3">
              <p className="text-xs text-white">End this block early?</p>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                Sessions you have already logged stay in your history either way.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" className="flex-1" onClick={() => void handleFinishOnly()}>
                  End block
                </Button>
                <Button className="flex-1" onClick={() => setConfirmingFinish(false)}>
                  Keep going
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingFinish(true)}
              className="mt-3 text-[11px] text-muted underline-offset-2 active:underline"
            >
              End this block early
            </button>
          )}
        </Card>
      ) : (
        <Card className="mb-4 p-4">
          <p className="text-sm text-white">No plan running.</p>
          <p className="mt-1 text-xs text-muted">
            A plan turns a goal and a split into a five-week block with sessions on real days.
          </p>
          <Link to="/plans">
            <Button variant="primary" className="mt-3 w-full">
              Pick a plan
            </Button>
          </Link>
        </Card>
      )}

      {view.sessions.length > 0 ? (
        <section className="mb-6">
          <h2 className="eyebrow mb-2">Sessions in this plan</h2>
          <p className="mb-2 text-[11px] leading-snug text-muted">
            Editing one changes future sessions only. Workouts you have already done keep exactly
            what you performed.
          </p>
          <ul className="space-y-2">
            {view.sessions.map((entry) => (
              <li key={entry.routine.id}>
                <RoutineRow entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="eyebrow mb-2">Your own routines</h2>
        {view.standalone.length === 0 ? (
          <EmptyState
            title="Nothing of your own yet."
            hint="A routine is a template. Starting a workout copies it, so editing it later never changes a session you have already done."
          />
        ) : (
          <ul className="space-y-2">
            {view.standalone.map((entry) => (
              <li key={entry.routine.id}>
                <RoutineRow entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

function RoutineRow({ entry }: { entry: ProgrammeRoutine }) {
  return (
    <Link to={`/routines/${entry.routine.id}`} className="block">
      <Card className="p-3 active:bg-raised">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-white">{entry.label}</p>
          <span className="shrink-0 text-[11px] text-muted">Edit</span>
        </div>
        {entry.exerciseCount === 0 ? (
          <p className="mt-1 text-[11px] text-muted">Empty — add some exercises.</p>
        ) : (
          <>
            <p className="mt-1 text-[11px] tabular-nums text-muted">
              {entry.exerciseCount} exercises · ~{entry.estimatedMinutes} min
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.muscles.map((muscle) => (
                <Pill key={muscle}>{muscle}</Pill>
              ))}
            </div>
          </>
        )}
      </Card>
    </Link>
  );
}
