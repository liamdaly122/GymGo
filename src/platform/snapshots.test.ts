import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOTS_KEPT,
  latestSnapshot,
  snapshotName,
  snapshotTakenAt,
  snapshotsToPrune,
  sortSnapshots,
  writeSnapshot,
} from './snapshots';

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
});

describe('snapshots outside the app', () => {
  it('write nothing and find nothing', async () => {
    await expect(writeSnapshot('{}')).resolves.toBeUndefined();
    expect(await latestSnapshot()).toBeNull();
  });
});
