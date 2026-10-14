/**
 * Who logs sets for the workout on screen: the watch, or this phone.
 *
 * While the watch runs the session the phone is the companion you pick up
 * between stations: the session list, the notes, swaps, fixing a set. It
 * shows no set in hand, no Done bar and no rest of its own, because two
 * surfaces logging the same set is how a set gets logged twice and a rest
 * buzzes twice (decision 8, docs/native-roadmap.md).
 *
 * The phone takes logging back the moment there is no watch session to
 * defer to, so a flat battery never strands a workout. The order of the
 * checks is the contract's (docs/watch-protocol.md, "Who logs sets"), and
 * each one only ever hands logging to the phone: the watch logs only when
 * nothing says otherwise.
 *
 * Staleness is judged on the phone's own clock (`receivedAt`), never the
 * watch's, so a drift between the two clocks cannot flip who logs.
 *
 * Pure. The store is src/platform/watchState.ts; screens read both through
 * `useCompanionMode`.
 */
import { setInHand, type OrderedSet } from './supersets';
import type { ReceivedWatchState, WatchStateReport } from './watchProtocol';

/**
 * How long a report counts for. The watch reports on every change and every
 * 30 seconds while its workout session runs, so five minutes of silence means
 * it has gone: out of range, flat, or its session ended without a word.
 */
export const WATCH_STALE_MS = 5 * 60_000;

/**
 * How long a report counts for while it says the workout is paused. A pause
 * is a deliberate break, not a watch gone missing, and whether watchOS keeps
 * a paused workout's app running for the 30-second heartbeat is only provable
 * on the device. An hour of a pause is long enough for a phone call, and short
 * enough that a watch which really has gone does not hold the session for ever.
 */
export const WATCH_PAUSED_STALE_MS = 60 * 60_000;

/**
 * How long this report counts for: five minutes, or an hour while it says the
 * workout is paused. The one rule, read by `loggingSurface` and by
 * `useCompanionMode`'s clock, so the two can never disagree about when a
 * report runs out.
 */
export function staleAfter(report: Pick<WatchStateReport, 'paused'>): number {
  return report.paused ? WATCH_PAUSED_STALE_MS : WATCH_STALE_MS;
}

/** Why the phone logs. */
export type PhoneReason = 'no-watch' | 'other-workout' | 'ended' | 'stale' | 'taken-back';

export type LoggingSurface = { on: 'watch' } | { on: 'phone'; why: PhoneReason };

/**
 * "Log on this phone", as the phone stored it: for this workout, at this time
 * on the phone's clock. Structural, so the domain needs nothing from the
 * platform layer; src/platform/watchState.ts holds the real one.
 */
export interface TakeBack {
  workoutId: string;
  at: string;
}

const phone = (why: PhoneReason): LoggingSurface => ({ on: 'phone', why });

/**
 * Has the watch seen this take-back? Only if it reports a claim at least as
 * new. A time that will not parse proves nothing, so it counts as unseen and
 * the phone keeps logging: the take-back was the lifter's own tap.
 */
function sawClaim(seenPhoneClaim: string | null, takenBackAt: string): boolean {
  if (seenPhoneClaim === null) return false;
  const seen = Date.parse(seenPhoneClaim);
  const taken = Date.parse(takenBackAt);
  if (!Number.isFinite(seen) || !Number.isFinite(taken)) return false;
  return seen >= taken;
}

/**
 * The companion rule, in the contract's order:
 *
 *  1. no report → phone (`no-watch`);
 *  2. the report is for another workout → phone (`other-workout`);
 *  3. the watch's session is `ended` or `none` → phone (`ended`);
 *  4. nothing heard for longer than the report counts for (`staleAfter`:
 *     five minutes, or an hour while paused) → phone (`stale`);
 *  5. the watch says the phone logs → phone (`taken-back`);
 *  6. this phone took logging back and the watch has not seen it yet →
 *     phone (`taken-back`): the switch is immediate, not a round trip later;
 *  7. otherwise the watch logs.
 *
 * `now` is the phone's clock, epoch ms.
 */
