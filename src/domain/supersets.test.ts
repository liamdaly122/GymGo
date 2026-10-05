import { describe, expect, it } from 'vitest';
import {
  nextStation,
  restsAfterSet,
  sessionStations,
  setInHand,
  supersetLabel,
  type OrderedSet,
  type SupersetMember,
} from './supersets';

const entries = (...groups: (string | null)[]): SupersetMember[] =>
  groups.map((superset_group, index) => ({ id: `e${index}`, superset_group }));

/** A set as the running order sees it. Ids read as "<member><round>". */
const set = (
  id: string,
  options: { type?: string; done?: boolean; parent?: string | null } = {},
): OrderedSet => ({
  id,
  type: options.type ?? 'working',
  completed: options.done ?? false,
  parent_set_id: options.parent ?? null,
});

describe('the set in hand', () => {
  it('works through a solo exercise in order', () => {
    const members = [[set('a1', { done: true }), set('a2'), set('a3')]];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'a2' });
  });

  it('alternates the halves of a superset round by round', () => {
    // The whole point of a superset: A1, A2, A1, A2 — not all of A1 first.
    const order: string[] = [];
    const members = [
      [set('a1'), set('a2'), set('a3')],
      [set('b1'), set('b2'), set('b3')],
    ];
    for (let next = setInHand(members); next; next = setInHand(members)) {
      order.push(next.setId);
      members[next.member]!.find((candidate) => candidate.id === next!.setId)!.completed = true;
    }
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  });

  it('carries on with the longer half once the shorter one runs out', () => {
    const members = [
      [set('a1', { done: true }), set('a2', { done: true }), set('a3')],
      [set('b1', { done: true }), set('b2', { done: true })],
    ];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'a3' });
  });

  it('puts every warm-up before the first working set of the pair', () => {
    const members = [
      [set('aw1', { type: 'warmup', done: true }), set('aw2', { type: 'warmup' }), set('a1')],
      [set('bw1', { type: 'warmup' }), set('b1')],
    ];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'aw2' });
    members[0]![1]!.completed = true;
    expect(setInHand(members)).toEqual({ member: 1, setId: 'bw1' });
    members[1]![0]!.completed = true;
    expect(setInHand(members)).toEqual({ member: 0, setId: 'a1' });
  });

  it('takes a child set straight after its parent, before the partner', () => {
    // A drop is done the moment the top set ends, not after the other half.
    const members = [
      [set('a1', { done: true }), set('a1-drop', { type: 'drop', parent: 'a1' }), set('a2')],
      [set('b1'), set('b2')],
    ];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'a1-drop' });
  });

  it('does a parent unticked after its child before the child', () => {
    const members = [[set('a1'), set('a1-drop', { type: 'drop', parent: 'a1' })]];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'a1' });
  });

  it('still reaches a set nothing else orders', () => {
    // A continuation hanging off a warm-up is not part of any round.
    const members = [
      [set('w1', { type: 'warmup', done: true }), set('w1-drop', { type: 'drop', parent: 'w1' }), set('a1', { done: true })],
    ];
    expect(setInHand(members)).toEqual({ member: 0, setId: 'w1-drop' });
  });

  it('is empty once everything is ticked', () => {
    expect(setInHand([[set('a1', { done: true })], [set('b1', { done: true })]])).toBeNull();
    expect(setInHand([])).toBeNull();
    expect(setInHand([[]])).toBeNull();
  });
});

