import { useMemo, useState } from 'react';
import { useExercises, useSettings } from '@/db/queries';
import { filterExercises } from '@/domain/search';
import { MOVEMENT_PATTERNS, type MovementPattern } from '@/domain/types';
import ExerciseImage from '@/components/ExerciseImage';
import { EQUIPMENT_LABELS, PATTERN_LABELS_SHORT } from './labels';

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
    <div className="fixed inset-0 z-30 flex flex-col bg-ink" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="border-b border-line px-5 pb-3"
        // This one genuinely needs the inset. The picker is `fixed inset-0`, so
        // it is positioned against the viewport and escapes the padding body
        // applies for the notch.
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={title}
            className="search flex-1"
          />
          <button type="button" className="btn-text" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="filter-row mx-auto mt-3 max-w-lg">
          {MOVEMENT_PATTERNS.map((option) => (
            <button
              key={option}
              type="button"
              className="filter"
              aria-pressed={pattern === option}
              onClick={() => setPattern(pattern === option ? null : option)}
            >
              {PATTERN_LABELS_SHORT[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul className="list mx-auto max-w-lg px-5">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <button type="button" className="ex-row" onClick={() => onPick(exercise.id)}>
                <ExerciseImage
                  sourceId={exercise.source_id}
                  muscle={exercise.primary_muscle}
                  name={exercise.name}
                  className="h-11 w-11 shrink-0"
                />
                <span className="ex-text">
                  <strong>{exercise.name}</strong>
                  <span className="first-letter:uppercase">
                    {exercise.primary_muscle} · {EQUIPMENT_LABELS[exercise.equipment]}
                  </span>
                </span>
                <span className="ex-tag">{PATTERN_LABELS_SHORT[exercise.movement_pattern]}</span>
              </button>
            </li>
          ))}
        </ul>

        {exercises && results.length === 0 ? (
          <p className="t-meta px-5 py-10 text-center">
            Nothing matches “{query}”.
            {settings?.mode === 'pro' ? ' Create a custom exercise from the library.' : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
