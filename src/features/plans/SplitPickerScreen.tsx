import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDefaultGym, useExercises } from '@/db/queries';
import { BackLink, Button, Pill, Screen, ScreenHeader, Segmented, SectionLabel } from '@/components/ui';
import { findGoal } from '@/domain/programmes/goals';
import { SUPPORTED_DAYS, findSplit } from '@/domain/programmes/splits';
import { workableSplits } from '@/domain/programmes/plan';
import BuilderSteps from './BuilderSteps';

/**
 * Days first, then split.
 *
 * That order is deliberate: how many days you can train decides which splits
 * make sense at all, so offering a six-day push/pull/legs to someone training
 * twice a week would be nonsense. Splits the gym cannot support are shown but
 * disabled, with the reason, rather than quietly dropped.
 */
export default function SplitPickerScreen() {
  const { goalId } = useParams<{ goalId: string }>();
  const navigate = useNavigate();
  const exercises = useExercises();
  const gym = useDefaultGym();
  const [days, setDays] = useState(4);

  const goal = goalId ? findGoal(goalId) : undefined;

  const options = useMemo(() => {
    if (!exercises || exercises.length === 0) return [];
    return workableSplits(days, exercises, {
      equipment: gym?.equipment_available ?? null,
    });
  }, [exercises, gym, days]);

  if (!goal) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/plan/new')}>Back to plans</Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackLink to="/plan/new">Goals</BackLink>
      <BuilderSteps step={2} />
      <ScreenHeader title="How many days a week?" label={goal.label} />

      <div className="stack">
        {goal.sameProgrammeAs ? <p className="t-meta">{goal.sameProgrammeAs}</p> : null}

        <section aria-labelledby="days-label">
          <SectionLabel id="days-label">Days a week</SectionLabel>
          <Segmented
            label="Days a week"
            options={SUPPORTED_DAYS.map((option) => ({ value: option, label: String(option) }))}
            value={days}
            onChange={setDays}
          />
          <p className="t-meta mt-2">Splits that don't work at {days} days aren't offered.</p>
        </section>

        <section aria-labelledby="split-label">
          <SectionLabel id="split-label">Split</SectionLabel>
          {exercises === undefined ? (
            <p className="t-meta">Loading…</p>
          ) : (
            <ul className="stack-sm">
              {options.map(({ splitId, viability }) => {
                const split = findSplit(splitId)!;
                const to = `/plan/new/${goal.id}/${splitId}?days=${days}`;
                const inner = (
                  <>
                    <span className="flex w-full items-start justify-between gap-3">
                      <strong>{split.label}</strong>
                      {viability.viable ? <Pill tone="accent">{days} days</Pill> : <Pill>Not here</Pill>}
                    </span>
                    <span className="t-meta">{split.blurb}</span>
                    <span className="t-meta">
                      {split.frequencyNote(days)} {split.tradeoff(days)}
                    </span>
                    {!viability.viable && viability.reason ? (
                      <span className="text-sm text-warn">{viability.reason}</span>
                    ) : null}
                  </>
                );
                return (
                  <li key={splitId}>
                    {viability.viable ? (
                      <Link to={to} className="goal">
                        {inner}
                      </Link>
                    ) : (
                      <div className="goal" aria-disabled="true">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {gym ? (
          <p className="t-meta">
            Built from the equipment at {gym.name}.{' '}
            <Link to="/gyms" className="text-hot">
              Change what it has
            </Link>{' '}
            to see different options.
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
