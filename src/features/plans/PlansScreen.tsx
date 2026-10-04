import { Link } from 'react-router-dom';
import { BackLink, Screen, ScreenHeader } from '@/components/ui';
import { TRAINING_GOALS } from '@/domain/programmes/goals';
import BuilderSteps from './BuilderSteps';

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
      <BackLink to="/plan">Plan</BackLink>
      <BuilderSteps step={1} />
      <ScreenHeader title="What are you training for?" label="New plan" />
      <p className="t-meta mb-4">
        Every plan is built from your gym's equipment and saved as routines you can edit.
      </p>
      <ul className="stack-sm">
        {TRAINING_GOALS.map((goal) => (
          <li key={goal.id}>
            <Link to={`/plan/new/${goal.id}`} className="goal">
              <strong>{goal.label}</strong>
              <span className="t-meta">{goal.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
