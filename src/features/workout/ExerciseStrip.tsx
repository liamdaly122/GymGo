import type { WorkoutExerciseView } from '@/db/queries';
import { Icon } from '@/components/icons';

/**
 * Where you are in the session, and how to get somewhere else.
 *
 * The screen shows one station at a time, so this is the only thing that keeps
 * the whole session visible. One pill per station, carrying its state: done,
 * part-done, where you are now, or untouched.
 *
 * Jumping backwards is the reason it exists — the footer button handles going
 * forwards, which is the common case and sits in the thumb zone. This costs a
 * grip shuffle, which is fine at a handful of uses per session.
 */
export default function ExerciseStrip({
  stations,
  exercises,
  focused,
  onFocus,
  onAdd,
}: {
  /** Indices into `exercises`, one array per station. */
  stations: number[][];
  exercises: WorkoutExerciseView[];
  focused: number;
  onFocus: (station: number) => void;
  onAdd: () => void;
}) {
  /*
   * Nothing to show, and nothing to add from here: the empty state owns "Add
   * exercise" until there is a session to navigate. Two controls under one
   * accessible name would also be ambiguous to a screen reader — and to the
   * browser suites, which resolve `Add exercise` strictly.
   */
  if (stations.length === 0) return null;

  return (
    <ul className="strip" aria-label="Exercises in this session">
      {stations.map((station, index) => {
        const entries = station.map((i) => exercises[i]!).filter(Boolean);
        const sets = entries.flatMap((entry) => entry.sets.filter((set) => set.type !== 'warmup'));
        const done = sets.filter((set) => set.completed).length;
        const complete = sets.length > 0 && done === sets.length;
        const current = index === focused;

        const name = entries.map((entry) => entry.exercise?.name ?? 'Exercise').join(' + ');

        return (
          <li key={station.join('-')} className="shrink-0">
            <button
              type="button"
              onClick={() => onFocus(index)}
              aria-current={current ? 'true' : undefined}
              aria-label={`${name}, ${done} of ${sets.length} sets done`}
              className={`pill ${complete ? 'full' : ''}`}
            >
              {complete ? <Icon name="check" /> : done > 0 ? `${done}/${sets.length}` : index + 1}
            </button>
          </li>
        );
      })}

      <li className="shrink-0">
        <button type="button" onClick={onAdd} aria-label="Add exercise" className="pill add">
          <Icon name="plus" />
        </button>
      </li>
    </ul>
  );
}
