import { useState, type ReactNode } from 'react';
import type { WorkoutExerciseView } from '@/db/queries';
import { useExerciseRecords, usePreviousPerformance, useSetSuggestion } from '@/db/queries';
import ExerciseImage from '@/components/ExerciseImage';
import { Icon } from '@/components/icons';
import { formatSetSummary } from '@/domain/previousPerformance';
import { SCHEME_LOAD_STEP, SCHEME_REP_STEP } from '@/domain/schemes';
import { setOrdinals } from '@/domain/sets';
import { formatClock, formatDayLabel } from '@/lib/dates';
import LiftRecords from '@/features/exercises/LiftRecords';
import PercentageTable, { tableMax } from '@/features/exercises/PercentageTable';
import SetupNotesField from '@/features/exercises/SetupNotesField';
import { EQUIPMENT_LABELS } from '@/features/exercises/labels';
import PlateDiagram from './PlateDiagram';
import { setPlan, VERB, VERB_TONE } from './setPlan';
import { describeTempo, formatLogged, formatNumber } from './setNames';

/**
 * One exercise, while the watch logs it: everything about it except the
 * controls for logging, which are on the wrist.
 *
 * What the watch will log comes first, worked out by the same rules as the
 * phone's own set in hand (`setPlan`), so the two always agree: the numbers,
 * which set it is, the plan behind them and last time. Then what helps
 * between sets: the plates to load, the tempo, the setup notes (the first
 * place a workout ever showed them), the sets so far, and, a tap away, the
 * records and the percentage table.
 */
export default function ExerciseInfo({
  entry,
  targetSetId,
  workoutId,
  pro,
  restSeconds,
  chips,
  onMore,
}: {
  entry: WorkoutExerciseView;
  /** The set this exercise does next: the watch's set in hand, or its next unticked one. */
  targetSetId: string | null;
  workoutId: string;
  pro: boolean;
  restSeconds: number;
  /** Its sets, as chips that open each one. */
  chips: ReactNode;
  onMore: () => void;
}) {
  const exercise = entry.exercise;
  const name = exercise?.name ?? 'Exercise';
  const suggestion = useSetSuggestion(workoutId, exercise?.id);
  const previous = usePreviousPerformance(exercise?.id, workoutId);
  const stats = useExerciseRecords(exercise?.id);
  const [showReason, setShowReason] = useState(false);
  const [showTempo, setShowTempo] = useState(false);
  // Null until tapped: open in Pro, folded away in Beginner, as on the lift's own screen.
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);

  const set = targetSetId ? entry.sets.find((candidate) => candidate.id === targetSetId) : undefined;
  const ordinal = set ? (setOrdinals(entry.sets).get(set.id) ?? 0) : 0;
  const plan = set ? setPlan(entry, set, ordinal, suggestion, previous) : null;
  const bodyweight = exercise?.equipment === 'bodyweight';

  // What the watch shows: what was typed into the set, else its placeholder.
  const weight = set && plan ? (set.weight_kg > 0 ? set.weight_kg : (plan.weightHint ?? (bodyweight ? 0 : null))) : null;
  const reps = set && plan ? (set.reps > 0 ? set.reps : plan.repsHint) : null;

  const muscles = [
    exercise?.primary_muscle,
    exercise && exercise.secondary_muscles.length > 0 ? `also ${exercise.secondary_muscles.join(', ')}` : null,
  ].filter(Boolean);
  const range = entry.repRange
    ? entry.repRange.low === entry.repRange.high
      ? `${entry.repRange.low} reps`
      : `${entry.repRange.low}–${entry.repRange.high} reps`
    : null;
  const kit = [
    exercise && exercise.equipment !== 'other' ? EQUIPMENT_LABELS[exercise.equipment] : null,
    range,
    `rest ${formatClock(restSeconds * 1000)}`,
  ].filter(Boolean);
  const tempo = entry.workoutExercise.tempo;
  const shown = detailsOpen ?? pro;
  const records = stats?.records;

  return (
    <section className="b-ex" aria-label={name}>
      <div className="ex-head">
        {exercise ? (
          <ExerciseImage
            sourceId={exercise.source_id}
            muscle={exercise.primary_muscle}
            name={exercise.name}
            className="h-16 w-16 shrink-0"
          />
        ) : null}
        <div className="ex-headtxt">
          <h3 className="b-title">{name}</h3>
          {muscles.length > 0 ? <p className="t-meta first-letter:uppercase">{muscles.join(' · ')}</p> : null}
          <p className="t-meta">{kit.join(' · ')}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onMore} aria-label={`More for ${name}`}>
          <Icon name="more" />
        </button>
      </div>

      {set && plan ? (
        <div>
          <p className="b-setlabel">{plan.label}</p>
          <p className="m-0 font-display text-[3.75rem] leading-none font-extrabold tabular-nums">
            <span aria-hidden="true">
              {weight === null ? '–' : weight > 0 ? formatNumber(weight) : 'BW'} × {reps ?? '–'}
            </span>
            <span className="sr-only">
              {weight !== null && reps !== null ? formatLogged(weight, reps) : 'No numbers yet'}
            </span>
          </p>
        </div>
      ) : (
        <p className="b-setlabel">All sets done</p>
      )}

      {/* The plan behind the numbers, one line, the full reason a tap away. */}
      {plan?.hintable && suggestion ? (
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
      ) : plan?.hintable && previous === null && suggestion === null ? (
        <p className="last">First time logging this one.</p>
      ) : plan && plan.fromTop !== null ? (
        <p className="last">
          {plan.schemeRole}: {Math.round(SCHEME_LOAD_STEP * plan.fromTop * 100)}% lighter than the top set,{' '}
          {SCHEME_REP_STEP * plan.fromTop} more reps.
        </p>
      ) : null}

      {previous ? (
        <p className="last">
          Last time · {formatDayLabel(previous.performed_at)} ·{' '}
          {previous.working_sets.map((logged) => formatSetSummary(logged)).join(', ')}
        </p>
      ) : null}

      {set ? <PlateDiagram weight={weight} loading={entry.loading} equipment={exercise?.equipment} /> : null}

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

      {chips}

      {exercise ? (
        <div className="stack-sm">
          <p className="t-label">Setup notes</p>
          <SetupNotesField exercise={exercise} label={`Setup notes for ${name}`} />
        </div>
      ) : null}

      {exercise ? (
        <div className="stack-sm">
          <button
            type="button"
            className="btn-text inline-flex items-center gap-1 self-start"
            aria-expanded={shown}
            onClick={() => setDetailsOpen(!shown)}
          >
            Details<span className="sr-only"> for {name}</span>
            <Icon name="chev" className={`h-4 w-4 transition-transform ${shown ? '-rotate-90' : 'rotate-90'}`} />
          </button>
          {shown ? (
            <div className="stack-sm">
              <div>
                <p className="t-label">Records</p>
                {stats === undefined ? null : records?.heaviest ? (
                  <LiftRecords records={records} pro={pro} />
                ) : (
                  <p className="t-meta">No completed sets yet.</p>
                )}
              </div>
              <PercentageTable
                estimatedMax={tableMax(records?.bestE1rm)}
                loading={entry.loading}
                equipment={exercise.equipment}
                pro={pro}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
