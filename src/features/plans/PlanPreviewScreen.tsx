import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDefaultGym, useExercises, useSettings } from '@/db/queries';
import { createRoutinesFromPlan } from '@/db/mutations';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import { findGoal } from '@/domain/programmes/goals';
import { assessPlan, buildPlan, weeklySetsPerMuscle } from '@/domain/programmes/plan';
import type { SplitId } from '@/domain/programmes/splits';
import type { TrainingGoalId } from '@/domain/programmes/goals';

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
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }

  if (!goal || !built) {
    return (
      <Screen>
        <ScreenTitle>Not available</ScreenTitle>
        <p className="mb-4 text-sm text-muted">That combination does not divide into a week.</p>
        <Button onClick={() => void navigate('/plans')}>Back to plans</Button>
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
      void navigate('/routines');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Link to={`/plans/${goal.id}`} className="mb-3 inline-block text-xs text-muted">
        ← {goal.label}
      </Link>
      <ScreenTitle>{plan.split.label}</ScreenTitle>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Pill tone="accent">{plan.days} days a week</Pill>
        <Pill>{goal.label}</Pill>
        {gym ? <Pill>{gym.name}</Pill> : null}
      </div>

      {!viability.viable && viability.reason ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-xs text-amber-400">{viability.reason}</p>
        </Card>
      ) : null}

      {plan.unfilledCount > 0 && viability.viable ? (
        <Card className="mb-4 p-4">
          <p className="text-xs text-muted">
            {plan.unfilledCount} slot{plan.unfilledCount === 1 ? '' : 's'} left empty — your gym has
            no equipment for {plan.unfilledCount === 1 ? 'it' : 'them'}. The rest of the plan is
            unaffected.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Weekly sets per muscle</h2>
        <ul className="flex flex-wrap gap-1.5">
          {topMuscles.map(([muscle, sets]) => (
            <li key={muscle}>
              <Pill>
                <span className="first-letter:uppercase">{muscle}</span>
                <span className="ml-1.5 tabular-nums text-white">{sets}</span>
              </Pill>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">
          {goal.profile === 'hypertrophy'
            ? 'Muscle growth wants 10 to 20 hard sets a week per muscle.'
            : goal.profile === 'strength'
              ? 'Strength work sits lower, around 8 to 12 sets on the main lifts.'
              : 'General fitness sits around 8 to 12 sets a week per muscle.'}
        </p>
      </Card>

      <ul className="space-y-3">
        {plan.sessions.map((session) => (
          <li key={`${session.templateId}-${session.dayIndex}`}>
            <Card className="p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium text-white">
                  Day {session.dayIndex + 1} · {session.name}
                </h2>
                <span className="shrink-0 text-xs text-muted">
                  {session.exercises.length} exercises
                </span>
              </div>
              <ul className="space-y-1.5">
                {session.exercises.map((entry) => (
                  <li key={entry.exercise.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-white">
                      {entry.exercise.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {entry.prescription.sets} × {entry.prescription.repLow}–
                      {entry.prescription.repHigh}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-2">
        <Button
          variant="primary"
          className="h-14 text-base"
          disabled={saving}
          onClick={() => void handleUse()}
        >
          {saving ? 'Building routines…' : `Use this plan (${plan.days} routines)`}
        </Button>
        <Button onClick={() => setSeed((current) => current + 1)}>
          Shuffle the exercises
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        This saves {plan.days} ordinary routines you can edit like any other. Weights are left for
        you to set on the first session
        {settings?.mode === 'beginner' ? ', and the app suggests them from then on' : ''}.
      </p>
    </Screen>
  );
}
