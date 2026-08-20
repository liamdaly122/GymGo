import { Link } from 'react-router-dom';
import type { WorkoutExerciseView } from '@/db/queries';
import { usePreviousPerformance, useSetSuggestion, useSettings } from '@/db/queries';
import { addSet, removeExerciseFromWorkout, toggleSupersetWithNext, updateSet } from '@/db/mutations';
import { Button, Card } from '@/components/ui';
import { formatDayLabel } from '@/lib/dates';
import { formatSetSummary } from '@/domain/previousPerformance';
import SetRow from './SetRow';
import ExerciseImage from '@/components/ExerciseImage';

/**
 * One exercise inside the active workout, with last session's numbers shown
 * inline.
 *
 * The previous-performance line is the whole point of the screen: it is the
 * number you are trying to beat. It always comes from top working sets, so a
 * drop set can never masquerade as last week's effort.
 */
export default function WorkoutExerciseCard({
  entry,
  workoutId,
  restsAfter = true,
  supersetLabel = null,
  canPairWithNext = false,
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
  /** False for the first half of a superset, which runs straight into the next. */
  restsAfter?: boolean;
  /** "A1", "A2" — null when this exercise is not in a superset. */
  supersetLabel?: string | null;
  canPairWithNext?: boolean;
}) {
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const suggestion = useSetSuggestion(workoutId, entry.exercise?.id);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';
  const workingSets = previous?.working_sets ?? [];

  // Most specific wins. The routine's prescription is the whole reason a
  // strength primary rests 210s and an accessory 75s; falling straight to the
  // exercise default made every generated plan rest the same.
  const restSeconds =
    entry.workoutExercise.rest_seconds ??
    entry.exercise?.default_rest_seconds ??
    settings?.default_rest_seconds ??
    120;

  /** Copies last session's numbers into any set not yet logged. Never overwrites. */
  const applyLastTime = async () => {
    const targets = entry.sets.filter((set) => !set.completed && set.parent_set_id === null);
    for (const [index, set] of targets.entries()) {
      const source = workingSets[index] ?? workingSets.at(-1);
      if (!source) continue;
      await updateSet(set.id, { weight_kg: source.weight_kg, reps: source.reps });
    }
  };

  /**
   * Accepts the suggestion into every set not yet logged.
   *
   * Suggestions are never applied on their own — they sit as placeholder text
   * until you tap, so nothing you did not do can end up in your history.
   */
  const applySuggestion = async () => {
    if (!suggestion) return;
    const targets = entry.sets.filter((set) => !set.completed && set.parent_set_id === null);
    for (const set of targets) {
      await updateSet(set.id, { weight_kg: suggestion.weight_kg, reps: suggestion.reps });
    }
  };

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-start gap-3">
        {entry.exercise ? (
          <ExerciseImage
            sourceId={entry.exercise.source_id}
            muscle={entry.exercise.primary_muscle}
            name={entry.exercise.name}
            className="h-14 w-14 shrink-0"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          {entry.exercise ? (
            <Link
              to={`/exercises/${entry.exercise.id}`}
              className="block truncate text-sm font-medium text-white"
            >
              {entry.exercise.name}
            </Link>
          ) : (
            <span className="text-sm text-muted">Unknown exercise</span>
          )}
          <p className="truncate text-xs text-muted first-letter:uppercase">
            {supersetLabel ? (
              <span className="mr-1.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-accent">
                {supersetLabel}
              </span>
            ) : null}
            {entry.exercise?.primary_muscle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            to={`/workout/${workoutId}/swap/${entry.workoutExercise.id}`}
            aria-label={`Swap ${entry.exercise?.name ?? 'exercise'} for something else`}
            className="rounded-lg px-2 py-1 text-xs text-accent active:opacity-60"
          >
            Swap
          </Link>
          <button
            onClick={() => void removeExerciseFromWorkout(entry.workoutExercise.id)}
            aria-label={`Remove ${entry.exercise?.name ?? 'exercise'} from this workout`}
            className="rounded-lg px-2 py-1 text-xs text-muted active:text-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Setup notes: seat height, pin position, which bar. Shown where they are used. */}
      {entry.exercise?.setup_notes ? (
        <p className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
          {entry.exercise.setup_notes}
        </p>
      ) : null}

      {suggestion ? (
        <div className="mb-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-accent">
                {suggestion.kind === 'deload'
                  ? 'Suggested — back off'
                  : suggestion.kind === 'add_weight'
                    ? 'Suggested — go up'
                    : 'Suggested'}
              </p>
              <p className="mt-0.5 text-sm tabular-nums text-white">
                {suggestion.weight_kg}kg × {suggestion.reps}
              </p>
            </div>
            <button
              onClick={() => void applySuggestion()}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink active:bg-accent/80"
            >
              Use
            </button>
          </div>
          {/* The brief requires every suggestion to be explainable. */}
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{suggestion.reason}</p>
        </div>
      ) : null}

      {previous ? (
        <div className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-raised px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted">
              Last time · {formatDayLabel(previous.performed_at)}
            </p>
            <p className="mt-0.5 truncate text-xs tabular-nums text-white">
              {workingSets.map((set) => formatSetSummary(set)).join(', ')}
            </p>
          </div>
          {suggestion ? null : (
            <button
              onClick={() => void applyLastTime()}
              className="shrink-0 text-[11px] text-accent active:opacity-60"
            >
              Use
            </button>
          )}
        </div>
      ) : previous === null ? (
        <p className="mb-2 text-xs text-muted">First time logging this one.</p>
      ) : null}

      <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
        <span className="w-6 text-center">Set</span>
        <span className="flex-1 text-center">Weight</span>
        <span className="flex-1 text-center">Reps</span>
        <span className="w-11" />
        <span className="w-7" />
      </div>

      {entry.sets.map((set, setIndex) => {
        const lastTime = set.parent_set_id === null ? workingSets[setIndex] : undefined;
        // The suggestion is the better hint where there is one; last time's
        // numbers fill in otherwise.
        const weightHint = suggestion?.weight_kg ?? lastTime?.weight_kg;
        const repsHint = suggestion?.reps ?? lastTime?.reps;
        return (
          <SetRow
            key={set.id}
            set={set}
            index={setIndex}
            {...(set.parent_set_id === null && weightHint !== undefined ? { weightHint } : {})}
            {...(set.parent_set_id === null && repsHint !== undefined ? { repsHint } : {})}
            restSeconds={restsAfter ? restSeconds : 0}
            pro={pro}
          />
        );
      })}

      <Button className="mt-2 w-full" onClick={() => void handleAddSet(entry)}>
        Add set
      </Button>

      {/* Supersetting is a Pro control: it changes when the timer runs, which
          is confusing if you did not ask for it. */}
      {pro && canPairWithNext ? (
        <button
          onClick={() => void toggleSupersetWithNext(entry.workoutExercise.id)}
          aria-pressed={!restsAfter}
          className={`mt-2 w-full rounded-xl border px-3 py-2 text-[11px] transition-colors ${
            !restsAfter
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-line bg-raised text-muted'
          }`}
        >
          {!restsAfter ? 'Supersetted with the next exercise' : 'Superset with next'}
        </button>
      ) : null}
    </Card>
  );
}

/** Carries the previous set's numbers forward — most sets repeat the one before. */
async function handleAddSet(entry: WorkoutExerciseView) {
  const last = entry.sets.filter((set) => set.parent_set_id === null).at(-1);
  await addSet(entry.workoutExercise.id, {
    weight_kg: last?.weight_kg ?? 0,
    reps: last?.reps ?? 0,
  });
}
