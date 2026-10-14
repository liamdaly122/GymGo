# Phone ⇄ watch: the protocol

The shapes are in `src/domain/watchProtocol.ts` and, mirrored field for field,
`ios/GymGoKit/Sources/GymGoKit/Protocol.swift`. This file is the rules: who
sends what, when, and how the other side applies it. It was written for the
round of work after build 4 (`docs/native-roadmap.md`, "Feedback from build 4")
and decisions 8, 9 and 13.

## The one hard fact

iOS freezes the phone app's JavaScript while the phone is locked. Native code
(`ios/App/App/WatchLink.swift`, started from `AppDelegate`) can still receive,
but nothing in Dexie changes until the phone app is opened. So the watch runs
a whole session from what the phone sent beforehand, and everything the watch
does waits in a native inbox until the web app drains it.

## Transport

| Direction | What | How | Ordering and delivery |
|---|---|---|---|
| Phone → watch | `WatchContext` | `updateApplicationContext(["context": json])`, the whole thing every time | Newest wins. The watch ignores a context whose `sentAt` is older than the last one applied. |
| Phone → watch | Acknowledgements | `transferUserInfo(["ack": [ids]])` | Queued, guaranteed. |
| Watch → phone | `WatchEvent` | `transferUserInfo(["event": json])`, plus `sendMessage(["event": json])` when reachable | Two copies; applied once by `id`. |
| Watch → phone | `WatchStateReport` | the watch's own `updateApplicationContext(["state": json])`, plus `sendMessage(["state": json])` when reachable | Newest `seq` wins. Never queued, never acknowledged. |
| Phone → watch app launch | — | `HKHealthStore.startWatchApp(toHandle:)` with a traditionalStrengthTraining configuration | Wakes the watch app into `WKApplicationDelegate.handle(_:)`, the only place a watch app may start a workout session from the background. |

The old `["snapshot": json]` key is gone: everything the phone sends is inside
`context`.

## Phone → watch: the context

The phone builds and sends a context whenever any of these change, a moment
later so a burst of writes sends one: workouts, workout exercises, sets,
routines, routine exercises, plans, exercises, gyms, settings. Also at launch,
on resume and at local midnight, and **never while an inbox drain is running**
(wait for it): a stale `ready` must not go out while a watch start is waiting
to be applied.

- **`live`**: the workout open on the phone, built by `buildWatchSnapshot`.
  Null when none is open. If more than one is open (it should not happen; see
  "Phone bugs to fix"), the newest.
- **`home`**: built by the phone from the schedule, the same rules as Today.
  - `ready` is the session `currentSession` offers, laid out as it would start
    (`planRoutineStart`, nothing written) with real random UUIDs, its snapshot
    built from those rows, and the layout as a JSON string the watch echoes
    back in its start. Null while a workout is open.
  - The watch uses each offer's IDs once. After a Discard on the wrist it may
    start the same offer again under IDs it mints itself (`FreshIds.swift`):
    lowercase v4 UUIDs for `workoutId`, `exercises[].id` and
    `exercises[].sets[].id`, in the layout and the snapshot alike, with the
    routine, gym, plan and library exercise IDs unchanged. Those three are
    the only fields it rewrites, so **a new row ID added to the layout must be
    added to `LayoutIds` in `FreshIds.swift` too.** A Discard on the phone of
    a wrist-started session gives its offer back, as does a context listing
    that workout in `closed` while still offering the same key.
  - `closed` lists the newest 20 workouts that **ended on the phone**
    (`CLOSED_KEPT` in `src/db/watch.ts`), whatever their age, newest first:
    finished (`finished_at` set) or discarded (`deleted_at` set) after being
    started. This is how Finish and Discard on the phone reach the watch. A
    count rather than an age, so a watch out of touch for days still hears.
  - `week` is the current calendar week, as the phone's calendar strip shows it.
- **`phoneClaim`**: set when the user taps "Log on this phone" for a workout.
- **`settings`**: the phone's Sound and Vibrate switches.

## Watch → phone: events

