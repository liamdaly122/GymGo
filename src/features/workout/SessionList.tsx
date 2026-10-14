import type { WorkoutExerciseView } from '@/db/queries';
import { Icon } from '@/components/icons';
import { supersetLabel } from '@/domain/supersets';
import { exerciseOutline } from './outline';

/**
 * The whole session, in order: one row per station, each naming its
 * exercises with their kit and their work, how far along it is, and where you
 * are, in blue. Tapping a row goes there.
 *
 * Held by `SessionSheet`, a tap from the header, while the phone logs; and
 * on the screen itself while the watch does, where "where you are" is the
 * watch's station.
 */
export default function SessionList({
  stations,
  exercises,
  focused,
  onPick,
}: {
  /** Indices into `exercises`, one array per station. */
  stations: number[][];
  exercises: WorkoutExerciseView[];
  /** The station marked current, or -1 for none. */
  focused: number;
  onPick: (station: number) => void;
}) {
  const members = exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));

  return (
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
  );
}

/** Ticked work against all of it, warm-ups aside, as the strip counts it. */
export function doneOf(entries: WorkoutExerciseView[]): { done: number; total: number; complete: boolean } {
  const sets = entries.flatMap((entry) => entry.sets.filter((set) => set.type !== 'warmup'));
  const done = sets.filter((set) => set.completed).length;
  return { done, total: sets.length, complete: sets.length > 0 && done === sets.length };
}
