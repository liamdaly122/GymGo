import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Exercise, Gym } from '@/db/schema';
import { exerciseAlternatives, liftFamily } from '@/domain/search';
import { Button, Segmented, SectionLabel, Toggle } from '@/components/ui';
import { Icon } from '@/components/icons';
import ExerciseImage from '@/components/ExerciseImage';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import { EQUIPMENT_LABELS, PATTERN_LABELS_SHORT } from '@/features/exercises/labels';

export interface SwapScopeOption<T extends string> {
  value: T;
  /** Short enough for one segment: "Today", "Every Pull A", "Whole plan". */
  label: string;
  /** What picking under this scope does, in a sentence. */
  hint: string;
  /** Exercises already where the swap would land. Offering one would double it up. */
  excludeIds: ReadonlySet<string>;
}

/**
 * What a swap across the plan changes, by name. It reaches each session's
 * version of the lift, not just the one tapped, so it has to say which:
 * "Every deadlift in the plan: Barbell Deadlift on Full body A and Romanian
 * Deadlift on Full body B."
 */
export function planScopeHint(
  exerciseName: string,
  targets: ReadonlyArray<{ session: string; exercise: string }>,
): string {
  const list = (items: string[]) =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  if (targets.every((target) => target.exercise === exerciseName)) {
    return `Every session with it: ${list(targets.map((target) => target.session))}.`;
  }
  const family = liftFamily(exerciseName);
  const kind = family === 'olympic' ? 'Olympic lift' : (family ?? 'version of it');
  return `Every ${kind} in the plan: ${list(targets.map((target) => `${target.exercise} on ${target.session}`))}.`;
}

/**
 * Choosing what to do instead of an exercise.
 *
 * Two groups, because "swap this" means two things. Not wanting to deadlift is
 * answered by a hip thrust or a good morning, something else for the same
 * muscles, and not by a sumo deadlift. A taken rack is answered by the same
 * lift on other kit. Which group leads depends on where you are: planning, it
 * is the different exercise; mid-session, the same lift.
 *
 * How far the swap reaches is chosen first, above the list, so the choice is
 * made before the tap that acts on it.
 */
export default function SwapPanel<T extends string>({
  exercise,
  library,
  gym,
  scopes,
  defaultScope,
  lead,
  notice,
  busy = false,
  onPick,
}: {
  exercise: Exercise;
  library: Exercise[];
  gym: Gym | null;
  scopes: SwapScopeOption<T>[];
  defaultScope: T;
  lead: 'different' | 'variations';
  notice?: ReactNode;
  busy?: boolean;
  onPick: (replacement: Exercise, scope: T) => void;
}) {
  const [scope, setScope] = useState<T>(defaultScope);
  const [anyGym, setAnyGym] = useState(false);
  const [searching, setSearching] = useState(false);

  const active = scopes.find((option) => option.value === scope) ?? scopes[0];
  const equipment = gym && gym.equipment_available.length > 0 ? gym.equipment_available : null;

  const { different, variations } = useMemo(
    () =>
      exerciseAlternatives(exercise, library, {
        availableEquipment: anyGym ? null : equipment,
        ...(active ? { excludeIds: active.excludeIds } : {}),
      }),
    [exercise, library, anyGym, equipment, active],
  );

  const pick = (replacement: Exercise) => {
    if (active) onPick(replacement, active.value);
  };

  const groups = [
    {
      key: 'different',
      title: 'Different exercise, same muscles',
      hint: 'Something else for what this one trains.',
      options: different,
    },
    {
      key: 'variations',
      title: 'Same lift, another way',
      hint: 'Another bar, grip, stance or angle.',
      options: variations,
    },
  ];
  if (lead === 'variations') groups.reverse();

  const muscles = [exercise.primary_muscle, ...exercise.secondary_muscles];

  return (
    <div className="stack">
      <div className="flex items-center gap-3">
        <ExerciseImage
          sourceId={exercise.source_id}
          muscle={exercise.primary_muscle}
          name={exercise.name}
          className="h-12 w-12 shrink-0"
        />
        <p className="t-meta">
          Trains {muscles.join(', ')} · {EQUIPMENT_LABELS[exercise.equipment]}
        </p>
      </div>

      {notice}

      {scopes.length > 1 && active ? (
        <div className="stack-sm">
          <Segmented
            label="Swap for"
            options={scopes.map((option) => ({ value: option.value, label: option.label }))}
            value={active.value}
            onChange={setScope}
          />
          <p className="t-meta" aria-live="polite">
            {active.hint}
          </p>
        </div>
      ) : null}

      {gym && equipment ? (
        <Toggle
          checked={!anyGym}
          onChange={(value) => setAnyGym(!value)}
          label={`Only what ${gym.name} has`}
          hint="Turn off if you are somewhere else, or your gym profile is out of date."
        />
      ) : null}

      {different.length === 0 && variations.length === 0 ? (
        <div className="rounded-md bg-surface p-6 text-center">
          <p className="font-semibold">Nothing to swap to.</p>
          <p className="t-meta">
            {equipment && !anyGym ? 'Try turning off the gym filter, or search.' : 'Search for one instead.'}
          </p>
        </div>
      ) : null}

      {groups.map((group) =>
        group.options.length > 0 ? (
          <section key={group.key} aria-labelledby={`swap-${group.key}`}>
            <SectionLabel id={`swap-${group.key}`}>{group.title}</SectionLabel>
            <p className="t-meta">{group.hint}</p>
            <ul className="list mt-1">
              {group.options.map((option) => (
                <li key={option.id}>
                  <button type="button" className="ex-row" disabled={busy} onClick={() => pick(option)}>
                    <ExerciseImage
                      sourceId={option.source_id}
                      muscle={option.primary_muscle}
                      name={option.name}
                      className="h-11 w-11 shrink-0"
                    />
                    <span className="ex-text">
                      <strong>{option.name}</strong>
                      <span className="first-letter:uppercase">
                        {option.primary_muscle} · {EQUIPMENT_LABELS[option.equipment]}
                      </span>
                    </span>
                    <span className="ex-tag">{PATTERN_LABELS_SHORT[option.movement_pattern]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      <Button block disabled={busy} onClick={() => setSearching(true)}>
        <Icon name="search" />
        Search all exercises
      </Button>

      {searching ? (
        <ExercisePicker
          title="Swap for"
          onPick={(exerciseId) => {
            setSearching(false);
            const replacement = library.find((candidate) => candidate.id === exerciseId);
            if (replacement && replacement.id !== exercise.id) pick(replacement);
          }}
          onClose={() => setSearching(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The panel as a full-screen layer, for screens whose state a route change
 * would throw away: the plan builder holds its plan in memory, and Today holds
 * which day is open.
 */
export function SwapOverlay({
  exerciseName,
  onClose,
  children,
}: {
  exerciseName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass onClose inline, so it changes on every render of theirs. Held
  // in a ref, focus moves in once on opening rather than being pulled back to
  // the top each time a live query updates underneath.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-30 overflow-y-auto bg-ink"
      role="dialog"
      aria-modal="true"
      aria-label={`Swap ${exerciseName}`}
      tabIndex={-1}
      // Fixed to the viewport, so it escapes the padding body applies for the notch.
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="screen">
        <div className="pt-2.5">
          <button type="button" className="back-btn" onClick={onClose}>
            <Icon name="back" />
            Cancel
          </button>
        </div>
        <header className="top">
          <div className="top-txt min-w-0">
            <p className="t-label">{exerciseName}</p>
            <h2 className="t-title">Swap exercise</h2>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
