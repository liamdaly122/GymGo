import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { logBodyMetric, removeBodyMetric } from './mutations';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

const live = async () => (await db.body_metrics.toArray()).filter((entry) => entry.deleted_at === null);

describe('logging body weight', () => {
  it('stores it in kg, on the day given', async () => {
    await logBodyMetric('bodyweight', 81.4, '2026-10-05');

    const [entry] = await live();
    expect(entry).toMatchObject({ metric: 'bodyweight', value: 81.4, unit: 'kg', date: '2026-10-05' });
  });

  it('corrects the day rather than adding a second point to the trend', async () => {
    const first = await logBodyMetric('bodyweight', 81.4, '2026-10-05');
    const second = await logBodyMetric('bodyweight', 80.9, '2026-10-05');

    expect(second).toBe(first);
    const entries = await live();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe(80.9);
  });

  it('keeps one entry a day even when two phones each logged one', async () => {
    await logBodyMetric('bodyweight', 81, '2026-10-05');
    // The other phone's entry, arrived by a pull.
    await db.body_metrics.add({
      ...(await live())[0]!,
      id: 'from-the-other-phone',
    });

    await logBodyMetric('bodyweight', 80.5, '2026-10-05');

    const entries = await live();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe(80.5);
  });

  it('refuses a weight of nothing', async () => {
    await expect(logBodyMetric('bodyweight', 0, '2026-10-05')).rejects.toThrow();
  });

  it('deletes softly, so the delete reaches the backup', async () => {
    const id = await logBodyMetric('bodyweight', 81, '2026-10-05');

    await removeBodyMetric(id);

    expect(await live()).toHaveLength(0);
    expect((await db.body_metrics.get(id))!.deleted_at).not.toBeNull();
  });

  it('queues every row it writes', async () => {
    const id = await logBodyMetric('bodyweight', 81, '2026-10-05');
    await logBodyMetric('bodyweight', 80.5, '2026-10-05');
    await removeBodyMetric(id);

    const queued = (await db.outbox.where({ table_name: 'body_metrics' }).toArray()).map((entry) => entry.op);
    expect(queued).toEqual(['put', 'put', 'delete']);
  });
});
