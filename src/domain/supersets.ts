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
