import { useNavigate, useParams } from 'react-router-dom';
import { useExercise, useExerciseLoading, useExerciseRecords, useExerciseTrend, useSettings } from '@/db/queries';
import { updateExercise } from '@/db/mutations';
import { BackLink, Button, Pill, Screen, ScreenHeader, SectionLabel, Segmented } from '@/components/ui';
import { incrementFor } from '@/domain/progression';
import { formatShortDate } from '@/lib/dates';
import { LiftChart, type LiftPoint } from '@/features/progress/charts';
import { EQUIPMENT_LABELS, PATTERN_LABELS } from './labels';
import LiftRecords from './LiftRecords';
import PercentageTable, { tableMax } from './PercentageTable';
import SetupNotesField from './SetupNotesField';

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
  const loading = useExerciseLoading(exerciseId);

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

  const records = stats?.records;
  const points: LiftPoint[] = (trend ?? []).map((point) => ({
    date: point.date,
    label: formatShortDate(point.date).replace(/^\w+ /, ''),
    value: pro ? point.e1rm : point.topWeight,
    detail: `${formatShortDate(point.date)}${pro ? ` · top set ${point.topWeight}kg` : ''}`,
  }));
  const change = points.length > 1 ? Math.round((points.at(-1)!.value - points[0]!.value) * 10) / 10 : 0;

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
              <LiftRecords records={records} pro={pro} />
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
        <PercentageTable
          estimatedMax={tableMax(records?.bestE1rm)}
          loading={loading}
          equipment={exercise.equipment}
          pro={pro}
        />

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
          <SetupNotesField exercise={exercise} label="Setup notes" />
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
