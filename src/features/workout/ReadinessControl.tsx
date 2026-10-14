import { updateWorkout } from '@/db/mutations';
import type { Readiness } from '@/domain/types';
import { READINESS_CHOICES, readinessAnswer } from './ReadinessPrompt';

/**
 * How today is going, always on hand while the watch logs.
 *
 * On the phone's own logging screen the question is asked once and gets out
 * of the way. On the companion screen there is room for it to stay, and a day
 * that turns rough halfway through is worth saying: a low answer makes the
 * suggestions 10% lighter, and the watch gets the new numbers with the next
 * list the phone sends.
 */
export default function ReadinessControl({
  workoutId,
  value,
  onAnswered,
}: {
  workoutId: string;
  value: Readiness | null;
  /** Said back in a toast, so a tap that changes no number still visibly lands. */
  onAnswered: (message: string) => void;
}) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label="How is today going?">
      <p className="t-meta shrink-0">How's today?</p>
      <div className="seg min-w-0 flex-1">
        {READINESS_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={value === choice.value}
            aria-label={`Readiness ${choice.value}`}
            onClick={() =>
              void updateWorkout(workoutId, { readiness: choice.value }).then(() =>
                onAnswered(readinessAnswer(choice.value)),
              )
            }
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
