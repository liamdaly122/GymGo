import { useEffect, useRef } from 'react';
import type { WorkoutExerciseView } from '@/db/queries';
import { Icon } from '@/components/icons';
import { stationName } from './outline';

/**
 * Where you are in the session, and how to get somewhere else.
 *
 * The screen shows one station at a time, so this is the only thing that keeps
 * the whole session visible. One pill per station, carrying its state (done,
 * part-done, or its number) and its name, so what comes next and which machine
 * it needs can be read without leaving the set in hand. Long names are cut
 * short here; the whole session, kit and all, is a tap away on "Exercise N/M".
 *
 * Jumping backwards is the reason it can be tapped. Going forwards happens by
 * itself when an exercise's last rest is over, or with the footer button.
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
  const list = useRef<HTMLUListElement>(null);

  // Named pills run past the edge, so the one you are on is scrolled into
  // view. The strip scrolls; the page never does.
  useEffect(() => {
    const strip = list.current;
    const pill = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !pill) return;
    const edge = 20;
    const box = strip.getBoundingClientRect();
    const at = pill.getBoundingClientRect();
    const by = at.left < box.left + edge ? at.left - box.left - edge : at.right > box.right - edge ? at.right - box.right + edge : 0;
    if (by === 0) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    strip.scrollBy({ left: by, behavior: still ? 'auto' : 'smooth' });
  }, [focused, stations.length]);

  /*
   * Nothing to show, and nothing to add from here: the empty state owns "Add
   * exercise" until there is a session to navigate. Two controls under one
   * accessible name would also be ambiguous to a screen reader — and to the
   * browser suites, which resolve `Add exercise` strictly.
   */
  if (stations.length === 0) return null;

  return (
    <ul ref={list} className="strip" aria-label="Exercises in this session">
      {stations.map((station, index) => {
        const entries = station.map((i) => exercises[i]!).filter(Boolean);
        const sets = entries.flatMap((entry) => entry.sets.filter((set) => set.type !== 'warmup'));
        const done = sets.filter((set) => set.completed).length;
        const complete = sets.length > 0 && done === sets.length;
        const current = index === focused;

        const name = stationName(entries);

        return (
          <li key={station.join('-')} className="shrink-0">
            <button
              type="button"
              onClick={() => onFocus(index)}
              aria-current={current ? 'true' : undefined}
              aria-label={`${name}, ${done} of ${sets.length} sets done`}
              className={`pill named ${complete ? 'full' : ''}`}
            >
              <span className="pill-state">
                {complete ? <Icon name="check" /> : done > 0 ? `${done}/${sets.length}` : index + 1}
              </span>
              <span className="pill-name">{name}</span>
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
