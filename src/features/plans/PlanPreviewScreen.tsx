import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDefaultGym, useExercises, useSettings } from '@/db/queries';
import { createRoutinesFromPlan } from '@/db/mutations';
import { BackLink, Button, Pill, Screen, ScreenHeader, SectionLabel } from '@/components/ui';
import { findGoal } from '@/domain/programmes/goals';
import { assessPlan, buildPlan, weeklySetsPerMuscle } from '@/domain/programmes/plan';
import type { SplitId } from '@/domain/programmes/splits';
import type { TrainingGoalId } from '@/domain/programmes/goals';
import BuilderSteps from './BuilderSteps';

/**
 * The whole week, before you commit to it.
 *
 * Everything shown here is exactly what gets written: the same exercises, sets,
 * rep ranges and rests. Nothing is decided later, so what you approve is what
 * you train.
 */
export default function PlanPreviewScreen() {
  const { goalId, splitId } = useParams<{ goalId: string; splitId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const exercises = useExercises();
  const gym = useDefaultGym();
  const settings = useSettings();
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(0);

  const days = Number.parseInt(search.get('days') ?? '4', 10);
  const goal = goalId ? findGoal(goalId) : undefined;

  const built = useMemo(() => {
    if (!goal || !splitId || !exercises || exercises.length === 0) return null;
    try {
      const plan = buildPlan(
        { goalId: goal.id as TrainingGoalId, splitId: splitId as SplitId, days },
        exercises,
        { equipment: gym?.equipment_available ?? null, seed },
      );
      return { plan, viability: assessPlan(plan) };
    } catch {
      return null;
    }
  }, [goal, splitId, exercises, gym, days, seed]);

  if (exercises === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }

  if (!goal || !built) {
    return (
      <Screen>
        <ScreenHeader title="Not available" />
        <p className="t-meta mb-4">That combination does not divide into a week.</p>
        <Button onClick={() => void navigate('/plan/new')}>Back to plans</Button>
      </Screen>
    );
  }

  const { plan, viability } = built;
  const direct = weeklySetsPerMuscle(plan, { includeSecondary: false });
  const topMuscles = [...direct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const handleUse = async () => {
    setSaving(true);
    try {
      await createRoutinesFromPlan(plan);
      void navigate('/plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <BackLink to={`/plan/new/${goal.id}`}>{goal.label}</BackLink>
      <BuilderSteps step={3} />
      <ScreenHeader title={plan.split.label} label={`${goal.label} · ${plan.days} days`} />

      <div className="stack">
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="accent">{plan.days} days a week</Pill>
          {gym ? <Pill>{gym.name}</Pill> : null}
        </div>

        {!viability.viable && viability.reason ? (
          <p className="rounded-md bg-surface p-4 text-sm text-warn">{viability.reason}</p>
        ) : null}

        {plan.unfilledCount > 0 && viability.viable ? (
          <p className="t-meta">
            {plan.unfilledCount} slot{plan.unfilledCount === 1 ? '' : 's'} left empty — your gym
            has no equipment for {plan.unfilledCount === 1 ? 'it' : 'them'}. The rest of the plan is
            unaffected.
          </p>
        ) : null}

        <section aria-labelledby="weekly-sets">
          <SectionLabel id="weekly-sets">Weekly sets per muscle</SectionLabel>
          <ul className="flex flex-wrap gap-1.5">
            {topMuscles.map(([muscle, sets]) => (
              <li key={muscle}>
                <Pill>
                  <span className="first-letter:uppercase">{muscle}</span>
                  <span className="ml-1.5 tabular-nums text-chalk">{sets}</span>
                </Pill>
              </li>
            ))}
          </ul>
          <p className="t-meta mt-2">
            {goal.profile === 'hypertrophy'
              ? 'Muscle growth wants 10 to 20 hard sets a week per muscle.'
              : goal.profile === 'strength'
                ? 'Strength work sits lower, around 8 to 12 sets on the main lifts.'
                : 'General fitness sits around 8 to 12 sets a week per muscle.'}
          </p>
        </section>

        {plan.sessions.map((session) => (
          <section key={`${session.templateId}-${session.dayIndex}`} className="card" aria-label={`Day ${session.dayIndex + 1}`}>
            <div className="card-head">
              <h2 className="t-h2">
                Day {session.dayIndex + 1} · {session.name}
              </h2>
              <span className="t-meta shrink-0">{session.exercises.length} exercises</span>
            </div>
            <ul className="list ex-list">
              {session.exercises.map((entry) => (
                <li key={entry.exercise.id}>
                  <span className="ex-name">
                    <span>{entry.exercise.name}</span>
                  </span>
                  <span className="ex-pres">
                    {entry.prescription.sets} × {entry.prescription.repLow}–{entry.prescription.repHigh}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="stack-sm">
          <Button variant="primary" size="lg" block disabled={saving} onClick={() => void handleUse()}>
            {saving ? 'Building routines…' : `Use this plan (${plan.days} routines)`}
          </Button>
          <Button block onClick={() => setSeed((current) => current + 1)}>
            Shuffle the exercises
          </Button>
          <p className="t-meta">
            This saves {plan.days} ordinary routines you can edit like any other. Weights are left
            for you to set on the first session
            {settings?.mode === 'beginner' ? ', and the app suggests them from then on' : ''}.
          </p>
        </div>
      </div>
    </Screen>
  );
}
