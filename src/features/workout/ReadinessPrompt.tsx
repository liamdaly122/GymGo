import { updateWorkout } from '@/db/mutations';
import type { Readiness } from '@/domain/types';

/**
 * How today is going, asked once.
 *
 * The brief's fifth progression rule — a low-readiness session scales suggested
 * loads down 10% and is exempt from the failure counter — has been implemented
 * and unit tested since the engine was written, and could never fire, because
 * nothing in the app ever wrote `workout.readiness`. This is the missing write.
 *
 * It lives here rather than in a modal before the session starts because a
 * modal is friction with no visible result: you tap "rough", it closes, nothing
 * appears to happen. Here the suggestion placeholders re-render 10% lighter the
 * instant you answer, so the control shows its own effect.
 *
 * Only `low` changes anything. Guessing upward off a good mood is exactly the
 * kind of cleverness that makes a suggestion untrustworthy, so `normal` and
 * `high` are recorded and change no load.
 */
const CHOICES: Array<{ value: Readiness; label: string }> = [
  { value: 'low', label: 'Rough' },
  { value: 'normal', label: 'OK' },
  { value: 'high', label: 'Good' },
];

export default function ReadinessPrompt({
  workoutId,
  onDismiss,
}: {
  workoutId: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <p className="shrink-0 text-meta text-muted">How's today?</p>

      {CHOICES.map((choice) => (
        <button
          key={choice.value}
          onClick={() => void updateWorkout(workoutId, { readiness: choice.value })}
          aria-label={`Readiness ${choice.value}`}
          className="h-11 flex-1 rounded-xl border border-line bg-raised text-meta text-white active:bg-line"
        >
          {choice.label}
        </button>
      ))}

      <button
        onClick={onDismiss}
        aria-label="Dismiss the readiness question"
        className="grid h-11 w-8 shrink-0 place-items-center text-muted"
      >
        ✕
      </button>
    </div>
  );
}
