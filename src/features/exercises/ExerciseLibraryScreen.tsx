import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useExercises } from '@/db/queries';
import { filterExercises } from '@/domain/search';
import { EQUIPMENT, MOVEMENT_PATTERNS, MUSCLES, type Equipment, type MovementPattern, type Muscle } from '@/domain/types';
import { Screen, ScreenTitle } from '@/components/ui';
import { EQUIPMENT_LABELS, PATTERN_LABELS_SHORT } from './labels';

type FilterKind = 'pattern' | 'muscle' | 'equipment';

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

  const clearAll = () => {
    setPattern(null);
    setMuscle(null);
    setEquipment(null);
  };

  const activeCount = [pattern, muscle, equipment].filter(Boolean).length;

  return (
    <Screen>
      <Link to="/plans" className="mb-3 inline-block text-xs text-muted">
        ← Plans
      </Link>
      <ScreenTitle
        action={
          <span className="text-xs text-muted">
            {results.length} of {exercises?.length ?? 0}
          </span>
        }
      >
        Library
      </ScreenTitle>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search exercises"
        aria-label="Search exercises"
        className="mb-3 h-11 w-full rounded-xl border border-line bg-raised px-4 text-base text-white placeholder:text-muted focus:border-accent focus:outline-none"
      />

      <div className="mb-2 flex items-center gap-2">
        {(['pattern', 'muscle', 'equipment'] as FilterKind[]).map((option) => (
          <button
            key={option}
            onClick={() => setKind(option)}
            className={`rounded-lg px-2.5 py-1 text-xs capitalize transition-colors ${
              kind === option ? 'bg-raised text-white' : 'text-muted'
            }`}
          >
            {option}
          </button>
        ))}
        {activeCount > 0 ? (
          <button onClick={clearAll} className="ml-auto text-xs text-accent">
            Clear
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {kind === 'pattern' &&
          MOVEMENT_PATTERNS.map((option) => (
            <Chip
              key={option}
              active={pattern === option}
              onClick={() => setPattern(pattern === option ? null : option)}
            >
              {PATTERN_LABELS_SHORT[option]}
            </Chip>
          ))}
        {kind === 'muscle' &&
          MUSCLES.map((option) => (
            <Chip
              key={option}
              active={muscle === option}
              capitalise
              onClick={() => setMuscle(muscle === option ? null : option)}
            >
              {option}
            </Chip>
          ))}
        {kind === 'equipment' &&
          EQUIPMENT.map((option) => (
            <Chip
              key={option}
              active={equipment === option}
              onClick={() => setEquipment(equipment === option ? null : option)}
            >
              {EQUIPMENT_LABELS[option]}
            </Chip>
          ))}
      </div>

      {exercises === undefined ? null : results.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing matches those filters.</p>
      ) : (
        <ul className="divide-y divide-line">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <Link
                to={`/exercises/${exercise.id}`}
                className="flex items-center justify-between gap-3 py-3 active:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{exercise.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {exercise.primary_muscle} · {EQUIPMENT_LABELS[exercise.equipment]}
                    {exercise.is_custom ? ' · custom' : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {PATTERN_LABELS_SHORT[exercise.movement_pattern]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

function Chip({
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
  children: React.ReactNode;
  capitalise?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${
        capitalise ? 'first-letter:uppercase' : ''
      } ${active ? 'bg-accent font-medium text-ink' : 'border border-line bg-raised text-muted'}`}
    >
      {children}
    </button>
  );
}
