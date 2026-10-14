import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings, useWorkout } from '@/db/queries';
import { addExerciseToWorkout, addSet, discardWorkout, finishWorkout, ImmutableWorkoutError } from '@/db/mutations';
import { db } from '@/db/db';
import { snapshotEverything } from '@/platform/snapshots';
import { drainWatchInbox } from '@/platform/watch';
import { Button, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { formatClock } from '@/lib/dates';
import { useCompanionMode } from '@/hooks/useCompanionMode';
import { useElapsed } from '@/hooks/useElapsed';
import { totalWorkingSets } from '@/domain/volume';
import { isLive } from '@/domain/sets';
import { openStations, watchStation } from '@/domain/companion';
import { nextStation, sessionStations } from '@/domain/supersets';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import { useRestTimer } from './RestTimer';
import CompanionView from './CompanionView';
import ExerciseStrip from './ExerciseStrip';
import ReadinessPrompt from './ReadinessPrompt';
import SessionSheet from './SessionSheet';
import StationCard from './StationCard';
import WatchBar from './WatchBar';
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
 *
 * While the watch logs (`useCompanionMode`), the same screen is the
 * companion instead: no set in hand, no Done bar, no strip and no rest of its
 * own, and the watch's place in the session, live. When logging comes back to
 * the phone, the screen picks up at the station the watch was on.
 *
 * It follows the workout too: finished from the watch while it is open, it
 * goes where Finish here goes; discarded or deleted, it says so.
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
  const companion = useCompanionMode(workoutId);
  const onWatch = companion.surface.on === 'watch';
  // Discarded or deleted, on the watch or by a sync: told apart from still loading.
  const exists = useLiveQuery(async () => {
    if (!workoutId) return false;
    const row = await db.workouts.get(workoutId);
    return row !== undefined && row.deleted_at === null;
  }, [workoutId]);
  const gone = view === null || exists === false;

  // The session as stations, worked out before any early return so the
  // effects below can read it. Empty while the workout loads.
  const exercises = view?.exercises ?? [];
  const stations = sessionStations(
    exercises.map((entry) => ({
      id: entry.workoutExercise.id,
      superset_group: entry.workoutExercise.superset_group,
    })),
  );
  // Which stations still have anything unticked. While the watch logs, the
  // sets it skipped are not left to do either, so the companion's Up next is
  // the station the watch goes to; back on the phone they are there to log.
  const open = openStations(stations, exercises, onWatch ? (companion.report?.skipped ?? []) : []);
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

  // Where the watch is, kept while it logs: when logging comes back to the
  // phone, the phone picks up there rather than where it last was.
  const atWatch = onWatch ? (watchStation(stations, exercises, companion.report?.setId ?? null) ?? seeded) : null;
  const watchKey = atWatch === null ? null : keyOf(atWatch);
  const lastWatchKey = useRef<string | null>(null);
  useEffect(() => {
    if (watchKey !== null) lastWatchKey.current = watchKey;
  }, [watchKey]);

  // The handover, either way. To the watch: nothing waits on a phone rest,
  // and the session is on the screen itself, so its sheet closes. Back to the
  // phone: focus where the watch was. Losing touch is said out loud; an
  // ended session is not, because the watch's Finish ends it too, a moment
  // before the Finish itself lands and the screen moves on.
  const wasOnWatch = useRef(false);
  const why = companion.surface.on === 'phone' ? companion.surface.why : null;
  useEffect(() => {
    if (onWatch) {
      wasOnWatch.current = true;
      setMoveOn(null);
      setListing(false);
      return;
    }
    if (!wasOnWatch.current) return;
    wasOnWatch.current = false;
    if (lastWatchKey.current !== null) setFocusId(lastWatchKey.current);
    if (why === 'stale') showToast('Lost touch with your watch. Log here.');
    // Keyed on the handover alone.
  }, [onWatch]);

  useEffect(() => {
    if (companion.reclaimed) showToast('Logging is back on your watch.');
  }, [companion.reclaimed, showToast]);

  // Finished while this screen showed it open, which is the watch's Finish:
  // out the same way as Finish here, "Done." poster and all. Opened already
  // finished, it goes to the session's summary without the poster. Finish
  // here navigates itself, and `leaving` keeps this from doing it twice. The
  // drain that applied the watch's Finish has written the phone's snapshot
  // already, so it is not written again here.
  const finishedAt = view?.workout.finished_at;
  const seenFinishedAt = useRef<string | null | undefined>(undefined);
  const leaving = useRef(false);
  useEffect(() => {
    if (finishedAt === undefined || !workoutId) return;
    const before = seenFinishedAt.current;
    seenFinishedAt.current = finishedAt;
    if (finishedAt === null || leaving.current) return;
    leaving.current = true;
    if (before === null) {
      rest.stop();
      void navigate(`/history/${workoutId}`, { replace: true, state: { fresh: true } });
    } else {
      void navigate(`/history/${workoutId}`, { replace: true });
    }
    // Keyed on the workout's own finish alone.
  }, [finishedAt, workoutId]);

  // Gone from under the screen: no rest runs on over "That workout is gone".
  useEffect(() => {
    if (gone) rest.stop();
    // Keyed on it going alone.
  }, [gone]);

  if (view === undefined && !gone) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Loading…</div>;
  }
  if (gone || view === undefined || !workoutId) {
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
    leaving.current = true;
    // Sets logged on the watch but not yet applied go in first: Finish tidies
    // away every unticked set, and a finished workout cannot change.
    await drainWatchInbox();
    // That drain may have finished this workout (the watch's own Finish) or
    // discarded it (the watch's Discard, or a start from the watch taking the
    // place of an empty one). finishWorkout checks and writes in one step, so
    // neither can slip in between, and it never finishes a discarded workout.
    const finishedHere = await finishWorkout(workoutId).catch(async (cause: unknown) => {
      // Finished by that drain, or gone altogether: where to go is read below.
      if (cause instanceof ImmutableWorkoutError || !(await db.workouts.get(workoutId))) return false;
      throw cause;
    });
    rest.stop();
    const workout = await db.workouts.get(workoutId);
    if (!workout || workout.deleted_at !== null || workout.finished_at === null) {
      void navigate('/', { replace: true });
      return;
    }
    // Inside the app, a copy of everything on the phone itself. Never awaited.
    // A Finish the drain applied was copied by the drain.
    if (finishedHere) void snapshotEverything();
    void navigate(`/history/${workoutId}`, { replace: true, state: { fresh: true } });
  };

  const handleDiscard = async () => {
    await discardWorkout(workoutId);
    rest.stop();
    void navigate('/', { replace: true });
  };

  const showReadiness = view.workout.readiness === null && completedSets === 0 && !dismissedReadiness;
  const watchReport = onWatch ? companion.report : null;

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
            {stations.length > 0 && !watchReport ? (
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
        {watchReport ? (
          <WatchBar report={watchReport} onTakeBack={companion.takeBack} />
        ) : (
          <ExerciseStrip
            stations={stations}
            exercises={view.exercises}
            focused={focused}
            onFocus={focusStation}
            onAdd={() => setPicking(true)}
          />
        )}
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
        ) : watchReport ? (
          <CompanionView
            view={view}
            stations={stations}
            open={open}
            workoutId={workoutId}
            pro={pro}
            defaultRest={settings?.default_rest_seconds ?? 120}
            watchSetId={watchReport.setId}
            onAdd={() => setPicking(true)}
            onToast={showToast}
          />
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
