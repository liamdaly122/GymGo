/**
 * Record IDs are UUIDs generated on the client, so a record exists and is valid
 * before the server has ever seen it. This is what lets the app write freely
 * offline and reconcile later.
 */
export function newId(): string {
  return crypto.randomUUID();
}
