import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings, useWorkout } from '@/db/queries';
import { addExerciseToWorkout, addSet, discardWorkout, finishWorkout } from '@/db/mutations';
import { snapshotEverything } from '@/platform/snapshots';
import { Button, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { formatClock } from '@/lib/dates';
import { useElapsed } from '@/hooks/useElapsed';
import { totalWorkingSets } from '@/domain/volume';
import { isLive } from '@/domain/sets';
import { nextStation, sessionStations } from '@/domain/supersets';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import { useRestTimer } from './RestTimer';
import ExerciseStrip from './ExerciseStrip';
import ReadinessPrompt from './ReadinessPrompt';
import SessionSheet from './SessionSheet';
import StationCard from './StationCard';
import { stationName, stationOutline } from './outline';

/**
 * The workout, one set at a time.
 *
 * The unit on screen is a station — a solo exercise, or a whole superset — and
 * inside it, the one set you are about to do, with a single Done button under
 * your thumb. Everything else is a tap away: the strip for other exercises,
 * the chips for other sets, the overflow for swap and the rest.
 *
 * Focus is pinned on arrival, to the first station with anything unticked.
 * After that it moves because you moved it — the strip, "Next exercise",
 * adding an exercise — or once the rest after a station's last set runs its
 * course: the rest names the exercise, and when it is over that exercise is
 * waiting. It never follows a tick. On the last tick the screen stays put
 * under the rest, so "Show sets" still finds the set just done if a rep was
 * mistyped.
 */
export default function ActiveWorkoutScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const view = useWorkout(workoutId);
  const settings = useSettings();
  const rest = useRestTimer();
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [listing, setListing] = useState(false);
  const [dismissedReadiness, setDismissedReadiness] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Done ticked the last set of this station, and this rest followed: when
  // that rest runs its course, the screen moves on.
  const [moveOn, setMoveOn] = useState<{ from: string; afterRest: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'plain' | 'hot' } | null>(null);
  // Blue only for news worth celebrating — a record — never for a nudge.
  const showToast = useCallback(
    (message: string, tone: 'plain' | 'hot' = 'plain') => setToast({ message, tone }),
    [],
  );
  const elapsed = useElapsed(view?.workout.started_at);

  // The session as stations, worked out before any early return so the
  // effects below can read it. Empty while the workout loads.
  const exercises = view?.exercises ?? [];
  const stations = sessionStations(
    exercises.map((entry) => ({
      id: entry.workoutExercise.id,
      superset_group: entry.workoutExercise.superset_group,
    })),
  );
  // Which stations still have anything unticked.
  const open = stations.map((station) => station.some((index) => exercises[index]!.sets.some((set) => !set.completed)));
  const stationOf = (exerciseId: string | null) =>
    exerciseId === null
      ? -1
      : stations.findIndex((station) => station.some((index) => exercises[index]!.workoutExercise.id === exerciseId));
  const keyOf = (index: number): string | null => {
    const first = stations[index]?.[0];
    return first === undefined ? null : exercises[first]!.workoutExercise.id;
  };

  // Where the session has got to: the first station with anything unticked.
  const firstOpen = open.indexOf(true);
  const seeded = firstOpen === -1 ? Math.max(0, stations.length - 1) : firstOpen;
  const pinned = stationOf(focusId);
  const focused = pinned === -1 ? seeded : pinned;
  const seededKey = keyOf(seeded);

  // Pinned on arrival, and again if the exercise it was pinned to is removed:
  // left unpinned, the screen would follow "first unticked" and jump on the
  // last tick of a station.
  useEffect(() => {
    if (pinned === -1 && seededKey !== null) setFocusId(seededKey);
  }, [pinned, seededKey]);

  // Moving on, once the rest after a station's last set has run its course —
  // run out, or been skipped. Not if the lifter went elsewhere in that rest,
  // and not if the station has work again: a set added in that rest (a
  // back-off, a rest-pause, one more) keeps the screen where it is. A drop
  // stops the rest without running it, so it never moves anything.
  useEffect(() => {
    if (moveOn === null || rest.lastRun !== moveOn.afterRest) return;
    setMoveOn(null);
    const from = stationOf(moveOn.from);
    if (from === -1 || from !== focused || open[from]) return;
    const to = nextStation(open, from);
    if (to !== null) setFocusId(keyOf(to));
    // Keyed on the rest finishing alone: the session is read as it stands then.
  }, [moveOn, rest.lastRun]);

  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (view === undefined) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>;
  }
  if (view === null || !workoutId) {
    return (
      <main className="screen grid place-items-center text-center">
        <div className="stack-sm">
          <p>That workout is gone.</p>
          <Button onClick={() => void navigate('/')}>Back to Today</Button>
        </div>
      </main>
    );
  }

  const pro = settings?.mode === 'pro';
  const allSets = exercises.flatMap((entry) => entry.sets);
  const completedSets = totalWorkingSets(allSets);
  // Out of how many, so the line reads "1/12 sets". Same population as the
  // numerator, children included, or a drop set would make it read "5/4".
  const plannedSets = allSets.filter((set) => isLive(set) && set.type !== 'warmup').length;

  const station = stations[focused] ?? [];
  // Where "Next exercise", the rest's "up next" and moving on all go: the next
  // station with work left, else one skipped earlier.
  const upcoming = nextStation(open, focused);
  const upcomingEntries = upcoming === null ? [] : stations[upcoming]!.map((index) => exercises[index]!);
  const focusedKey = keyOf(focused);

  /** A tap that goes somewhere: it also cancels any move still waiting on a rest. */
  const focusStation = (index: number) => {
    setMoveOn(null);
    setFocusId(keyOf(index));
  };

  const handleAddExercise = async (exerciseId: string) => {
    setPicking(false);
    const workoutExerciseId = await addExerciseToWorkout(workoutId, exerciseId);
    // Open with one empty set ready, so the next tap is a number, not a button.
    await addSet(workoutExerciseId);
    setMoveOn(null);
    setFocusId(workoutExerciseId);
  };

  const handleFinish = async () => {
    await finishWorkout(workoutId);
    // Inside the app, a copy of everything on the phone itself. Never awaited.
    void snapshotEverything();
    rest.stop();
    void navigate(`/history/${workoutId}`, { replace: true, state: { fresh: true } });
  };

  const handleDiscard = async () => {
    await discardWorkout(workoutId);
    rest.stop();
    void navigate('/', { replace: true });
  };

  const showReadiness = view.workout.readiness === null && completedSets === 0 && !dismissedReadiness;

  return (
    <div className="wk">
      <header className="wk-head">
        <h1 className="sr-only">Workout</h1>
        <div className="wk-top">
          <button type="button" className="icon-btn" aria-label="Back to Today" onClick={() => void navigate('/')}>
            <Icon name="back" />
          </button>
          <p className="wk-meta">
            <span>{formatClock(elapsed)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {completedSets}/{plannedSets} sets
            </span>
            {stations.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                {/* The way into the whole session: what is coming, and what kit it needs. */}
                <button
                  type="button"
                  className="wk-where"
                  aria-haspopup="dialog"
                  aria-label={`Exercise ${focused + 1} of ${stations.length}, show the whole session`}
                  onClick={() => setListing(true)}
                >
                  Exercise {focused + 1}/{stations.length}
                </button>
              </>
            ) : null}
          </p>
          <Button variant="primary" size="sm" onClick={() => setFinishing(true)}>
            Finish
          </Button>
        </div>
        <ExerciseStrip
          stations={stations}
          exercises={view.exercises}
          focused={focused}
          onFocus={focusStation}
          onAdd={() => setPicking(true)}
        />
      </header>

      <main className="wk-body">
        {view.exercises.length === 0 ? (
          <div className="stack pt-10 text-center">
            <h2 className="t-h2">Nothing here yet</h2>
            <p className="t-meta">Add your first exercise to get going.</p>
            <Button variant="primary" block onClick={() => setPicking(true)}>
              Add exercise
            </Button>
          </div>
        ) : (
          <>
            {showReadiness ? (
              <ReadinessPrompt
                workoutId={workoutId}
                onDismiss={() => setDismissedReadiness(true)}
                onAnswered={showToast}
              />
            ) : null}
            <StationCard
              key={station.join('-')}
              view={view}
              station={station}
              workoutId={workoutId}
              pro={pro}
              defaultRest={settings?.default_rest_seconds ?? 120}
              next={
                upcoming === null
                  ? null
                  : { name: stationName(upcomingEntries), detail: stationOutline(upcomingEntries) }
              }
              onNext={upcoming === null ? null : () => focusStation(upcoming)}
              onFinish={() => setFinishing(true)}
              onToast={showToast}
              onStationDone={(restId) => {
                if (restId !== null && focusedKey !== null) setMoveOn({ from: focusedKey, afterRest: restId });
              }}
            />
          </>
        )}
      </main>

      {picking ? (
        <ExercisePicker
          onPick={(exerciseId) => void handleAddExercise(exerciseId)}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {listing ? (
        <SessionSheet
          stations={stations}
          exercises={exercises}
          focused={focused}
          onPick={(index) => {
            setListing(false);
            focusStation(index);
          }}
          onClose={() => setListing(false)}
        />
      ) : null}

      {finishing ? (
        <Sheet label="Finish this workout?" onClose={() => setFinishing(false)}>
          <h2>Finish this workout?</h2>
          <p className="sheet-note">Sets you did not tick off are discarded.</p>
          <Button variant="primary" onClick={() => void handleFinish()}>
            Finish and save
          </Button>
          <Button onClick={() => setFinishing(false)}>Keep going</Button>
          <Button variant="danger" onClick={() => void handleDiscard()}>
            Discard workout
          </Button>
        </Sheet>
      ) : null}

      {toast ? (
        <div className={`toast ${toast.tone === 'hot' ? 'hot' : ''}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
