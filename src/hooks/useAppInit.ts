import { useCallback, useEffect, useState } from 'react';
import { seedIfEmpty } from '@/db/seed';
import { clearGeneratedRests } from '@/db/mutations';
import { hasUserData } from '@/db/queries';
import { importFromJson } from '@/db/backup';
import { onceOnThisPhone } from '@/lib/once';
import { latestSnapshot, snapshotIfDue, type Snapshot } from '@/platform/snapshots';

type InitState = 'seeding' | 'offer' | 'ready' | 'failed';

const DECLINED_KEY = 'gymgo.snapshot.declined';

/**
 * Inside the app, with nothing of the lifter's own in the database and a
 * snapshot on the phone that has not already been turned down: that snapshot.
 * Otherwise null. Outside the app there is never a snapshot.
 */
async function snapshotToOffer(): Promise<Snapshot | null> {
  if (await hasUserData()) return null;
  const snapshot = await latestSnapshot();
  if (!snapshot) return null;
  try {
    if (globalThis.localStorage.getItem(DECLINED_KEY) === snapshot.takenAt) return null;
  } catch {
    // Unreadable storage: offer it anyway.
  }
  return snapshot;
}

/**
 * Prepares the local database on launch.
 *
 * Only the very first run does real work — after that the seed check is a
 * single count and resolves immediately, so this never becomes a splash screen
 * standing between the user and logging a set.
 *
 * Inside the iPhone app there is one more state: iOS can reclaim a web view's
 * storage, so a launch that finds nothing of the lifter's own, and a snapshot
 * on the phone, offers the snapshot back before the app opens.
 */
export function useAppInit(): {
  state: InitState;
  error: Error | null;
  snapshot: Snapshot | null;
  restoreSnapshot: () => Promise<void>;
  startFresh: () => void;
} {
  const [state, setState] = useState<InitState>('seeding');
  const [error, setError] = useState<Error | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    seedIfEmpty()
      // Rest follows the lift now: a plan made before that gives its rows'
      // generated rests back, so the plan already running rests 2:30, 2:00
      // and 1:30 from the next session on.
      .then(() => onceOnThisPhone('rests-follow-the-lift', clearGeneratedRests))
      .then(snapshotToOffer)
      .then((offer) => {
        if (cancelled) return;
        if (offer) {
          setSnapshot(offer);
          setState('offer');
          return;
        }
        setState('ready');
        // A copy of everything once a day, inside the app. Started, never awaited.
        void snapshotIfDue();
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

  const restoreSnapshot = useCallback(async () => {
    if (!snapshot) return;
    try {
      // The import queues every row it restores, so the backup follows.
      await importFromJson(snapshot.json);
      setState('ready');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setState('failed');
    }
  }, [snapshot]);

  const startFresh = useCallback(() => {
    try {
      if (snapshot) globalThis.localStorage.setItem(DECLINED_KEY, snapshot.takenAt);
    } catch {
      // Then it is offered again next launch, which is the safe way round.
    }
    setState('ready');
  }, [snapshot]);

  return { state, error, snapshot, restoreSnapshot, startFresh };
}
