import { useState } from 'react';
import type { WorkoutExerciseView } from '@/db/queries';
import { usePreviousPerformance, useSetSuggestion, useSettings } from '@/db/queries';
import { addSet, updateSet } from '@/db/mutations';
import { setOrdinals } from '@/domain/sets';
import { loadableWeight, nextLoadableAbove, nextLoadableBelow, type LoadingProfile } from '@/domain/plates';
import { formatDayLabel } from '@/lib/dates';
import { formatSetSummary } from '@/domain/previousPerformance';
import SetRow from './SetRow';
import ExerciseSheet from './ExerciseSheet';

/**
 * One exercise, expanded, with nothing else competing for the screen.
 *
 * What this replaced rendered a photo, a name, Swap, Remove, a setup-notes
 * paragraph, a "Suggested" card with its own reason paragraph and filled Use
 * button, a separate "Last time" card with a second Use button, column
 * headers, a warm-up button, the set rows, a plate line, four adjusters, and —
 * in Pro — an RIR row per set, three attachment chips per completed set, a
 * superset toggle and two reorder buttons. At 390px that card was 703px tall
 * against a 620px window, so a complete exercise never fit on screen at all.
 *
 * The rule now: at most one border between you and the background. The body
 * sits directly on the ground colour, and the only bordered things are the
 * fields, the tick and the sheet.
 */
export default function ExercisePanel({
  entry,
  workoutId,
  restsAfter,
  supersetLabel,
  canPairWithNext,
  canMoveUp,
  canMoveDown,
  activeSetId,
}: {
  entry: WorkoutExerciseView;
  workoutId: string;
  restsAfter?: boolean;
  supersetLabel?: string | null;
  canPairWithNext?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** Resolved once for the whole session, so only one row carries the tools. */
  activeSetId: string | null;
}) {
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const suggestion = useSetSuggestion(workoutId, entry.exercise?.id);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';

  const [sheetOpen, setSheetOpen] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const workingSets = previous?.working_sets ?? [];
  const ordinals = setOrdinals(entry.sets);

  const restSeconds =
    entry.workoutExercise.rest_seconds ??
    entry.exercise?.default_rest_seconds ??
    settings?.default_rest_seconds ??
    120;

  const firstWorking = entry.sets.find(
    (set) => set.parent_set_id === null && set.type === 'working' && set.weight_kg > 0,
  );
  const warmupTarget =
    firstWorking?.weight_kg ?? suggestion?.weight_kg ?? previous?.top_set?.weight_kg ?? 0;

  /** Fills every unlogged set with the suggestion. The one Use, not two. */
  const applySuggestion = async () => {
    if (!suggestion) return;
    const targets = entry.sets.filter(
      (set) => !set.completed && set.parent_set_id === null && set.type !== 'warmup',
    );
    for (const set of targets) {
      await updateSet(set.id, { weight_kg: suggestion.weight_kg, reps: suggestion.reps });
    }
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Two lines, not one: truncating "Barbell Bench Press - Medium Grip"
              throws away the half that says which bench press it is. */}
          <h1 className="line-clamp-2 text-title font-semibold leading-tight text-white">
            {entry.exercise?.name ?? 'Unknown exercise'}
          </h1>
          <p className="mt-0.5 truncate text-meta text-muted first-letter:uppercase">
            {supersetLabel ? (
              <span className="mr-1.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {supersetLabel}
              </span>
            ) : null}
            {entry.exercise?.primary_muscle}
          </p>
        </div>

        <button
          onClick={() => setSheetOpen(true)}
          aria-label={`More for ${entry.exercise?.name ?? 'this exercise'}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted active:bg-raised"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="16" cy="10" r="1.6" />
          </svg>
        </button>
      </div>

      {/* One quiet line, not a card with its own Use button. */}
      {previous ? (
        <p className="mt-2 truncate text-meta tabular-nums text-muted">
          Last time · {formatDayLabel(previous.performed_at)} ·{' '}
          {workingSets.map((set) => formatSetSummary(set)).join(', ')}
        </p>
      ) : null}

      {/* Setup notes are read once per exercise, not once per set. */}
      {entry.exercise?.setup_notes ? (
        <button
          onClick={() => setShowNotes((open) => !open)}
          aria-expanded={showNotes}
          className={`mt-2 block w-full text-left text-note text-muted ${showNotes ? '' : 'truncate'}`}
        >
          {entry.exercise.setup_notes}
        </button>
      ) : null}

      <ul className="mt-5 divide-y divide-line border-t border-line">
        {entry.sets.map((set) => {
          const ordinal = ordinals.get(set.id);
          const lastTime = ordinal === undefined ? undefined : workingSets[ordinal];
          const hintable = set.parent_set_id === null && set.type !== 'warmup';
          const weightHint = suggestion?.weight_kg ?? lastTime?.weight_kg;
          const repsHint = suggestion?.reps ?? lastTime?.reps;

          return (
            <li key={set.id}>
              <SetRow
                set={set}
                index={ordinal ?? 0}
                {...(hintable && weightHint !== undefined ? { weightHint } : {})}
                {...(hintable && repsHint !== undefined ? { repsHint } : {})}
                restSeconds={restsAfter === false ? 0 : restSeconds}
                pro={pro}
                loading={entry.loading}
                showTools={set.id === activeSetId}
                /*
                 * The steppers move the number you can see, and on an empty row
                 * that is the placeholder. Stepping from zero offered "+ 20" —
                 * the bare bar — beside a suggested 102.5kg, so one tap threw
                 * the suggestion away and called it an adjustment.
                 */
                weightStep={weightStep(
                  set.weight_kg > 0 ? set.weight_kg : (hintable && weightHint) || 0,
                  entry.loading,
                )}
                repsBase={set.reps > 0 ? set.reps : (hintable && repsHint) || 0}
              />
            </li>
          );
        })}
      </ul>

      {/* The suggestion is a placeholder in the row, per the brief. This is the
          plain-language plan that goes with it — one line, with the full reason
          a tap away rather than three lines of prose on every card. */}
      {suggestion ? (
        <div className="mt-2 flex items-start gap-2">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
              suggestion.kind === 'estimate'
                ? 'bg-info/15 text-info'
                : suggestion.kind === 'deload'
                  ? 'bg-warn/15 text-warn'
                  : 'bg-accent/15 text-accent'
            }`}
          >
            {VERB[suggestion.kind]}
          </span>
          <button
            onClick={() => setShowReason((open) => !open)}
            aria-expanded={showReason}
            className={`min-w-0 flex-1 text-left text-note leading-snug text-muted ${
              showReason ? '' : 'line-clamp-1'
            }`}
          >
            {suggestion.reason}
          </button>
          <button
            onClick={() => void applySuggestion()}
            className="-my-2 shrink-0 px-2 py-2 text-note text-accent active:opacity-60"
          >
            Use
          </button>
        </div>
      ) : previous === null ? (
        <p className="mt-2 text-note text-muted">First time logging this one.</p>
      ) : null}

      <button
        onClick={() => void handleAddSet(entry)}
        className="mt-5 grid min-h-11 w-full place-items-center rounded-xl border border-line bg-raised text-meta text-white active:bg-line"
      >
        Add set
      </button>

      {sheetOpen ? (
        <ExerciseSheet
          entry={entry}
          workoutId={workoutId}
          warmupTarget={warmupTarget}
          canMoveUp={canMoveUp ?? false}
          canMoveDown={canMoveDown ?? false}
          canPairWithNext={canPairWithNext ?? false}
          supersetted={restsAfter === false}
          pro={pro}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </section>
  );
}

