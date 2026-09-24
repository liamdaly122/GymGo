import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkout } from '@/db/queries';
import { addExerciseToWorkout, addSet, discardWorkout, finishWorkout } from '@/db/mutations';
import { Button } from '@/components/ui';
import { formatDuration } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';
import { totalTonnage, totalWorkingSets } from '@/domain/volume';
import { isLive } from '@/domain/sets';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import { restsAfter, sessionStations, supersetLabel } from '@/domain/supersets';
import { useRestTimer } from './RestTimer';
import ExercisePanel from './ExercisePanel';
import ExerciseStrip from './ExerciseStrip';
import ReadinessPrompt from './ReadinessPrompt';

export default function ActiveWorkoutScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const view = useWorkout(workoutId);
  const rest = useRestTimer();
  const [picking, setPicking] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [dismissedReadiness, setDismissedReadiness] = useState(false);

  /**
   * Which station is on screen.
   *
   * Null means "wherever the session has got to", which is the seed, not live
   * truth. If focus followed the first unfinished exercise, ticking the last
   * set of a station would teleport the screen while the rest dial is up and
   * you are about to correct a mistyped rep. Forward is a deliberate tap.
   */
  const [focusId, setFocusId] = useState<string | null>(null);

  const elapsed = useElapsed(view?.workout.started_at);

  if (view === undefined) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>;
  }
  if (view === null || !workoutId) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-white">That workout is gone.</p>
          <Button className="mt-4" onClick={() => void navigate('/')}>
            Back to Train
          </Button>
        </div>
      </div>
    );
  }

  const allSets = view.exercises.flatMap((entry) => entry.sets);
  const completedSets = totalWorkingSets(allSets);
  /*
   * Out of how many, so the line reads "1/12 sets" rather than "1 sets".
   *
   * Same population as the numerator minus the `completed` requirement, child
   * sets included — `countsTowardVolume` counts a drop set, so leaving children
   * out of the denominator alone would let a session read "5/4 sets".
   */
  const plannedSets = allSets.filter((set) => isLive(set) && set.type !== 'warmup').length;
  const tonnage = totalTonnage(allSets);

  const members = view.exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));
  const stations = sessionStations(members);

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

  /*
   * One active set for the whole session, not one per exercise.
   *
   * Computed per card, five unfinished exercises put five adjuster rows —
   * twenty buttons — on the page at once, which defeated the point of
   * attaching the tools to the set you are about to do.
   */
  const activeSetId =
    station
      .flatMap((index) => view.exercises[index]!.sets)
      .find((set) => !set.completed && set.parent_set_id === null && set.type !== 'warmup')?.id ??
    null;

  const stationComplete =
    station.length > 0 &&
    station.every((index) => view.exercises[index]!.sets.every((set) => set.completed));
  const nextStation = focused + 1 < stations.length ? focused + 1 : null;

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
    void navigate(`/history/${workoutId}`, { replace: true });
  };

  const handleDiscard = async () => {
    await discardWorkout(workoutId);
    void navigate('/', { replace: true });
  };

  const showReadiness =
    view.workout.readiness === null && completedSets === 0 && !dismissedReadiness;

  return (
    <div className={`mx-auto min-h-dvh max-w-lg px-4 ${rest.endsAt === null ? 'pb-28' : 'pb-52'}`}>
      <header
        /*
         * pt-3 and no safe-area inset. The header is sticky, so it is still
         * inside the padding body applies for the notch (src/index.css);
         * adding the inset again here double-counted it and stole ~47px of
         * screen on every notched phone — most of a set row, on the screen
         * that can least afford it. The picker, being `fixed`, does need its
         * own inset, which is why it keeps one.
         */
        className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-ink/95 px-4 pb-2 pt-3 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => void navigate('/')}
            className="-my-2 shrink-0 py-2 text-meta text-muted active:text-white"
          >
            Back
          </button>

          {/* One line where three stat tiles used to be. Session tonnage is a
              number you read afterwards, not between sets. */}
          <p className="min-w-0 truncate text-note tabular-nums text-muted">
            {formatDuration(elapsed)} · {Math.round(tonnage).toLocaleString('en-GB')} kg ·{' '}
            {completedSets}/{plannedSets} sets ·{' '}
            {stations.length > 0
              ? `Exercise ${focused + 1}/${stations.length}`
              : 'No exercises yet'}
          </p>

          <Button variant="primary" className="h-9 shrink-0 px-4" onClick={() => setConfirmingFinish(true)}>
            Finish
          </Button>
        </div>

        <div className="mt-2">
          <ExerciseStrip
            stations={stations}
            exercises={view.exercises}
            focused={focused}
            onFocus={focusStation}
            onAdd={() => setPicking(true)}
          />
        </div>
      </header>

      {showReadiness ? (
        <ReadinessPrompt workoutId={workoutId} onDismiss={() => setDismissedReadiness(true)} />
      ) : null}

      {view.exercises.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-white">Nothing logged yet.</p>
          <p className="mt-1 text-xs text-muted">Add your first exercise to get going.</p>
          <Button variant="secondary" className="mt-4 w-full" onClick={() => setPicking(true)}>
            Add exercise
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {station.map((index) => {
            const entry = view.exercises[index]!;
            return (
              <ExercisePanel
                key={entry.workoutExercise.id}
                entry={entry}
                workoutId={workoutId}
                // Superset membership is a property of the whole session, so it
                // is resolved here where the ordered list lives.
                restsAfter={restsAfter(members, index)}
                supersetLabel={supersetLabel(members, index)}
                canPairWithNext={index < view.exercises.length - 1}
                canMoveUp={index > 0}
                canMoveDown={index < view.exercises.length - 1}
                activeSetId={activeSetId}
              />
            );
          })}
        </div>
      )}

      {/* Forward is a thumb-zone button; jumping about is the strip. It lights
          up once the station is done rather than moving the screen for you. */}
      {nextStation !== null ? (
        <Button
          variant={stationComplete ? 'primary' : 'secondary'}
          className="mt-6 w-full"
          onClick={() => focusStation(nextStation)}
        >
          Next exercise →
        </Button>
      ) : null}

      {picking ? (
        <ExercisePicker
          onPick={(exerciseId) => void handleAddExercise(exerciseId)}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {confirmingFinish ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 sm:place-items-center">
          <div className="w-full max-w-lg rounded-t-2xl border-t border-line bg-surface p-5 sm:rounded-2xl sm:border">
            <h2 className="text-base font-semibold text-white">Finish this workout?</h2>
            <p className="mt-1 text-note text-muted">Sets you did not tick off are discarded.</p>
            <div className="mt-4 grid gap-2">
              <Button variant="primary" onClick={() => void handleFinish()}>
                Finish and save
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingFinish(false)}>
                Keep going
              </Button>
              <Button variant="danger" onClick={() => void handleDiscard()}>
                Discard workout
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
