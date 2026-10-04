import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings, useWorkout } from '@/db/queries';
import { addExerciseToWorkout, addSet, discardWorkout, finishWorkout } from '@/db/mutations';
import { Button, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { formatClock } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';
import { totalWorkingSets } from '@/domain/volume';
import { isLive } from '@/domain/sets';
import { sessionStations } from '@/domain/supersets';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import { useRestTimer } from './RestTimer';
import ExerciseStrip from './ExerciseStrip';
import ReadinessPrompt from './ReadinessPrompt';
import StationCard from './StationCard';

/**
 * The workout, one set at a time.
 *
 * The unit on screen is a station — a solo exercise, or a whole superset — and
 * inside it, the one set you are about to do, with a single Done button under
 * your thumb. Everything else is a tap away: the strip for other exercises,
 * the chips for other sets, the overflow for swap and the rest.
 *
 * Focus never moves on its own. It is seeded from the first station with
 * anything unticked, and after that it moves only because you tapped the strip
 * or "Next exercise". Following the session would teleport the screen on the
 * last tick of a station, while you are about to correct a mistyped rep.
 */
export default function ActiveWorkoutScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const view = useWorkout(workoutId);
  const settings = useSettings();
  const rest = useRestTimer();
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [dismissedReadiness, setDismissedReadiness] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const elapsed = useElapsed(view?.workout.started_at);

  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (view === undefined) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>;
  }
  if (view === null || !workoutId) {
    return (
      <main className="screen grid place-items-center text-center">
        <div className="stack-sm">
          <p>That workout is gone.</p>
          <Button onClick={() => void navigate('/')}>Back to Today</Button>
        </div>
      </main>
    );
  }

  const pro = settings?.mode === 'pro';
  const allSets = view.exercises.flatMap((entry) => entry.sets);
  const completedSets = totalWorkingSets(allSets);
  // Out of how many, so the line reads "1/12 sets". Same population as the
  // numerator, children included, or a drop set would make it read "5/4".
  const plannedSets = allSets.filter((set) => isLive(set) && set.type !== 'warmup').length;

  const stations = sessionStations(
    view.exercises.map((entry) => ({
      id: entry.workoutExercise.id,
      superset_group: entry.workoutExercise.superset_group,
    })),
  );

  // Where the session has got to: the first station with anything unticked.
  const firstUnfinished = stations.findIndex((station) =>
    station.some((index) => view.exercises[index]!.sets.some((set) => !set.completed)),
  );
  const seeded = firstUnfinished === -1 ? Math.max(0, stations.length - 1) : firstUnfinished;
  const focused = focusId
    ? Math.max(
        0,
        stations.findIndex((station) =>
          station.some((index) => view.exercises[index]!.workoutExercise.id === focusId),
        ),
      )
    : seeded;
  const station = stations[focused] ?? [];
  const next = stations[focused + 1];

  const focusStation = (index: number) => {
    const first = stations[index]?.[0];
    setFocusId(first === undefined ? null : view.exercises[first]!.workoutExercise.id);
  };

  const handleAddExercise = async (exerciseId: string) => {
    setPicking(false);
    const workoutExerciseId = await addExerciseToWorkout(workoutId, exerciseId);
    // Open with one empty set ready, so the next tap is a number, not a button.
    await addSet(workoutExerciseId);
    setFocusId(workoutExerciseId);
  };

  const handleFinish = async () => {
    await finishWorkout(workoutId);
    rest.stop();
    void navigate(`/history/${workoutId}`, { replace: true, state: { fresh: true } });
  };

  const handleDiscard = async () => {
    await discardWorkout(workoutId);
    rest.stop();
    void navigate('/', { replace: true });
  };

  const showReadiness = view.workout.readiness === null && completedSets === 0 && !dismissedReadiness;

  return (
    <div className="wk">
      <header className="wk-head">
        <h1 className="sr-only">Workout</h1>
        <div className="wk-top">
          <button type="button" className="icon-btn" aria-label="Back to Today" onClick={() => void navigate('/')}>
            <Icon name="back" />
          </button>
          <p className="wk-meta">
            <span>{formatClock(elapsed)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {completedSets}/{plannedSets} sets
            </span>
            {stations.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Exercise {focused + 1}/{stations.length}
                </span>
              </>
            ) : null}
          </p>
          <Button variant="primary" size="sm" onClick={() => setFinishing(true)}>
            Finish
          </Button>
        </div>
        <ExerciseStrip
          stations={stations}
          exercises={view.exercises}
          focused={focused}
          onFocus={focusStation}
          onAdd={() => setPicking(true)}
        />
      </header>

      <main className="wk-body">
        {view.exercises.length === 0 ? (
          <div className="stack pt-10 text-center">
            <h2 className="t-h2">Nothing here yet</h2>
            <p className="t-meta">Add your first exercise to get going.</p>
            <Button variant="primary" block onClick={() => setPicking(true)}>
              Add exercise
            </Button>
          </div>
        ) : (
          <>
            {showReadiness ? (
              <ReadinessPrompt
                workoutId={workoutId}
                onDismiss={() => setDismissedReadiness(true)}
                onAnswered={setToast}
              />
            ) : null}
            <StationCard
              key={station.join('-')}
              view={view}
              station={station}
              workoutId={workoutId}
              pro={pro}
              defaultRest={settings?.default_rest_seconds ?? 120}
              nextStationName={
                next ? next.map((index) => view.exercises[index]!.exercise?.name ?? 'Exercise').join(' + ') : null
              }
              onNext={next ? () => focusStation(focused + 1) : null}
              onFinish={() => setFinishing(true)}
              onToast={setToast}
            />
          </>
        )}
      </main>

      {picking ? (
        <ExercisePicker
          onPick={(exerciseId) => void handleAddExercise(exerciseId)}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {finishing ? (
        <Sheet label="Finish this workout?" onClose={() => setFinishing(false)}>
          <h2>Finish this workout?</h2>
          <p className="sheet-note">Sets you did not tick off are discarded.</p>
          <Button variant="primary" onClick={() => void handleFinish()}>
            Finish and save
          </Button>
          <Button onClick={() => setFinishing(false)}>Keep going</Button>
          <Button variant="danger" onClick={() => void handleDiscard()}>
            Discard workout
          </Button>
        </Sheet>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
