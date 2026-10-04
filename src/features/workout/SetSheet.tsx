import { useState } from 'react';
import type { WorkoutSet } from '@/db/schema';
import { addChildSet, completeSet, removeSet, updateSet, type ChildSetKind } from '@/db/mutations';
import { Button, NumberField, Sheet } from '@/components/ui';
import { isChildSet } from '@/domain/sets';
import { formatLogged, setName } from './setNames';

const ATTACH: Array<{ kind: ChildSetKind; label: string }> = [
  { kind: 'drop', label: 'Drop' },
  { kind: 'rest_pause', label: 'Rest-pause' },
  { kind: 'myo', label: 'Myo' },
];

/**
 * One set that is not the one in hand: fix it, untick it, or get rid of it.
 *
 * A mistyped rep spotted after Done has to be fixable, and this is where — a
 * tap on the set's chip. Deleting a set with work on it asks first and names
 * what would be lost; deleting an untouched one does not, because there is
 * nothing to lose and the confirm would be friction for its own sake.
 */
export default function SetSheet({
  set,
  ordinal,
  exerciseName,
  pro,
  onClose,
}: {
  set: WorkoutSet;
  ordinal: number;
  exerciseName: string;
  pro: boolean;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = setName(set, ordinal);
  const hasWork = set.completed || set.weight_kg > 0 || set.reps > 0;
  const child = isChildSet(set);

  const handleDelete = async () => {
    if (hasWork && !confirming) {
      setConfirming(true);
      return;
    }
    await removeSet(set.id);
    onClose();
  };

  if (confirming) {
    return (
      <Sheet label={`Delete ${name.toLowerCase()}`} onClose={onClose}>
        <h2>Delete {name.toLowerCase()}?</h2>
        <p className="sheet-note">
          {set.weight_kg > 0 || set.reps > 0 ? formatLogged(set.weight_kg, set.reps) : 'Part-filled'}
          {set.completed ? ', already done' : ''}. This can't be undone.
        </p>
        <Button variant="danger" aria-label={`Delete ${name.toLowerCase()} for good`} onClick={() => void handleDelete()}>
          Delete it
        </Button>
        <Button onClick={() => setConfirming(false)}>Keep it</Button>
      </Sheet>
    );
  }

  return (
    <Sheet label={`Edit ${name.toLowerCase()}`} onClose={onClose}>
      <h2>{name}</h2>
      <p className="sheet-note">{exerciseName}</p>

      <div className="row2">
        <NumberField
          key={`${set.id}-weight-${set.weight_kg}`}
          value={set.weight_kg}
          blankWhenZero
          suffix="kg"
          onCommit={(value) => void updateSet(set.id, { weight_kg: value })}
          aria-label={`${name} weight in kilograms`}
        />
        <NumberField
          key={`${set.id}-reps-${set.reps}`}
          value={set.reps}
          blankWhenZero
          suffix={set.is_amrap ? 'AMRAP' : 'reps'}
          onCommit={(value) => void updateSet(set.id, { reps: Math.round(value) })}
          aria-label={`${name} repetitions`}
        />
      </div>

      {pro && set.type !== 'warmup' ? (
        <div className="rir">
          <span className="t-label">RIR</span>
          {[0, 1, 2, 3, 4].map((value) => (
            <button
              key={value}
              type="button"
              // Tapping the current value again clears it: RIR is optional, and
              // a guess you no longer stand behind should be removable.
              onClick={() => void updateSet(set.id, { rir: set.rir === value ? null : value })}
              aria-label={`${name} reps in reserve ${value}`}
              aria-pressed={set.rir === value}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}

      {pro && set.completed && !child && set.type === 'working' ? (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Add a technique to this set">
          {ATTACH.map((option) => (
            <Button
              key={option.kind}
              size="sm"
              onClick={() => void addChildSet(set.id, option.kind).then(onClose)}
            >
              + {option.label}
            </Button>
          ))}
        </div>
      ) : null}

      {set.completed ? (
        <Button onClick={() => void completeSet(set.id, false).then(onClose)}>Untick {name.toLowerCase()}</Button>
      ) : null}
      <Button variant="ghost" className="text-danger" onClick={() => void handleDelete()}>
        Delete {name.toLowerCase()}
      </Button>
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </Sheet>
  );
}
