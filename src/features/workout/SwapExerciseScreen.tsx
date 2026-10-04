import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Exercise } from '@/db/schema';
import { useSwapOptions } from '@/db/queries';
import { swapWorkoutExercise, type SwapScope } from '@/db/mutations';
import { Button, Screen, ScreenHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import SwapPanel, { planScopeHint, type SwapScopeOption } from '@/features/swap/SwapPanel';

/**
 * Swapping an exercise mid-session, for when the rack is taken, or for good.
 *
 * Today only is the default, and the same lift on other kit leads the list:
 * that is the swap you make between sets. Further reach is a deliberate choice
 * above the list — this session from now on, or every session of the plan
 * that has the lift. None of it can reach a workout already done.
 */
export default function SwapExerciseScreen() {
  const { workoutId, workoutExerciseId } = useParams<{
    workoutId: string;
    workoutExerciseId: string;
  }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const view = useSwapOptions(workoutExerciseId);

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

  const { current, loggedSets, routine, plan } = view;

  const scopes: SwapScopeOption<SwapScope>[] = [
    {
      value: 'workout',
      label: 'Today',
      hint: routine
        ? `Just this session. ${routine.label} keeps ${current.name} next time.`
        : 'Just this session.',
      excludeIds: view.workoutExerciseIds,
    },
  ];
  if (routine) {
    scopes.push({
      value: 'routine',
      label: `Every ${routine.label}`,
      hint: `${routine.label} has the replacement from now on.`,
      excludeIds: union(view.workoutExerciseIds, routine.exerciseIds),
    });
  }
  if (plan && plan.targets.length > 1) {
    scopes.push({
      value: 'plan',
      label: 'Whole plan',
      hint: planScopeHint(current.name, plan.targets),
      excludeIds: union(view.workoutExerciseIds, plan.exerciseIds),
    });
  }

  const handlePick = async (replacement: Exercise, scope: SwapScope) => {
    if (!workoutExerciseId) return;
    setSaving(true);
    try {
      await swapWorkoutExercise(workoutExerciseId, replacement.id, { scope });
      back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <div className="pt-2.5">
        <button type="button" className="back-btn" onClick={back}>
          <Icon name="back" />
          Workout
        </button>
      </div>
      <ScreenHeader title="Swap exercise" label={current.name} />

      <SwapPanel
        exercise={current}
        library={view.library}
        gym={view.gym}
        scopes={scopes}
        defaultScope="workout"
        lead="variations"
        busy={saving}
        onPick={(replacement, scope) => void handlePick(replacement, scope)}
        notice={
          // Said up front rather than discovered afterwards: the sets you have
          // already done stay where they are, because moving them would record
          // work against a lift you never performed.
          loggedSets > 0 ? (
            <div className="rounded-md bg-surface p-4">
              <p className="font-semibold text-hot">
                {loggedSets} set{loggedSets === 1 ? '' : 's'} already logged
              </p>
              <p className="t-meta">
                Those stay on {current.name} exactly as you did them. The replacement is added below
                it with the sets you have left.
              </p>
            </div>
          ) : undefined
        }
      />
    </Screen>
  );
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a, ...b]);
}
