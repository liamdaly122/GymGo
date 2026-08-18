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

export default function ActiveWorkoutScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const view = useWorkout(workoutId);
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
  const completedSets = totalWorkingSets(allSets);
  const tonnage = totalTonnage(allSets);

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
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-32">
      <header
        className="sticky top-0 z-10 -mx-4 mb-4 border-b border-line bg-ink/95 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatDuration(elapsed)}
            </p>
            <p className="text-xs text-muted">
              {completedSets} {completedSets === 1 ? 'set' : 'sets'} ·{' '}
              {Math.round(tonnage).toLocaleString('en-GB')} kg
            </p>
          </div>
          <Button variant="primary" onClick={() => setConfirmingFinish(true)}>
            Finish
          </Button>
        </div>
      </header>

      {view.exercises.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-white">Nothing logged yet.</p>
          <p className="mt-1 text-xs text-muted">Add your first exercise to get going.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {view.exercises.map((entry) => (
            <li key={entry.workoutExercise.id}>
              <WorkoutExerciseCard entry={entry} workoutId={workoutId} />
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
