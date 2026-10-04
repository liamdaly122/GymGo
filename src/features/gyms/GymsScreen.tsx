import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { createGym, setDefaultGym } from '@/db/mutations';
import { BackLink, Button, Screen, ScreenHeader, Sheet } from '@/components/ui';
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
      <BackLink to="/settings">Settings</BackLink>
      <ScreenHeader
        title="Gyms"
        action={
          <Button size="sm" onClick={() => setNaming(true)}>
            Add
          </Button>
        }
      />

      <div className="stack">
        <p className="t-meta">
          Plans, swap suggestions and suggested weights are all built from the equipment at the gym
          you are training in.
        </p>

        <ul className="list">
          {(gyms ?? []).map((gym) => (
            <li key={gym.id}>
              <div className="list-row">
                <Link to={`/gyms/${gym.id}`} className="list-main">
                  <strong>{gym.name}</strong>
                  <span className="t-meta truncate">
                    {gym.equipment_available.length === 0
                      ? 'Nothing selected yet'
                      : gym.equipment_available
                          .slice(0, 4)
                          .map((item) => EQUIPMENT_LABELS[item])
                          .join(', ') +
                        (gym.equipment_available.length > 4
                          ? ` +${gym.equipment_available.length - 4}`
                          : '')}
                  </span>
                </Link>
                <span className="list-end">
                  {gym.is_default ? (
                    <span className="chip chip-hot">Current</span>
                  ) : (
                    <Button size="sm" onClick={() => void setDefaultGym(gym.id)}>
                      Use this
                    </Button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {naming ? (
        <Sheet label="New gym" onClose={() => setNaming(false)}>
          <h2>New gym</h2>
          <label htmlFor="gym-name" className="field-label">
            Gym name
          </label>
          <input
            id="gym-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
            placeholder="Home garage, PureGym, hotel…"
            className="field"
          />
          <Button variant="primary" onClick={() => void handleCreate()}>
            Create
          </Button>
          <Button onClick={() => setNaming(false)}>Cancel</Button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
