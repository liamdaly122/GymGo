import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDefaultGym, useExercises } from '@/db/queries';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import { findGoal } from '@/domain/programmes/goals';
import { SUPPORTED_DAYS, findSplit } from '@/domain/programmes/splits';
import { workableSplits } from '@/domain/programmes/plan';

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
        <ScreenTitle>Not found</ScreenTitle>
        <Button onClick={() => void navigate('/plans')}>Back to plans</Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Link to="/plans" className="mb-3 inline-block text-xs text-muted">
        ← Plans
      </Link>
      <ScreenTitle>{goal.label}</ScreenTitle>

      {goal.sameProgrammeAs ? (
        <Card className="mb-4 p-4">
          <p className="text-xs text-muted">{goal.sameProgrammeAs}</p>
        </Card>
      ) : null}

      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Days a week</h2>
      <div className="mb-5 flex gap-2">
        {SUPPORTED_DAYS.map((option) => (
          <button
            key={option}
            onClick={() => setDays(option)}
            aria-pressed={days === option}
            className={`h-12 flex-1 rounded-xl text-base font-medium transition-colors ${
              days === option
                ? 'bg-accent text-ink'
                : 'border border-line bg-raised text-muted'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Split</h2>

      {exercises === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {options.map(({ splitId, viability }) => {
            const split = findSplit(splitId)!;
            const to = `/plans/${goal.id}/${splitId}?days=${days}`;

            const inner = (
              <Card
                className={`p-4 ${viability.viable ? 'active:bg-raised' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{split.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{split.blurb}</p>
                  </div>
                  {viability.viable ? (
                    <Pill tone="accent">{days} days</Pill>
                  ) : (
                    <Pill>Not here</Pill>
                  )}
                </div>

                <p className="mt-2 text-[11px] text-muted">
                  {split.frequencyNote(days)} {split.tradeoff(days)}
                </p>

                {!viability.viable && viability.reason ? (
                  <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-[11px] text-amber-400">
                    {viability.reason}
                  </p>
                ) : null}
              </Card>
            );

            return (
              <li key={splitId}>
                {viability.viable ? (
                  <Link to={to} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      {gym ? (
        <p className="mt-4 text-[11px] text-muted">
          Built from the equipment at {gym.name}.{' '}
          <Link to="/gyms" className="text-accent">
            Change what it has
          </Link>{' '}
          to see different options.
        </p>
      ) : null}
    </Screen>
  );
}
