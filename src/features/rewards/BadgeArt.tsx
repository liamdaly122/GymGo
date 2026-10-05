import type { ReactNode } from 'react';
import { BADGES, type Badge, type BadgeFamily } from '@/domain/rewards';

export type TileState = 'earned' | 'next' | 'locked';

/**
 * A badge, drawn: one silhouette per family so the families read apart at a
 * glance, the number in the display face, and an ornament that grows with
 * the tier — an inner ring, then a star, then laurels on the top one.
 *
 * App colours only, as the owner chose: every colour comes from the classes
 * in index.css, chalk for the frame and blue for what was earned. Nothing
 * here names a colour, and the plate colours stay with the plate diagram.
 * Higher tiers look grander through detail rather than through bronze,
 * silver and gold, which would have been three colours nothing else uses.
 *
 * Drawn on a 120 grid like the icon set, scaled up: round caps and joins,
 * heavy strokes. Inline, so there is nothing to fetch or precache, and the
 * number uses the bundled display face. Decorative: the tile around it
 * carries the badge's name.
 */

type Point = readonly [number, number];

const CENTRE = 60;
/** The progress ring the next badge in a family wears. */
const RING_RADIUS = 56.5;
export const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const round = (value: number) => Math.round(value * 10) / 10;
const polar = ([cx, cy]: Point, radius: number, degrees: number): Point => [
  cx + radius * Math.cos((degrees * Math.PI) / 180),
  cy + radius * Math.sin((degrees * Math.PI) / 180),
];
const closed = (points: readonly Point[]) => `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
const regular = (centre: Point, radius: number, sides: number, startDegrees: number) =>
  closed(Array.from({ length: sides }, (_unused, index) => polar(centre, radius, startDegrees + (360 / sides) * index)));
const circle = ([cx, cy]: Point, radius: number) =>
  `M${cx - radius} ${cy}A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}Z`;

interface Frame {
  /** The silhouette: filled, then stroked. */
  d: string;
  /** What the inner ring scales about, and the laurels curve around. */
  centre: Point;
  /** How far the inner ring is drawn in. */
  inner: number;
  /** An inner ring of its own, for a silhouette that would not scale well. */
  innerD?: string;
  /** Where the star sits: the top of the silhouette. */
  top: Point;
  /**
   * The left branch: the arc its stem follows, in degrees clockwise from
   * three o'clock, around `centre` unless it names its own. The right branch
   * is its mirror image.
   */
  laurel: { radius: number; from: number; to: number; centre?: Point };
  /** The number's vertical centre, and how big it may get. */
  label: { y: number; scale: number };
  /** Lines that belong to the frame: grip slots, binder rings, a coin's edge. */
  lines?: ReactNode;
  /** Shapes that hang behind the silhouette, like a rosette's ribbons. */
  behind?: ReactNode;
}

const SEAL: Point = [60, 54];

const FRAMES: Record<BadgeFamily, Frame> = {
  // The head of a hex dumbbell.
  sessions: {
    d: regular([CENTRE, CENTRE], 46, 6, -90),
    centre: [CENTRE, CENTRE],
    inner: 0.84,
    top: [CENTRE, 14],
    laurel: { radius: 51, from: 102, to: 200 },
    label: { y: 75, scale: 1 },
  },
  // A pennant with a pointed foot.
  streak: {
    d: 'M24 18H96V58C96 80 80 95 60 106C40 95 24 80 24 58Z',
    centre: [CENTRE, 62],
    inner: 0.84,
    top: [CENTRE, 18],
    laurel: { radius: 50, from: 104, to: 196 },
    label: { y: 80, scale: 1 },
  },
  // A rosette: a seal with a toothed edge and two ribbon tails.
  records: {
    d: closed(Array.from({ length: 48 }, (_unused, index) => polar(SEAL, index % 2 === 0 ? 42 : 38, -90 + index * 7.5))),
    centre: SEAL,
    inner: 0.8,
    top: [CENTRE, 12],
    laurel: { radius: 50, from: 128, to: 212 },
    label: { y: 69, scale: 0.94 },
    behind: (
      <>
        <path className="ba-fill" d="M47 92L38 113L46.5 108.5L51 115.5L57.5 95.5" />
        <path className="ba-frame" d="M47 92L38 113L46.5 108.5L51 115.5L57.5 95.5" />
        <path className="ba-fill" d="M73 92L82 113L73.5 108.5L69 115.5L62.5 95.5" />
        <path className="ba-frame" d="M73 92L82 113L73.5 108.5L69 115.5L62.5 95.5" />
      </>
    ),
  },
  // A kettlebell, the tonnage on the bell.
  lifted: {
    d: 'M80 40.1A36 36 0 1 1 40 40.1V30C40 20 48 14 60 14C72 14 80 20 80 30Z',
    centre: [CENTRE, 64],
    inner: 0.84,
    // Round the bell only: a second handle would crowd the first one's hole.
    innerD: circle([CENTRE, 70], 29.5),
    top: [CENTRE, 14],
    laurel: { radius: 44, from: 112, to: 205, centre: [CENTRE, 70] },
    label: { y: 74, scale: 1 },
    lines: (
      <>
        <path className="ba-hole" d="M49 35.7V31C49 26.5 53 24 60 24C67 24 71 26.5 71 31V35.7A36 36 0 0 0 49 35.7Z" />
        <path className="ba-line" d="M49 35.7V31C49 26.5 53 24 60 24C67 24 71 26.5 71 31V35.7A36 36 0 0 0 49 35.7Z" />
      </>
    ),
  },
  // A calendar page: binder rings, a header, the week of a block.
  blocks: {
    d: 'M30 22H90A12 12 0 0 1 102 34V92A12 12 0 0 1 90 104H30A12 12 0 0 1 18 92V34A12 12 0 0 1 30 22Z',
    centre: [CENTRE, 63],
    inner: 0.86,
    top: [CENTRE, 22],
    laurel: { radius: 54, from: 150, to: 208 },
    label: { y: 84, scale: 0.86 },
    lines: (
      <>
        <path className="ba-frame" d="M42 14V28M78 14V28" />
        <path className="ba-line" d="M18 38H102" />
      </>
    ),
  },
  // Eight sides, flat on top, with the bar across it.
  plates: {
    d: regular([CENTRE, CENTRE], 46, 8, -67.5),
    centre: [CENTRE, CENTRE],
    inner: 0.9,
    top: [CENTRE, 17.5],
    laurel: { radius: 51, from: 104, to: 200 },
    label: { y: 89, scale: 0.78 },
  },
  // A coin, with a milled edge.
  moments: {
    d: circle([CENTRE, CENTRE], 46),
    centre: [CENTRE, CENTRE],
    inner: 0.86,
    top: [CENTRE, 14],
    laurel: { radius: 51, from: 104, to: 200 },
    label: { y: 60, scale: 1 },
    lines: <path className="ba-line" d={circle([CENTRE, CENTRE], 39.5)} />,
  },
};

/** Plates a side on a 20kg bar, from a plates badge's kg. */
export const platesOf = (badge: Badge) => Math.round((badge.threshold - 20) / 40);

/** The number on the badge: "50", "10T", "100" kg on the bar. Moments carry none. */
export function artLabel(badge: Badge): string | null {
  switch (badge.family) {
    case 'lifted':
      return `${badge.threshold / 1000}T`;
    case 'moments':
      return null;
    default:
      return String(badge.threshold);
  }
}

/** Shorter labels get bigger type; "1000T" still fits inside the frame. */
export function labelSize(label: string): number {
  return [0, 34, 32, 28, 25, 21][Math.min(label.length, 5)]!;
}

/**
 * How dressed up a badge is: 0 plain, 1 an inner ring, 2 a star as well, 3
 * laurels too. Read from how far up its family it sits, so the top badge of
 * every family wears laurels however many tiers the family has.
 */
export function ornamentLevel(badge: Badge): 0 | 1 | 2 | 3 {
  if (badge.family === 'moments') return 0;
  const family = BADGES.filter((other) => other.family === badge.family);
  const height = family.indexOf(badge) / Math.max(1, family.length - 1);
  if (height >= 1) return 3;
  if (height >= 0.5) return 2;
  if (height >= 0.25) return 1;
  return 0;
}

function Glyph({ badge }: { badge: Badge }): ReactNode {
  switch (badge.family) {
    case 'sessions':
      // A dumbbell.
      return (
        <>
          <path className="ba-glyph" d="M50 43H70" />
          <rect className="ba-solid" x={44} y={35} width={6} height={16} rx={2} />
          <rect className="ba-solid" x={70} y={35} width={6} height={16} rx={2} />
          <rect className="ba-solid" x={39.5} y={38} width={4} height={10} rx={1.5} />
          <rect className="ba-solid" x={76.5} y={38} width={4} height={10} rx={1.5} />
        </>
      );
    case 'streak':
      // A flame, with its heart cut out.
      return (
        <path
          className="ba-solid"
          fillRule="evenodd"
          transform="translate(0 5)"
          d="M60 23C61 30 70 34 70 43C70 49.5 65.5 53 60 53C54.5 53 50 49.5 50 43.5C50 39 52.5 36 55 34C55 38 56.5 40.5 59 41C57.5 35.5 58 28.5 60 23ZM60 40C62 43 64.5 45 64.5 47.8C64.5 50 62.5 51.5 60 51.5C57.5 51.5 55.5 50 55.5 47.8C55.5 45 58 43 60 40Z"
        />
      );
    case 'records':
      // An arrow breaking up through the bar it had to beat.
      return (
        <>
          <path className="ba-glyph" d="M41 41H52M68 41H79" />
          <path className="ba-glyph" d="M60 49V27M52.5 34.5L60 27L67.5 34.5" />
        </>
      );
    case 'lifted':
      return null;
    case 'blocks':
      // The block's own shape: four weeks building, then the deload.
      return (
        <>
          {[7, 10, 13, 16, 6].map((height, index) => (
            <rect
              key={index}
              className="ba-solid"
              x={33 + index * 11.5}
              y={62 - height}
              width={7}
              height={height}
              rx={1.5}
            />
          ))}
        </>
      );
    case 'plates': {
      // The bar from the side, with the plates this badge is for.
      const count = platesOf(badge);
      const plates = Array.from({ length: count }, (_unused, index) => index);
      return (
        <>
          <path className="ba-glyph-thin" d="M24 56H96" />
          <path className="ba-glyph-thin" d="M50.5 49V63M69.5 49V63" />
          {plates.map((index) => (
            <rect key={`l${index}`} className="ba-solid ba-plate" x={48 - index * 5 - 3.6} y={43} width={3.6} height={26} rx={1.2} />
          ))}
          {plates.map((index) => (
            <rect key={`r${index}`} className="ba-solid ba-plate" x={72 + index * 5} y={43} width={3.6} height={26} rx={1.2} />
          ))}
        </>
      );
    }
    case 'moments':
      return <MomentGlyph id={badge.id} />;
  }
}

function MomentGlyph({ id }: { id: string }) {
  if (id === 'moments-early') {
    // The sun coming up.
    const rays = [200, 235, 270, 305, 340].map((degrees) => {
      const [x1, y1] = polar([CENTRE, 72], 23, degrees);
      const [x2, y2] = polar([CENTRE, 72], 31, degrees);
      return `M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`;
    });
    return (
      <>
        <path className="ba-solid" d="M44 72A16 16 0 0 1 76 72Z" />
        <path className="ba-glyph-thin" d={rays.join('')} />
        <path className="ba-glyph" d="M30 80H90" />
      </>
    );
  }
  if (id === 'moments-late') {
    // A crescent moon and a star.
    return (
      <>
        <path className="ba-solid" d="M64 36A24 24 0 1 0 84 72A19 19 0 0 1 64 36Z" />
        <path className="ba-solid" d="M80 30L82 36L88 38L82 40L80 46L78 40L72 38L78 36Z" />
      </>
    );
  }
  // Coming back round: a circle that nearly closes, a solid head on its end.
  const from = -40;
  const to = 228;
  const start = polar([CENTRE, CENTRE], 21, from);
  const end = polar([CENTRE, CENTRE], 21, to);
  // The arc runs clockwise, so at its end it heads along `to + 90`. The head
  // is a triangle: its base straddles the arc's end, its point runs on ahead.
  const point = polar(end, 9, to + 90);
  const outer = polar(end, 7, to);
  const inner = polar(end, 7, to + 180);
  return (
    <>
      <path
        className="ba-glyph"
        d={`M${round(start[0])} ${round(start[1])}A21 21 0 1 1 ${round(end[0])} ${round(end[1])}`}
      />
      <path className="ba-solid" d={closed([point, outer, inner])} />
    </>
  );
}

/** A five-point star, for the second ornament. */
function star([cx, cy]: Point, outer: number, inner: number) {
  return closed(
    Array.from({ length: 10 }, (_unused, index) => polar([cx, cy], index % 2 === 0 ? outer : inner, -90 + index * 36)),
  );
}

/** An almond leaf, its base at the origin, pointing along +x. */
const LEAF = 'M0 0C3 -3 7.5 -3.2 10.5 0C7.5 3.2 3 3 0 0Z';

/**
 * The left laurel branch: a stem curving up the badge's side, leaves on its
 * outer edge pointing up and out, and one at the tip. The right branch is
 * this one mirrored, so the wreath is symmetrical by construction.
 */
function Branch({ frame }: { frame: Frame }) {
  const { radius, from, to } = frame.laurel;
  const centre = frame.laurel.centre ?? frame.centre;
  const a = polar(centre, radius, from);
  const b = polar(centre, radius, to);
  const leaves = Array.from({ length: 5 }, (_unused, index) => {
    const degrees = from + ((to - from) * (index + 0.6)) / 5.4;
    const [x, y] = polar(centre, radius, degrees);
    // The stem grows clockwise, so its heading is `degrees + 90`; outer
    // leaves lean out from that by 38°.
    return (
      <path
        key={index}
        className="ba-leaf"
        d={LEAF}
        transform={`translate(${round(x)} ${round(y)}) rotate(${round(degrees + 52)})`}
      />
    );
  });
  return (
    <>
      <path
        className="ba-orn"
        d={`M${round(a[0])} ${round(a[1])}A${radius} ${radius} 0 0 1 ${round(b[0])} ${round(b[1])}`}
      />
      {leaves}
      <path className="ba-leaf" d={LEAF} transform={`translate(${round(b[0])} ${round(b[1])}) rotate(${round(to + 90)})`} />
    </>
  );
}

export default function BadgeArt({
  badge,
  state,
  progress = 0,
  size = 72,
  stamp = false,
  delay = 0,
}: {
  badge: Badge;
  state: TileState;
  /** For the next badge in a family: how far there, 0 to 1. */
  progress?: number;
  size?: number;
  /** Freshly earned: it stamps itself in. */
  stamp?: boolean;
  /** Milliseconds to wait before stamping, so several land one after another. */
  delay?: number;
}) {
  const frame = FRAMES[badge.family];
  const level = ornamentLevel(badge);
  const label = artLabel(badge);
  const fontSize = label ? Math.round(labelSize(label) * frame.label.scale) : 0;
  const [cx, cy] = frame.centre;
  const reached = Math.max(0, Math.min(1, progress)) * RING_LENGTH;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`badge-art ${state}${stamp ? ' stamp' : ''}`}
      style={stamp && delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
      data-badge={badge.id}
    >
      {state === 'next' ? (
        <>
          <circle className="ba-track" cx={CENTRE} cy={CENTRE} r={RING_RADIUS} />
          <circle
            className="ba-ring"
            cx={CENTRE}
            cy={CENTRE}
            r={RING_RADIUS}
            strokeDasharray={`${round(reached)} ${round(RING_LENGTH)}`}
            transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
          />
        </>
      ) : null}

      {frame.behind}
      <path className="ba-fill" d={frame.d} />
      <path className="ba-frame" d={frame.d} />
      {frame.lines}

      {level >= 1 ? (
        frame.innerD ? (
          <path className="ba-orn ba-inner" d={frame.innerD} />
        ) : (
          <path
            className="ba-orn ba-inner"
            d={frame.d}
            vectorEffect="non-scaling-stroke"
            transform={`translate(${cx} ${cy}) scale(${frame.inner}) translate(${-cx} ${-cy})`}
          />
        )
      ) : null}

      <Glyph badge={badge} />

      {label ? (
        <text
          className="ba-num"
          x={CENTRE}
          y={round(frame.label.y + fontSize * 0.35)}
          textAnchor="middle"
          fontSize={fontSize}
        >
          {label}
        </text>
      ) : null}

      {level >= 2 ? (
        <g className="ba-star">
          <circle className="ba-halo" cx={frame.top[0]} cy={frame.top[1]} r={10} />
          <path className="ba-orn-solid" d={star(frame.top, 8, 3.4)} />
        </g>
      ) : null}
      {level >= 3 ? (
        <g className="ba-laurel">
          <Branch frame={frame} />
          <g transform={`translate(${CENTRE * 2} 0) scale(-1 1)`}>
            <Branch frame={frame} />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
