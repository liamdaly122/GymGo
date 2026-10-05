import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useExercise, useExerciseLoading, useExerciseRecords, useExerciseTrend, useSettings } from '@/db/queries';
import { updateExercise } from '@/db/mutations';
import { BackLink, Button, Pill, Screen, ScreenHeader, SectionLabel, Segmented } from '@/components/ui';
import { estimate1RMRounded, loadablePercentageTable } from '@/domain/epley';
import { incrementFor } from '@/domain/progression';
import { formatDayLabel, formatShortDate } from '@/lib/dates';
import { LiftChart, type LiftPoint } from '@/features/progress/charts';
import { EQUIPMENT_LABELS, PATTERN_LABELS } from './labels';

/**
 * One lift: its chart, its records, and the setup notes you read mid-set.
 *
 * The chart plots the heaviest top working set per session, or the estimated
 * 1-rep max in Pro — the brief lists estimated 1RM under Pro. Either way it
 * comes from top working sets only, so a drop set can never drag it down.
 */
export default function ExerciseDetailScreen() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();
  const exercise = useExercise(exerciseId);
  const stats = useExerciseRecords(exerciseId);
  const trend = useExerciseTrend(exerciseId);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const loading = useExerciseLoading(exerciseId);
  const [maxText, setMaxText] = useState('');
  // Null until tapped: open in Pro, folded away in Beginner.
  const [tableOpen, setTableOpen] = useState<boolean | null>(null);

  if (exercise === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }
  if (!exercise) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/exercises')}>Back to library</Button>
      </Screen>
    );
  }

  const notes = notesDraft ?? exercise.setup_notes ?? '';
  const records = stats?.records;
  const points: LiftPoint[] = (trend ?? []).map((point) => ({
    date: point.date,
    label: formatShortDate(point.date).replace(/^\w+ /, ''),
    value: pro ? point.e1rm : point.topWeight,
    detail: `${formatShortDate(point.date)}${pro ? ` · top set ${point.topWeight}kg` : ''}`,
  }));
  const change = points.length > 1 ? Math.round((points.at(-1)!.value - points[0]!.value) * 10) / 10 : 0;

  // The table works off the max you type, else your best estimate.
  const typedMax = Number.parseFloat(maxText.replace(',', '.'));
  const estimatedMax = records?.bestE1rm ? Math.round(records.bestE1rm.value * 10) / 10 : null;
  const max = Number.isFinite(typedMax) && typedMax > 0 ? typedMax : estimatedMax;
  const percentages = max !== null && loading ? loadablePercentageTable(max, loading) : [];
  const tableShown = tableOpen ?? pro;

  return (
    <Screen>
      <BackLink to="/progress/lifts">Lifts</BackLink>
      <ScreenHeader
        title={exercise.name}
        label={
          <span className="first-letter:uppercase">
            {exercise.primary_muscle} · {EQUIPMENT_LABELS[exercise.equipment]}
          </span>
        }
      />

      <div className="stack">
        <section className="card" aria-labelledby="lift-chart">
          <div className="card-head">
            <h2 className="t-section" id="lift-chart" style={{ margin: 0 }}>
              {pro ? 'Estimated 1-rep max, kg' : 'Top set, kg'}
            </h2>
            {points.length > 1 ? (
              <span className="t-meta">
                {change >= 0 ? '+' : ''}
                {change} kg in {points.length} sessions
              </span>
            ) : null}
          </div>
          {points.length >= 2 ? (
            <>
              <LiftChart points={points} unit="kg" />
              <details className="tbl">
                <summary>Show as a table</summary>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Top set</th>
                        <th>Est. 1RM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(trend ?? [])].reverse().map((point) => (
                        <tr key={point.performed_at}>
                          <td>{formatShortDate(point.date)}</td>
                          <td>{point.topWeight}kg</td>
                          <td>{point.e1rm}kg</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <p className="t-meta">Log this exercise twice and its chart will appear.</p>
          )}
        </section>

        <section aria-labelledby="records">
          <SectionLabel id="records">Records</SectionLabel>
          {stats === undefined ? null : !records?.heaviest ? (
            <p className="t-meta">No completed sets yet.</p>
          ) : (
            <div>
              <div className="pr-row">
                <span className="pr-badge">PR</span>
                <span className="list-main">
                  <span className="font-semibold">
                    Heaviest set · {records.heaviest.weight_kg}kg × {records.heaviest.reps}
                  </span>
                  <span className="t-meta">
                    {formatDayLabel(records.heaviest.completed_at ?? records.heaviest.created_at)}
                  </span>
                </span>
              </div>
              {pro && records.bestE1rm ? (
                <div className="pr-row">
                  <span className="pr-badge">1RM</span>
                  <span className="list-main">
                    <span className="font-semibold">
                      Best estimate ·{' '}
                      {estimate1RMRounded(records.bestE1rm.set.weight_kg, records.bestE1rm.set.reps)}kg
                    </span>
                    <span className="t-meta">
                      from {records.bestE1rm.set.weight_kg}kg × {records.bestE1rm.set.reps}
                    </span>
                  </span>
                </div>
              ) : null}
              <p className="t-meta mt-2">
                {stats?.sessionCount ?? 0} {stats?.sessionCount === 1 ? 'session' : 'sessions'}. Records
                come from top working sets only — drop sets count toward volume, never a record.
              </p>
            </div>
          )}
        </section>

        {/* The brief: "Percentage table from an estimated or entered 1RM." Every
            row rounds DOWN through the gym's plates, so each one can be loaded
            and none is heavier than its percentage. */}
        <section aria-labelledby="percentages">
          <div className="card-head">
            <SectionLabel id="percentages">Percentage table</SectionLabel>
            <button
              type="button"
              className="btn-text"
              aria-expanded={tableShown}
              aria-controls="percentage-rows"
              onClick={() => setTableOpen(!tableShown)}
            >
              {tableShown ? 'Hide' : 'Show'}
            </button>
          </div>
          {tableShown ? (
            <div id="percentage-rows" className="stack-sm">
              <input
                type="text"
                inputMode="decimal"
                value={maxText}
                onChange={(event) => setMaxText(event.target.value)}
                placeholder={estimatedMax !== null ? String(estimatedMax) : '1-rep max, kg'}
                aria-label="Your max in kilograms"
                className="field h-12 text-center"
              />
              <p className="t-meta">
                {Number.isFinite(typedMax) && typedMax > 0
                  ? `From the max you typed, ${typedMax} kg.`
                  : estimatedMax !== null
                    ? `From your best estimated max, ${estimatedMax} kg. Type your own to use that instead.`
                    : 'Type a max to see the table. Once you have logged this lift, your best estimate fills in.'}
              </p>
              {percentages.length > 0 ? (
                <div className="tbl-wrap">
                  <table aria-label={`Percentages of ${max} kilograms`}>
                    <thead>
                      <tr>
                        <th>Percent</th>
                        <th>Load</th>
                      </tr>
                    </thead>
                    <tbody>
                      {percentages.map((row) => (
                        <tr key={row.percent}>
                          <td>{row.percent}%</td>
                          <td>{row.weight_kg} kg</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className="t-meta">Each load is rounded down to what {exercise.equipment === 'barbell' || exercise.equipment === 'ez_bar' ? 'your plates make' : 'the equipment steps in'}.</p>
            </div>
          ) : null}
        </section>

        {/* The brief: increments are "configurable per exercise". Auto is the
            brief's default for the lift; a coarse machine or a home rack can
            need something else, and the suggestion engine already reads this. */}
        <section aria-labelledby="weight-step">
          <SectionLabel id="weight-step">Weight step</SectionLabel>
          <Segmented<number>
            label="Weight step"
            options={[0, 1, 1.25, 2, 2.5, 5].map((step) => ({ value: step, label: step === 0 ? 'Auto' : `${step}` }))}
            value={exercise.increment_kg ?? 0}
            onChange={(step) => void updateExercise(exercise.id, { increment_kg: step === 0 ? null : step })}
          />
          <p className="t-meta mt-2">
            How far a suggestion goes up when you have hit the top of the rep range.{' '}
            {exercise.increment_kg === null
              ? `Auto is ${incrementFor({ ...exercise, increment_kg: null })} kg for this lift.`
              : `Set to ${exercise.increment_kg} kg.`}
          </p>
        </section>

        {/* The small feature that saves the most time in practice: seat height,
            pin position, which bar. Shown again during the set. */}
        <section aria-labelledby="setup-notes">
          <SectionLabel id="setup-notes">Setup notes</SectionLabel>
          <textarea
            value={notes}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={() => {
              if (notesDraft === null) return;
              const trimmed = notesDraft.trim();
              void updateExercise(exercise.id, { setup_notes: trimmed === '' ? null : trimmed });
              setNotesDraft(null);
            }}
            rows={2}
            placeholder="Seat height, pin position, grip width, which bar…"
            aria-label="Setup notes"
            className="field h-auto resize-none py-3"
          />
          <p className="t-meta mt-1">Shown while you are logging this exercise.</p>
        </section>

        <section aria-labelledby="about">
          <SectionLabel id="about">About</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="accent">{PATTERN_LABELS[exercise.movement_pattern]}</Pill>
            <Pill>{EQUIPMENT_LABELS[exercise.equipment]}</Pill>
            <Pill>{exercise.is_compound ? 'Compound' : 'Isolation'}</Pill>
            {exercise.is_unilateral ? <Pill>Unilateral</Pill> : null}
            {exercise.is_custom ? <Pill>Custom</Pill> : null}
          </div>
          {exercise.secondary_muscles.length > 0 ? (
            <p className="t-meta mt-2 first-letter:uppercase">Also works: {exercise.secondary_muscles.join(', ')}</p>
          ) : null}
          {exercise.demo_url ? (
            <a href={exercise.demo_url} target="_blank" rel="noreferrer noopener" className="btn-text hot inline-flex items-center">
              View demonstration ↗
            </a>
          ) : null}
        </section>
      </div>
    </Screen>
  );
}
