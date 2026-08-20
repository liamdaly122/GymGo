import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Exercise } from '@/db/schema';
import { useSwapOptions } from '@/db/queries';
import { swapWorkoutExercise } from '@/db/mutations';
import { Button, Card, Screen, ScreenTitle } from '@/components/ui';
import ExerciseImage from '@/components/ExerciseImage';
import { EQUIPMENT_LABELS, PATTERN_LABELS_SHORT } from '@/features/exercises/labels';

/**
 * Swapping an exercise mid-session, for when the rack is taken.
 *
 * Two lists rather than one. The direct list trains the same muscle through the
 * same movement — the substitution you would make without thinking. The
 * alternatives match on one or the other, which is what you want when the whole
 * station is busy rather than just the bar.
 */
export default function SwapExerciseScreen() {
  const { workoutId, workoutExerciseId } = useParams<{
    workoutId: string;
    workoutExerciseId: string;
  }>();
  const navigate = useNavigate();

  const [anyGym, setAnyGym] = useState(false);
  const [keepInRoutine, setKeepInRoutine] = useState(false);
  const [saving, setSaving] = useState(false);

  const view = useSwapOptions(workoutExerciseId, { anyGym });

  const back = () => void navigate(`/workout/${workoutId}`);

  if (view === undefined) {
    return (
      <Screen>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }

  if (view === null) {
    return (
      <Screen>
        <ScreenTitle>Not found</ScreenTitle>
        <Button onClick={back}>Back to workout</Button>
      </Screen>
    );
  }

  const { current, loggedSets, routineName, gymName, suggestions } = view;
  const nothingToOffer =
    suggestions.direct.length === 0 && suggestions.alternative.length === 0;

  const handlePick = async (replacement: Exercise) => {
    if (!workoutExerciseId) return;
    setSaving(true);
    try {
      await swapWorkoutExercise(workoutExerciseId, replacement.id, {
        updateRoutine: keepInRoutine,
      });
      back();
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ exercise }: { exercise: Exercise }) => (
    <li>
      <button
        disabled={saving}
        onClick={() => void handlePick(exercise)}
        className="flex w-full items-center gap-3 py-2.5 text-left active:opacity-60 disabled:opacity-40"
      >
        <ExerciseImage
          sourceId={exercise.source_id}
          muscle={exercise.primary_muscle}
          name={exercise.name}
          className="h-12 w-12 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-white">{exercise.name}</span>
          <span className="block truncate text-xs text-muted first-letter:uppercase">
            {exercise.primary_muscle} · {EQUIPMENT_LABELS[exercise.equipment]}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted">
          {PATTERN_LABELS_SHORT[exercise.movement_pattern]}
        </span>
      </button>
    </li>
  );

  return (
    <Screen>
      <button onClick={back} className="mb-3 text-xs text-muted">
        ← Back to workout
      </button>
      <ScreenTitle>Swap exercise</ScreenTitle>

      <Card className="mb-4 flex items-center gap-3 p-3">
        <ExerciseImage
          sourceId={current.source_id}
          muscle={current.primary_muscle}
          name={current.name}
          className="h-12 w-12 shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{current.name}</p>
          <p className="truncate text-xs text-muted first-letter:uppercase">
            {current.primary_muscle} · {PATTERN_LABELS_SHORT[current.movement_pattern]}
          </p>
        </div>
      </Card>

      {/*
        Said up front rather than discovered afterwards: the sets you have
        already done stay where they are, because moving them would record work
        against a lift you never performed.
      */}
      {loggedSets > 0 ? (
        <Card className="mb-4 border-info/30 bg-info/5 p-3">
          <p className="text-xs text-info">
            {loggedSets} set{loggedSets === 1 ? '' : 's'} already logged
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Those stay on {current.name} exactly as you did them. The replacement is added below it
            with the sets you have left.
          </p>
        </Card>
      ) : null}

      <div className="mb-4 space-y-2">
        <Toggle
          checked={!anyGym}
          onChange={(value) => setAnyGym(!value)}
          label={gymName ? `Only what ${gymName} has` : 'Only what my gym has'}
          hint="Turn off if you are somewhere else, or your gym profile is out of date."
        />
        {routineName ? (
          <Toggle
            checked={keepInRoutine}
            onChange={setKeepInRoutine}
            label="Keep this in the routine"
            hint={`Next time you run ${routineName} it starts with the replacement. Workouts you have already done are untouched.`}
          />
        ) : null}
      </div>

      {nothingToOffer ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-white">Nothing to swap to.</p>
          <p className="mt-1 text-xs text-muted">
            {anyGym
              ? 'No other exercise trains this the same way.'
              : 'Try turning off the gym filter.'}
          </p>
        </div>
      ) : null}

      {suggestions.direct.length > 0 ? (
        <section className="mb-5">
          <h2 className="eyebrow mb-1">Direct swaps</h2>
          <p className="mb-2 text-[11px] text-muted">
            Same movement, same muscle. The closest thing to what you were about to do.
          </p>
          <ul className="divide-y divide-line">
            {suggestions.direct.map((exercise) => (
              <Row key={exercise.id} exercise={exercise} />
            ))}
          </ul>
        </section>
      ) : null}

      {suggestions.alternative.length > 0 ? (
        <section>
          <h2 className="eyebrow mb-1">Alternatives</h2>
          <p className="mb-2 text-[11px] text-muted">
            Either the same movement worked by a different muscle, or the same muscle trained a
            different way. Looser, still worth doing.
          </p>
          <ul className="divide-y divide-line">
            {suggestions.alternative.map((exercise) => (
              <Row key={exercise.id} exercise={exercise} />
            ))}
          </ul>
        </section>
      ) : null}
    </Screen>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs text-white">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</p> : null}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
