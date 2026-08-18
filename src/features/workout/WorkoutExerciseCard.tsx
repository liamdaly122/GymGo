import { Link } from 'react-router-dom';
import type { WorkoutExerciseView } from '@/db/queries';
import { usePreviousPerformance, useSettings } from '@/db/queries';
import { addSet, removeExerciseFromWorkout, updateSet } from '@/db/mutations';
import { Button, Card } from '@/components/ui';
import { formatDayLabel } from '@/lib/dates';
import { formatSetSummary } from '@/domain/previousPerformance';
import SetRow from './SetRow';

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
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
}) {
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const settings = useSettings();
  const workingSets = previous?.working_sets ?? [];

  // Per-exercise rest wins over the global default: the brief's defaults are
  // 150-180s for compounds and 60-90s for isolation, which the seed applies.
  const restSeconds = entry.exercise?.default_rest_seconds ?? settings?.default_rest_seconds ?? 120;

  /** Copies last session's numbers into any set not yet logged. Never overwrites. */
  const applyLastTime = async () => {
    const targets = entry.sets.filter((set) => !set.completed && set.parent_set_id === null);
    for (const [index, set] of targets.entries()) {
      const source = workingSets[index] ?? workingSets.at(-1);
      if (!source) continue;
      await updateSet(set.id, { weight_kg: source.weight_kg, reps: source.reps });
    }
  };

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
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
            {entry.exercise?.primary_muscle}
          </p>
        </div>
        <button
          onClick={() => void removeExerciseFromWorkout(entry.workoutExercise.id)}
          aria-label={`Remove ${entry.exercise?.name ?? 'exercise'} from this workout`}
          className="shrink-0 px-2 py-1 text-xs text-muted active:text-red-400"
        >
          Remove
        </button>
      </div>

      {/* Setup notes: seat height, pin position, which bar. Shown where they are used. */}
      {entry.exercise?.setup_notes ? (
        <p className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
          {entry.exercise.setup_notes}
        </p>
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
          <button
            onClick={() => void applyLastTime()}
            className="shrink-0 text-[11px] text-accent active:opacity-60"
          >
            Use
          </button>
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
        const hint = set.parent_set_id === null ? workingSets[setIndex] : undefined;
        return (
          <SetRow
            key={set.id}
            set={set}
            index={setIndex}
            weightHint={hint?.weight_kg}
            repsHint={hint?.reps}
            restSeconds={restSeconds}
          />
        );
      })}

      <Button className="mt-2 w-full" onClick={() => void handleAddSet(entry)}>
        Add set
      </Button>
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
