import { describe, expect, it } from 'vitest';
import {
  marksBroken,
  prsHitInSession,
  recordMarks,
  recordSetIds,
  recordsBrokenPerSession,
  setBreaksRecord,
} from './prs';
import { estimate1RM } from './epley';
import { makeDropSet, makeSet } from './testFactories';

/**
 * The one test every record passes through, and the flash on Done that reads
 * it. Stated in both directions, like the rest of the counting rules: what
 * must count, and what must never.
 */
describe('what a lift stands at', () => {
  it('reads the heaviest set, the best estimated max and the most unloaded reps', () => {
    const marks = recordMarks([
      makeSet({ weight_kg: 100, reps: 5 }),
      makeSet({ weight_kg: 90, reps: 10 }),
    ]);
    expect(marks).toEqual({ weight: 100, e1rm: estimate1RM(90, 10), unloadedReps: 0 });
  });

  it('is nothing at all when no set can be a record', () => {
    const { children } = makeDropSet({ weight_kg: 100, reps: 5 }, [80]);
    expect(recordMarks([makeSet({ type: 'warmup', weight_kg: 60 }), ...children])).toBeNull();
    expect(recordMarks([makeSet({ completed: false })])).toBeNull();
  });
});

describe('beating what came before', () => {
  const marks = (weight: number, e1rm: number, unloadedReps = 0) => ({ weight, e1rm, unloadedReps });

  it('needs strictly more: equalling a record is not breaking it', () => {
    expect(marksBroken(marks(100, 116), marks(100, 116))).toEqual([]);
    expect(marksBroken(marks(102.5, 116), marks(100, 116))).toEqual(['weight']);
    expect(marksBroken(marks(100, 120), marks(100, 116))).toEqual(['e1rm']);
  });

  it('counts reps only where nothing was ever added', () => {
    expect(marksBroken(marks(0, 0, 12), marks(0, 0, 10))).toEqual(['reps']);
    // Once weight goes on, more reps at that weight is an estimated-max record
    // already. Counting reps as well would double every one of them.
    expect(marksBroken(marks(0, 0, 12), marks(5, 6, 10))).toEqual([]);
  });

  it('never calls an estimated max of zero a record', () => {
    expect(marksBroken(marks(0, 0, 8), marks(0, 0, 8))).toEqual([]);
  });
});

describe('records hit in a session, for bodyweight work', () => {
  const pullUps = (reps: number) => makeSet({ weight_kg: 0, reps });

  it('makes more reps with nothing added a record', () => {
    const hits = prsHitInSession([pullUps(12)], [pullUps(10)]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'reps', value: 12, previous: 10 });
  });

  it('reports a first session as reps, not as a 0kg estimated max', () => {
    const hits = prsHitInSession([pullUps(8)], []);
    expect(hits.map((hit) => hit.kind)).toEqual(['reps']);
    expect(hits[0]).toMatchObject({ value: 8, previous: null });
  });

  it('leaves loaded lifts exactly as they were', () => {
    const hits = prsHitInSession([makeSet({ weight_kg: 105, reps: 5 })], [makeSet({ weight_kg: 100, reps: 5 })]);
    expect(hits.map((hit) => hit.kind)).toEqual(['weight', 'e1rm']);
  });

  it('counts a session list’s unloaded record once', () => {
    const counts = recordsBrokenPerSession([
      { id: 'a', exercises: [{ exerciseId: 'pull', sets: [pullUps(8)] }] },
      { id: 'b', exercises: [{ exerciseId: 'pull', sets: [pullUps(10)] }] },
      { id: 'c', exercises: [{ exerciseId: 'pull', sets: [pullUps(10)] }] },
    ]);
    expect([...counts.values()]).toEqual([0, 1, 0]);
  });
});

