import { useMemo, useState } from 'react';
import { useExercises, useSettings } from '@/db/queries';
import { filterExercises } from '@/domain/search';
import { MOVEMENT_PATTERNS, type MovementPattern } from '@/domain/types';
import { Button } from '@/components/ui';
import ExerciseImage from '@/components/ExerciseImage';

const PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge',
  horizontal_push: 'Horiz push',
  vertical_push: 'Vert push',
  horizontal_pull: 'Horiz pull',
  vertical_pull: 'Vert pull',
  carry: 'Carry',
  core: 'Core',
  isolation: 'Isolation',
};

/**
 * Full-screen exercise picker.
 *
 * Opens straight onto the search field: mid-session the fastest path to an
 * exercise is typing three letters of its name, not scrolling 675 rows.
 */
export default function ExercisePicker({
  onPick,
  onClose,
  title = 'Add exercise',
}: {
  onPick: (exerciseId: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const exercises = useExercises();
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState<MovementPattern | null>(null);

  const results = useMemo(
    () => filterExercises(exercises ?? [], { query, pattern }).slice(0, 200),
    [exercises, query, pattern],
  );

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ink">
      <div
        className="border-b border-line px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={title}
            className="h-11 flex-1 rounded-xl border border-line bg-raised px-4 text-base text-white placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="mx-auto mt-3 flex max-w-lg gap-2 overflow-x-auto pb-1">
          {MOVEMENT_PATTERNS.map((option) => (
            <button
              key={option}
              onClick={() => setPattern(pattern === option ? null : option)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
                pattern === option
                  ? 'bg-accent text-ink font-medium'
                  : 'border border-line bg-raised text-muted'
              }`}
            >
              {PATTERN_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul className="mx-auto max-w-lg divide-y divide-line px-4">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <button
                onClick={() => onPick(exercise.id)}
                className="flex w-full items-center gap-3 py-2.5 text-left active:opacity-60"
              >
                <ExerciseImage
                  sourceId={exercise.source_id}
                  muscle={exercise.primary_muscle}
                  name={exercise.name}
                  className="h-11 w-11 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{exercise.name}</span>
                  <span className="block truncate text-xs text-muted first-letter:uppercase">
                    {exercise.primary_muscle} · {exercise.equipment.replace('_', ' ')}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {PATTERN_LABELS[exercise.movement_pattern]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {exercises && results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Nothing matches “{query}”.
            {settings?.mode === 'pro' ? ' Create a custom exercise from the library.' : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
