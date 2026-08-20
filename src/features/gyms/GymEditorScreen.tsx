import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { LastGymError, deleteGym, setDefaultGym, updateGym } from '@/db/mutations';
import { Button, Card, Screen, ScreenTitle } from '@/components/ui';
import { EQUIPMENT, type Equipment } from '@/domain/types';
import { EQUIPMENT_LABELS } from '@/features/exercises/labels';
import { formatPlateLoad, loadableWeight, plateBreakdown } from '@/domain/plates';

/** The denominations a gym might stock, heaviest first. */
const PLATE_OPTIONS = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
const BAR_OPTIONS = [20, 15, 10, 7.5];

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
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }
  if (!gym || !gymId) {
    return (
      <Screen>
        <ScreenTitle>Not found</ScreenTitle>
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

  const toggleNumber = (
    key: 'bar_weights' | 'plates_available',
    value: number,
  ) => {
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
      <Link to="/gyms" className="mb-3 inline-block text-xs text-muted">
        ← Gyms
      </Link>

      <input
        defaultValue={gym.name}
        onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          if (value && value !== gym.name) void updateGym(gymId, { name: value });
          else event.currentTarget.value = gym.name;
        }}
        aria-label="Gym name"
        className="mb-4 w-full bg-transparent text-2xl font-semibold tracking-tight text-white focus:outline-none"
      />

      {!gym.is_default ? (
        <Button className="mb-4 w-full" onClick={() => void setDefaultGym(gymId)}>
          Train here
        </Button>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-xl bg-warn/10 px-4 py-3 text-xs text-warn" role="status">
          {error}
        </p>
      ) : null}

      <Card className="mb-4 p-4">
        <h2 className="eyebrow mb-1">Equipment</h2>
        <p className="mb-3 text-[11px] text-muted">
          Tick what is actually here. Plans and swaps will only ever offer these.
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {EQUIPMENT.map((item) => {
            const on = gym.equipment_available.includes(item);
            return (
              <li key={item}>
                <button
                  onClick={() => toggleEquipment(item)}
                  aria-pressed={on}
                  aria-label={EQUIPMENT_LABELS[item]}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                    on
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                      : 'border border-line bg-raised text-muted'
                  }`}
                >
                  {EQUIPMENT_LABELS[item]}
                </button>
              </li>
            );
          })}
        </ul>
        {gym.equipment_available.length === 0 ? (
          <p className="mt-3 text-[11px] text-warn">
            Nothing selected — no plan can be built for this gym.
          </p>
        ) : null}
      </Card>

      {hasBarbell ? (
        <>
          <Card className="mb-4 p-4">
            <h2 className="eyebrow mb-1">Bars</h2>
            <p className="mb-3 text-[11px] text-muted">
              The heaviest is assumed unless a lift says otherwise.
            </p>
            <ChipRow
              options={BAR_OPTIONS}
              selected={gym.bar_weights}
              onToggle={(value) => toggleNumber('bar_weights', value)}
              suffix="kg"
            />
          </Card>

          <Card className="mb-4 p-4">
            <h2 className="eyebrow mb-1">Plates</h2>
            <p className="mb-3 text-[11px] text-muted">
              Per side. Suggested weights are rounded to what these can actually make.
            </p>
            <ChipRow
              options={PLATE_OPTIONS}
              selected={gym.plates_available}
              onToggle={(value) => toggleNumber('plates_available', value)}
              suffix="kg"
            />

            {/* Abstract lists of numbers are hard to sanity-check; this makes the
                consequence visible. */}
            <div className="mt-4 border-t border-line pt-3">
              <p className="eyebrow mb-2">What that loads</p>
              <ul className="space-y-1.5">
                {plateExamples.map((example) => (
                  <li key={example.target} className="text-[11px]">
                    <span className="text-muted">Asking for {example.target}kg → </span>
                    <span className="text-white">
                      {example.actual}kg
                      {example.actual !== example.target ? ' (nearest)' : ''}
                    </span>
                    <span className="block text-muted">{example.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </>
      ) : null}

      <Card className="p-4">
        <h2 className="eyebrow mb-1">Danger</h2>
        {confirmingDelete ? (
          <>
            <p className="mb-3 text-sm text-white">
              Delete {gym.name}? Workouts you did there keep their history.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" onClick={() => void handleDelete()}>
                Delete gym
              </Button>
              <Button className="flex-1" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </div>
          </>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="text-sm text-red-400">
            Delete this gym
          </button>
        )}
      </Card>
    </Screen>
  );
}

function ChipRow({
  options,
  selected,
  onToggle,
  suffix,
}: {
  options: number[];
  selected: number[];
  onToggle: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((value) => {
        const on = selected.includes(value);
        return (
          <button
            key={value}
            onClick={() => onToggle(value)}
            aria-pressed={on}
            aria-label={`${value}${suffix}`}
            className={`rounded-full px-3 py-1.5 text-xs tabular-nums transition-colors ${
              on ? 'bg-accent font-medium text-ink' : 'border border-line bg-raised text-muted'
            }`}
          >
            {value}
            {suffix}
          </button>
        );
      })}
    </div>
  );
}
