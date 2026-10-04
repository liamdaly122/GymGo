import { useState } from 'react';
import type { Exercise } from '@/db/schema';
import { useRoutineSwapOptions } from '@/db/queries';
import { swapRoutineExercise } from '@/db/mutations';
import SwapPanel, { SwapOverlay, planScopeHint, type SwapScopeOption } from './SwapPanel';

type Scope = 'routine' | 'plan';

/**
 * Swapping an exercise in a planned session: this one, or every session of the
 * plan that has it.
 *
 * Planning rather than mid-set, so a different exercise for the same muscles
 * leads the list — "I don't want to deadlift" — and the same lift on other kit
 * follows. Only the routines change; a workout already done never does.
 */
export default function RoutineSwap({
  routineExerciseId,
  onClose,
  onSwapped,
}: {
  routineExerciseId: string;
  onClose: () => void;
  /** Told what the swap reached, to say so. */
  onSwapped?: (message: string) => void;
}) {
  const view = useRoutineSwapOptions(routineExerciseId);
  const [saving, setSaving] = useState(false);

  if (!view) return null;
  const { current, routine, plan } = view;

  const scopes: SwapScopeOption<Scope>[] = [];
  if (routine) {
    scopes.push({
      value: 'routine',
      label: `Just ${routine.label}`,
      hint: `Only ${routine.label} changes.`,
      excludeIds: routine.exerciseIds,
    });
  }
  if (plan && plan.targets.length > 1) {
    scopes.push({
      value: 'plan',
      label: 'Whole plan',
      hint: planScopeHint(current.name, plan.targets),
      excludeIds: plan.exerciseIds,
    });
  }

  const handlePick = async (replacement: Exercise, scope: Scope) => {
    setSaving(true);
    try {
      const changed = await swapRoutineExercise(routineExerciseId, replacement.id, { scope });
      onSwapped?.(
        changed > 1
          ? `${replacement.name} in ${changed} sessions`
          : `${replacement.name} in ${routine?.label ?? 'this session'}`,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SwapOverlay exerciseName={current.name} onClose={onClose}>
      <SwapPanel
        exercise={current}
        library={view.library}
        gym={view.gym}
        scopes={scopes}
        defaultScope="routine"
        lead="different"
        busy={saving}
        onPick={(replacement, scope) => void handlePick(replacement, scope)}
      />
    </SwapOverlay>
  );
}
