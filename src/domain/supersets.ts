/**
 * Supersets: what a station is, the order its sets come up in, and when the
 * rest runs.
 *
 * A superset is two or more exercises performed back to back with rest only at
 * the end of the round. Starting the timer after each one would turn an A1/A2
 * pair into two ordinary exercises with a long gap between them, which is the
 * opposite of the technique.
 *
 * Pure so the rules are tested directly rather than re-derived on the screen.
 */

export interface SupersetMember {
  id: string;
  superset_group: string | null;
}

/**
 * The parts of a set the running order needs.
 *
 * Structural rather than the full row, so this module stays free of the
 * database types and the order is tested on plain objects.
 */
export interface OrderedSet {
  id: string;
  type: string;
  completed: boolean;
  parent_set_id: string | null;
}

/** Where the next set lives: which member of the station, and which set. */
export interface SetInHand {
  member: number;
  setId: string;
}

/** Top-level sets that are not warm-ups — the ones a round is made of. */
function roundSets(sets: OrderedSet[]): OrderedSet[] {
  return sets.filter((set) => set.parent_set_id === null && set.type !== 'warmup');
}

/**
 * The set you are about to do.
 *
 * The logging screen shows one set at a time, so something has to decide which
 * one — and it has to be the order the work is performed in, not the order the
 * rows sit in:
 *
 *  - warm-ups first, member by member: you ramp up before the pair starts;
 *  - then the working sets by round across the station — A1, A2, A1, A2. A
 *    superset is performed by alternating, so finishing every set of A1 before
 *    touching A2 is the one order it is never done in;
 *  - a child set straight after its parent, before the partner's turn: a drop
 *    is done the moment the top set ends.
 *
 * Anything still unticked that none of those reach comes last, so the answer
 * is null only when every set in the station is done.
 *
 * `members` holds one list per exercise in the station, each in set order.
 */
export function setInHand(members: OrderedSet[][]): SetInHand | null {
  for (const [member, sets] of members.entries()) {
    const warmup = sets.find(
      (set) => set.type === 'warmup' && set.parent_set_id === null && !set.completed,
    );
    if (warmup) return { member, setId: warmup.id };
  }

  const rounds = members.map(roundSets);
  const roundCount = Math.max(0, ...rounds.map((list) => list.length));
  for (let round = 0; round < roundCount; round += 1) {
    for (const [member, list] of rounds.entries()) {
      const top = list[round];
      if (!top) continue;
      if (!top.completed) return { member, setId: top.id };
      const child = members[member]!.find(
        (set) => set.parent_set_id === top.id && !set.completed,
      );
      if (child) return { member, setId: child.id };
    }
  }

  for (const [member, sets] of members.entries()) {
    const left = sets.find((set) => !set.completed);
    if (left) return { member, setId: left.id };
  }
  return null;
}

/**
 * Does the rest timer start after this set?
 *
 * Not after a warm-up, and not after a continuation: those run straight on, or
 * rest for the technique's own short gap, which the caller owns. After a
 * working set, rest waits while a later member of the station still has its
 * set to do in this round, and runs once the round is over. That is what a
 * superset is — A1 runs straight into A2, rest comes after the pair — and
 * judging it by round means a pair whose halves have different set counts
 * still rests after A1's extra set, rather than never.
 *
 * A group with one member left in it, because the others were removed or
 * swapped out, has no later member and rests like an ordinary exercise.
 */
export function restsAfterSet(members: OrderedSet[][], member: number, setId: string): boolean {
  const sets = members[member];
  const set = sets?.find((candidate) => candidate.id === setId);
  if (!sets || !set || set.type === 'warmup' || set.parent_set_id !== null) return false;

  const round = roundSets(sets).findIndex((candidate) => candidate.id === setId);
  return !members.slice(member + 1).some((later) => {
    const partner = roundSets(later)[round];
    return partner !== undefined && !partner.completed;
  });
}

/** Position within the group, for the A1 / A2 labels on the card. */
export function supersetLabel(entries: SupersetMember[], index: number): string | null {
  const entry = entries[index];
  if (!entry || entry.superset_group === null) return null;

  const members = entries.filter((other) => other.superset_group === entry.superset_group);
  if (members.length < 2) return null;

  // Groups are lettered in the order they first appear, so the first superset
  // in a session is A regardless of what its id happens to be.
  const groups: string[] = [];
  for (const other of entries) {
    if (other.superset_group !== null && !groups.includes(other.superset_group)) {
      groups.push(other.superset_group);
    }
  }
  const letter = String.fromCharCode(65 + groups.indexOf(entry.superset_group));
  return `${letter}${members.findIndex((member) => member.id === entry.id) + 1}`;
}

/**
 * The session as you actually walk it, one stop at a time.
 *
 * A station is a solo exercise, or a whole superset group. It has to be the
 * group rather than the exercise: a superset is performed by alternating
 * between its members, so showing one at a time would make an A1/A2 pair
 * unloggable — you would be paging back and forth between two screens for
 * every single set.
 *
 * Grouping is read from the stored `superset_group` rather than from
 * adjacency, so members that are not next to each other still form one
 * station; the station takes its place from whichever member comes first. A
 * group left with one member behaves as a solo station, consistent with
 * `supersetLabel` declining to letter it.
 *
 * Returns arrays of indices into `entries`, in the order the session runs.
 */
export function sessionStations(entries: SupersetMember[]): number[][] {
  const stations: number[][] = [];
  const groupStation = new Map<string, number>();

  for (const [index, entry] of entries.entries()) {
    if (entry.superset_group === null) {
      stations.push([index]);
      continue;
    }

    const existing = groupStation.get(entry.superset_group);
    if (existing === undefined) {
      groupStation.set(entry.superset_group, stations.length);
      stations.push([index]);
    } else {
      stations[existing]!.push(index);
    }
  }

  return stations;
}
