/**
 * Which exercise in a superset actually gets the rest.
 *
 * A superset is two or more exercises performed back to back with rest only at
 * the end of the round. Starting the timer after each one would turn an A1/A2
 * pair into two ordinary exercises with a long gap between them, which is the
 * opposite of the technique.
 *
 * Pure so the rule is tested directly rather than re-derived on the screen.
 */

export interface SupersetMember {
  id: string;
  superset_group: string | null;
}

/**
 * Does rest run after this exercise?
 *
 * Yes when it is not in a superset at all, and yes when it is the last member
 * of its group in the session's order. A group with one member left in it —
 * because the others were removed or swapped out — behaves like an ordinary
 * exercise, which is the only sensible reading.
 */
export function restsAfter(entries: SupersetMember[], index: number): boolean {
  const entry = entries[index];
  if (!entry) return false;
  if (entry.superset_group === null) return true;
  return !entries
    .slice(index + 1)
    .some((later) => later.superset_group === entry.superset_group);
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
