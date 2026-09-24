import { Link } from 'react-router-dom';
import type { WorkoutExerciseView } from '@/db/queries';
import { usePreviousPerformance, useSetSuggestion, useSettings } from '@/db/queries';
import {
  addSet,
  generateWarmupSets,
  moveWorkoutExercise,
  removeExerciseFromWorkout,
  toggleSupersetWithNext,
  updateSet,
} from '@/db/mutations';
import { setOrdinals } from '@/domain/sets';
import { warmupRamp } from '@/domain/warmup';
import {
  loadableWeight,
  nextLoadableAbove,
  nextLoadableBelow,
  type LoadingProfile,
} from '@/domain/plates';
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
  canMoveUp = false,
  canMoveDown = false,
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
  /** False for the first half of a superset, which runs straight into the next. */
  restsAfter?: boolean;
  /** "A1", "A2" — null when this exercise is not in a superset. */
  supersetLabel?: string | null;
  canPairWithNext?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const suggestion = useSetSuggestion(workoutId, entry.exercise?.id);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';
  const workingSets = previous?.working_sets ?? [];

  // Most specific wins. The routine's prescription is the whole reason a
  // strength primary rests 210s and an accessory 75s; falling straight to the
  // exercise default made every generated plan rest the same.
  /*
   * Set numbers come from the domain, not the array index: a warm-up ramp sits
   * in front of the working sets and must not renumber them.
   */
  const ordinals = setOrdinals(entry.sets);

  // The set you are about to do — the only row that carries the tools.
  const activeSetId =
    entry.sets.find((set) => !set.completed && set.parent_set_id === null && set.type !== 'warmup')
      ?.id ?? null;

  const hasWarmup = entry.sets.some((set) => set.type === 'warmup');
  const firstWorking = entry.sets.find(
    (set) => set.parent_set_id === null && set.type === 'working' && set.weight_kg > 0,
  );
  const warmupTarget =
    firstWorking?.weight_kg ?? suggestion?.weight_kg ?? previous?.top_set?.weight_kg ?? 0;
  const ramp = warmupRamp(warmupTarget, entry.loading);

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

      {/* Hidden when the ramp is empty, which covers bodyweight work and a
          working weight already at the bare bar without a second rule. */}
      {ramp.length > 0 && !hasWarmup ? (
        <button
          onClick={() => void generateWarmupSets(entry.workoutExercise.id, warmupTarget)}
          className="mb-2 w-full rounded-lg border border-line bg-raised py-2 text-[11px] text-muted active:bg-line"
        >
          Warm up to {warmupTarget}kg · {ramp.length} sets
        </button>
      ) : null}

      <div className="flex items-center gap-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
        <span className="w-6 text-center">Set</span>
        <span className="flex-1 text-center">Weight</span>
        <span className="flex-1 text-center">Reps</span>
        <span className="w-11" />
        <span className="w-7" />
      </div>

      {entry.sets.map((set) => {
        const ordinal = ordinals.get(set.id);
        // Keyed off the set's own number, so a warm-up ramp cannot shift last
        // session's figures onto the wrong rows.
        const lastTime = ordinal === undefined ? undefined : workingSets[ordinal];
        // The suggestion is the better hint where there is one; last time's
        // numbers fill in otherwise.
        const hintable = set.parent_set_id === null && set.type !== 'warmup';
        const weightHint = suggestion?.weight_kg ?? lastTime?.weight_kg;
        const repsHint = suggestion?.reps ?? lastTime?.reps;
        return (
          <SetRow
            key={set.id}
            set={set}
            index={ordinal ?? 0}
            {...(hintable && weightHint !== undefined ? { weightHint } : {})}
            {...(hintable && repsHint !== undefined ? { repsHint } : {})}
            restSeconds={restsAfter ? restSeconds : 0}
            pro={pro}
            loading={entry.loading}
            showTools={set.id === activeSetId}
            weightStep={weightStep(set.weight_kg, entry.loading)}
          />
        );
      })}

      <Button className="mt-2 w-full" onClick={() => void handleAddSet(entry)}>
        Add set
      </Button>

      {/* Reordering is what a busy squat rack actually forces. Footer rather
          than the header, which already carries Swap and Remove and would leave
          the exercise name about 76px at 390px. */}
      {canMoveUp || canMoveDown ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => void moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'up')}
            disabled={!canMoveUp}
            aria-label={`Move ${entry.exercise?.name ?? 'exercise'} earlier`}
            className="h-11 flex-1 rounded-lg border border-line bg-raised text-xs text-muted disabled:opacity-25 active:bg-line"
          >
            ↑ Earlier
          </button>
          <button
            onClick={() => void moveWorkoutExercise(workoutId, entry.workoutExercise.id, 'down')}
            disabled={!canMoveDown}
            aria-label={`Move ${entry.exercise?.name ?? 'exercise'} later`}
            className="h-11 flex-1 rounded-lg border border-line bg-raised text-xs text-muted disabled:opacity-25 active:bg-line"
          >
            ↓ Later
          </button>
        </div>
      ) : null}

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
  // Working sets only: inheriting a warm-up rung's weight would start the set
  // at 40% of what you are meant to be lifting.
  const last = entry.sets
    .filter((set) => set.parent_set_id === null && set.type === 'working')
    .at(-1);
  await addSet(entry.workoutExercise.id, {
    weight_kg: last?.weight_kg ?? 0,
    reps: last?.reps ?? 0,
  });
}

/** Two decimal places, so a plate step never renders as 2.4999999999999996. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * How far one tap moves the weight, in the equipment's own increments.
 *
 * From an empty field the first tap gives you the smallest thing you can
 * actually pick up — the bare bar on a barbell, one plate on a stack. Stepping
 * up from zero the same way as from a loaded bar offered "+ 22.5kg", which is
 * the bar plus a plate each side, skipping the bar itself; and stepping down
 * from zero offered "− 0.5kg", which is not a weight at all.
 */
function weightStep(
  weight: number,
  loading: LoadingProfile,
): { up: number | null; down: number | null } {
  if (weight <= 0) {
    return { up: round2(loadableWeight(0.1, loading)), down: null };
  }

  // A zero delta means the equipment has nothing further in that direction —
  // an empty bar has nothing lighter. Clamping it to a token 0.5 offered
  // "− 0.5kg", which is not a weight you can take off anything.
  const up = round2(nextLoadableAbove(weight, loading) - weight);
  const down = round2(weight - nextLoadableBelow(weight, loading));
  return { up: up > 0 ? up : null, down: down > 0 ? down : null };
}
