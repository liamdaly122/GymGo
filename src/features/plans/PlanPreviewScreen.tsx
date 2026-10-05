import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Exercise } from '@/db/schema';
import { useDefaultGym, useExercises, useSettings } from '@/db/queries';
import { createRoutinesFromPlan } from '@/db/mutations';
import { BackLink, Button, Pill, Screen, ScreenHeader, SectionLabel, Toggle } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Toast, useToast } from '@/components/Toast';
import { findGoal } from '@/domain/programmes/goals';
import {
  assessPlan,
  buildPlan,
  pinExercises,
  slotIndexOf,
  weeklySetsPerMuscle,
  type GeneratedPlan,
  type PlanPin,
} from '@/domain/programmes/plan';
import type { SplitId } from '@/domain/programmes/splits';
import type { TrainingGoalId } from '@/domain/programmes/goals';
import SwapPanel, { SwapOverlay, planScopeHint, type SwapScopeOption } from '@/features/swap/SwapPanel';
import { liftFamily, planSwapTargets } from '@/domain/search';
import { AVOIDABLE_LIFTS, PRIORITY_MUSCLES, tailorPlan } from '@/domain/programmes/tailor';
import { explainPick } from '@/domain/programmes/explain';
import { loadBuilderPrefs, saveBuilderPrefs, type BuilderPrefs } from '@/lib/builderPrefs';
import BuilderSteps from './BuilderSteps';
import PlanOptionsSheet from './PlanOptionsSheet';

type Scope = 'day' | 'plan';

