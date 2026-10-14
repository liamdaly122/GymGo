import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two lists behind Today's "Finished on your watch": kept across a
 * reload, safe when storage refuses, and heard by a screen that is open.
 */
const storage = new Map<string, string>();
let refuse = false;
const stub = {
  getItem: (key: string) => {
    if (refuse) throw new Error('storage refused');
    return storage.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (refuse) throw new Error('storage refused');
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    if (refuse) throw new Error('storage refused');
    storage.delete(key);
  },
};

beforeEach(() => {
  storage.clear();
  refuse = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
  vi.resetModules();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

const fresh = () => import('./celebrate');

describe('the celebration lists', () => {
  it('start empty', async () => {
    const { finishedOnWatch, celebrated } = await fresh();
    expect(finishedOnWatch()).toEqual([]);
    expect(celebrated()).toEqual([]);
  });

  it('keep what the drain and the summary wrote across a reload', async () => {
    const first = await fresh();
    first.recordFinishedOnWatch(['w-1'], '2026-10-14T18:00:00.000Z');
    first.markCelebrated('w-0');
    vi.resetModules();
    const again = await fresh();
    expect(again.finishedOnWatch()).toEqual([{ id: 'w-1', at: '2026-10-14T18:00:00.000Z' }]);
    expect(again.celebrated()).toEqual(['w-0']);
  });

  it('note a workout once, at its latest finish, and keep only the newest thirty', async () => {
    const { recordFinishedOnWatch, finishedOnWatch, markCelebrated, celebrated } = await fresh();
    recordFinishedOnWatch(['w-1'], '2026-10-14T18:00:00.000Z');
    recordFinishedOnWatch(['w-1'], '2026-10-14T18:05:00.000Z');
    expect(finishedOnWatch()).toEqual([{ id: 'w-1', at: '2026-10-14T18:05:00.000Z' }]);
    recordFinishedOnWatch(Array.from({ length: 40 }, (_, index) => `w-${index + 2}`));
    expect(finishedOnWatch()).toHaveLength(30);
    expect(finishedOnWatch().at(-1)?.id).toBe('w-41');
    for (let index = 0; index < 35; index += 1) markCelebrated(`w-${index}`);
    markCelebrated('w-3');
    expect(celebrated()).toHaveLength(30);
    expect(celebrated().at(-1)).toBe('w-3');
  });

  it('tell a screen that is open, and keep the same snapshot until something changes', async () => {
    const { getCelebrations, subscribeCelebrations, recordFinishedOnWatch, markCelebrated } = await fresh();
    const heard = vi.fn();
    const stop = subscribeCelebrations(heard);
    const before = getCelebrations();
    expect(getCelebrations()).toBe(before);
    recordFinishedOnWatch(['w-1']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(getCelebrations()).not.toBe(before);
    markCelebrated('w-1');
    markCelebrated('w-1');
    // Seen twice in a row is one change.
    expect(heard).toHaveBeenCalledTimes(2);
    recordFinishedOnWatch([]);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    markCelebrated('w-2');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('carry on in memory where storage refuses, and read rubbish as nothing', async () => {
    storage.set('gymgo.celebrate.finishedOnWatch', 'not json');
    storage.set('gymgo.celebrate.celebrated', JSON.stringify(['w-0', 7, null]));
    const { finishedOnWatch, celebrated, recordFinishedOnWatch, markCelebrated } = await fresh();
    expect(finishedOnWatch()).toEqual([]);
    expect(celebrated()).toEqual(['w-0']);
    refuse = true;
    recordFinishedOnWatch(['w-1'], '2026-10-14T18:00:00.000Z');
    markCelebrated('w-1');
    expect(finishedOnWatch()).toEqual([{ id: 'w-1', at: '2026-10-14T18:00:00.000Z' }]);
    expect(celebrated()).toEqual(['w-0', 'w-1']);
  });

  it('start empty where there is no storage at all', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    const { finishedOnWatch, recordFinishedOnWatch } = await fresh();
    expect(finishedOnWatch()).toEqual([]);
    recordFinishedOnWatch(['w-1'], '2026-10-14T18:00:00.000Z');
    expect(finishedOnWatch()).toEqual([{ id: 'w-1', at: '2026-10-14T18:00:00.000Z' }]);
  });
});
