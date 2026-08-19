import { useState } from 'react';
import manifest from '@/db/image-manifest.json';
import type { Muscle } from '@/domain/types';

const AVAILABLE = new Set(manifest as string[]);

/**
 * A photo where we have one, a muscle-group graphic where we do not.
 *
 * Images are bundled for the ~100 lifts any generated plan can show, so a plan
 * is never a wall of grey boxes, while the long tail of the 675-exercise library
 * costs the install nothing. The fallback is drawn rather than fetched, so it
 * works offline and cannot flash.
 */
const MUSCLE_TINT: Partial<Record<Muscle, string>> = {
  chest: '#f97316',
  quadriceps: '#8b5cf6',
  hamstrings: '#a855f7',
  glutes: '#d946ef',
  lats: '#0ea5e9',
  'middle back': '#0284c7',
  'lower back': '#0369a1',
  shoulders: '#eab308',
  biceps: '#22c55e',
  triceps: '#14b8a6',
  abdominals: '#ef4444',
  calves: '#6366f1',
  traps: '#f59e0b',
  forearms: '#10b981',
};

export default function ExerciseImage({
  sourceId,
  muscle,
  name,
  className = '',
  rounded = 'rounded-lg',
}: {
  sourceId: string | null;
  muscle: Muscle | string;
  name: string;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hasPhoto = sourceId !== null && AVAILABLE.has(sourceId) && !failed;
  const tint = MUSCLE_TINT[muscle as Muscle] ?? '#64748b';

  if (hasPhoto) {
    return (
      <img
        src={`/exercise-images/${sourceId}.webp`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`bg-raised object-cover ${rounded} ${className}`}
      />
    );
  }

  // Initials over a muscle-group tint: recognisable at a glance, and it never
  // looks like a broken image.
  const initials = name
    .replace(/[^a-zA-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

  return (
    <div
      aria-hidden="true"
      className={`grid place-items-center overflow-hidden ${rounded} ${className}`}
      style={{ background: `linear-gradient(135deg, ${tint}22, ${tint}0d)` }}
    >
      <span className="text-sm font-semibold tracking-wide" style={{ color: `${tint}cc` }}>
        {initials || '—'}
      </span>
    </div>
  );
}