export function loggingSurface(
  report: ReceivedWatchState | null,
  workoutId: string,
  now: number,
  takeBack: TakeBack | null,
): LoggingSurface {
  if (!report) return phone('no-watch');
  if (report.workoutId !== workoutId) return phone('other-workout');
  if (report.session !== 'running') return phone('ended');
  if (now - report.receivedAt > staleAfter(report)) return phone('stale');
  if (report.owner === 'phone') return phone('taken-back');
  if (takeBack && takeBack.workoutId === workoutId && !sawClaim(report.seenPhoneClaim, takeBack.at)) {
    return phone('taken-back');
  }
  return { on: 'watch' };
}

/**
 * The watch took logging back from this phone: the phone had taken it for
 * this workout, and the watch, having seen that, chose "Log here instead".
 * Only true while the watch is the one logging, so a reclaim from a watch
 * that has since gone quiet is not announced.
 */
export function watchReclaimed(
  report: ReceivedWatchState | null,
  workoutId: string,
  now: number,
  takeBack: TakeBack | null,
): boolean {
  if (!report || !takeBack || takeBack.workoutId !== workoutId) return false;
  return loggingSurface(report, workoutId, now, takeBack).on === 'watch' && sawClaim(report.seenPhoneClaim, takeBack.at);
}

/**
 * Which stations still have work in them, as one side counts it: a set not
 * ticked, and not one of `skipped`.
 *
 * The phone's own logging passes nothing skipped: a set skipped on the wrist
 * is still there to log once the phone has taken over. The companion passes
 * the watch's `skipped`, the sets it will not ask for, so the station it
 * names as Up next (`nextStation` over these) is the one the watch goes to.
 *
 * `stations` are indices into `exercises`, as `sessionStations` returns them.
 */
export function openStations(
  stations: ReadonlyArray<ReadonlyArray<number>>,
  exercises: ReadonlyArray<{ sets: ReadonlyArray<{ id: string; completed: boolean }> }>,
  skipped: ReadonlyArray<string> = [],
): boolean[] {
  const passed = new Set(skipped);
  return stations.map((station) =>
    station.some((member) => exercises[member]?.sets.some((set) => !set.completed && !passed.has(set.id)) ?? false),
  );
}

/**
 * Which station holds the set the watch has in hand, or null when the watch
 * names no set, or one this session no longer has (deleted, or swapped away).
 *
 * `stations` are indices into `exercises`, as `sessionStations` returns them;
 * a child set and a warm-up live in their exercise's sets like any other, so
 * they find their station too.
 */
export function watchStation(
  stations: ReadonlyArray<ReadonlyArray<number>>,
  exercises: ReadonlyArray<{ sets: ReadonlyArray<{ id: string }> }>,
  setId: string | null,
): number | null {
  if (setId === null) return null;
  const index = stations.findIndex((station) =>
    station.some((member) => exercises[member]?.sets.some((set) => set.id === setId) ?? false),
  );
  return index === -1 ? null : index;
}

/**
 * The companion's card for one station: each member's next set, the one the
 * watch has in hand where it is, and which member is current.
 *
 * Read past the sets the watch skipped, since it will not ask for them: a
 * superset's partner shows the set the watch goes to next, not one it
 * skipped. Counted as passed rather than taken out, so the rounds stay in
 * line; taken out, a member's later sets would slide a round earlier and the
 * wrong half would be current. A station with only skipped sets left gets
 * them back, as the watch does when it goes there.
 *
 * `members` holds one list per exercise in the station, each in set order.
 */
export function companionTargets(
  members: ReadonlyArray<ReadonlyArray<OrderedSet>>,
  watchSetId: string | null,
  skipped: ReadonlyArray<string> = [],
): { watchMember: number; current: number; targets: Array<string | null>; skippedOnly: boolean[] } {
  const passed = new Set(skipped);
  const remaining = members.map((sets) => sets.map((set) => (passed.has(set.id) ? { ...set, completed: true } : set)));
  const lists = setInHand(remaining) ? remaining : members.map((sets) => [...sets]);
  // The member the watch is on, else whoever is next in the order the work is done.
  const watchMember = members.findIndex((sets) => sets.some((set) => set.id === watchSetId));
  const current = watchMember !== -1 ? watchMember : (setInHand(lists)?.member ?? -1);
  const targets = lists.map((sets, member) => (member === watchMember ? watchSetId : (setInHand([sets])?.setId ?? null)));
  // Nothing left to ask for only because the watch skipped what is left: not "All sets done".
  const skippedOnly = targets.map((target, member) => target === null && members[member]!.some((set) => !set.completed));
  return { watchMember, current, targets, skippedOnly };
}