| Kind | Sent when | Phone applies it by |
|---|---|---|
| `startWorkout` | Start on the watch's Today page | `replayWatchStart(layout, at)`: writes exactly the workout, exercise and set rows in the layout, with `started_at = at`. Skipped if a workout with that ID already exists, even a deleted one. Filed under the block slot the layout was offered for only if that slot is still the one `planSlot` gives now; otherwise filed with the plan but no week or session index. If an empty workout is open on the phone, it is discarded first; one with sets is kept and both stay open. Exercises missing from the library are dropped with their sets. The layout may carry IDs the watch minted (see `ready` above). |
| `completeSet` | Done or double tap (the Action button is not wired up yet: it needs an App Intent, roadmap 4.4) | `completeSetWith(setId, {weight, reps}, {completedAt: at})`. **Deferred** (left in the inbox, not acknowledged) while the workout row does not exist yet. Skipped if the set or workout is gone, or if the set was completed at a time `>=` this one. In a workout **finished on the phone**, a set that Finish tidied away (its `deleted_at` equals `finished_at`) and that was logged before that Finish (`at < finished_at`) goes back in through `reviveTidiedSet`: completed with the watch's numbers and time, its exercise restored if Finish dropped it, both queued. Any other write to a finished workout is skipped. |
| `skipRest` | Skip on the rest | Nothing to write. Acknowledged. |
| `finish` | Finish and save on the watch | First applies `sets` (the watch's unconfirmed completeSets), deduped by ID, then `finishWorkout(id, { finishedAt: at })`: `finished_at` is when Finish was pressed, clamped to no earlier than `started_at` and the last completed set and no later than now; tidied rows get the same `deleted_at`, and `updated_at` is now. If the phone finished the workout first, the carried sets still go through as late sets (revived as above) and the finish itself is skipped. The phone's snapshot (`snapshotEverything`) is written after a finish or a revival. |
| `discard` | Discard on the watch (offered only before the first set is logged) | `discardWorkout(id, { deletedAt: at })`, clamped to no earlier than `started_at` and no later than now. A workout already discarded is never finished afterwards: `finishWorkout` leaves it alone and returns false. |

A batch is applied in this order: starts and discards first, together in
order of `at` (so a discarded start gives up its block slot before the next
start asks for it), then everything else by `at`, then finishes. A workout the
batch discards is never kept open for a start. An event that throws is **not** acknowledged; it is
retried on the next drain, and dropped after 7 days. A deferred event older
than 7 days is dropped too.

The native inbox keeps a persisted set of the last 500 applied event IDs and
drops any event whose ID is in it, so the slower second copy of an event
cannot be applied again after the first was acknowledged and removed.

## Watch → phone: state

The watch reports on every change (session starts or ends, set in hand moves,
rest starts or ends, owner changes) and every 30 seconds while a HealthKit
session runs. The phone's native side keeps the newest by `seq`, stamps it
with `receivedAt` from the phone's own clock, persists it, and tells the web
app (a `watchState` plugin event, and `lastState()` on launch and resume).

## Who logs sets: the companion rule

`loggingSurface(report, workoutId, now, takeBack)` in `src/domain/companion.ts`,
pure and unit tested. In order:

1. No report → phone (`no-watch`).
2. The report is for another workout → phone (`other-workout`).
3. `session` is `ended` or `none` → phone (`ended`).
4. `now - receivedAt` > 5 minutes → phone (`stale`).
5. `owner` is `phone` → phone (`taken-back`).
6. The phone has a take-back for this workout that the watch has not seen
   (`seenPhoneClaim` is null or older than it) → phone (`taken-back`).
7. Otherwise → **watch**.

While the watch logs, the phone shows the companion screen and does not log:
no set in hand, no Done bar, no steppers, no rest takeover and no rest cue
(one cue per rest). "Log on this phone" stores a take-back
(`{workoutId, at}`, phone clock, in localStorage) and puts it in the context
as `phoneClaim`. The watch, seeing a claim it has not seen before, switches
its `owner` to `phone`, shows "Logging on your iPhone" with **Log here
instead**, and keeps its HealthKit session running. Log here instead reports
`owner: watch` with `seenPhoneClaim` set to that claim's `at`, which wins.

## The watch's workout session (HealthKit)

One `HKWorkoutSession` (traditionalStrengthTraining, indoor) with its
`HKLiveWorkoutBuilder` per workout, owned by a `@MainActor` singleton in
GymGoWatchUI. Every HealthKit delegate method is `nonisolated` and hops to the
main actor.

- **Starts** when a session starts on the watch (Start on Today), when the
  phone starts one (`startWatchApp` → `handle(_ workoutConfiguration:)`), or
  when a `live` workout is adopted while the watch app is in the foreground.
  The phone wakes the watch once per workout, and never for a workout the
  watch has already reported, running or ended.
  Health authorisation is asked for on the watch, in the foreground, before
  the first start. If it is refused or unavailable, the session runs without
  HealthKit and the state reports `health: denied` or `unavailable`. A start
  that failed before Health was asked is tried again once it is granted;
  only a failure while authorised stops the retries.
- **Ends:** Finish on the watch, or `closed: finished` from the phone →
  `stopActivity`, `endCollection`, `finishWorkout` (saved to Health and
  Fitness, counts towards the rings), `end`. Discard on the watch, or
  `closed: discarded` → `discardWorkout`. The workout carries
  `HKMetadataKeyExternalUUID` and `HKMetadataKeySyncIdentifier`
  `gymgo.workout.<workoutId>` with `HKMetadataKeySyncVersion` 1. The phone
  never saves a copy of a workout the watch recorded.
- **Leftovers are ended, not kept** (`healthRecordingAction` in
  `HealthWorkout.swift`). On recovery, adoption, Start and the phone's start,
  a recording tagged with a workout already over is saved if that workout
  ended as a finish and thrown away if it was discarded. An untagged
  recording with no session ends once a context sent after it began has no
  live workout: saved under the workout that just finished if it is at least
  60 s long, otherwise thrown away.
- **Recovers** after a crash through `handleActiveWorkoutRecovery` and
  `recoverActiveWorkoutSession`, with the delegates and data source set again.
- **Live metrics:** the most recent heart rate (count/min) and the summed
  active energy (kcal), shown on the watch and reported to the phone.
- Requires `WKBackgroundModes` `workout-processing` **and** `audio` (haptics
  during a workout need the second), and a `@WKApplicationDelegateAdaptor` in
  the watch app.

## Haptics on the watch

`WKInterfaceDevice.current().play`, from the main actor. There is no stronger
tap: strength comes from the heavier types and from repeats. Space taps at
least 250 ms after a short one and 600 ms after `.notification`, `.success`,
`.retry` or `.failure`. A new cue cancels one still playing. Off when the
phone's Vibrate switch is off.

| Event | Sequence (ms after the previous tap) |
|---|---|
| Workout started | `.start` |
| Set logged, rest begins | `.stop`, 250, `.directionDown` |
| Set logged, superset partner next (no rest) | `.directionUp` |
| Last set of an exercise | `.stop`, 300, `.success` |
| Record (replaces the two above) | `.success`, 700, `.success` |
| 10 s left (rests of 20 s or more) | `.retry` |
| 3, 2, 1 s left | `.click` each second |
| **Rest over** | `.notification`, 600, `.notification`, 600, `.start`; once more 8 s later if the screen was not woken or touched, and only while that session still runs. While Health is not recording, the rest's end is also a local notification ("Rest over"), one per rest, replaced or removed as the rest changes and never sent with Vibrate off; delivered ones are cleared when the app comes to the front |
| +30 s or Skip | `.click` |
| Finished or discarded on the iPhone | `.stop`, 500, `.directionDown` |
| Saved to Health | `.success` |
| Workout session refused or failed, Health save failed | `.failure` |

A record on a set with no rest after it (the first half of a superset) shows
on the set screen as a blue line until the rest that ends the round, which
leads with it.

**Upgrading from build 4:** a session saved by build 4 (`session.json`) never
comes back as running and never starts Health. Its unconfirmed events are
sent again, so the phone still gets every set.

## Phone bugs this round fixes (from build 4)

- The workout screen follows `finished_at`: when a workout it is showing
  finishes (from the watch), it stops the rest and goes to the session's
  detail screen, with the "Done." poster only on that transition. The drain
  that applied the watch's Finish writes the snapshot; Finish on the phone
  writes it only when that call finished the workout. Finish on the phone
  after a drain discarded the workout goes to Today.
- `composeWorkout` returns null for a deleted workout, so "That workout is
  gone" can show.
- Starting a routine from the routine editor is refused while a workout is
  open, as Today already does.
- The web app registers its inbox listener before its first drain.

## Seams between the parts of the code

Each part is built against these, so they can be built at the same time.

**`src/db/watch.ts`** (the database side) exports:

```ts
/** Everything the phone sends. Null `live` when no workout is open. */
export async function watchContextFor(
  today: Date,
  describe: DescribeStation,
  options: { phoneClaim: { workoutId: string; at: string } | null; settings: { sound: boolean; vibrate: boolean } },
): Promise<WatchContext>;

export interface WatchDrainResult {
  /** Event IDs to acknowledge: applied, or skipped for good. */
  acknowledge: string[];
  /** Left in the inbox for the next drain: deferred, or threw. */
  keep: string[];
  /** Workouts a `finish` event finished, so the caller writes the phone's snapshot. */
  finished: string[];
  /** Finished workouts a late set was put back into, so the caller writes the snapshot again. */
  revived: string[];
}
export async function applyWatchEvents(events: readonly WatchEvent[], now?: Date): Promise<WatchDrainResult>;
```

**`src/platform/watchState.ts`** (written with this contract) exports
`getWatchState`, `subscribeWatchState`, `reportFromWatch`, `takeLoggingBack`,
`clearTakeBack`, `phoneClaim` and `resetWatchState`, and, in development
builds only, `window.__gymgoWatch.report(...)`, `.end()` and `.clear()` for
the browser suites. `src/platform/watch.ts` feeds it from the native side;
screens read it only through `useCompanionMode`.

**`WatchBridgePlugin`** (native, `jsName` `WatchBridge`):

| Method | Does |
|---|---|
| `sendContext({ json })` | `updateApplicationContext(["context": json])`; retried on the next activation and on a timer if it throws |
| `drainInbox()` → `{ events: string[] }` | the inbox, oldest first |
| `acknowledge({ ids })` | removes them, records them as applied, sends `["ack": ids]` |
| `lastState()` → `{ json: string \| null, receivedAt: number \| null }` | the newest state report |
| `startWatchWorkout()` | `HKHealthStore.startWatchApp(toHandle:)`; resolves either way, with `{ started: boolean, error?: string }` |
| `status()` | supported, paired, installed, reachable |
| listeners | `inbox` (something landed), `watchState` (`{ json, receivedAt }`) |

**`src/hooks/useCompanionMode.ts`** returns
`{ surface, report, takeBack(): void, reclaimed: boolean }` for a workout ID.
`src/domain/companion.ts` exports `loggingSurface`, `WATCH_STALE_MS`
(5 minutes) and `watchStation(stations, exercises, setId)`.
