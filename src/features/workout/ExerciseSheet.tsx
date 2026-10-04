import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkoutExerciseView } from '@/db/queries';
import { usePreviousPerformance, useSetSuggestion } from '@/db/queries';
import {
  generateWarmupSets,
  moveWorkoutExercise,
  removeExerciseFromWorkout,
  toggleSupersetWithNext,
} from '@/db/mutations';
import { Button, Sheet } from '@/components/ui';
import { warmupRamp } from '@/domain/warmup';
import { formatNumber } from './setNames';

/**
 * Everything about an exercise that is not logging a set.
 *
 * Swap, warm up, move earlier, move later, remove, and in Pro the superset
 * toggle, used to live on the card itself: six controls competing with the
 * two that matter. They are all still here, one tap further away, in a sheet
 * that opens under your thumb.
 */
export default function ExerciseSheet({
  entry,
  workoutId,
  canMoveUp,
  canMoveDown,
  canPairWithNext,
  pairedWithNext,
  pro,
  onClose,
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canPairWithNext: boolean;
  pairedWithNext: boolean;
  pro: boolean;
  onClose: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const suggestion = useSetSuggestion(workoutId, entry.exercise?.id);
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const name = entry.exercise?.name ?? 'this exercise';

  // Warm up to the weight you are about to work at: what the first working set
  // holds, else the suggestion, else last time's top set.
  const firstWorking = entry.sets.find(
    (set) => set.parent_set_id === null && set.type === 'working' && set.weight_kg > 0,
  );
  const target =
    firstWorking?.weight_kg ?? suggestion?.weight_kg ?? previous?.top_set?.weight_kg ?? 0;
  const hasWarmup = entry.sets.some((set) => set.type === 'warmup');
  const ramp = warmupRamp(target, entry.loading);

  const run = async (work: () => Promise<unknown>) => {
    await work();
    onClose();
  };

  if (confirmingRemove) {
    return (
      <Sheet label={`Remove ${name}`} onClose={onClose}>
        <h2>Remove {name}?</h2>
        <p className="sheet-note">Everything logged against it in this workout goes too.</p>
        <Button
          variant="danger"
          aria-label={`Remove ${name} from this workout`}
          onClick={() => void run(() => removeExerciseFromWorkout(entry.workoutExercise.id))}
        >
          Remove it
        </Button>
        <Button onClick={() => setConfirmingRemove(false)}>Keep it</Button>
      </Sheet>
    );
  }

  return (
    <Sheet label={`More for ${name}`} onClose={onClose}>
      <h2>{name}</h2>

      {ramp.length > 0 && !hasWarmup ? (
        <Button onClick={() => void run(() => generateWarmupSets(entry.workoutExercise.id, target))}>
          Warm up to {formatNumber(target)}kg · {ramp.length} sets
        </Button>
      ) : null}

      <Link
        to={`/workout/${workoutId}/swap/${entry.workoutExercise.id}`}
        aria-label={`Swap ${name} for something else`}
        className="btn btn-secondary btn-block"
      >
        Swap exercise
      </Link>

      <div className="row2">
        <Button
          disabled={!canMoveUp}
          aria-label={`Move ${name} earlier`}
          onClick={() => void run(() => moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'up'))}
        >
          ↑ Earlier
        </Button>
        <Button
          disabled={!canMoveDown}
          aria-label={`Move ${name} later`}
          onClick={() => void run(() => moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'down'))}
        >
          ↓ Later
        </Button>
      </div>

      {pro && canPairWithNext ? (
        <Button
          aria-pressed={pairedWithNext}
          onClick={() => void run(() => toggleSupersetWithNext(entry.workoutExercise.id))}
        >
          {pairedWithNext ? 'Supersetted with the next exercise' : 'Superset with next'}
        </Button>
      ) : null}

      {entry.exercise ? (
        <Link to={`/exercises/${entry.exercise.id}`} className="btn btn-ghost btn-block">
          Exercise details
        </Link>
      ) : null}

      {/* Destructive, last, and behind a confirm. */}
      <div className="sheet-sep" />
      <Button variant="ghost" className="text-danger" onClick={() => setConfirmingRemove(true)}>
        Remove from this workout
      </Button>
    </Sheet>
  );
}
