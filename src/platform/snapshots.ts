import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { exportAsJson } from '@/db/backup';
import { hasUserData } from '@/db/queries';
import { isoDate } from '@/lib/dates';
import { isNativeApp } from './native';

/**
 * A copy of everything, on the phone itself.
 *
 * iOS can reclaim a web view's IndexedDB when the phone runs short of space,
 * and the backup only helps once you are signed in. So inside the app the same
 * JSON as "Export everything" is written into the app's Documents folder after
 * every finished session and once a day, and the newest seven are kept. iOS
 * does not reclaim those files; they go into the phone's own iCloud backup;
 * and they show in Files under On My iPhone → GymGo. On a launch with nothing
 * of the lifter's own in the database, the newest is offered back
 * (useAppInit). A deliberate wipe deletes them, so it is never offered back.
 *
 * Outside the app every function here does nothing and finds nothing.
 */
const FOLDER = 'snapshots';
const PREFIX = 'gymgo-';
const LAST_KEY = 'gymgo.snapshot.at';
export const SNAPSHOTS_KEPT = 7;

/** gymgo-2026-10-10T09-12-33-123Z.json: a name that sorts by time as text. */
export function snapshotName(at: Date): string {
  return `${PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.json`;
}

/** The ISO time a snapshot's name carries, or null for a file that is not one. */
export function snapshotTakenAt(name: string): string | null {
  const match = /^gymgo-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/.exec(name);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : null;
}

/** Newest first, ignoring anything that is not a snapshot. */
export function sortSnapshots(names: readonly string[]): string[] {
  return names.filter((name) => snapshotTakenAt(name) !== null).sort().reverse();
}

/** The names to delete so that only the newest `keep` remain. */
export function snapshotsToPrune(names: readonly string[], keep = SNAPSHOTS_KEPT): string[] {
  return sortSnapshots(names).slice(keep);
}

export interface Snapshot {
  takenAt: string;
  json: string;
}

async function listSnapshots(): Promise<string[]> {
  try {
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: Directory.Documents });
    return files.filter((file) => file.type === 'file').map((file) => file.name);
  } catch {
    return [];
  }
}

export async function writeSnapshot(json: string, at = new Date()): Promise<void> {
  if (!isNativeApp()) return;
  await Filesystem.writeFile({
    path: `${FOLDER}/${snapshotName(at)}`,
    data: json,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  for (const name of snapshotsToPrune(await listSnapshots())) {
    await Filesystem.deleteFile({ path: `${FOLDER}/${name}`, directory: Directory.Documents }).catch(() => {});
  }
}

/**
 * Everything, as "Export everything" writes it. Nothing is written while
 * there is nothing of the lifter's own to keep, or a fresh install would
 * offer its own empty copy back. Failures are logged, never thrown: a
 * snapshot is a safety net, not a step.
 */
export async function snapshotEverything(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (!(await hasUserData())) return;
    await writeSnapshot(JSON.stringify(await exportAsJson()));
    globalThis.localStorage?.setItem(LAST_KEY, new Date().toISOString());
  } catch (cause) {
    console.warn('GymGo: could not write a snapshot.', cause);
  }
}

/** Once a day, on launch. */
export async function snapshotIfDue(today = new Date()): Promise<void> {
  if (!isNativeApp()) return;
  const last = globalThis.localStorage?.getItem(LAST_KEY);
  if (last && isoDate(new Date(last)) === isoDate(today)) return;
  await snapshotEverything();
}

export async function latestSnapshot(): Promise<Snapshot | null> {
  if (!isNativeApp()) return null;
  const [name] = sortSnapshots(await listSnapshots());
  if (!name) return null;
  try {
    const { data } = await Filesystem.readFile({
      path: `${FOLDER}/${name}`,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    if (typeof data !== 'string') return null;
    return { takenAt: snapshotTakenAt(name)!, json: data };
  } catch {
    return null;
  }
}

/** A deliberate wipe takes the snapshots with it, so the wiped data is never offered back. */
export async function deleteSnapshots(): Promise<void> {
  if (!isNativeApp()) return;
  await Filesystem.rmdir({ path: FOLDER, directory: Directory.Documents, recursive: true }).catch(() => {});
}
