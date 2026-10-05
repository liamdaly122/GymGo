import { useEffect, useRef, useState } from 'react';
import { useSettings, type WorkoutExerciseView } from '@/db/queries';
import type { WorkoutSet } from '@/db/schema';
import { addSet, completeSetWith, updateSet } from '@/db/mutations';
import { formatSetSummary, type PreviousPerformance } from '@/domain/previousPerformance';
import type { Suggestion } from '@/domain/progression';
import { setBreaksRecord, type RecordMarks } from '@/domain/prs';
import { stepFrom } from '@/domain/plates';
import { isChildSet } from '@/domain/sets';
import { schemeTarget, stepsFromTop, SCHEME_LOAD_STEP, SCHEME_REP_STEP } from '@/domain/schemes';
import { restsAfterSet } from '@/domain/supersets';
import { formatDayLabel, nowIso } from '@/lib/dates';
import { playRecordTone, RECORD_VIBRATION, vibrate } from '@/lib/feedback';
import { useWriteQueue } from '@/hooks/useWriteQueue';
import { useRestTimer } from './RestTimer';
import PlateDiagram from './PlateDiagram';
import {
  CHILD_NAMES,
  CONTINUATION_REST_SECONDS,
  describeRecord,
  describeTempo,
  formatLogged,
  formatNumber,
  parseEntry,
  setName,
} from './setNames';

/** The chip beside the plan line: what the engine wants you to do, in a word. */
const VERB: Record<string, string> = {
  add_weight: 'Go up',
  add_reps: 'More reps',
  repeat: 'Hold',
  deload: 'Back off',
  estimate: 'Estimate',
};

const VERB_TONE: Record<string, string> = {
  estimate: 'chip-hot',
  deload: 'chip-warn',
};

/** 0 means failure, 4 means four left in the tank. Past that nobody estimates. */
const RIR_OPTIONS = [0, 1, 2, 3, 4];

/**
 * The set you are about to do, and the one button that logs it.
 *
 * Two numbers, poster-sized, each between a minus and a plus. What they show
 * is what Done logs: what you typed, or — while a field is still empty — the
 * suggestion sitting in it as a placeholder. An empty tick used to save
 * 0kg × 0; now the number on screen is the number in your history.
 *
 * The steppers move the number you can see, which while the field is empty is
 * that same placeholder, by what the equipment can actually make. Writes go
 * through one queue, so a tap that lands while the field is still committing
 * its blur cannot be overtaken by it.
 */
