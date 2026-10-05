import type { WorkoutExerciseView } from '@/db/queries';
import { Button, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { supersetLabel } from '@/domain/supersets';
import { exerciseOutline } from './outline';

/**
 * The whole session, in order, a tap from the header.
 *
 * From the gym: the screen shows one exercise at a time, so nothing said
 * what was coming, or which machine to go and find. Each row names the
 * exercises with their kit and their work, says how far along each one is,
 * and marks in blue where you are. Tapping one goes there.
 */
export default function SessionSheet({
  stations,
  exercises,
  focused,
  onPick,
  onClose,
}: {
  /** Indices into `exercises`, one array per station. */
  stations: number[][];
  exercises: WorkoutExerciseView[];
  focused: number;
  onPick: (station: number) => void;
  onClose: () => void;
}) {
  const members = exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));
  const finished = stations.filter((station) => doneOf(station.map((index) => exercises[index]!)).complete).length;

  return (
    <Sheet label="This session" onClose={onClose}>
      <h2>This session</h2>
      <p className="sheet-note">
        {stations.length} {stations.length === 1 ? 'exercise' : 'exercises'} · {finished} done
      </p>
      <ol className="list session-list">
        {stations.map((station, index) => {
          const entries = station.map((member) => exercises[member]!);
          const { done, total, complete } = doneOf(entries);
          const current = index === focused;
          return (
            <li key={station.join('-')}>
              <button
                type="button"
                className="list-row session-row"
                aria-current={current ? 'step' : undefined}
                onClick={() => onPick(index)}
              >
                <span className="session-num num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="list-main">
                  {entries.map((entry, member) => {
                    const badge = entries.length > 1 ? supersetLabel(members, station[member]!) : null;
                    return (
                      <span key={entry.workoutExercise.id} className="session-ex">
                        <strong>
                          {badge ? <span className="ss">{badge}</span> : null}
                          {entry.exercise?.name ?? 'Exercise'}
                        </strong>
                        <span className="t-meta">{exerciseOutline(entry)}</span>
                      </span>
                    );
                  })}
                </span>
                <span className="session-state">
                  {complete ? (
                    <>
                      <Icon name="check" />
                      <span className="sr-only">, done</span>
                    </>
                  ) : done > 0 ? (
                    <>
                      <span aria-hidden="true">
                        {done}/{total}
                      </span>
                      <span className="sr-only">
                        , {done} of {total} done
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Button onClick={onClose}>Close</Button>
    </Sheet>
  );
}

/** Ticked work against all of it, warm-ups aside, as the strip counts it. */
function doneOf(entries: WorkoutExerciseView[]): { done: number; total: number; complete: boolean } {
  const sets = entries.flatMap((entry) => entry.sets.filter((set) => set.type !== 'warmup'));
  const done = sets.filter((set) => set.completed).length;
  return { done, total: sets.length, complete: sets.length > 0 && done === sets.length };
}
