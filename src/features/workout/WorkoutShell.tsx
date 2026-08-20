import { Outlet, useParams } from 'react-router-dom';
import { RestTimerBar, RestTimerProvider } from './RestTimer';
import { useWakeLock } from '@/hooks/useWakeLock';

/**
 * Everything that has to outlive a single workout screen.
 *
 * The rest timer and the wake lock used to live inside `ActiveWorkoutScreen`,
 * but the swap screen is a sibling route — so tapping "Swap" mid-rest unmounted
 * both: the countdown vanished and the screen was free to sleep. Hoisting them
 * into a shared layout route fixes both, and means the rest dial stays visible
 * while you pick a replacement exercise, which is when you most want to know
 * how long you have left.
 *
 * Deliberately not hoisted to the app root: `RestTimerBar` and the tab bar are
 * both fixed to the bottom, and they would overlap on every other screen.
 */
export default function WorkoutShell() {
  const { workoutId } = useParams<{ workoutId: string }>();
  useWakeLock(true);

  return (
    <RestTimerProvider scopeId={workoutId ?? null}>
      <Outlet />
      <RestTimerBar />
    </RestTimerProvider>
  );
}
