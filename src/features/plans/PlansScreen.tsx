import { Link } from 'react-router-dom';
import { Card, Screen, ScreenTitle } from '@/components/ui';
import { TRAINING_GOALS } from '@/domain/programmes/goals';

/**
 * Where a plan starts: what are you actually training for.
 *
 * Six goals, three programmes underneath. The overlap is stated on the next
 * screen rather than hidden, because pretending "Lose weight" needs a different
 * split from "Build muscle" would be marketing rather than training.
 */
export default function PlansScreen() {
  return (
    <Screen>
      <ScreenTitle
        action={
          <Link to="/exercises" className="text-xs text-muted">
            Exercises
          </Link>
        }
      >
        Plans
      </ScreenTitle>

      <p className="mb-4 text-sm text-muted">
        Pick what you are training for. Every plan is built from your gym's equipment and saved as
        routines you can edit.
      </p>

      <ul className="space-y-2">
        {TRAINING_GOALS.map((goal) => (
          <li key={goal.id}>
            <Link to={`/plans/${goal.id}`} className="block">
              <Card className="flex items-center justify-between gap-3 p-4 active:bg-raised">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">{goal.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{goal.blurb}</span>
                </span>
                <span className="shrink-0 text-muted" aria-hidden="true">
                  ›
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
