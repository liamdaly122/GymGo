import type { WorkoutSet } from '@/db/schema';
import { Icon } from '@/components/icons';
import { isChildSet } from '@/domain/sets';
import { CHILD_MARKS, formatLogged, setName } from './setNames';

/**
 * Every set of one exercise, as a row of chips.
 *
 * The set in hand is the lit one. Done sets show what was logged; the rest
 * show their number — warm-ups on their own W sequence, and a continuation by
 * its mark, so a drop under set 1 never reads as set 2. Every chip but the one
 * in hand opens that set, which is the way back to a rep you mistyped.
 */
export default function SetChips({
  sets,
  ordinals,
  inHandId,
  exerciseName,
  onOpen,
}: {
  sets: WorkoutSet[];
  ordinals: Map<string, number>;
  inHandId: string | null;
  exerciseName: string;
  onOpen: (setId: string) => void;
}) {
  return (
    <ul className="b-chips" aria-label={`${exerciseName} sets`}>
      {sets.map((set) => {
        const ordinal = ordinals.get(set.id) ?? 0;
        const name = setName(set, ordinal);
        const child = isChildSet(set);
        const mark = child
          ? (CHILD_MARKS[set.type] ?? '↳')
          : set.type === 'warmup'
            ? `W${ordinal + 1}`
            : String(ordinal + 1);
        const tone = `${set.type === 'warmup' ? 'warm' : ''} ${child ? 'child' : ''}`;

        if (set.id === inHandId) {
          return (
            <li key={set.id}>
              <span className={`b-chip cur ${tone}`} aria-current="step">
                <span aria-hidden="true">{mark}</span>
                <span className="sr-only">{name}, in hand</span>
              </span>
            </li>
          );
        }

        if (set.completed) {
          const logged = formatLogged(set.weight_kg, set.reps);
          return (
            <li key={set.id}>
              <button
                type="button"
                className={`b-chip done ${tone}`}
                onClick={() => onOpen(set.id)}
                aria-label={`Edit ${name.toLowerCase()}, ${logged}, done`}
              >
                {child ? `${mark} ` : ''}
                {logged.replace('kg', '')}
                <Icon name="check" />
              </button>
            </li>
          );
        }

        return (
          <li key={set.id}>
            <button
              type="button"
              className={`b-chip ${tone}`}
              onClick={() => onOpen(set.id)}
              aria-label={`Edit ${name.toLowerCase()}`}
            >
              {mark}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
