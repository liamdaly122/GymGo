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
import type { ReceivedWatchState } from './watchProtocol';

/**
 * How long a report counts for. The watch reports on every change and every
 * 30 seconds while its workout session runs, so five minutes of silence means
 * it has gone: out of range, flat, or its session ended without a word.
 */
export const WATCH_STALE_MS = 5 * 60_000;

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
 *  4. nothing heard for more than five minutes → phone (`stale`);
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
  if (now - report.receivedAt > WATCH_STALE_MS) return phone('stale');
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
