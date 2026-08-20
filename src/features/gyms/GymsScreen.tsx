import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { createGym, setDefaultGym } from '@/db/mutations';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import { EQUIPMENT_LABELS } from '@/features/exercises/labels';

/**
 * Where you train, and what is in it.
 *
 * This is the screen everything equipment-aware has been waiting for: plans are
 * filled from what a gym has, swaps are filtered by it, and suggested weights
 * are rounded to the plates it lists.
 */
export default function GymsScreen() {
  const navigate = useNavigate();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const gyms = useLiveQuery(
    async () =>
      (await db.gyms.toArray())
        .filter((gym) => gym.deleted_at === null)
        .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, 'en')),
    [],
  );

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const gymId = await createGym(trimmed);
    setName('');
    setNaming(false);
    void navigate(`/gyms/${gymId}`);
  };

  return (
    <Screen>
      <Link to="/settings" className="mb-3 inline-block text-xs text-muted">
        ← Settings
      </Link>
      <ScreenTitle
        action={
          <button onClick={() => setNaming(true)} className="text-xs text-accent">
            Add
          </button>
        }
      >
        Gyms
      </ScreenTitle>

      <p className="mb-4 text-sm text-muted">
        Plans, swap suggestions and suggested weights are all built from the equipment at the gym
        you are training in.
      </p>

      {naming ? (
        <Card className="mb-4 p-4">
          <label htmlFor="gym-name" className="eyebrow mb-2 block">
            Gym name
          </label>
          <input
            id="gym-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
              if (event.key === 'Escape') setNaming(false);
            }}
            placeholder="Home garage, PureGym, hotel…"
            className="h-11 w-full rounded-xl border border-line bg-raised px-4 text-base text-white placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" onClick={() => void handleCreate()}>
              Create
            </Button>
            <Button className="flex-1" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <ul className="space-y-2">
        {(gyms ?? []).map((gym) => (
          <li key={gym.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/gyms/${gym.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{gym.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {gym.equipment_available.length === 0
                      ? 'Nothing selected yet'
                      : gym.equipment_available
                          .slice(0, 4)
                          .map((item) => EQUIPMENT_LABELS[item])
                          .join(', ') +
                        (gym.equipment_available.length > 4
                          ? ` +${gym.equipment_available.length - 4}`
                          : '')}
                  </p>
                </Link>
                {gym.is_default ? (
                  <Pill tone="accent">Current</Pill>
                ) : (
                  <button
                    onClick={() => void setDefaultGym(gym.id)}
                    className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted active:bg-raised"
                  >
                    Use this
                  </button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
