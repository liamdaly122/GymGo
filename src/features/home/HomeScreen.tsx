import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  useActivePlan,
  useActiveWorkout,
  useBlockOverview,
  useFinishedWorkouts,
  usePlanSchedule,
  useRoutines,
  useSettings,
} from '@/db/queries';
import { startFreestyleWorkout, startWorkoutFromRoutine } from '@/db/mutations';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import WeekStrip from '@/components/WeekStrip';
import BlockOverview from './BlockOverview';
import ExerciseImage from '@/components/ExerciseImage';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';
import { formatWeekLabel } from '@/domain/programmes/block';
import { estimateDurationMinutes } from '@/domain/sessionSummary';
import { setsForWeek } from '@/domain/programmes/block';

export default function HomeScreen() {
  const navigate = useNavigate();
  const active = useActiveWorkout();
  const plan = useActivePlan();
  const planned = usePlanSchedule();
  const routines = useRoutines();
  const settings = useSettings();
  const recent = useFinishedWorkouts(3);
  const elapsed = useElapsed(active?.started_at);
  const block = useBlockOverview();
  // Collapsed by default: the screen's job is "what am I doing today", and the
  // rest of the block is a question you ask occasionally.
  const [showBlock, setShowBlock] = useState(false);

  const next = planned?.current ?? null;

  // What today's session actually contains, so the strip is not guesswork.
  const preview = useLiveQuery(async () => {
    if (!next?.routineId) return null;
    const rows = (await db.routine_exercises.where({ routine_id: next.routineId }).toArray())
      .filter((row) => row.deleted_at === null)
      .sort((a, b) => a.position - b.position);
    const exercises = await db.exercises.bulkGet(rows.map((row) => row.exercise_id));
    const present = exercises.filter(Boolean).map((exercise) => exercise!);
    return {
      count: rows.length,
      minutes: estimateDurationMinutes(
        rows.map((row) => ({
          sets: planned?.week ? setsForWeek(row.target_sets, planned.week) : row.target_sets,
          restSeconds: row.rest_seconds ?? 120,
        })),
      ),
      first: present.slice(0, 3).map((exercise) => exercise.name),
      hero: present[0] ?? null,
    };
  }, [next?.routineId, planned?.week.week]);

  const handleStartFreestyle = async () => {
    const workoutId = await startFreestyleWorkout();
    void navigate(`/workout/${workoutId}`);
  };

  const handleStartPlanned = async () => {
    if (!next?.routineId) return;
    const workoutId = await startWorkoutFromRoutine(next.routineId);
    void navigate(`/workout/${workoutId}`);
  };

  return (
    <Screen>
      <ScreenTitle
        action={
          <Link to="/settings" className="text-xs text-muted" aria-label="Settings">
            Settings
          </Link>
        }
      >
        Train
      </ScreenTitle>

      {active ? (
        <Card className="mb-4 border-accent/40 bg-accent/5 p-4">
          <p className="text-xs text-accent">Workout in progress</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatDuration(elapsed)}</p>
          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() => void navigate(`/workout/${active.id}`)}
          >
            Resume
          </Button>
        </Card>
      ) : null}

      {planned && plan ? (
        <Card className="mb-4 p-4">
          <button
            onClick={() => setShowBlock((open) => !open)}
            aria-expanded={showBlock}
            aria-controls="block-overview"
            className="mb-3 flex w-full items-baseline justify-between gap-2 text-left"
          >
            <p className="min-w-0 truncate text-xs text-muted">{plan.name}</p>
            <span className="flex shrink-0 items-center gap-1 text-xs text-blue-400">
              {formatWeekLabel(planned.week)}
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-transform ${showBlock ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>

          <WeekStrip
            schedule={planned.schedule}
            weekStartsOn={settings?.week_starts_on ?? 1}
            {...(next ? { selectedDate: next.date } : {})}
          />

          <p className="mt-3 text-[11px] leading-snug text-muted">{planned.week.intent}</p>

          <div id="block-overview">
            {showBlock && block ? <BlockOverview weeks={block} /> : null}
          </div>

          {!showBlock ? (
            <button
              onClick={() => setShowBlock(true)}
              className="mt-3 w-full rounded-lg border border-line bg-raised py-2 text-[11px] text-muted active:bg-line"
            >
              See the whole {planned.week.totalWeeks}-week block
            </button>
          ) : null}

          {next ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[10px] uppercase tracking-wide text-muted">
                {next.status === 'today'
                  ? "Today's workout"
                  : next.status === 'missed'
                    ? 'Missed — pick it up'
                    : `Next · ${formatDayLabel(`${next.date}T12:00:00`)}`}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-white">{next.name}</h2>

              {preview ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill>{preview.count} exercises</Pill>
                  <Pill>~{preview.minutes} min</Pill>
                  {planned.week.isDeload ? <Pill tone="accent">Deload</Pill> : null}
                </div>
              ) : null}

              {preview?.hero ? (
                <div className="mt-3 overflow-hidden rounded-xl">
                  <ExerciseImage
                    sourceId={preview.hero.source_id}
                    muscle={preview.hero.primary_muscle}
                    name={preview.hero.name}
                    rounded="rounded-xl"
                    className="h-36 w-full"
                  />
                </div>
              ) : null}

              {preview && preview.first.length > 0 ? (
                <p className="mt-2 truncate text-xs text-muted">{preview.first.join(' · ')}</p>
              ) : null}

              <Button
                variant="primary"
                className="mt-3 h-14 w-full text-base"
                disabled={!next.routineId || Boolean(active)}
                onClick={() => void handleStartPlanned()}
              >
                Start workout
              </Button>
            </div>
          ) : (
            <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
              Block finished. Start another from Plans.
            </p>
          )}

          <p className="mt-3 text-[11px] text-muted">
            {planned.progress.done} of {planned.progress.total} sessions done
            {planned.progress.missed > 0 ? ` · ${planned.progress.missed} missed` : ''}
          </p>
        </Card>
      ) : null}

      {!active ? (
        <Button
          variant={planned ? 'secondary' : 'primary'}
          className={`mb-4 w-full ${planned ? '' : 'h-14 text-base'}`}
          onClick={() => void handleStartFreestyle()}
        >
          Start empty workout
        </Button>
      ) : null}

      {!planned ? (
        <section className="mb-6">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Routines</h2>
          {routines === undefined ? null : routines.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-white">No plan yet.</p>
              <p className="mt-1 text-xs text-muted">
                Pick a goal and GymGo will build a five-week block and put it on your calendar.
              </p>
              <Button variant="primary" className="mt-3 w-full" onClick={() => void navigate('/plans')}>
                Build a plan
              </Button>
            </Card>
          ) : (
            <ul className="space-y-2">
              {routines.slice(0, 4).map((routine) => (
                <li key={routine.id}>
                  <Link to={`/routines/${routine.id}`} className="block">
                    <Card className="flex items-center justify-between p-4 active:bg-raised">
                      <span className="truncate text-sm text-white">{routine.name}</span>
                      <span className="shrink-0 text-xs text-muted">Open</span>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wide text-muted">Recent</h2>
          <Link to="/history" className="text-xs text-muted">
            All history
          </Link>
        </div>
        {recent && recent.length > 0 ? (
          <ul className="space-y-2">
            {recent.map((workout) => (
              <li key={workout.id}>
                <Link to={`/history/${workout.id}`} className="block">
                  <Card className="flex items-center justify-between p-4 active:bg-raised">
                    <span className="text-sm text-white">{formatDayLabel(workout.started_at)}</span>
                    <span className="text-xs text-muted">
                      {workout.finished_at
                        ? formatDuration(
                            Date.parse(workout.finished_at) - Date.parse(workout.started_at),
                          )
                        : ''}
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Nothing logged yet.</p>
        )}
      </section>
    </Screen>
  );
}
