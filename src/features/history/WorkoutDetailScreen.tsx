import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSessionSummary } from '@/db/queries';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { estimate1RMRounded } from '@/domain/epley';
import { isChildSet } from '@/domain/sets';

export default function WorkoutDetailScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const data = useSessionSummary(workoutId);

  if (data === undefined) {
    return (
      <Screen>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }
  if (data === null) {
    return (
      <Screen>
        <ScreenTitle>Not found</ScreenTitle>
        <Button onClick={() => void navigate('/history')}>Back to history</Button>
      </Screen>
    );
  }

  const { view, summary } = data;
  const inProgress = view.workout.finished_at === null;

  return (
    <Screen>
      <Link to="/history" className="mb-3 inline-block text-xs text-muted">
        ← History
      </Link>
      <ScreenTitle>{formatDayLabel(view.workout.started_at)}</ScreenTitle>

      {inProgress ? (
        <Card className="mb-4 border-accent/40 bg-accent/5 p-4">
          <p className="text-sm text-white">This session is still in progress.</p>
          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() => void navigate(`/workout/${view.workout.id}`)}
          >
            Resume
          </Button>
        </Card>
      ) : null}

      <Card className="mb-4 grid grid-cols-3 divide-x divide-line p-0">
        <Stat label="Duration" value={summary.duration_ms === null ? '—' : formatDuration(summary.duration_ms)} />
        <Stat label="Volume" value={`${Math.round(summary.tonnage_kg).toLocaleString('en-GB')} kg`} />
        <Stat label="Sets" value={String(summary.set_count)} />
      </Card>

      {summary.prs.length > 0 ? (
        <Card className="mb-4 border-accent/40 bg-accent/5 p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-accent">
            {summary.prs.length === 1 ? 'Personal record' : 'Personal records'}
          </h2>
          <ul className="space-y-1.5">
            {summary.prs.map((pr, index) => (
              <li key={`${pr.set.id}-${pr.kind}-${index}`} className="text-sm">
                <span className="text-white">{pr.exercise_name}</span>
                <span className="text-muted">
                  {' — '}
                  {pr.kind === 'weight'
                    ? `${pr.value}kg × ${pr.set.reps}`
                    : `${estimate1RMRounded(pr.set.weight_kg, pr.set.reps)}kg estimated 1RM`}
                  {pr.previous !== null
                    ? ` (was ${pr.kind === 'weight' ? pr.previous : Math.round(pr.previous * 10) / 10}kg)`
                    : ' (first time)'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {summary.comparison ? (
        <Card className="mb-4 p-4">
          <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">
            Against the last run of this routine
          </h2>
          <p className="text-sm text-white">
            {summary.comparison.tonnage_delta_kg === 0
              ? 'Same volume'
              : `${summary.comparison.tonnage_delta_kg > 0 ? '+' : ''}${Math.round(
                  summary.comparison.tonnage_delta_kg,
                ).toLocaleString('en-GB')} kg`}
            {summary.comparison.set_delta !== 0
              ? `, ${summary.comparison.set_delta > 0 ? '+' : ''}${summary.comparison.set_delta} sets`
              : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            vs {formatDayLabel(summary.comparison.performed_at)}
          </p>
        </Card>
      ) : null}

      {summary.sets_per_muscle.length > 0 ? (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Sets per muscle group</h2>
          <ul className="flex flex-wrap gap-1.5">
            {summary.sets_per_muscle.map((entry) => (
              <li key={entry.muscle}>
                <Pill>
                  <span className="first-letter:uppercase">{entry.muscle}</span>
                  <span className="ml-1.5 tabular-nums text-white">{entry.sets}</span>
                </Pill>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            A set credits its primary muscle in full and each secondary at a half.
          </p>
        </Card>
      ) : null}

      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Exercises</h2>
      <ul className="space-y-3">
        {view.exercises.map((entry) => (
          <li key={entry.workoutExercise.id}>
            <Card className="p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                {entry.exercise ? (
                  <Link
                    to={`/exercises/${entry.exercise.id}`}
                    className="truncate text-sm font-medium text-white"
                  >
                    {entry.exercise.name}
                  </Link>
                ) : (
                  <span className="text-sm text-muted">Unknown exercise</span>
                )}
                <span className="shrink-0 text-xs text-muted">
                  {entry.sets.filter((set) => set.completed).length}
                  {entry.sets.filter((set) => set.completed).length === 1 ? ' set' : ' sets'}
                </span>
              </div>
              <ul className="space-y-1">
                {entry.sets
                  .filter((set) => set.completed)
                  .map((set, index) => (
                    <li
                      key={set.id}
                      className={`flex items-baseline gap-3 text-sm tabular-nums ${
                        isChildSet(set) ? 'pl-4 text-muted' : 'text-white'
                      }`}
                    >
                      <span className="w-5 text-xs text-muted">
                        {isChildSet(set) ? '↳' : index + 1}
                      </span>
                      <span>
                        {set.weight_kg}kg × {set.reps}
                      </span>
                      {set.type !== 'working' ? (
                        <span className="text-[11px] text-muted">{set.type.replace('_', ' ')}</span>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>

      {view.workout.notes ? (
        <Card className="mt-4 p-4">
          <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Notes</h2>
          <p className="text-sm text-white">{view.workout.notes}</p>
        </Card>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-4 text-center">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
