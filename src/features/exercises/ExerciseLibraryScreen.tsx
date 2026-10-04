import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useExercises } from '@/db/queries';
import { filterExercises } from '@/domain/search';
import { EQUIPMENT, MOVEMENT_PATTERNS, MUSCLES, type Equipment, type MovementPattern, type Muscle } from '@/domain/types';
import { BackLink, Screen, ScreenHeader, Segmented } from '@/components/ui';
import ExerciseImage from '@/components/ExerciseImage';
import { EQUIPMENT_LABELS, PATTERN_LABELS_SHORT } from './labels';

type FilterKind = 'pattern' | 'muscle' | 'equipment';

/**
 * Every exercise, A to Z, reached from Progress → Lifts.
 *
 * Three ways to narrow it — movement, muscle, equipment — one at a time on
 * screen, because three rows of chips at 390px is a wall before the list.
 */
export default function ExerciseLibraryScreen() {
  const exercises = useExercises();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FilterKind>('pattern');
  const [pattern, setPattern] = useState<MovementPattern | null>(null);
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);

  const results = useMemo(
    () => filterExercises(exercises ?? [], { query, pattern, muscle, equipment }),
    [exercises, query, pattern, muscle, equipment],
  );

  const activeCount = [pattern, muscle, equipment].filter(Boolean).length;
  const clearAll = () => {
    setPattern(null);
    setMuscle(null);
    setEquipment(null);
  };

  return (
    <Screen>
      <BackLink to="/progress/lifts">Lifts</BackLink>
      <ScreenHeader
        title="Exercises"
        label={`${results.length} of ${exercises?.length ?? 0}`}
      />

      <div className="stack-sm">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          className="search"
        />

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Segmented
              label="Filter by"
              options={[
                { value: 'pattern', label: 'Movement' },
                { value: 'muscle', label: 'Muscle' },
                { value: 'equipment', label: 'Equipment' },
              ]}
              value={kind}
              onChange={setKind}
            />
          </div>
          {activeCount > 0 ? (
            <button type="button" className="btn-text hot" onClick={clearAll}>
              Clear
            </button>
          ) : null}
        </div>

        <div className="filter-row">
          {kind === 'pattern' &&
            MOVEMENT_PATTERNS.map((option) => (
              <Filter key={option} active={pattern === option} onClick={() => setPattern(pattern === option ? null : option)}>
                {PATTERN_LABELS_SHORT[option]}
              </Filter>
            ))}
          {kind === 'muscle' &&
            MUSCLES.map((option) => (
              <Filter
                key={option}
                active={muscle === option}
                capitalise
                onClick={() => setMuscle(muscle === option ? null : option)}
              >
                {option}
              </Filter>
            ))}
          {kind === 'equipment' &&
            EQUIPMENT.map((option) => (
              <Filter
                key={option}
                active={equipment === option}
                onClick={() => setEquipment(equipment === option ? null : option)}
              >
                {EQUIPMENT_LABELS[option]}
              </Filter>
            ))}
        </div>
      </div>

      {exercises === undefined ? null : results.length === 0 ? (
        <p className="t-meta py-10 text-center">Nothing matches those filters.</p>
      ) : (
        <ul className="list mt-4">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <Link to={`/exercises/${exercise.id}`} className="ex-row">
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
                    {exercise.is_custom ? ' · custom' : ''}
                  </span>
                </span>
                <span className="ex-tag">{PATTERN_LABELS_SHORT[exercise.movement_pattern]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function Filter({
  active,
  onClick,
  children,
  // Muscle names come from the dataset in lower case and need capitalising;
  // pattern and equipment labels are already written properly and must not be
  // title-cased into "Horiz Push".
  capitalise = false,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  capitalise?: boolean;
}) {
  return (
    <button
      type="button"
      className={`filter ${capitalise ? 'first-letter:uppercase' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
