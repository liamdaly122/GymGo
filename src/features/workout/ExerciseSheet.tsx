import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkoutExerciseView } from '@/db/queries';
import {
  generateWarmupSets,
  moveWorkoutExercise,
  removeExerciseFromWorkout,
  toggleSupersetWithNext,
} from '@/db/mutations';
import { warmupRamp } from '@/domain/warmup';

/**
 * Everything about an exercise that is not logging a set.
 *
 * All of this used to live on the card itself: swap, remove, warm up, move
 * earlier, move later, superset. Six controls competing with the two that
 * matter, on a card you could not fit on screen. They are all still here, one
 * tap further away, in a sheet that opens under your thumb rather than a menu
 * anchored to the top of the screen.
 */
export default function ExerciseSheet({
  entry,
  workoutId,
  warmupTarget,
  canMoveUp,
  canMoveDown,
  canPairWithNext,
  supersetted,
  pro,
  onClose,
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
  warmupTarget: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canPairWithNext: boolean;
  supersetted: boolean;
  pro: boolean;
  onClose: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const name = entry.exercise?.name ?? 'this exercise';
  const hasWarmup = entry.sets.some((set) => set.type === 'warmup');
  const ramp = warmupRamp(warmupTarget, entry.loading);

  const run = async (work: () => Promise<unknown>) => {
    await work();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-black/60 sm:place-items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl border-t border-line bg-surface p-4 sm:rounded-2xl sm:border"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-3 truncate text-meta text-muted">{name}</p>

        <div className="grid gap-2">
          {ramp.length > 0 && !hasWarmup ? (
            <SheetButton
              onClick={() => void run(() => generateWarmupSets(entry.workoutExercise.id, warmupTarget))}
            >
              Warm up to {warmupTarget}kg · {ramp.length} sets
            </SheetButton>
          ) : null}

          <Link
            to={`/workout/${workoutId}/swap/${entry.workoutExercise.id}`}
            aria-label={`Swap ${name} for something else`}
            className="grid min-h-11 place-items-center rounded-xl border border-line bg-raised px-4 text-meta text-white active:bg-line"
          >
            Swap exercise
          </Link>

          <div className="grid grid-cols-2 gap-2">
            <SheetButton
              disabled={!canMoveUp}
              aria-label={`Move ${name} earlier`}
              onClick={() => void run(() => moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'up'))}
            >
              ↑ Earlier
            </SheetButton>
            <SheetButton
              disabled={!canMoveDown}
              aria-label={`Move ${name} later`}
              onClick={() => void run(() => moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'down'))}
            >
              ↓ Later
            </SheetButton>
          </div>

          {pro && canPairWithNext ? (
            <SheetButton
              aria-pressed={supersetted}
              onClick={() => void run(() => toggleSupersetWithNext(entry.workoutExercise.id))}
            >
              {supersetted ? 'Supersetted with the next exercise' : 'Superset with next'}
            </SheetButton>
          ) : null}

          {entry.exercise ? (
            <Link
              to={`/exercises/${entry.exercise.id}`}
              className="grid min-h-11 place-items-center rounded-xl border border-line bg-raised px-4 text-meta text-muted active:bg-line"
            >
              Exercise details
            </Link>
          ) : null}
        </div>

        {/* Destructive, last, and behind a confirm — it used to be a 24px text
            button four pixels from Swap. */}
        <div className="mt-4 border-t border-line pt-4">
          {confirmingRemove ? (
            <div className="grid gap-2">
              <p className="text-meta text-white">Remove {name} and everything logged against it?</p>
              <button
                onClick={() => void run(() => removeExerciseFromWorkout(entry.workoutExercise.id))}
                aria-label={`Remove ${name} from this workout`}
                className="grid min-h-11 place-items-center rounded-xl bg-red-500/15 px-4 text-meta text-red-300 active:bg-red-500/25"
              >
                Remove it
              </button>
              <SheetButton onClick={async () => setConfirmingRemove(false)}>Keep it</SheetButton>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingRemove(true)}
              className="grid min-h-11 w-full place-items-center text-meta text-red-400"
            >
              Remove from this workout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SheetButton({
  children,
  onClick,
  disabled,
  ...props
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
} & Record<string, unknown>) {
  return (
    <button
      {...props}
      disabled={disabled}
      onClick={() => void onClick()}
      className="grid min-h-11 place-items-center rounded-xl border border-line bg-raised px-4 text-meta text-white disabled:opacity-25 active:bg-line"
    >
      {children}
    </button>
  );
}