/**
 * The whole week, before you commit to it.
 *
 * Everything shown here is exactly what gets written: the same exercises, sets,
 * rep ranges and rests. Nothing is decided later, so what you approve is what
 * you train.
 *
 * Any exercise can be swapped, on its day or across the plan, where the swap
 * reaches each day's version of the lift. A swap is pinned to its slot, so
 * Shuffle re-rolls everything else and keeps what you chose; a lift swapped
 * out of the whole plan stays out of every shuffle after it.
 *
 * Adjust holds the rest of the brief's inputs — time per session,
 * experience, priority muscles, lifts to avoid — and "Why these exercises?"
 * says what each pick is for. The order is fill, then pins, then tailoring,
 * so a time limit trims the week you actually chose.
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
  const [pins, setPins] = useState<PlanPin[]>([]);
  // Swapped out of the whole plan: kept out of every shuffle from now on.
  const [banned, setBanned] = useState<string[]>([]);
  // What the current fill leaves out. Changed only by a shuffle, so a swap
  // never refills the week and moves lifts nobody touched.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [swapping, setSwapping] = useState<{ dayIndex: number; slotIndex: number } | null>(null);
  const [toast, showToast] = useToast();
  const [prefs, setPrefs] = useState<BuilderPrefs>(loadBuilderPrefs);
  const [adjusting, setAdjusting] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const updatePrefs = (next: BuilderPrefs) => {
    setPrefs(next);
    saveBuilderPrefs(next);
  };

  const days = Number.parseInt(search.get('days') ?? '4', 10);
  const goal = goalId ? findGoal(goalId) : undefined;

  const built = useMemo(() => {
    if (!goal || !splitId || !exercises || exercises.length === 0) return null;
    try {
      const generated = buildPlan(
        { goalId: goal.id as TrainingGoalId, splitId: splitId as SplitId, days },
        exercises,
        {
          equipment: gym?.equipment_available ?? null,
          seed,
          excludeExerciseIds: excluded,
          experience: prefs.experience,
          avoidFamilies: prefs.avoidFamilies,
        },
      );
      const pinned = pinExercises(generated, pins);
      // Viability is about the gym, so it is judged before time trims anything.
      const plan = tailorPlan(pinned, { priorities: prefs.priorities, minutes: prefs.minutes });
      return { plan, viability: assessPlan(pinned) };
    } catch {
      return null;
    }
  }, [goal, splitId, exercises, gym, days, seed, excluded, pins, prefs]);

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
  const pinned = new Set(pins.map((pin) => `${pin.dayIndex}:${pin.slotIndex}`));

  const handleUse = async () => {
    setSaving(true);
    try {
      await createRoutinesFromPlan(plan);
      void navigate('/plan');
    } finally {
      setSaving(false);
    }
  };

  const shuffle = () => {
    setSeed((current) => current + 1);
    setExcluded([...new Set([...banned, ...pins.map((pin) => pin.exercise.id)])]);
  };

  const clearSwaps = () => {
    setPins([]);
    setBanned([]);
    setExcluded([]);
  };

  const swap = swapping ? swapTarget(plan, swapping.dayIndex, swapping.slotIndex) : null;

  const handlePick = (replacement: Exercise, scope: Scope) => {
    if (!swap) return;
    const positions =
      scope === 'plan'
        ? swap.holders.map((holder) => ({ dayIndex: holder.session.dayIndex, slotIndex: holder.slotIndex }))
        : [{ dayIndex: swap.session.dayIndex, slotIndex: swap.slotIndex }];
    const taken = new Set(positions.map((position) => `${position.dayIndex}:${position.slotIndex}`));
    setPins((current) => [
      ...current.filter((pin) => !taken.has(`${pin.dayIndex}:${pin.slotIndex}`)),
      ...positions.map((position) => ({ ...position, exercise: replacement })),
    ]);
    if (scope === 'plan') {
      // "No deadlifts": every version of the lift stays out of the shuffles.
      const family = liftFamily(swap.entry.exercise.name);
      const gone = family
        ? exercises.filter((candidate) => liftFamily(candidate.name) === family).map((candidate) => candidate.id)
        : [swap.entry.exercise.id];
      setBanned((current) => [...new Set([...current, ...gone])]);
    }
    setSwapping(null);
    showToast(
      positions.length > 1
        ? `${replacement.name} on ${positions.length} days`
        : `${replacement.name} on ${swap.session.name}`,
    );
  };

  return (
    <Screen>
      <BackLink to={`/plan/new/${goal.id}`}>{goal.label}</BackLink>
      <BuilderSteps step={3} />
      <ScreenHeader title={plan.split.label} label={`${goal.label} · ${plan.days} days`} />

      <div className="stack">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="accent">{plan.days} days a week</Pill>
          {gym ? <Pill>{gym.name}</Pill> : null}
          {prefs.minutes ? <Pill>{prefs.minutes} min a session</Pill> : null}
          {prefs.experience !== 'intermediate' ? (
            <Pill>{prefs.experience === 'beginner' ? 'Beginner' : 'Expert'}</Pill>
          ) : null}
          {prefs.priorities.map((muscle) => (
            <Pill key={muscle}>More {PRIORITY_MUSCLES.find((entry) => entry.muscle === muscle)?.label.toLowerCase() ?? muscle}</Pill>
          ))}
          {prefs.avoidFamilies.map((family) => (
            <Pill key={family}>No {AVOIDABLE_LIFTS.find((entry) => entry.family === family)?.label.toLowerCase() ?? family}</Pill>
          ))}
        </div>
        <div className="stack-sm">
          <Button block onClick={() => setAdjusting(true)}>
            Adjust plan
          </Button>
          <p className="t-meta">Time per session, experience, priority muscles and lifts to avoid.</p>
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

        <p className="t-meta">Don't fancy one? Swap it, on its day or across the whole plan.</p>
        <Toggle
          label="Why these exercises?"
          hint="What each pick is for, and why this one."
          checked={showWhy}
          onChange={setShowWhy}
        />

        {plan.sessions.map((session) => (
          <section key={`${session.templateId}-${session.dayIndex}`} className="card" aria-label={`Day ${session.dayIndex + 1}`}>
            <div className="card-head">
              <h2 className="t-h2">
                Day {session.dayIndex + 1} · {session.name}
              </h2>
              <span className="t-meta shrink-0">
                {session.exercises.length} exercises
                {prefs.minutes && session.peakMinutes ? ` · ${session.peakMinutes} min` : ''}
              </span>
            </div>
            <ul className="list ex-list">
              {session.exercises.map((entry) => {
                const slotIndex = slotIndexOf(session, entry);
                const chosen = pinned.has(`${session.dayIndex}:${slotIndex}`);
                return (
                  <li key={`${slotIndex}-${entry.exercise.id}`} className="items-center">
                    <span className="ex-name flex-1">
                      <span>{entry.exercise.name}</span>
                      {chosen ? <span className="text-xs font-semibold text-hot">Your swap</span> : null}
                      {showWhy ? (
                        <span className="text-xs text-muted">{explainPick(entry, { experience: prefs.experience })}</span>
                      ) : null}
                    </span>
                    <span className="ex-pres">
                      {entry.prescription.sets} × {entry.prescription.repLow}–{entry.prescription.repHigh}
                    </span>
                    <button
                      type="button"
                      className="icon-btn -my-2 -mr-2.5"
                      aria-label={`Swap ${entry.exercise.name}`}
                      onClick={() => setSwapping({ dayIndex: session.dayIndex, slotIndex })}
                    >
                      <Icon name="swap" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <TrimNote session={session} minutes={prefs.minutes} />
          </section>
        ))}

        <div className="stack-sm">
          <Button variant="primary" size="lg" block disabled={saving} onClick={() => void handleUse()}>
            {saving ? 'Building routines…' : `Use this plan (${plan.days} routines)`}
          </Button>
          <Button block onClick={shuffle}>
            {pins.length > 0 ? 'Shuffle the rest' : 'Shuffle the exercises'}
          </Button>
          {pins.length > 0 ? (
            <button type="button" className="btn-text" onClick={clearSwaps}>
              Undo my swaps
            </button>
          ) : null}
          <p className="t-meta">
            This saves {plan.days} ordinary routines you can edit like any other. Weights are left
            for you to set on the first session
            {settings?.mode === 'beginner' ? ', and the app suggests them from then on' : ''}.
          </p>
        </div>
      </div>

      {swap ? (
        <SwapOverlay exerciseName={swap.entry.exercise.name} onClose={() => setSwapping(null)}>
          <SwapPanel
            exercise={swap.entry.exercise}
            library={exercises}
            gym={gym ?? null}
            scopes={swap.scopes}
            defaultScope="day"
            lead="different"
            onPick={handlePick}
          />
        </SwapOverlay>
      ) : null}

      {adjusting ? (
        <PlanOptionsSheet prefs={prefs} onChange={updatePrefs} onClose={() => setAdjusting(false)} />
      ) : null}

      <Toast message={toast} />
    </Screen>
  );
}

/** What a time limit cost this day, and whether it still runs over. */
function TrimNote({ session, minutes }: { session: GeneratedPlan['sessions'][number]; minutes: number | null }) {
  if (!minutes) return null;
  const dropped = (session.trimmed ?? []).filter((lift) => lift.cut === 'dropped');
  const shortened = (session.trimmed ?? []).filter((lift) => lift.cut === 'shortened');
  const over = (session.peakMinutes ?? 0) > minutes;
  if (dropped.length === 0 && shortened.length === 0 && !over) return null;
  return (
    <div className="stack-sm border-t border-line pt-3">
      {dropped.length > 0 ? (
        <p className="t-meta">
          Cut to fit {minutes} min: {dropped.map((lift) => lift.exercise.name).join(', ')}.
        </p>
      ) : null}
      {shortened.length > 0 ? (
        <p className="t-meta">
          Fewer sets on {shortened.length} {shortened.length === 1 ? 'lift' : 'lifts'}.
        </p>
      ) : null}
      {over ? (
        <p className="text-sm text-warn">
          Even trimmed, its hardest week runs about {session.peakMinutes} min. Main lifts are never cut out.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The exercise being swapped, every day of the week that has it, and how far a
 * swap can reach. The exercise ids keep out a lift a day already has.
 */
function swapTarget(plan: GeneratedPlan, dayIndex: number, slotIndex: number) {
  const session = plan.sessions[dayIndex];
  const entry = session?.exercises.find((candidate) => slotIndexOf(session, candidate) === slotIndex);
  if (!session || !entry) return null;

  const holders = planSwapTargets(
    plan.sessions.map((candidate) => candidate.exercises),
    entry.exercise,
  ).map(({ sessionIndex, item }) => {
    const holder = plan.sessions[sessionIndex]!;
    // The tapped slot in its own day, whatever else that day holds.
    return holder === session
      ? { session, entry, slotIndex }
      : { session: holder, entry: item, slotIndex: slotIndexOf(holder, item) };
  });
  const idsOf = (sessions: GeneratedPlan['sessions']) =>
    new Set(sessions.flatMap((candidate) => candidate.exercises.map((other) => other.exercise.id)));

  const scopes: SwapScopeOption<Scope>[] = [
    {
      value: 'day',
      label: `Just ${session.name}`,
      hint: `Only ${session.name} changes.`,
      excludeIds: idsOf([session]),
    },
  ];
  if (holders.length > 1) {
    scopes.push({
      value: 'plan',
      label: 'Whole plan',
      hint: `${planScopeHint(
        entry.exercise.name,
        holders.map((holder) => ({ session: holder.session.name, exercise: holder.entry.exercise.name })),
      )} Shuffling won't bring them back.`,
      excludeIds: idsOf(holders.map((holder) => holder.session)),
    });
  }

  return { session, entry, slotIndex, holders, scopes };
}
