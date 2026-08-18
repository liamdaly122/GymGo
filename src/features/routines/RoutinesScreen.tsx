import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRoutines } from '@/db/queries';
import { createRoutine } from '@/db/mutations';
import { Button, Card, EmptyState, Screen, ScreenTitle } from '@/components/ui';

export default function RoutinesScreen() {
  const routines = useRoutines();
  const navigate = useNavigate();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const routineId = await createRoutine(trimmed);
    setName('');
    setNaming(false);
    void navigate(`/routines/${routineId}`);
  };

  return (
    <Screen>
      <ScreenTitle
        action={
          <button onClick={() => setNaming(true)} className="text-xs text-accent">
            New
          </button>
        }
      >
        Routines
      </ScreenTitle>

      {naming ? (
        <Card className="mb-4 p-4">
          <label htmlFor="routine-name" className="mb-2 block text-xs uppercase tracking-wide text-muted">
            Routine name
          </label>
          <input
            id="routine-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
              if (event.key === 'Escape') setNaming(false);
            }}
            placeholder="Lower A, Push, Full body…"
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

      {routines === undefined ? null : routines.length === 0 && !naming ? (
        <EmptyState
          title="No routines yet."
          hint="A routine is a template. Starting a workout copies it, so editing it later never changes a session you have already done."
        />
      ) : (
        <ul className="space-y-2">
          {routines.map((routine) => (
            <li key={routine.id}>
              <Link to={`/routines/${routine.id}`} className="block">
                <Card className="flex items-center justify-between gap-3 p-4 active:bg-raised">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{routine.name}</span>
                    {routine.notes ? (
                      <span className="block truncate text-xs text-muted">{routine.notes}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted">Open</span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
