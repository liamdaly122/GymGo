import type { WorkoutExerciseView } from '@/db/queries';

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
    <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
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
              onClick={() => onFocus(index)}
              aria-current={current ? 'true' : undefined}
              aria-label={`${name}, ${done} of ${sets.length} sets done`}
              className={`grid h-11 min-w-11 place-items-center rounded-full px-3 text-meta tabular-nums transition-colors ${
                complete
                  ? 'bg-accent font-medium text-ink'
                  : current
                    ? 'bg-raised text-white ring-2 ring-accent'
                    : 'bg-raised text-muted'
              }`}
            >
              {complete ? '✓' : done > 0 ? `${done}/${sets.length}` : index + 1}
            </button>
          </li>
        );
      })}

      <li className="shrink-0">
        <button
          onClick={onAdd}
          aria-label="Add exercise"
          className="grid h-11 min-w-11 place-items-center rounded-full border border-dashed border-line px-3 text-meta text-muted active:bg-raised"
        >
          +
        </button>
      </li>
    </ul>
  );
}
