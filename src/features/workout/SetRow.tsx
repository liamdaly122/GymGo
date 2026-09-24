import { useRef, useState } from 'react';
import type { WorkoutSet } from '@/db/schema';
import { NumberField } from '@/components/ui';
import { addChildSet, completeSet, removeSet, updateSet } from '@/db/mutations';
import { isChildSet } from '@/domain/sets';
import { formatPlateLoad, plateBreakdown, type LoadingProfile } from '@/domain/plates';
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
 * What a continuation is called out loud.
 *
 * A child set inherits its parent's number — a drop hanging off set 3 is still
 * set 3, not a fourth set — so without a name of its own it would share an
 * accessible label with its parent and a screen reader would announce two
 * identical controls.
 */
const CHILD_NAMES: Record<string, string> = {
  drop: 'Drop',
  rest_pause: 'Rest-pause',
  myo: 'Myo',
  cluster: 'Cluster',
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
  loading,
  showTools = false,
  weightStep,
  repsBase,
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
  /** What this exercise can be loaded with, for the plate line and the steppers. */
  loading?: LoadingProfile;
  /** True for the set you are about to do — the only row that gets the tools. */
  showTools?: boolean;
  /**
   * How far one tap moves the weight, and what it moves from — which is the
   * suggested weight while the field is still empty, not zero.
   */
  weightStep?: { up: number | null; down: number | null; base: number };
  /** The same, for reps: the placeholder until something is typed. */
  repsBase?: number;
}) {
  const child = isChildSet(set);
  const label = TYPE_LABELS[set.type] ?? '';
  const rest = useRestTimer();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
   * Deleting a set you have done asks first; deleting an empty row does not.
   *
   * Every other delete in the app confirms — gyms, routines, settings, and now
   * the exercise itself. This one sat two thumb-widths from the tick you press
   * after every single set, with no undo behind it. An untouched planned row
   * has nothing to lose, so making that ask would be friction for its own sake.
   */
  const hasWork = set.completed || set.weight_kg > 0 || set.reps > 0;

  /*
   * One write at a time per row.
   *
   * Tapping a stepper while the field is focused fires blur — which commits the
   * typed value — and then click. Without a queue the click would read a stale
   * weight from its closure and overwrite what was just typed, and two fast
   * taps would both read the same base and move one step instead of two.
   */
  // Top-level sets keep the plain "Set 3" wording; a continuation says what it
  // is and which set it hangs off.
  const setName = child
    ? `${CHILD_NAMES[set.type] ?? 'Continuation'} under set ${index + 1}`
    : set.type === 'warmup'
      ? `Warm-up ${index + 1}`
      : `Set ${index + 1}`;

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = (work: () => Promise<unknown>) => {
    queue.current = queue.current.then(work, work);
    return queue.current;
  };

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

  /*
   * Three states, three sizes. The set you are about to do is the only thing
   * on screen worth reading from arm's length; one already behind you is
   * present but done with. Both stay real inputs — a mistyped rep you spot
   * after ticking has to be fixable.
   */
  const fieldSize = set.completed ? 'done' : showTools ? 'log' : 'read';

  const row = (
    <div className={`flex items-center gap-2 py-2 ${child ? 'pl-6' : ''}`}>
      <span
        className={`w-6 shrink-0 text-center text-note tabular-nums ${
          set.type === 'warmup' ? 'text-amber-400' : 'text-muted'
        }`}
        title={child ? 'Child set — counts toward volume, never toward a PR' : undefined}
      >
        {label || index + 1}
      </span>

      <NumberField
        key={`${set.id}-weight-${set.weight_kg}`}
        value={set.weight_kg}
        blankWhenZero
        size={fieldSize}
        placeholder={weightHint !== undefined ? String(weightHint) : undefined}
        onCommit={(value) => void run(() => updateSet(set.id, { weight_kg: value }))}
        suffix="kg"
        aria-label={`${setName} weight in kilograms`}
      />
      <NumberField
        key={`${set.id}-reps-${set.reps}`}
        value={set.reps}
        blankWhenZero
        size={fieldSize}
        placeholder={repsHint !== undefined ? String(repsHint) : undefined}
        onCommit={(value) => void run(() => updateSet(set.id, { reps: Math.round(value) }))}
        suffix={set.is_amrap ? 'AMRAP' : 'reps'}
        aria-label={`${setName} repetitions`}
      />

      <button
        onClick={() => void handleComplete()}
        aria-label={
          set.completed ? `${setName} done, tap to undo` : `Mark ${setName.toLowerCase()} done`
        }
        aria-pressed={set.completed}
        className={`grid w-12 shrink-0 place-items-center rounded-lg border transition-colors ${
          showTools ? 'h-16' : 'h-11'
        } ${
          set.completed
            ? 'border-accent bg-accent text-ink'
            : 'border-line bg-raised text-muted active:bg-line'
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Not on the set in hand. At 56px of fixed width it took the fields down
          to about 99px, where a three-digit decimal clips — and it put an
          unconfirmed delete one thumb-width from the tick you press after every
          single set. It stays on the rows either side, where it is out of the
          way. */}
      {showTools ? null : (
        <button
          onClick={() => (hasWork ? setConfirmingDelete(true) : void removeSet(set.id))}
          aria-label={`Delete ${setName.toLowerCase()}`}
          className="grid h-11 w-7 shrink-0 place-items-center text-muted active:text-red-400"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );

  const confirm = confirmingDelete ? (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-black/60 sm:place-items-center"
      onClick={() => setConfirmingDelete(false)}
    >
      <div
        className="w-full max-w-lg rounded-t-2xl border-t border-line bg-surface p-5 sm:rounded-2xl sm:border"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-meta text-white">
          Delete {setName.toLowerCase()}
          {set.weight_kg > 0 || set.reps > 0 ? ` — ${set.weight_kg}kg × ${set.reps}` : ''}?
        </p>
        <div className="mt-4 grid gap-2">
          <button
            onClick={() => void removeSet(set.id)}
            aria-label={`Delete ${setName.toLowerCase()} for good`}
            className="grid min-h-11 place-items-center rounded-xl bg-red-500/15 px-4 text-meta text-red-300 active:bg-red-500/25"
          >
            Delete it
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            className="grid min-h-11 place-items-center rounded-xl border border-line bg-raised px-4 text-meta text-white active:bg-line"
          >
            Keep it
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const indent = child ? 'pl-14' : 'pl-8';

  /*
   * The plate breakdown and the steppers ride on the set you are about to do,
   * not on every row. At 390px the row is already 128px of fixed width before
   * the two fields, so nothing more fits inline — and repeating the loading
   * four times for four sets at the same weight is noise, not information.
   */
  const load =
    showTools && loading && set.weight_kg > 0 && !child
      ? plateBreakdown(set.weight_kg, loading)
      : null;

  const tools =
    showTools && !child && set.type !== 'warmup' ? (
      <>
        {load ? (
          <p className={`pb-1 text-[10px] leading-snug text-muted ${indent}`}>
            {load.rounded ? `Loads as ${load.total}kg · ` : ''}
            {formatPlateLoad(load)}
          </p>
        ) : null}

        {weightStep ? (
          <div className={`flex gap-1.5 pb-1.5 ${indent}`}>
            {weightStep.down === null ? null : (
              <StepButton
                label={`− ${weightStep.down}`}
                aria-label={`Set ${index + 1} weight down ${weightStep.down} kilograms`}
                onClick={() =>
                  void run(() =>
                    updateSet(set.id, {
                      weight_kg: Math.max(0, weightStep.base - (weightStep.down ?? 0)),
                    }),
                  )
                }
              />
            )}
            {weightStep.up === null ? null : (
              <StepButton
                label={`+ ${weightStep.up}`}
                aria-label={`Set ${index + 1} weight up ${weightStep.up} kilograms`}
                onClick={() =>
                  void run(() =>
                    updateSet(set.id, { weight_kg: weightStep.base + (weightStep.up ?? 0) }),
                  )
                }
              />
            )}
            <StepButton
              label="− 1 rep"
              aria-label={`Set ${index + 1} one rep fewer`}
              onClick={() =>
                void run(() => updateSet(set.id, { reps: Math.max(0, (repsBase ?? set.reps) - 1) }))
              }
            />
            <StepButton
              label="+ 1 rep"
              aria-label={`Set ${index + 1} one more rep`}
              onClick={() => void run(() => updateSet(set.id, { reps: (repsBase ?? set.reps) + 1 }))}
            />
          </div>
        ) : null}
      </>
    ) : null;

  if (!pro) {
    return (
      <div>
        {row}
        {tools}
        {confirm}
      </div>
    );
  }

  const attachable = set.completed && !child && set.type === 'working';

  return (
    <div>
      {row}
      {tools}
      {confirm}
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
              aria-label={`${setName} reps in reserve ${value}`}
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

          {/* AMRAP is a property of the set you are about to do, so it sits with
              RIR rather than waiting for the set to be ticked. The reps field
              relabels itself once it is on. */}
          {!child ? (
            <button
              onClick={() => void updateSet(set.id, { is_amrap: !set.is_amrap })}
              aria-label={`${setName} as many reps as possible`}
              aria-pressed={set.is_amrap}
              className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide transition-colors ${
                set.is_amrap
                  ? 'bg-accent text-ink'
                  : 'border border-line bg-raised text-muted'
              }`}
            >
              AMRAP
            </button>
          ) : null}
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

/** A quick-adjust key. Full height so it clears the 44px one-handed target. */
function StepButton({
  label,
  onClick,
  ...props
}: { label: string; onClick: () => void } & { 'aria-label': string }) {
  return (
    <button
      {...props}
      onClick={onClick}
      className="h-11 flex-1 rounded-lg border border-line bg-raised text-[11px] tabular-nums text-white active:bg-line"
    >
      {label}
    </button>
  );
}

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
