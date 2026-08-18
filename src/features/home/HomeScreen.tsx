import { Link, useNavigate } from 'react-router-dom';
import { useActiveWorkout, useFinishedWorkouts, useRoutines } from '@/db/queries';
import { startFreestyleWorkout } from '@/db/mutations';
import { Button, Card, Screen, ScreenTitle } from '@/components/ui';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';

export default function HomeScreen() {
  const navigate = useNavigate();
  const active = useActiveWorkout();
  const routines = useRoutines();
  const recent = useFinishedWorkouts(3);
  const elapsed = useElapsed(active?.started_at);

  const handleStart = async () => {
    const workoutId = await startFreestyleWorkout();
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
      ) : (
        <Button variant="primary" className="mb-4 h-14 w-full text-base" onClick={() => void handleStart()}>
          Start empty workout
        </Button>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Routines</h2>
        {routines === undefined ? null : routines.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-white">No routines yet.</p>
            <p className="mt-1 text-xs text-muted">
              Build one to start a session without picking exercises each time.
            </p>
            <Button className="mt-3 w-full" onClick={() => void navigate('/routines')}>
              Build a routine
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