describe('when rest runs', () => {
  it('runs after every set of a solo exercise', () => {
    const members = [[set('a1', { done: true }), set('a2')]];
    expect(restsAfterSet(members, 0, 'a1')).toBe(true);
  });

  it('skips the first half of a pair and runs after the second', () => {
    const members = [
      [set('a1', { done: true }), set('a2')],
      [set('b1'), set('b2')],
    ];
    // A1 runs straight into A2, and rest comes after the round.
    expect(restsAfterSet(members, 0, 'a1')).toBe(false);
    members[1]![0]!.completed = true;
    expect(restsAfterSet(members, 1, 'b1')).toBe(true);
  });

  it('handles a giant set of three', () => {
    const members = [[set('a1', { done: true })], [set('b1')], [set('c1')]];
    expect(restsAfterSet(members, 0, 'a1')).toBe(false);
    members[1]![0]!.completed = true;
    expect(restsAfterSet(members, 1, 'b1')).toBe(false);
    members[2]![0]!.completed = true;
    expect(restsAfterSet(members, 2, 'c1')).toBe(true);
  });

  it('rests after the extra set of the longer half', () => {
    // Nothing is left to alternate with, so A1's third set ends a round too.
    const members = [
      [set('a1', { done: true }), set('a2', { done: true }), set('a3', { done: true })],
      [set('b1', { done: true }), set('b2', { done: true })],
    ];
    expect(restsAfterSet(members, 0, 'a3')).toBe(true);
  });

  it('treats a group left with one member as an ordinary exercise', () => {
    // The partner was swapped out or removed mid-session.
    expect(restsAfterSet([[set('a1', { done: true })]], 0, 'a1')).toBe(true);
  });

  it('never runs after a warm-up or a continuation', () => {
    const members = [
      [
        set('w1', { type: 'warmup', done: true }),
        set('a1', { done: true }),
        set('a1-drop', { type: 'drop', parent: 'a1', done: true }),
      ],
    ];
    expect(restsAfterSet(members, 0, 'w1')).toBe(false);
    expect(restsAfterSet(members, 0, 'a1-drop')).toBe(false);
  });

  it('says no for a set it cannot find', () => {
    expect(restsAfterSet([[set('a1')]], 0, 'missing')).toBe(false);
    expect(restsAfterSet([[set('a1')]], 3, 'a1')).toBe(false);
  });
});

describe('labels', () => {
  it('letters groups in the order they appear', () => {
    const list = entries('x', 'x', null, 'q', 'q');
    expect([0, 1, 2, 3, 4].map((i) => supersetLabel(list, i))).toEqual([
      'A1', 'A2', null, 'B1', 'B2',
    ]);
  });

  it('does not label a group of one', () => {
    expect(supersetLabel(entries('a'), 0)).toBeNull();
  });
});

describe('walking the session one stop at a time', () => {
  it('gives a solo exercise a station of its own', () => {
    expect(sessionStations(entries(null, null, null))).toEqual([[0], [1], [2]]);
  });

  it('keeps a superset pair together', () => {
    // Both halves have to be on screen at once: you alternate between them.
    expect(sessionStations(entries('a', 'a'))).toEqual([[0, 1]]);
  });

  it('keeps a giant set of three together', () => {
    expect(sessionStations(entries('a', 'a', 'a'))).toEqual([[0, 1, 2]]);
  });

  it('keeps two supersets apart', () => {
    expect(sessionStations(entries('a', 'a', 'b', 'b'))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('reunites a group whose members are not next to each other', () => {
    // Grouping lives on the rows, so something logged between the halves does
    // not split the pair — it just gets its own stop.
    expect(sessionStations(entries('a', null, 'a'))).toEqual([
      [0, 2],
      [1],
    ]);
  });

  it('treats a group left with one member as a solo stop', () => {
    expect(sessionStations(entries('a'))).toEqual([[0]]);
  });

  it('has no stops at all in an empty session', () => {
    expect(sessionStations([])).toEqual([]);
  });

  it('covers every exercise exactly once', () => {
    const list = entries('a', null, 'b', 'a', 'b', null);
    const visited = sessionStations(list).flat().sort((x, y) => x - y);

    expect(visited).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('where the session goes next', () => {
  it('is the next station with work left', () => {
    expect(nextStation([false, true, true], 0)).toBe(1);
    expect(nextStation([false, false, true, true], 1)).toBe(2);
  });

  it('passes over stations already done', () => {
    expect(nextStation([false, false, false, true], 0)).toBe(3);
  });

  it('comes back round to one skipped earlier', () => {
    // Exercise 2 was taken, so 3 went first: finishing 3 goes back for 2.
    expect(nextStation([false, true, false], 2)).toBe(1);
  });

  it('is nowhere when nothing else has work left', () => {
    expect(nextStation([false, false, false], 1)).toBeNull();
    expect(nextStation([false], 0)).toBeNull();
    expect(nextStation([], 0)).toBeNull();
  });

  it('never points back at the station it leaves, even with work in it', () => {
    expect(nextStation([true, false], 0)).toBeNull();
    expect(nextStation([true, true], 0)).toBe(1);
  });
});
