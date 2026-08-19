import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeToSyncStatus, type SyncStatus } from '@/sync/status';

/**
 * Read-only view of sync for the indicator.
 *
 * Subscribes to a store rather than awaiting anything, which is the mechanism
 * behind the brief's rule: the interface observes what sync has done, it never
 * waits for it to do it.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeToSyncStatus, getSyncStatus, getSyncStatus);
}