describe('the record flash on Done', () => {
  const prior = recordMarks([makeSet({ weight_kg: 100, reps: 5 })]);

  it('flashes a heavier set, with what it beat', () => {
    expect(setBreaksRecord(makeSet({ weight_kg: 102.5, reps: 3 }), prior, [])).toEqual({
      kind: 'weight',
      value: 102.5,
      previous: 100,
    });
  });

  it('flashes a better estimated max at a weight already lifted', () => {
    const record = setBreaksRecord(makeSet({ weight_kg: 100, reps: 7 }), prior, []);
    expect(record?.kind).toBe('e1rm');
    expect(record?.value).toBeCloseTo(estimate1RM(100, 7));
    expect(record?.previous).toBeCloseTo(estimate1RM(100, 5));
  });

  it('reports the heaviest news when a set beats more than one mark', () => {
    expect(setBreaksRecord(makeSet({ weight_kg: 105, reps: 5 }), prior, [])?.kind).toBe('weight');
  });

  it('stays quiet for a tie', () => {
    expect(setBreaksRecord(makeSet({ weight_kg: 100, reps: 5 }), prior, [])).toBeNull();
  });

  it('stays quiet on a lift’s first session: there is nothing to beat', () => {
    expect(setBreaksRecord(makeSet({ weight_kg: 140, reps: 5 }), null, [])).toBeNull();
  });

  it('never flashes a drop, a warm-up or a back-off set, however heavy', () => {
    const { children } = makeDropSet({ weight_kg: 100, reps: 5 }, [120]);
    expect(setBreaksRecord(children[0]!, prior, [])).toBeNull();
    expect(setBreaksRecord(makeSet({ type: 'warmup', weight_kg: 150, reps: 5 }), prior, [])).toBeNull();
    expect(setBreaksRecord(makeSet({ type: 'back_off', weight_kg: 150, reps: 5 }), prior, [])).toBeNull();
  });

  it('raises the bar with each set done today', () => {
    const first = makeSet({ weight_kg: 102.5, reps: 5 });
    expect(setBreaksRecord(makeSet({ weight_kg: 102.5, reps: 5 }), prior, [first])).toBeNull();
    expect(setBreaksRecord(makeSet({ weight_kg: 105, reps: 3 }), prior, [first])?.previous).toBe(102.5);
  });

  it('does not let a set beat itself', () => {
    const set = makeSet({ weight_kg: 102.5, reps: 5 });
    expect(setBreaksRecord(set, prior, [set])?.kind).toBe('weight');
  });

  it('flashes more pull-ups with nothing added', () => {
    const before = recordMarks([makeSet({ weight_kg: 0, reps: 10 })]);
    expect(setBreaksRecord(makeSet({ weight_kg: 0, reps: 11 }), before, [])).toEqual({
      kind: 'reps',
      value: 11,
      previous: 10,
    });
    expect(setBreaksRecord(makeSet({ weight_kg: 0, reps: 10 }), before, [])).toBeNull();
  });
});

describe('which chips light up', () => {
  const prior = recordMarks([makeSet({ weight_kg: 100, reps: 5 })]);

  it('marks each set that was a record when it was ticked, in the order they were ticked', () => {
    const one = makeSet({ id: 'one', weight_kg: 102.5, reps: 5, set_index: 0, completed_at: '2026-09-01T10:00:00.000Z' });
    const two = makeSet({ id: 'two', weight_kg: 102.5, reps: 5, set_index: 1, completed_at: '2026-09-01T10:04:00.000Z' });
    const three = makeSet({ id: 'three', weight_kg: 105, reps: 3, set_index: 2, completed_at: '2026-09-01T10:08:00.000Z' });
    expect([...recordSetIds([three, two, one], prior)]).toEqual(['one', 'three']);
  });

  it('lights nothing on a first session, or for sets not yet done', () => {
    expect(recordSetIds([makeSet({ weight_kg: 140 })], null).size).toBe(0);
    expect(recordSetIds([makeSet({ weight_kg: 140, completed: false })], prior).size).toBe(0);
  });
});
