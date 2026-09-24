import { describe, expect, it } from 'vitest';
import { restsAfter, sessionStations, supersetLabel, type SupersetMember } from './supersets';

const entries = (...groups: (string | null)[]): SupersetMember[] =>
  groups.map((superset_group, index) => ({ id: `e${index}`, superset_group }));

describe('when rest runs', () => {
  it('runs after every exercise when nothing is supersetted', () => {
    const list = entries(null, null, null);
    expect([0, 1, 2].map((i) => restsAfter(list, i))).toEqual([true, true, true]);
  });

  it('skips the first half of a pair and runs after the second', () => {
    const list = entries('a', 'a');
    // The whole point: A1 runs straight into A2, and rest comes after the round.
    expect(restsAfter(list, 0)).toBe(false);
    expect(restsAfter(list, 1)).toBe(true);
  });

  it('handles a giant set of three', () => {
    const list = entries('a', 'a', 'a');
    expect([0, 1, 2].map((i) => restsAfter(list, i))).toEqual([false, false, true]);
  });

  it('keeps two separate supersets apart', () => {
    const list = entries('a', 'a', 'b', 'b');
    expect([0, 1, 2, 3].map((i) => restsAfter(list, i))).toEqual([false, true, false, true]);
  });

  it('treats a group left with one member as an ordinary exercise', () => {
    // The partner was swapped out or removed mid-session.
    expect(restsAfter(entries('a'), 0)).toBe(true);
  });

  it('rests after a standalone exercise sitting between grouped ones', () => {
    const list = entries('a', null, 'a');
    // The pair is still a pair even with something logged between them, so rest
    // waits for the second half.
    expect([0, 1, 2].map((i) => restsAfter(list, i))).toEqual([false, true, true]);
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
