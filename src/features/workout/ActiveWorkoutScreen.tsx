import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkout } from '@/db/queries';
import {
  addExerciseToWorkout,
  addSet,
  discardWorkout,
  finishWorkout,
} from '@/db/mutations';
import { Button } from '@/components/ui';
import { formatDuration } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';
import { totalTonnage, totalWorkingSets } from '@/domain/volume';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import WorkoutExerciseCard from './WorkoutExerciseCard';
import { restsAfter, supersetLabel } from '@/domain/supersets';
import { useRestTimer } from './RestTimer';

export default function ActiveWorkoutScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const view = useWorkout(workoutId);
  const rest = useRestTimer();
  const [picking, setPicking] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);

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
  const supersetMembers = view.exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));
  const completedSets = totalWorkingSets(allSets);
  const tonnage = totalTonnage(allSets);

  // Which exercise you are on: the first with anything still unticked.
  const firstUnfinished = view.exercises.findIndex((entry) =>
    entry.sets.some((set) => !set.completed),
  );
  const currentExercise = firstUnfinished === -1 ? view.exercises.length - 1 : firstUnfinished;

  const handleAddExercise = async (exerciseId: string) => {
    setPicking(false);
    const workoutExerciseId = await addExerciseToWorkout(workoutId, exerciseId);
    // Open with one empty set ready, so the next tap is a number, not a button.
    await addSet(workoutExerciseId);
  };

  const handleFinish = async () => {
    await finishWorkout(workoutId);
    void navigate(`/history/${workoutId}`, { replace: true });
  };

  const handleDiscard = async () => {
    await discardWorkout(workoutId);
    void navigate('/', { replace: true });
  };

  return (
    // Extra clearance while the rest dial is up, so it never sits on top of the
    // set you are trying to type into.
    <div className={`mx-auto min-h-dvh max-w-lg px-4 ${rest.endsAt === null ? 'pb-28' : 'pb-52'}`}>
      <header
        className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-ink/95 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => void navigate('/')}
            className="text-xs text-muted active:text-white"
          >
            Back
          </button>
          <p className="eyebrow">
            {view.exercises.length > 0
              ? `Exercise ${Math.min(currentExercise + 1, view.exercises.length)}/${view.exercises.length}`
              : 'No exercises yet'}
          </p>
          <Button variant="primary" className="h-9 px-4" onClick={() => setConfirmingFinish(true)}>
            Finish
          </Button>
        </div>

        {/* The three numbers worth watching mid-session. */}
        <dl className="mt-3 grid grid-cols-3 divide-x divide-line rounded-xl bg-surface py-2">
          <div className="px-2 text-center">
            <dt className="eyebrow">Time</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-white">
              {formatDuration(elapsed)}
            </dd>
          </div>
          <div className="px-2 text-center">
            <dt className="eyebrow">Volume</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-white">
              {Math.round(tonnage).toLocaleString('en-GB')} kg
            </dd>
          </div>
          <div className="px-2 text-center">
            <dt className="eyebrow">Sets</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-white">
              {completedSets}
            </dd>
          </div>
        </dl>
      </header>

      {view.exercises.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-white">Nothing logged yet.</p>
          <p className="mt-1 text-xs text-muted">Add your first exercise to get going.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {view.exercises.map((entry, index) => (
            <li key={entry.workoutExercise.id}>
              <WorkoutExerciseCard
                entry={entry}
                workoutId={workoutId}
                // Superset membership is a property of the whole session, so it
                // is resolved here where the ordered list lives rather than in
                // each card.
                restsAfter={restsAfter(supersetMembers, index)}
                supersetLabel={supersetLabel(supersetMembers, index)}
                canPairWithNext={index < view.exercises.length - 1}
                canMoveUp={index > 0}
                canMoveDown={index < view.exercises.length - 1}
              />
            </li>
          ))}
        </ul>
      )}

      <Button variant="secondary" className="mt-4 w-full" onClick={() => setPicking(true)}>
        Add exercise
      </Button>


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
            <p className="mt-1 text-xs text-muted">
              Sets you did not tick off are discarded. Once finished, the session cannot be
              edited — that is what keeps your history honest.
            </p>
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