export default function SetInHand({
  entry,
  set,
  ordinal,
  memberIndex,
  stationSets,
  superset,
  pro,
  restSeconds,
  suggestion,
  previous,
  prior,
  liftSets,
  onToast,
}: {
  entry: WorkoutExerciseView;
  set: WorkoutSet;
  /** From `setOrdinals`, zero-based. */
  ordinal: number;
  /** Which member of the station this exercise is. */
  memberIndex: number;
  /** Every member's sets, for the superset rest rule. */
  stationSets: WorkoutSet[][];
  /** True when the station is a superset, so "up next" names the exercise. */
  superset: boolean;
  pro: boolean;
  restSeconds: number;
  suggestion: Suggestion | null | undefined;
  previous: PreviousPerformance | null | undefined;
  /** Where this lift's records stood before today; null for a first, undefined while loading. */
  prior: RecordMarks | null | undefined;
  /** Every set of this lift in the session, so today's earlier sets raise the bar. */
  liftSets: WorkoutSet[];
  onToast: (message: string, tone?: 'hot') => void;
}) {
  const rest = useRestTimer();
  const settings = useSettings();
  const { setUpNext } = rest;
  const run = useWriteQueue();
  const weightInput = useRef<HTMLInputElement>(null);
  const repsInput = useRef<HTMLInputElement>(null);
  const [showReason, setShowReason] = useState(false);
  const [showTempo, setShowTempo] = useState(false);

  const name = setName(set, ordinal);
  const child = isChildSet(set);
  const exerciseName = entry.exercise?.name ?? 'Exercise';
  const equipment = entry.exercise?.equipment;
  const bodyweight = equipment === 'bodyweight';

  // Only a top-level working set is something a suggestion or last time's
  // numbers apply to. A warm-up arrives filled in; a drop carries its weight.
  const hintable = !child && set.type === 'working';
  const lastTime = hintable ? previous?.working_sets[ordinal] : undefined;

  // A pyramid's other sets aim off its top set: lighter and longer the further
  // away they sit. One added by hand off a straight set arrives filled in.
  const technique = entry.workoutExercise.technique;
  const nonWarmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type !== 'warmup');
  const fromTop = stepsFromTop(
    technique,
    nonWarmups.map((candidate) => candidate.type),
    nonWarmups.findIndex((candidate) => candidate.id === set.id),
  );
  // Today's top set once it is done — a reverse pyramid's comes first — else
  // what it is meant to be.
  const workingSets = nonWarmups.filter((candidate) => candidate.type === 'working');
  const topSet = technique === 'reverse_pyramid' ? workingSets[0] : workingSets.at(-1);
  const topDone = topSet?.completed && (topSet.weight_kg > 0 || topSet.reps > 0) ? topSet : null;
  const topTarget = topDone ?? suggestion ?? previous?.top_set ?? null;
  const schemeHint = fromTop !== null && topTarget ? schemeTarget(topTarget, fromTop, entry.loading) : null;
  const schemeRole = set.type === 'back_off' ? (technique === 'pyramid' ? 'Ramp' : 'Back-off') : null;

  const weightHint = schemeHint?.weight_kg ?? (hintable ? (suggestion?.weight_kg ?? lastTime?.weight_kg ?? null) : null);
  const repsHint = schemeHint?.reps ?? (hintable ? (suggestion?.reps ?? lastTime?.reps ?? null) : null);
  const tempo = entry.workoutExercise.tempo;

  const [weightText, setWeightText] = useState(() => (set.weight_kg > 0 ? formatNumber(set.weight_kg) : ''));
  const [repsText, setRepsText] = useState(() => (set.reps > 0 ? String(set.reps) : ''));

  // What is on screen: the typed number, else the placeholder.
  const weight = parseEntry(weightText) ?? weightHint ?? (bodyweight ? 0 : null);
  const reps = parseEntry(repsText) ?? repsHint;
  const steps = stepFrom(weight ?? 0, entry.loading);

  const warmups = entry.sets.filter((candidate) => candidate.parent_set_id === null && candidate.type === 'warmup');
  const label = child
    ? `${CHILD_NAMES[set.type] ?? 'Continuation'} · set ${ordinal + 1}`
    : set.type === 'warmup'
      ? `Warm-up ${ordinal + 1} of ${warmups.length}`
      : `Set ${ordinal + 1} of ${nonWarmups.length}${schemeRole ? ` · ${schemeRole}` : ''}`;

  const ready = weight !== null && reps !== null && reps > 0;
  // "102.5 × 6" on the button, as the draft has it; "102.5kg × 6" when read out.
  const logged = ready ? `${weight > 0 ? formatNumber(weight) : 'BW'} × ${reps}` : null;
  const spoken = ready ? formatLogged(weight, reps) : null;

  // The rest screen says what comes next; this is it until Done moves on.
  const upNext = `${superset ? `${exerciseName}, ${name.toLowerCase()}` : name}${logged ? ` · ${logged}` : ''}`;
  useEffect(() => {
    setUpNext(upNext);
  }, [setUpNext, upNext]);

  const stepWeight = (direction: 1 | -1) => {
    const now = stepFrom(weight ?? 0, entry.loading);
    const delta = direction > 0 ? now.up : now.down;
    if (delta === null) return;
    const next = Math.max(0, Math.round((now.base + direction * delta) * 100) / 100);
    setWeightText(formatNumber(next));
    void run(() => updateSet(set.id, { weight_kg: next }));
  };

  const stepReps = (direction: 1 | -1) => {
    const next = Math.max(0, (reps ?? 0) + direction);
    setRepsText(String(next));
    void run(() => updateSet(set.id, { reps: next }));
  };

  const commitWeight = () => {
    const value = parseEntry(weightText) ?? 0;
    if (value !== set.weight_kg) void run(() => updateSet(set.id, { weight_kg: value }));
  };
  const commitReps = () => {
    const value = Math.round(parseEntry(repsText) ?? 0);
    if (value !== set.reps) void run(() => updateSet(set.id, { reps: value }));
  };

  const handleDone = async () => {
    if (weight === null) {
      onToast('Add the weight first.');
      weightInput.current?.focus();
      return;
    }
    if (reps === null || reps <= 0) {
      onToast('Add the reps first.');
      repsInput.current?.focus();
      return;
    }

    // Judged on the numbers being logged, before the write, so the sound comes
    // straight from the tap — the gesture iOS wants before it plays anything.
    const record =
      prior === undefined
        ? null
        : setBreaksRecord({ ...set, weight_kg: weight, reps, completed: true, completed_at: nowIso() }, prior, liftSets);
    const news = record ? describeRecord(record, weight, reps) : null;
    if (news) {
      if (settings?.sound_on !== false) playRecordTone();
      if (settings?.vibrate_on !== false) vibrate(RECORD_VIBRATION);
    }

    // Cleared first, so the rest never opens on the set just done as "up next".
    setUpNext(null);
    await run(() => completeSetWith(set.id, { weight_kg: weight, reps }));

    if (set.type === 'warmup') return;
    const after = stationSets.map((list) =>
      list.map((candidate) => (candidate.id === set.id ? { ...candidate, completed: true } : candidate)),
    );
    if (child) {
      // A continuation rests briefly rather than not at all — 20 seconds is the
      // technique. A drop has no gap: it ends its top set's effort, so the
      // round's rest runs now.
      const gap = CONTINUATION_REST_SECONDS[set.type];
      if (gap) rest.start(gap);
      else if (set.parent_set_id && restsAfterSet(after, memberIndex, set.parent_set_id)) rest.start(restSeconds);
      return;
    }
    if (restsAfterSet(after, memberIndex, set.id)) {
      rest.start(restSeconds, { afterSetId: set.type === 'working' ? set.id : null, record: news });
    } else if (news) {
      // The first half of a superset round goes straight on: no rest screen
      // to lead with the record, so it gets the toast.
      onToast(news.toast, 'hot');
    }
  };

  /**
   * Carries the last working set's numbers forward — and when that set is the
   * one in hand, what has been typed into it, which may not be written yet.
   * Never the placeholder: the new set gets the same suggestion as its own.
   */
  const handleAddSet = async () => {
    const last = nonWarmups.at(-1);
    const carried =
      last?.id === set.id
        ? { weight_kg: parseEntry(weightText) ?? 0, reps: Math.round(parseEntry(repsText) ?? 0) }
        : { weight_kg: last?.weight_kg ?? 0, reps: last?.reps ?? 0 };
    await run(() => addSet(entry.workoutExercise.id, carried));
  };

  const unit = equipment === 'dumbbell' || equipment === 'kettlebell' ? 'kg each' : bodyweight ? 'kg added' : 'kg';

  return (
    <>
      <p className="b-setlabel">{label}</p>

      {/* The brief: tempo is "displayed during the set". One tap spells it out. */}
      {tempo ? (
        <div className="b-plan">
          <button
            type="button"
            className="chip"
            aria-expanded={showTempo}
            onClick={() => setShowTempo((open) => !open)}
          >
            Tempo {tempo}
          </button>
          {showTempo ? <span className="text-sm text-muted">{describeTempo(tempo) ?? tempo}</span> : null}
        </div>
      ) : null}

      <div className="b-num">
        <button
          type="button"
          className="pm"
          disabled={steps.down === null}
          onClick={() => stepWeight(-1)}
          aria-label={`${name} weight down${steps.down === null ? '' : ` ${formatNumber(steps.down)} kilograms`}`}
        >
          −{formatNumber(steps.down ?? steps.up ?? 0)}
        </button>
        <label className="b-num-field">
          <input
            ref={weightInput}
            inputMode="decimal"
            autoComplete="off"
            value={weightText}
            placeholder={weightHint !== null ? formatNumber(weightHint) : bodyweight ? '0' : '–'}
            onChange={(event) => setWeightText(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitWeight}
            aria-label={`${name} weight in kilograms`}
          />
          <span className="b-unit">{unit}</span>
        </label>
        <button
          type="button"
          className="pm"
          disabled={steps.up === null}
          onClick={() => stepWeight(1)}
          aria-label={`${name} weight up${steps.up === null ? '' : ` ${formatNumber(steps.up)} kilograms`}`}
        >
          +{formatNumber(steps.up ?? 0)}
        </button>
      </div>

      <div className="b-num reps">
        <button
          type="button"
          className="pm"
          disabled={(reps ?? 0) <= 0}
          onClick={() => stepReps(-1)}
          aria-label={`${name} one rep fewer`}
        >
          −1
        </button>
        <label className="b-num-field">
          <input
            ref={repsInput}
            inputMode="numeric"
            autoComplete="off"
            value={repsText}
            placeholder={repsHint !== null ? String(repsHint) : '–'}
            onChange={(event) => setRepsText(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitReps}
            aria-label={`${name} repetitions`}
          />
          <span className="b-unit">{set.is_amrap ? 'reps · AMRAP' : 'reps'}</span>
        </label>
        <button type="button" className="pm" onClick={() => stepReps(1)} aria-label={`${name} one more rep`}>
          +1
        </button>
      </div>

      <PlateDiagram weight={weight} loading={entry.loading} equipment={equipment} />

      {/* The suggestion is the placeholder; this is the plain-language plan
          that goes with it — one line, the full reason a tap away. */}
      {hintable && suggestion ? (
        <div className="b-plan">
          <span className={`chip ${VERB_TONE[suggestion.kind] ?? ''}`}>{VERB[suggestion.kind]}</span>
          <button
            type="button"
            className={`plan-reason ${showReason ? '' : 'clamp'}`}
            aria-expanded={showReason}
            onClick={() => setShowReason((open) => !open)}
          >
            {suggestion.reason}
          </button>
        </div>
      ) : hintable && previous === null && suggestion === null ? (
        <p className="last">First time logging this one.</p>
      ) : fromTop !== null ? (
        <p className="last">
          {schemeRole}: {Math.round(SCHEME_LOAD_STEP * fromTop * 100)}% lighter than the top set,{' '}
          {SCHEME_REP_STEP * fromTop} more reps.
        </p>
      ) : null}

      {pro && set.type !== 'warmup' ? (
        <div className="rir">
          <span className="t-label">RIR</span>
          {RIR_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              // Tapping the current value again clears it: RIR is optional.
              onClick={() => void run(() => updateSet(set.id, { rir: set.rir === value ? null : value }))}
              aria-label={`${name} reps in reserve ${value}`}
              aria-pressed={set.rir === value}
            >
              {value}
            </button>
          ))}
          {/* AMRAP belongs to the set you are about to do; the reps unit says so. */}
          {!child ? (
            <button
              type="button"
              className="amrap"
              onClick={() => void run(() => updateSet(set.id, { is_amrap: !set.is_amrap }))}
              aria-label={`${name} as many reps as possible`}
              aria-pressed={set.is_amrap}
            >
              AMRAP
            </button>
          ) : null}
        </div>
      ) : null}

      {previous ? (
        <p className="last">
          Last time · {formatDayLabel(previous.performed_at)} ·{' '}
          {previous.working_sets.map((logged) => formatSetSummary(logged)).join(', ')}
        </p>
      ) : null}

      <button type="button" className="add-set" onClick={() => void handleAddSet()}>
        Add set
      </button>

      <div className="donebar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleDone()}
          aria-label={`Mark ${name.toLowerCase()} done${spoken ? `, ${spoken}` : ''}`}
        >
          {logged ? `Done · ${logged}` : 'Done'}
        </button>
      </div>
    </>
  );
}
