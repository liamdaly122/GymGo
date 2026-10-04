import { updateWorkout } from '@/db/mutations';
import type { Readiness } from '@/domain/types';
import { Icon } from '@/components/icons';

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
  onAnswered,
}: {
  workoutId: string;
  onDismiss: () => void;
  /** Said back in a toast, so a tap that changes no number still visibly lands. */
  onAnswered?: (message: string) => void;
}) {
  return (
    <div className="ready" role="group" aria-label="How is today going?">
      <p>How's today?</p>

      {CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            void updateWorkout(workoutId, { readiness: choice.value }).then(() =>
              onAnswered?.(
                choice.value === 'low'
                  ? 'Suggestions are 10% lighter today.'
                  : 'Noted. Suggestions stay as planned.',
              ),
            )
          }
          aria-label={`Readiness ${choice.value}`}
        >
          {choice.label}
        </button>
      ))}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss the readiness question"
        className="icon-btn"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
