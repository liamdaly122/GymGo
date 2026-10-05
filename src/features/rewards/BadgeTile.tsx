import type { Badge } from '@/domain/rewards';
import { tileText } from './copy';

export type TileState = 'earned' | 'next' | 'locked';

const STATE_WORDS: Record<TileState, string> = { earned: 'earned', next: 'next up', locked: 'not yet' };

/**
 * A badge, typographic like the rest of the app: its number in the display
 * face over what it counts. Earned ones are chalk, the next one in its family
 * is outlined blue, the rest wait in grey. No plate colours: those belong to
 * the plate diagram.
 */
export function BadgeFace({ badge, state, note }: { badge: Badge; state: TileState; note?: string }) {
  const { big, small } = tileText(badge);
  return (
    <>
      <span className={`badge-big ${small ? '' : 'word'}`} aria-hidden="true">
        {big}
      </span>
      {small ? (
        <span className="badge-small" aria-hidden="true">
          {small}
        </span>
      ) : null}
      {note ? (
        <span className="badge-note" aria-hidden="true">
          {note}
        </span>
      ) : null}
      <span className="sr-only">
        {badge.name}, {STATE_WORDS[state]}
        {note ? `: ${note}` : ''}
      </span>
    </>
  );
}

export default function BadgeTile({ badge, state, note }: { badge: Badge; state: TileState; note?: string }) {
  return (
    <li className={`badge-tile ${state}`}>
      <BadgeFace badge={badge} state={state} note={note} />
    </li>
  );
}
