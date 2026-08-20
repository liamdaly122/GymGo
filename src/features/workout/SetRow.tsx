import type { WorkoutSet } from '@/db/schema';
import { NumberField } from '@/components/ui';
import { addChildSet, completeSet, removeSet, updateSet } from '@/db/mutations';
import { isChildSet } from '@/domain/sets';
import { useRestTimer } from './RestTimer';

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
 * How long a continuation actually rests for.
 *
 * A rest-pause is 15-20 seconds, not a full inter-set rest — running the normal
 * timer would turn it into an ordinary set and lose the whole point of the
 * technique.
 */
const CONTINUATION_REST_SECONDS: Record<string, number> = {
  rest_pause: 20,
  myo: 15,
  cluster: 20,
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
  weightHint,
  repsHint,
  restSeconds,
  pro = false,
}: {
  set: WorkoutSet;
  index: number;
  onCompleted?: (set: WorkoutSet) => void;
  /** Last session's numbers for this set, shown as a placeholder until logged. */
  weightHint?: number;
  repsHint?: number;
  /** How long to rest after this set. Omitted for child sets, which run straight on. */
  restSeconds?: number;
  /** Pro mode adds RIR and the drop / rest-pause attachments. */
  pro?: boolean;
}) {
  const child = isChildSet(set);
  const label = TYPE_LABELS[set.type] ?? '';
  const rest = useRestTimer();

  const handleComplete = async () => {
    const next = !set.completed;
    await completeSet(set.id, next);
    if (!next) return;
    onCompleted?.(set);
    if (child) {
      // A continuation rests briefly rather than not at all — 20 seconds is the
      // technique, a full three minutes would just be another set.
      const brief = CONTINUATION_REST_SECONDS[set.type];
      if (brief) rest.start(brief);
      return;
    }
    if (set.type !== 'warmup' && restSeconds) rest.start(restSeconds);
  };

  const row = (
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
        key={`${set.id}-weight-${set.weight_kg}`}
        value={set.weight_kg}
        blankWhenZero
        placeholder={weightHint !== undefined ? String(weightHint) : undefined}
        onCommit={(value) => void updateSet(set.id, { weight_kg: value })}
        suffix="kg"
        aria-label={`Set ${index + 1} weight in kilograms`}
      />
      <NumberField
        key={`${set.id}-reps-${set.reps}`}
        value={set.reps}
        blankWhenZero
        placeholder={repsHint !== undefined ? String(repsHint) : undefined}
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

  if (!pro) return row;

  const attachable = set.completed && !child && set.type === 'working';
  const indent = child ? 'pl-14' : 'pl-8';

  return (
    <div>
      {row}
      {/* RIR and the attachments live on a second line rather than in the row
          itself: a third input would squeeze weight and reps below a usable tap
          target on a phone, and both are things you decide after the set. */}
      {set.type !== 'warmup' ? (
        <div className={`flex items-center gap-1.5 pb-1.5 ${indent}`}>
          <span className="w-7 text-[10px] uppercase tracking-wide text-muted">RIR</span>
          {RIR_OPTIONS.map((value) => (
            <button
              key={value}
              // Tapping the current value again clears it: RIR is optional, and
              // a guess you no longer stand behind should be removable.
              onClick={() => void updateSet(set.id, { rir: set.rir === value ? null : value })}
              aria-label={`Set ${index + 1} reps in reserve ${value}`}
              aria-pressed={set.rir === value}
              className={`h-7 w-7 rounded-full text-[11px] tabular-nums transition-colors ${
                set.rir === value
                  ? 'bg-accent font-medium text-ink'
                  : 'border border-line bg-raised text-muted'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}

      {/* Their own row rather than trailing the RIR chips: three labels plus
          five chips wrap raggedly at 390px, which reads as broken rather than
          dense. */}
      {attachable ? (
        <div className={`flex flex-wrap gap-1.5 pb-2 ${indent}`}>
          <AttachButton label="Drop" onClick={() => void addChildSet(set.id, 'drop')} />
          <AttachButton label="Rest-pause" onClick={() => void addChildSet(set.id, 'rest_pause')} />
          <AttachButton label="Myo" onClick={() => void addChildSet(set.id, 'myo')} />
        </div>
      ) : null}
    </div>
  );
}

/** 0 means failure, 4 means four left in the tank. Past that nobody estimates. */
const RIR_OPTIONS = [0, 1, 2, 3, 4];

function AttachButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11px] text-muted active:bg-line"
    >
      + {label}
    </button>
  );
}
