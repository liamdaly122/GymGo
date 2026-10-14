import { useId, useState } from 'react';
import type { WorkoutView } from '@/db/queries';
import ExerciseImage from '@/components/ExerciseImage';
import { Button } from '@/components/ui';
import { watchStation } from '@/domain/companion';
import { nextStation } from '@/domain/supersets';
import NowOnWatch from './NowOnWatch';
import ReadinessControl from './ReadinessControl';
import SessionList, { doneOf } from './SessionList';
import { stationName, stationOutline } from './outline';

/**
 * The phone as the companion, while the watch logs.
 *
 * The watch has the set in hand, the Done button and the rest, so the phone
 * shows what is worth picking up between stations instead: the exercise the
 * watch is on, with its information, notes and fixes; how today is going;
 * what is up next, so you know which machine to go and claim; and the whole
 * session, in order, with the watch's place in blue. Tapping a session row
 * shows that station; the card goes back to following the watch on "Back to
 * the watch's exercise".
 *
 * Same data, same mutations as the phone's own logging screen. A change here
 * reaches the watch with the next list the phone sends.
 */
export default function CompanionView({
  view,
  stations,
  open,
  workoutId,
  pro,
  defaultRest,
  watchSetId,
  onAdd,
  onToast,
}: {
  view: WorkoutView;
  /** Indices into `view.exercises`, one array per station. */
  stations: number[][];
  /** Which stations still have anything unticked. */
  open: boolean[];
  workoutId: string;
  pro: boolean;
  defaultRest: number;
  /** The set the watch has in hand. */
  watchSetId: string | null;
  onAdd: () => void;
  onToast: (message: string) => void;
}) {
  const listId = useId();
  const nextId = useId();
  // Picked by the first exercise in it, so the pick survives the session
  // being reordered around it. Null follows the watch.
  const [viewingKey, setViewingKey] = useState<string | null>(null);

  const keyOf = (index: number) => view.exercises[stations[index]![0]!]!.workoutExercise.id;
  const firstOpen = open.indexOf(true);
  // Where the watch is: the station holding its set in hand, else where the
  // session has got to.
  const atWatch =
    watchStation(stations, view.exercises, watchSetId) ?? (firstOpen === -1 ? Math.max(0, stations.length - 1) : firstOpen);
  const picked = viewingKey === null ? -1 : stations.findIndex((_, index) => keyOf(index) === viewingKey);
  const shown = picked === -1 ? atWatch : picked;
  const following = shown === atWatch;
  const complete = doneOf(stations[shown]!.map((index) => view.exercises[index]!)).complete;
  const kicker = following ? 'On your watch' : complete ? 'Done' : 'Coming up';

  const upcoming = nextStation(open, atWatch);
  const upcomingEntries = upcoming === null ? [] : stations[upcoming]!.map((index) => view.exercises[index]!);

  const show = (index: number | null) => {
    setViewingKey(index === null || index === atWatch ? null : keyOf(index));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="stack">
      <NowOnWatch
        view={view}
        station={stations[shown]!}
        workoutId={workoutId}
        pro={pro}
        defaultRest={defaultRest}
        watchSetId={watchSetId}
        kicker={kicker}
        following={following}
        onBack={following ? null : () => show(null)}
      />

      <ReadinessControl workoutId={workoutId} value={view.workout.readiness} onAnswered={onToast} />

      {upcoming !== null ? (
        <section aria-labelledby={nextId} className="stack-sm">
          <h2 id={nextId} className="t-section" style={{ margin: 0 }}>
            Up next
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 gap-1.5">
              {upcomingEntries.slice(0, 2).map((entry) =>
                entry.exercise ? (
                  <ExerciseImage
                    key={entry.workoutExercise.id}
                    sourceId={entry.exercise.source_id}
                    muscle={entry.exercise.primary_muscle}
                    name={entry.exercise.name}
                    className="h-12 w-12"
                  />
                ) : null,
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="m-0 font-semibold [overflow-wrap:anywhere]">{stationName(upcomingEntries)}</p>
              <p className="t-meta">{stationOutline(upcomingEntries)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section aria-labelledby={listId}>
        <h2 id={listId} className="t-section">
          This session
        </h2>
        <SessionList stations={stations} exercises={view.exercises} focused={atWatch} onPick={(index) => show(index)} />
        <Button block className="mt-3" onClick={onAdd}>
          Add exercise
        </Button>
      </section>
    </div>
  );
}
