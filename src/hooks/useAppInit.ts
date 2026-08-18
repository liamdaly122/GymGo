import { useEffect, useState } from 'react';
import { seedIfEmpty } from '@/db/seed';

type InitState = 'seeding' | 'ready' | 'failed';

/**
 * Prepares the local database on launch.
 *
 * Only the very first run does real work — after that the seed check is a
 * single count and resolves immediately, so this never becomes a splash screen
 * standing between the user and logging a set.
 */
export function useAppInit(): { state: InitState; error: Error | null } {
  const [state, setState] = useState<InitState>('seeding');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    seedIfEmpty()
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, error };
}
