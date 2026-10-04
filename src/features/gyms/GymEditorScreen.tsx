import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { LastGymError, deleteGym, setDefaultGym, updateGym } from '@/db/mutations';
import { BackLink, Button, Screen, ScreenHeader, SectionLabel, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { EQUIPMENT, type Equipment } from '@/domain/types';
import { EQUIPMENT_LABELS } from '@/features/exercises/labels';
import { formatPlateLoad, loadableWeight, plateBreakdown } from '@/domain/plates';

/** The denominations a gym might stock, heaviest first. */
const PLATE_OPTIONS = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
const BAR_OPTIONS = [20, 15, 10, 7.5];

/**
 * What one gym has.
 *
 * Plan filling, plan viability, swap suggestions and plate rounding all read
 * this. A new gym starts at bodyweight only: ticking what you own is quicker
 * and more honest than un-ticking what you do not.
 */
export default function GymEditorScreen() {
  const { gymId } = useParams<{ gymId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const gym = useLiveQuery(async () => (gymId ? db.gyms.get(gymId) : undefined), [gymId]);

  /**
   * What this gym can actually load, so the equipment list is not abstract.
   * Reuses the same plate maths the progression engine rounds suggestions with.
   */
  const plateExamples = useMemo(() => {
    if (!gym) return [];
    const profile = {
      mode: 'barbell' as const,
      barWeight: gym.bar_weights[0] ?? 20,
      plates: gym.plates_available,
    };
    return [60, 100, 142.5].map((target) => {
      const load = plateBreakdown(target, profile);
      return {
        target,
        actual: loadableWeight(target, profile),
        text: load ? formatPlateLoad(load) : '—',
      };
    });
  }, [gym]);

  if (gym === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }
  if (!gym || !gymId) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/gyms')}>Back to gyms</Button>
      </Screen>
    );
  }

  const toggleEquipment = (item: Equipment) => {
    const next = gym.equipment_available.includes(item)
      ? gym.equipment_available.filter((value) => value !== item)
      : [...gym.equipment_available, item];
    void updateGym(gymId, { equipment_available: next });
  };

  const toggleNumber = (key: 'bar_weights' | 'plates_available', value: number) => {
    const list = gym[key];
    const next = list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value].sort((a, b) => b - a);
    void updateGym(gymId, { [key]: next });
  };

  const handleDelete = async () => {
    try {
      await deleteGym(gymId);
      void navigate('/gyms', { replace: true });
    } catch (cause) {
      setError(cause instanceof LastGymError ? cause.message : String(cause));
      setConfirmingDelete(false);
    }
  };

  const hasBarbell =
    gym.equipment_available.includes('barbell') || gym.equipment_available.includes('ez_bar');

  return (
    <Screen>
      <BackLink to="/gyms">Gyms</BackLink>
      <header className="top">
        <div className="top-txt min-w-0 flex-1">
          <p className="t-label">{gym.is_default ? 'Training here' : 'Gym'}</p>
          <h1 className="sr-only">{gym.name}</h1>
          <input
            key={gym.name}
            defaultValue={gym.name}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== gym.name) void updateGym(gymId, { name: value });
              else event.currentTarget.value = gym.name;
            }}
            aria-label="Gym name"
            className="title-input"
          />
        </div>
      </header>

      <div className="stack">
        {!gym.is_default ? (
          <Button variant="primary" block onClick={() => void setDefaultGym(gymId)}>
            Train here
          </Button>
        ) : null}

        {error ? (
          <p className="rounded-md bg-surface p-4 text-sm text-warn" role="status">
            {error}
          </p>
        ) : null}

        <section aria-labelledby="equipment">
          <SectionLabel id="equipment">Equipment</SectionLabel>
          <p className="t-meta mb-3">Tick what is actually here. Plans and swaps will only ever offer these.</p>
          <ul className="toggle-grid">
            {EQUIPMENT.map((item) => {
              const on = gym.equipment_available.includes(item);
              return (
                <li key={item}>
                  <button
                    type="button"
                    className="toggle"
                    onClick={() => toggleEquipment(item)}
                    aria-pressed={on}
                    aria-label={EQUIPMENT_LABELS[item]}
                  >
                    {EQUIPMENT_LABELS[item]}
                    {on ? <Icon name="check" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {gym.equipment_available.length === 0 ? (
            <p className="mt-3 text-sm text-warn">Nothing selected — no plan can be built for this gym.</p>
          ) : null}
        </section>

        {hasBarbell ? (
          <>
            <section aria-labelledby="bars">
              <SectionLabel id="bars">Bars</SectionLabel>
              <p className="t-meta mb-3">The heaviest is assumed unless a lift says otherwise.</p>
              <NumberToggles
                options={BAR_OPTIONS}
                selected={gym.bar_weights}
                onToggle={(value) => toggleNumber('bar_weights', value)}
              />
            </section>

            <section aria-labelledby="plates">
              <SectionLabel id="plates">Plates</SectionLabel>
              <p className="t-meta mb-3">
                Per side. Suggested weights are rounded to what these can actually make.
              </p>
              <NumberToggles
                options={PLATE_OPTIONS}
                selected={gym.plates_available}
                onToggle={(value) => toggleNumber('plates_available', value)}
              />

              {/* Abstract lists of numbers are hard to sanity-check; this makes
                  the consequence visible. */}
              <div className="card mt-4 rounded-md bg-surface p-4">
                <p className="t-label">What that loads</p>
                <ul className="stack-sm">
                  {plateExamples.map((example) => (
                    <li key={example.target} className="text-sm">
                      <span className="text-muted">Asking for {example.target}kg → </span>
                      <span className="font-semibold">
                        {example.actual}kg
                        {example.actual !== example.target ? ' (nearest)' : ''}
                      </span>
                      <span className="block text-muted">{example.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </>
        ) : null}

        <button type="button" className="btn-text text-danger" onClick={() => setConfirmingDelete(true)}>
          Delete this gym
        </button>
      </div>

      {confirmingDelete ? (
        <Sheet label={`Delete ${gym.name}`} onClose={() => setConfirmingDelete(false)}>
          <h2>Delete {gym.name}?</h2>
          <p className="sheet-note">Workouts you did there keep their history.</p>
          <Button variant="danger" onClick={() => void handleDelete()}>
            Delete gym
          </Button>
          <Button onClick={() => setConfirmingDelete(false)}>Keep</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}

function NumberToggles({
  options,
  selected,
  onToggle,
}: {
  options: number[];
  selected: number[];
  onToggle: (value: number) => void;
}) {
  return (
    <div className="num-toggles">
      {options.map((value) => (
        <button
          key={value}
          type="button"
          className="num-toggle"
          onClick={() => onToggle(value)}
          aria-pressed={selected.includes(value)}
          aria-label={`${value}kg`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