/** The chip beside the plan line: what the engine wants you to do, in a word. */
const VERB: Record<string, string> = {
  add_weight: 'Go up',
  add_reps: 'More reps',
  repeat: 'Hold',
  deload: 'Back off',
  estimate: 'Estimate',
};

/** Carries the previous working set's numbers forward. */
async function handleAddSet(entry: WorkoutExerciseView) {
  const last = entry.sets
    .filter((set) => set.parent_set_id === null && set.type === 'working')
    .at(-1);
  await addSet(entry.workoutExercise.id, {
    weight_kg: last?.weight_kg ?? 0,
    reps: last?.reps ?? 0,
  });
}

/**
 * How far one tap moves the weight, in the equipment's own increments.
 *
 * From an empty field the first tap gives the smallest thing you can pick up —
 * the bare bar, or one plate on a stack. A step with nowhere to go is not
 * offered: there is nothing lighter than an empty bar.
 */
function weightStep(
  weight: number,
  loading: LoadingProfile,
): { up: number | null; down: number | null; base: number } {
  if (weight <= 0) {
    return { up: round2(loadableWeight(0.1, loading)), down: null, base: 0 };
  }

  const up = round2(nextLoadableAbove(weight, loading) - weight);
  const down = round2(weight - nextLoadableBelow(weight, loading));
  return { up: up > 0 ? up : null, down: down > 0 ? down : null, base: weight };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
