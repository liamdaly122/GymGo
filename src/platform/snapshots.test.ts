import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The app's Documents folder, in memory, and whether the code thinks it is inside the app. */
const h = vi.hoisted(() => {
  const files = new Map<string, string>();
  const state = { native: false };
  const Filesystem = {
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      files.set(path, data);
      return { uri: path };
    },
    readdir: async ({ path }: { path: string }) => ({
      files: [...files.keys()]
        .filter((key) => key.startsWith(`${path}/`))
        .map((key) => ({ name: key.slice(path.length + 1), type: 'file' })),
    }),
    readFile: async ({ path }: { path: string }) => {
      const data = files.get(path);
      if (data === undefined) throw new Error(`No file at ${path}`);
      return { data };
    },
    deleteFile: async ({ path }: { path: string }) => void files.delete(path),
    rmdir: async () => files.clear(),
  };
  return { files, state, Filesystem };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.state.native } }));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: h.Filesystem,
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

const {
  SNAPSHOTS_KEPT,
  latestSnapshot,
  snapshotName,
  snapshotTakenAt,
  snapshotsReplacedBy,
  snapshotsToPrune,
  sortSnapshots,
  writeSnapshot,
} = await import('./snapshots');

afterEach(() => {
  h.state.native = false;
  h.files.clear();
});

describe('snapshot names', () => {
  it('carry the time they were taken, and give it back', () => {
    const at = new Date('2026-10-10T09:12:33.123Z');
    const name = snapshotName(at);
    expect(name).toBe('gymgo-2026-10-10T09-12-33-123Z.json');
    expect(snapshotTakenAt(name)).toBe(at.toISOString());
  });

  it('sort newest first as plain text, and ignore other files', () => {
    const names = [
      'gymgo-2026-10-09T18-00-00-000Z.json',
      '.DS_Store',
      'gymgo-2026-10-10T07-30-00-000Z.json',
      'notes.txt',
      'gymgo-2026-09-30T21-45-10-500Z.json',
    ];
    expect(sortSnapshots(names)).toEqual([
      'gymgo-2026-10-10T07-30-00-000Z.json',
      'gymgo-2026-10-09T18-00-00-000Z.json',
      'gymgo-2026-09-30T21-45-10-500Z.json',
    ]);
    expect(snapshotTakenAt('notes.txt')).toBeNull();
  });

  it('prune to the newest seven', () => {
    const names = Array.from({ length: 10 }, (_, day) =>
      snapshotName(new Date(Date.UTC(2026, 9, day + 1, 12))),
    );
    const pruned = snapshotsToPrune(names);
    expect(pruned).toHaveLength(10 - SNAPSHOTS_KEPT);
    // The oldest three go; the newest stays.
    expect(pruned).toEqual(names.slice(0, 3).reverse());
    expect(pruned).not.toContain(names.at(-1));
  });

  it('a new one replaces any taken in the minute before it, and no other', () => {
    const at = new Date('2026-10-14T19:00:00.000Z');
    const ago = (ms: number) => snapshotName(new Date(at.getTime() - ms));
    const names = [ago(59_999), ago(5_000), ago(60_000), ago(3_600_000), ago(-5_000), snapshotName(at), 'notes.txt'];
    expect(snapshotsReplacedBy(names, at)).toEqual([ago(5_000), ago(59_999)]);
  });
});

describe('snapshots outside the app', () => {
  it('write nothing and find nothing', async () => {
    await expect(writeSnapshot('{}')).resolves.toBeUndefined();
    expect(await latestSnapshot()).toBeNull();
    expect(h.files.size).toBe(0);
  });
});

describe('snapshots inside the app', () => {
  const stored = () => sortSnapshots([...h.files.keys()].map((path) => path.split('/').at(-1)!));

  /**
   * A Finish on the phone, then late sets from the watch put back one drain
   * at a time, seconds apart. Each wrote a full copy, and pushed an older,
   * distinct restore point out of the seven.
   */
  it('keep one copy of a burst, and every older restore point', async () => {
    h.state.native = true;
    const finish = Date.parse('2026-10-14T19:00:00.000Z');
    const days = Array.from({ length: SNAPSHOTS_KEPT - 1 }, (_, back) => new Date(finish - (back + 1) * 86_400_000));
    for (const day of [...days].reverse()) await writeSnapshot(JSON.stringify({ day: day.toISOString() }), day);

    await writeSnapshot('{"after":"finish"}', new Date(finish));
    for (const seconds of [4, 9, 17]) {
      await writeSnapshot(`{"after":"late set ${seconds}"}`, new Date(finish + seconds * 1000));
    }

    expect(stored()).toEqual([snapshotName(new Date(finish + 17_000)), ...days.map(snapshotName)]);
    expect(await latestSnapshot()).toEqual({
      takenAt: new Date(finish + 17_000).toISOString(),
      json: '{"after":"late set 17"}',
    });
  });

  it('keep both when the second comes more than a minute after the first', async () => {
    h.state.native = true;
    const first = new Date('2026-10-14T19:00:00.000Z');
    const second = new Date(first.getTime() + 61_000);
    await writeSnapshot('{"n":1}', first);
    await writeSnapshot('{"n":2}', second);
    expect(stored()).toEqual([snapshotName(second), snapshotName(first)]);
  });
});
