import type { WorkoutSet } from '@/db/schema';
import { NumberField } from '@/components/ui';
import { completeSet, removeSet, updateSet } from '@/db/mutations';
import { isChildSet } from '@/domain/sets';

const TYPE_LABELS: Record<string, string> = {
  warmup: 'W',
  working: '',
  drop: 'D',
  rest_pause: 'RP',
  myo: 'M',
  cluster: 'C',
  back_off: 'B',
};

/**
 * One logged set.
 *
 * Weight and reps commit on blur rather than on every keystroke, so a
 * part-typed "12" never lands in the database as 1 then 12.
 */
export default function SetRow({
  set,
  index,
  onCompleted,
}: {
  set: WorkoutSet;
  index: number;
  onCompleted?: (set: WorkoutSet) => void;
}) {
  const child = isChildSet(set);
  const label = TYPE_LABELS[set.type] ?? '';

  const handleComplete = async () => {
    const next = !set.completed;
    await completeSet(set.id, next);
    if (next) onCompleted?.(set);
  };

  return (
    <div className={`flex items-center gap-2 py-1.5 ${child ? 'pl-6' : ''}`}>
      <span
        className={`w-6 shrink-0 text-center text-xs tabular-nums ${
          set.type === 'warmup' ? 'text-amber-400' : child ? 'text-muted' : 'text-muted'
        }`}
        title={child ? 'Child set — counts toward volume, never toward a PR' : undefined}
      >
        {label || index + 1}
      </span>

      <NumberField
        key={`${set.id}-weight`}
        value={set.weight_kg}
        onCommit={(value) => void updateSet(set.id, { weight_kg: value })}
        suffix="kg"
        aria-label={`Set ${index + 1} weight in kilograms`}
      />
      <NumberField
        key={`${set.id}-reps`}
        value={set.reps}
        onCommit={(value) => void updateSet(set.id, { reps: Math.round(value) })}
        suffix={set.is_amrap ? 'AMRAP' : 'reps'}
        aria-label={`Set ${index + 1} repetitions`}
      />

      <button
        onClick={() => void handleComplete()}
        aria-label={set.completed ? `Set ${index + 1} done, tap to undo` : `Mark set ${index + 1} done`}
        aria-pressed={set.completed}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg border transition-colors ${
          set.completed
            ? 'border-accent bg-accent text-ink'
            : 'border-line bg-raised text-muted active:bg-line'
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        onClick={() => void removeSet(set.id)}
        aria-label={`Delete set ${index + 1}`}
        className="grid h-11 w-7 shrink-0 place-items-center text-muted active:text-red-400"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
