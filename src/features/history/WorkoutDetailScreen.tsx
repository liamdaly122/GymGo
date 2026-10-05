import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSessionSummary, useSettings, useWorkoutName } from '@/db/queries';
import { BackLink, Button, Screen, ScreenHeader, SectionLabel, Stat } from '@/components/ui';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { estimate1RMRounded } from '@/domain/epley';
import { isChildSet } from '@/domain/sets';
import { MuscleBars } from '@/features/progress/charts';
import SessionRewards from '@/features/rewards/SessionRewards';
import { formatLogged } from '@/features/workout/setNames';

/** What each kind of record wears: a heavier set, a better estimated max, more reps with nothing added. */
const PR_BADGE = { weight: 'PR', e1rm: '1RM', reps: 'REPS' } as const;

/**
 * One finished session — and, straight after Finish, the summary.
 *
 * The same screen either way, so the summary you see in the gym is the record
 * you find later. It reads "Done." only on the way out of a workout.
 */
export default function WorkoutDetailScreen() {
  const { workoutId } = useParams<{ workoutId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const fresh = Boolean((location.state as { fresh?: boolean } | null)?.fresh);
  const data = useSessionSummary(workoutId);
  const name = useWorkoutName(workoutId);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';

  if (data === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }
  if (data === null) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/progress')}>Back to history</Button>
      </Screen>
    );
  }

  const { view, summary } = data;
  const inProgress = view.workout.finished_at === null;
  const when = formatDayLabel(view.workout.started_at);

  return (
    <Screen>
      {fresh ? null : <BackLink to="/progress">Sessions</BackLink>}
      <ScreenHeader title={fresh ? 'Done.' : (name ?? 'Workout')} label={`${when} · ${name ?? 'Workout'}`} />

      <div className="stack">
        {inProgress ? (
          <div className="stack-sm">
            <p className="t-meta">This session is still in progress.</p>
            <Button variant="primary" block onClick={() => void navigate(`/workout/${view.workout.id}`)}>
              Resume
            </Button>
          </div>
        ) : null}

        <div className="stats">
          <Stat label="Duration" value={summary.duration_ms === null ? '—' : formatDuration(summary.duration_ms)} />
          <Stat label="Volume" value={Math.round(summary.tonnage_kg).toLocaleString('en-GB')} unit="kg" />
          <Stat label="Sets" value={summary.set_count} />
        </div>

        {summary.comparison ? (
          <p className="compare">
            Against the last run of this routine ({formatDayLabel(summary.comparison.performed_at).toLowerCase()}):{' '}
            <strong>
              {summary.comparison.tonnage_delta_kg === 0
                ? 'same volume'
                : `${summary.comparison.tonnage_delta_kg > 0 ? '+' : ''}${Math.round(
                    summary.comparison.tonnage_delta_kg,
                  ).toLocaleString('en-GB')} kg`}
            </strong>
            {summary.comparison.set_delta !== 0
              ? `, ${summary.comparison.set_delta > 0 ? '+' : ''}${summary.comparison.set_delta} sets`
              : ''}
            .
          </p>
        ) : null}

        <SessionRewards workoutId={view.workout.id} fresh={fresh} />

        {summary.prs.length > 0 ? (
          <section aria-labelledby="records">
            <SectionLabel id="records">{summary.prs.length === 1 ? 'Personal record' : 'Personal records'}</SectionLabel>
            <div>
              {summary.prs.map((pr, index) => (
                <div key={`${pr.set.id}-${pr.kind}-${index}`} className="pr-row">
                  <span className="pr-badge">{pr.previous === null ? 'NEW' : PR_BADGE[pr.kind]}</span>
                  <span className="list-main">
                    <span className="font-semibold">{pr.exercise_name}</span>
                    <span className="t-meta">
                      {pr.kind === 'weight'
                        ? `${pr.value}kg × ${pr.set.reps}`
                        : pr.kind === 'reps'
                          ? `${pr.value} reps`
                          : `${estimate1RMRounded(pr.set.weight_kg, pr.set.reps)}kg estimated 1RM`}
                      {pr.previous === null
                        ? ' (first time)'
                        : pr.kind === 'reps'
                          ? ` (was ${pr.previous})`
                          : ` (was ${pr.kind === 'weight' ? pr.previous : Math.round(pr.previous * 10) / 10}kg)`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {pro && summary.sets_per_muscle.length > 0 ? (
          <section className="card" aria-labelledby="per-muscle">
            <h2 className="t-section" id="per-muscle" style={{ margin: 0 }}>
              Sets per muscle group
            </h2>
            <MuscleBars data={summary.sets_per_muscle} idPrefix="sbar" />
            <p className="t-meta">A set credits its primary muscle in full and each secondary at a half.</p>
          </section>
        ) : null}

        <section aria-labelledby="exercises">
          <SectionLabel id="exercises">Exercises</SectionLabel>
          <div>
            {view.exercises.map((entry) => {
              const done = entry.sets.filter((set) => set.completed);
              return (
                <div key={entry.workoutExercise.id} className="summary-ex">
                  {entry.exercise ? (
                    <Link to={`/exercises/${entry.exercise.id}`} className="font-semibold">
                      {entry.exercise.name}
                    </Link>
                  ) : (
                    <span className="text-muted">Unknown exercise</span>
                  )}
                  <ul className="ex-sets">
                    {done.map((set) => (
                      <li key={set.id} className={set.type === 'warmup' || isChildSet(set) ? 'text-muted' : ''}>
                        {set.type === 'warmup' ? 'W ' : isChildSet(set) ? '↳ ' : ''}
                        {formatLogged(set.weight_kg, set.reps)}
                        {isChildSet(set) ? ` ${set.type.replace('_', '-')}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {view.workout.notes ? (
          <section aria-labelledby="notes">
            <SectionLabel id="notes">Notes</SectionLabel>
            <p>{view.workout.notes}</p>
          </section>
        ) : null}

        {fresh ? (
          <Button variant="primary" size="lg" block onClick={() => void navigate('/', { replace: true })}>
            Done
          </Button>
        ) : null}
      </div>
    </Screen>
  );
}
