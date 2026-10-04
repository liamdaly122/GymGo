import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Exercise } from '@/db/schema';
import { useSwapOptions } from '@/db/queries';
import { swapWorkoutExercise } from '@/db/mutations';
import { Button, Screen, ScreenHeader, SectionLabel, Toggle } from '@/components/ui';
import { Icon } from '@/components/icons';
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
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }

  if (view === null) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={back}>Back to workout</Button>
      </Screen>
    );
  }

  const { current, loggedSets, routineName, gymName, suggestions } = view;
  const nothingToOffer = suggestions.direct.length === 0 && suggestions.alternative.length === 0;

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

  const options = (list: Exercise[]) => (
    <ul className="stack-sm">
      {list.map((exercise) => (
        <li key={exercise.id}>
          <button
            type="button"
            className="goal"
            disabled={saving}
            onClick={() => void handlePick(exercise)}
          >
            <strong>{exercise.name}</strong>
            <span className="t-meta first-letter:uppercase">
              {exercise.primary_muscle} · {EQUIPMENT_LABELS[exercise.equipment]} ·{' '}
              {PATTERN_LABELS_SHORT[exercise.movement_pattern]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Screen>
      <div className="pt-2.5">
        <button type="button" className="back-btn" onClick={back}>
          <Icon name="back" />
          Workout
        </button>
      </div>
      <ScreenHeader title="Swap exercise" label={current.name} />

      <div className="stack">
        <div className="flex items-center gap-3">
          <ExerciseImage
            sourceId={current.source_id}
            muscle={current.primary_muscle}
            name={current.name}
            className="h-12 w-12 shrink-0"
          />
          <p className="t-meta first-letter:uppercase">
            {current.primary_muscle} · {PATTERN_LABELS_SHORT[current.movement_pattern]} ·{' '}
            {EQUIPMENT_LABELS[current.equipment]}
          </p>
        </div>

        {/*
          Said up front rather than discovered afterwards: the sets you have
          already done stay where they are, because moving them would record
          work against a lift you never performed.
        */}
        {loggedSets > 0 ? (
          <div className="rounded-md bg-surface p-4">
            <p className="font-semibold text-hot">
              {loggedSets} set{loggedSets === 1 ? '' : 's'} already logged
            </p>
            <p className="t-meta">
              Those stay on {current.name} exactly as you did them. The replacement is added below
              it with the sets you have left.
            </p>
          </div>
        ) : null}

        <div className="stack-sm">
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
          <div className="rounded-md bg-surface p-6 text-center">
            <p className="font-semibold">Nothing to swap to.</p>
            <p className="t-meta">
              {anyGym ? 'No other exercise trains this the same way.' : 'Try turning off the gym filter.'}
            </p>
          </div>
        ) : null}

        {suggestions.direct.length > 0 ? (
          <section aria-labelledby="direct-swaps">
            <SectionLabel id="direct-swaps">Direct swaps</SectionLabel>
            <p className="t-meta mb-3">
              Same movement, same muscle. The closest thing to what you were about to do.
            </p>
            {options(suggestions.direct)}
          </section>
        ) : null}

        {suggestions.alternative.length > 0 ? (
          <section aria-labelledby="alternatives">
            <SectionLabel id="alternatives">Alternatives</SectionLabel>
            <p className="t-meta mb-3">
              Either the same movement worked by a different muscle, or the same muscle trained a
              different way. Looser, still worth doing.
            </p>
            {options(suggestions.alternative)}
          </section>
        ) : null}
      </div>
    </Screen>
  );
}
