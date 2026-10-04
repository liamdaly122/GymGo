import type { Equipment } from '@/domain/types';
import { formatPlateLoad, plateBreakdown, type LoadingProfile } from '@/domain/plates';
import { formatNumber } from './setNames';

/** Plate heights in px, so a 25 and a 1.25 read as what they are at a glance. */
const HEIGHTS: Record<number, number> = { 25: 58, 20: 58, 15: 50, 10: 42, 5: 32, 2.5: 26, 1.25: 22 };

/** Competition colours. The one place in the app they are used. */
const COLOURS: Record<number, string> = {
  25: 'var(--color-p25)',
  20: 'var(--color-p20)',
  15: 'var(--color-p15)',
  10: 'var(--color-p10)',
  5: 'var(--color-p5)',
  2.5: 'var(--color-p2)',
  1.25: 'var(--color-p1)',
};

/**
 * What to load for the number on screen.
 *
 * On a barbell, the bar as you would see it from the side — heaviest plates
 * innermost, which is the order they go on — with the breakdown in words
 * beneath, since a diagram alone is no help to a screen reader. Anything else
 * gets a line saying what the number means on that equipment: two dumbbells,
 * a pin in a stack.
 */
export default function PlateDiagram({
  weight,
  loading,
  equipment,
}: {
  weight: number | null;
  loading: LoadingProfile;
  equipment: Equipment | undefined;
}) {
  if (weight === null) return null;

  const load = loading.mode === 'barbell' && weight > 0 ? plateBreakdown(weight, loading) : null;
  if (load) {
    const side = load.perSide.map((plate, index) => (
      <i
        key={index}
        className="plate"
        style={{ height: HEIGHTS[plate] ?? 20, background: COLOURS[plate] ?? 'var(--color-p1)' }}
      />
    ));
    return (
      <div className="bar-viz-wrap">
        <div className="bar-viz" aria-hidden="true">
          <span className="sleeve" />
          {[...side].reverse()}
          <span className="shaft" />
          {side}
          <span className="sleeve" />
        </div>
        <p className="bar-viz-txt">
          {load.rounded ? `Loads as ${formatNumber(load.total)}kg · ` : ''}
          {formatPlateLoad(load)}
        </p>
      </div>
    );
  }

  const text = describe(weight, equipment);
  return text ? <p className="bar-viz-txt">{text}</p> : null;
}

function describe(weight: number, equipment: Equipment | undefined): string | null {
  const kg = `${formatNumber(weight)}kg`;
  switch (equipment) {
    case 'dumbbell':
      return weight > 0 ? `Two ${kg} dumbbells` : null;
    case 'kettlebell':
      return weight > 0 ? `${kg} kettlebell` : null;
    case 'cable':
      return weight > 0 ? `Pin at ${kg}` : null;
    case 'machine':
      return weight > 0 ? `${kg} on the stack` : null;
    case 'bodyweight':
      return weight > 0 ? `Bodyweight + ${kg}` : 'Bodyweight';
    default:
      return null;
  }
}
