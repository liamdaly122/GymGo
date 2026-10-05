import type { Badge } from '@/domain/rewards';
import BadgeArt, { type TileState } from './BadgeArt';
import { tileCaption } from './copy';

export type { TileState };

const STATE_WORDS: Record<TileState, string> = { earned: 'earned', next: 'next up', locked: 'not yet' };

/**
 * A badge on a tile: its art, what the number counts, and a note — when it
 * was earned, or how far there is to go. The art carries the number and is
 * decorative; the name a screen reader hears is the line kept for it here,
 * the same one the tiles have always had.
 */
export function BadgeFace({
  badge,
  state,
  note,
  progress,
  stamp,
  delay,
}: {
  badge: Badge;
  state: TileState;
  note?: string;
  /** For the next badge in a family: how far there, 0 to 1. */
  progress?: number;
  /** Freshly earned, on the summary: the art stamps itself in. */
  stamp?: boolean;
  delay?: number;
}) {
  return (
    <>
      <BadgeArt badge={badge} state={state} progress={progress} stamp={stamp} delay={delay} />
      <span className="badge-small" aria-hidden="true">
        {tileCaption(badge)}
      </span>
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

export default function BadgeTile({
  badge,
  state,
  note,
  stamp,
  delay,
}: {
  badge: Badge;
  state: TileState;
  note?: string;
  stamp?: boolean;
  delay?: number;
}) {
  return (
    <li className={`badge-tile ${state}`}>
      <BadgeFace badge={badge} state={state} note={note} stamp={stamp} delay={delay} />
    </li>
  );
}
