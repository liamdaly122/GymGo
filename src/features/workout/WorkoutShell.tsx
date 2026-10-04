import { Outlet, useParams } from 'react-router-dom';
import { RestTimerProvider, RestTimerView, useRestTimer } from './RestTimer';
import { useWakeLock } from '@/hooks/useWakeLock';

/**
 * Everything that has to outlive a single workout screen.
 *
 * The rest timer and the wake lock used to live inside `ActiveWorkoutScreen`,
 * but the swap screen is a sibling route — so tapping "Swap" mid-rest unmounted
 * both: the countdown vanished and the screen was free to sleep. Hoisting them
 * into a shared layout route fixes both, and means the rest stays up while you
 * pick a replacement exercise, which is when you most want to know how long you
 * have left.
 *
 * Deliberately not hoisted to the app root: the rest and the tab bar would
 * fight over the screen everywhere else.
 */
export default function WorkoutShell() {
  const { workoutId } = useParams<{ workoutId: string }>();
  useWakeLock(true);

  return (
    <RestTimerProvider scopeId={workoutId ?? null}>
      <Covered />
    </RestTimerProvider>
  );
}

/**
 * While the rest fills the screen, what is underneath is inert: a keyboard or
 * a screen reader must not wander into set fields nobody can see.
 */
function Covered() {
  const { endsAt, minimised } = useRestTimer();
  const covering = endsAt !== null && !minimised;
  return (
    <>
      <div className={endsAt !== null && minimised ? 'with-rest-bar' : undefined} inert={covering}>
        <Outlet />
      </div>
      <RestTimerView />
    </>
  );
}
