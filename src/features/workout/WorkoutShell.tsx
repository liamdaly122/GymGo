import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { RestTimerProvider, RestTimerView, useRestTimer } from './RestTimer';
import { useCompanionMode } from '@/hooks/useCompanionMode';
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
 * While the watch logs, both stand down: the watch has the countdown and the
 * cue (one cue per rest), and the phone is the companion you pick up between
 * stations, free to sleep in a pocket.
 *
 * Deliberately not hoisted to the app root: the rest and the tab bar would
 * fight over the screen everywhere else.
 */
export default function WorkoutShell() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const onWatch = useCompanionMode(workoutId).surface.on === 'watch';
  useWakeLock(!onWatch);

  return (
    <RestTimerProvider scopeId={workoutId ?? null}>
      <Covered onWatch={onWatch} />
    </RestTimerProvider>
  );
}

/**
 * While the rest fills the screen, what is underneath is inert: a keyboard or
 * a screen reader must not wander into set fields nobody can see.
 */
function Covered({ onWatch }: { onWatch: boolean }) {
  const { endsAt, minimised, stop } = useRestTimer();

  // The phone's rest stops the moment the watch takes over, and none starts
  // while it logs, so the phone never counts down or cues alongside it.
  useEffect(() => {
    if (onWatch && endsAt !== null) stop();
  }, [onWatch, endsAt, stop]);

  const resting = !onWatch && endsAt !== null;
  const covering = resting && !minimised;
  return (
    <>
      <div className={resting && minimised ? 'with-rest-bar' : undefined} inert={covering}>
        <Outlet />
      </div>
      {onWatch ? null : <RestTimerView />}
    </>
  );
}
