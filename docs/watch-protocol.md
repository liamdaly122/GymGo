# Phone ⇄ watch: the protocol

The shapes are in `src/domain/watchProtocol.ts` and, mirrored field for field,
`ios/GymGoKit/Sources/GymGoKit/Protocol.swift`; the list the watch walks is in
`src/domain/watch.ts` and `GymGoKit/Snapshot.swift`. This file is the rules:
who sends what, when, and how the other side applies it. It was written for
the round of work after build 4 (`docs/native-roadmap.md`, "Feedback from
build 4") and decisions 8, 9 and 13, and extended for build 7
(`docs/build7-plan.md`, "Contract changes, in one place").

**Versions.** The protocol and the snapshot are both still version 1: every
change since has been additive. A field added since build 6 is **Optional in
Swift** wherever it is decoded from the phone or saved in `watch-state.json`
(the snapshot types, `LoggedSet`, `WatchSession`), and in the state report,
which the phone decodes natively from build 7 for the Live Activity (its
decoder reads `skipped` as `[]` when missing): a synthesised decoder
throws on a missing non-Optional key, and a saved state that fails to decode
loses the sets the phone has not confirmed. A missing Optional decodes to nil,
not to a default, so readers treat nil as false or empty. A build 6 watch
ignores keys it does not know; a build 6 phone's `readReport` copies only the
keys it knows. Never add a new value to an existing enum on the wire (the
report's `session`, for one): the other side refuses the whole message.

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
  "Phone bugs this round fixes (from build 4)"), the newest.
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

### The list (`WatchSnapshot`)

Every set still to do, in the order the phone's set in hand would bring it
up, each with its label, the numbers it starts at and where they came from
(`source`: `typed`, `scheme`, `carried`, `stepped`, `suggestion`, `last`,
`none`), whether it carries (rule 1), which top set it aims off (rule 2), its
rest and its Up next. Per lift (`lifts`, by exercise ID): the name, unit,
Crown ladder, setup note, the marks to beat, the working sets already done
today and the loading. Build 7 adds, all optional:

| Field | What | Sent |
|---|---|---|
| `lifts[].plan` | `{ kind, verb, reason }`: the engine's suggestion for the lift, in the phone's own word (`SUGGESTION_VERB`) and its reason, clamped to 320 characters (`WATCH_REASON_MAX`) | null with no suggestion |
| `lifts[].lastTime` | `{ day, top: { weight, reps }, sets: [{ weight, reps }] }` from `previousPerformance`: `day` is the lifter's calendar day the session finished (`YYYY-MM-DD`, never relative words: the watch may be days past the context); `top` the best working set, so the watch never re-derives that rule; `sets` the working sets in order | null for a first |
| `lifts[].repLow` | the bottom of the routine's rep range, which rule 1 steps a short set down to | null for freestyle |
| `sets[].amrap`, `lifts[].doneToday[].amrap` | `true` for a set marked AMRAP | only when true |
| `source: 'stepped'` | the set just done, a notch lighter because it fell short of the range | — |

None of these names a row ID, so `FreshIds.swift` is unchanged. A build 6
watch ignores them and carries the set just done unstepped, overriding the
phone's stepped numbers, until the watch app updates.

## Watch → phone: events

| Kind | Sent when | Phone applies it by |
|---|---|---|
| `startWorkout` | Start on the watch's Today page | `replayWatchStart(layout, at)`: writes exactly the workout, exercise and set rows in the layout, with `started_at = at`. Skipped if a workout with that ID already exists, even a deleted one. Filed under the block slot the layout was offered for only if that slot is still the one `planSlot` gives now; otherwise filed with the plan but no week or session index. If an empty workout is open on the phone, it is discarded first; one with sets is kept and both stay open. Exercises missing from the library are dropped with their sets. The layout may carry IDs the watch minted (see `ready` above). |
| `completeSet` | Done, double tap or the Action button, once the set's Undo window has closed (below) | `completeSetWith(setId, {weight, reps}, {completedAt: at})`. **Deferred** (left in the inbox, not acknowledged) while the workout row does not exist yet. Read and written in one transaction, so a Finish on the phone lands wholly before or wholly after. Skipped if the set or workout is gone, or if the set was completed at a time `>=` this one. In a workout **finished on the phone**, a set that Finish tidied away (its `deleted_at` equals `finished_at`) and that was logged before that Finish (`at < finished_at`) goes back in through `reviveTidiedSet`: completed with the watch's numbers and time, its exercise restored if Finish dropped it, both queued. Any other write to a finished workout is skipped. |
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

**Undo.** Every set logged on the watch, by Done, double tap or the Action
button, shows "Logged · Undo" for 5 seconds. The set is logged on the watch at
once and saved, so the set in hand moves on and its rest starts, but its
`completeSet` is **held for those 5 seconds** and only then sent. Undo inside
the window removes the set, puts it back in hand and cancels the rest it
started; nothing reaches the phone, so the phone never has to take a set back.
Undo also brings back a rest the undone set cut short, if it has not run out,
and the record line shown before it. A Finish inside the window sends at
once, the held set inside its `sets`. Without Health the app may be
suspended wrist-down; a held event then goes when the app next wakes.

**Skipping needs no event.** A set skipped on the wrist ("Skip this set",
"Done with this lift") is simply never logged; the state report lists it
(`skipped`) and Finish on either device tidies unlogged sets as it always has.

## Watch → phone: state

The watch reports on every change (session starts or ends, set in hand moves,
rest starts or ends, owner changes, a set is skipped, the workout pauses or
resumes) and every 30 seconds while a HealthKit session runs, **paused
included**: a paused `HKWorkoutSession` is still a session, and the phone
needs the heartbeat to know the watch is there. The phone's native side keeps
the newest by `seq`, stamps it with `receivedAt` from the phone's own clock,
persists it, and tells the web app (a `watchState` plugin event, and
`lastState()` on launch and resume). From build 7 it also hands each report
to the Live Activity natively (below), because the web app is frozen while
the phone is locked.

The report (`WatchStateReport`), every key always written, null where there
is nothing (Wire.swift's `nullableKeys`), except `rest.startedAt`, which is
left out when the watch has none:

| Field | What |
|---|---|
| `v`, `at`, `seq` | protocol version; the watch's clock; a number that rises with every report |
| `workoutId`, `session` | the workout and `running`, `ended` or `none`. **`session` gets no new value**: a build 6 phone refuses a report whose `session` it does not know, and would then go stale |
| `owner`, `seenPhoneClaim` | who logs sets, and the phone's take-back the watch has seen (the companion rule, below) |
| `setId` | the set in hand on the watch, or null |
| `inHand` | `{ name, detail }`: the set in hand exactly as the watch's set screen shows it ("Bench Press", "Set 2 of 4 · 100 × 5"), or null with none. For the Live Activity, which cannot read Dexie while the phone is locked |
| `rest` | `{ endsAt, startedAt?, upNext: { name, detail } }`: the running rest, when it began (so a bar drains exactly) and what follows it; null with none. A build 6 watch sends no `startedAt` |
| `skipped` | the set IDs skipped on the wrist: neither done nor left to do. Always present, `[]` when none. The companion leaves them out of what is open, so its Up next is the watch's |
| `paused` | when the workout was paused (watch clock, ISO), or null while it records. `session` stays `running` |
| `heartRate`, `activeKcal`, `health` | the live metrics, and whether Health is recording |

`readReport` (`src/platform/watch.ts`) copies only the keys it knows and
defaults the build 7 ones for a build 6 watch: `skipped` to `[]`, `paused` and
`inHand` to null, `rest.startedAt` left out. The dev seam
(`window.__gymgoWatch`) uses the same defaults. `fixtures/watch/state.json`
holds a report with every field set and the empty and null ones; the Swift
tests decode it and write it back key for key, and the phone reads it back
field for field.

## Who logs sets: the companion rule

`loggingSurface(report, workoutId, now, takeBack)` in `src/domain/companion.ts`,
pure and unit tested. In order:

1. No report → phone (`no-watch`).
2. The report is for another workout → phone (`other-workout`).
3. `session` is `ended` or `none` → phone (`ended`).
4. `now - receivedAt` > `staleAfter(report)` → phone (`stale`): 5 minutes
   (`WATCH_STALE_MS`), or 60 minutes while the report says `paused`
   (`WATCH_PAUSED_STALE_MS`): a pause is a deliberate break rather than a
   watch gone missing, and whether watchOS keeps a paused workout's app
   running for the 30 s heartbeat is only provable on the device.
   `useCompanionMode` uses the same function to know when to look again, so
   the rule stays in one place.
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

While the phone logs, the watch keeps its `focus` and `skipped`; the phone
shows the skipped sets as unticked and may log them, and the watch drops
anything the phone logged when its next list arrives. The companion screen
shows "Paused" while the report says `paused`.

## The watch's own rules

The watch follows the list, and keeps exactly these rules of its own, because
while the phone is locked it cannot ask. Each is a port of one TypeScript
function, held to it by a fixture file in `fixtures/watch/`
(`scripts/watchFixtures.ts`; `npm run fixtures:watch` writes them, Vitest
fails if they fall behind, and GymGoKit's tests run the port over the same
cases). A new rule on the watch needs a fixture too, or it does not go in.

| Rule | TypeScript | Fixture |
|---|---|---|
| 1. **Carry forward**, a notch lighter when the set fell short | `carryForward` in `src/domain/carry.ts` | `carry.json` |
| 2. **The back-off target** of a pyramid | `schemeTarget` in `src/domain/schemes.ts` | `scheme.json` |
| 3. **The record check** | `setBreaksRecord` in `src/domain/prs.ts` | `records.json` |
| 4. **Where the session goes** after a station | `nextStation` in `src/domain/supersets.ts` | `stations.json` |
| 5. **How Up next words** the set that follows | `upNextFor` in `src/domain/watch.ts` | `upnext.json` |

**Rule 1, the step-down.** The set carried is the working set of the lift
done most recently today (top-level, `working`, reps above 0; a tie goes to
the later set). When it is not AMRAP, its weight is above 0, the loading is
not `free`, and its reps are below the lift's `repLow`, the next set that
carries (`carries`: not a warm-up, child, typed or pyramid back-off set)
starts lower:

1. `epley = estimate1RM(L) / (1 + repLow / 30)`, the weight that should give
   `repLow` reps;
2. `floor = 0.9 × L.weight`;
3. `target = loadableWeight(max(epley, floor), down)`;
4. `weight = min(target, nextLoadableBelow(L.weight))`: at least one real
   step, and at most 10% lighter unless one step is already more;
5. reps become `repLow`; `source` is `stepped`.

When nothing lighter can be loaded (`nextLoadableBelow` is not below
`L.weight`: a bare bar, the lightest dumbbell, a stack's first plate) the set
carries unchanged, as it does at or above `repLow`, with no `repLow`, for
AMRAP, for 0kg and for `free` loading. The watch's `nextLoadableBelow`: for a
barbell, the previous ladder rung at or above the bar (the bar itself when
there is none); for fixed steps, `max(step, ceil(w / step) · step − step)`,
never the ladder's 0 rung. `carry.json` gives each case's `repLow`,
`loading`, `ladder`, the logged sets (with `amrap`), the expected numbers with
`stepped: { from, repLow }` or null, and `below`, the expected
`nextLoadableBelow`, for the port's own check. The cases with no `repLow` are
the carry as it was, which the port must still answer.

**Rules 4 and 5, running the session from the wrist.** The watch's session
gains `focus` (the chosen station's first member's `workoutExerciseId`: an
index shifts when the phone reorders, this does not) and `skipped` (set IDs).
The set in hand is the first of the list's sets that is neither logged nor
skipped in the focused station; if that station has none, the first in the
station `nextStation(open, focus)` picks; with no focus, the first in the
list. Logging a set focuses its station. Tapping a station on This session
focuses it; if all it has left are skipped sets, they come back. Skip this set
skips the set and its children; Done with this lift skips every remaining set
of the station in hand. When the set just logged has no rest only because its
round's partner was skipped, it takes that partner's rest; skipping the set
straight after the one just logged starts that rest, once. A warm-up, or a
rest-pause, myo or cluster piece, never hands a rest on (by the phone's rule
none rests); a drop does, as the phone rests the round after a drop. A focused station
the phone has finished hands focus on to where `nextStation` goes from it.
"Same station" is judged by station, never by exercise (a rest remembers its
station's workout-exercise IDs, `RestState.afterStation`), so a lift that
appears twice in a session is two stations. Once the wrist has
left the list's order, the rest's Up next is worded by `upNextFor`: the same
station, the lift's name and "label · weight × reps" ("BW" for 0, no numbers
without reps); another station, its name and outline; nothing left, Finish.
Skipped sets are neither done nor remaining (the total is done + left +
skipped), and never trigger the last-set-of-an-exercise cue. The Finish
confirmation reads "14 of 18 logged · 2 skipped"; with everything left
skipped, "Nothing left · 2 skipped".

**Wording the list's extras.** The set screen's header shows the plan's verb
("Set 1 of 4 · Go up") only while the set's numbers are still the list's
suggestion (`source == "suggestion"` and no rule replaced them), "Lighter"
after a step-down, and nothing after a plain carry. The lift sheet shows the
plan's verb and full reason and "Last time · 3 Oct" with the working sets
(`dayLabel` words the day). The rest's third line shows `Last 97.5 × 8` when
the set after it is the lift's first today (nothing of that lift logged
today, warm-ups included), unless a setup note takes the line.

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
  60 s long, otherwise thrown away. With no context since it began, it waits
  2 minutes (`strayRecordingWait`; the 30 s heartbeat asks again) and is then
  thrown away, never saved: a finish that ended before it began is an
  earlier workout's. A recording a context names as live, or tagged with the
  running session, is never ended. The idle page's End throws it away and
  says so ("End, not saved").
- **Recovers** after a crash through `handleActiveWorkoutRecovery` and
  `recoverActiveWorkoutSession`, with the delegates and data source set again.
- **Live metrics:** the most recent heart rate (count/min) and the summed
  active energy (kcal), shown on the watch and reported to the phone.
- Requires `WKBackgroundModes` `workout-processing` **and** `UIBackgroundModes`
  `audio` (haptics during a workout need the second), and a
  `@WKApplicationDelegateAdaptor` in the watch app. `audio` must not go under
  `WKBackgroundModes`, which takes only session types (`workout-processing`,
  `self-care`, `mindfulness`, `physical-therapy`, `alarm`): App Store Connect
  refuses the upload (ITMS-90362, "Invalid Info.plist value"), which is what
  stopped build 5's first upload.
- **Pauses and resumes** through `WorkoutController.pause()` and `resume()`
  (`isPaused`, `pausedAt`; the `HKWorkoutSession`'s own state is the truth,
  read again on recovery). HealthKit's `pauseOrResumeRequest` (Crown and side
  button together, on any watch) toggles too, but is ignored within 2 s of a
  pause or resume from an intent, so a press is never undone by its own echo.
  A paused session keeps its rest's wall-clock end; the rest-over
  notification fallback is on while paused (paused counts as not
  recording); the metrics page shows Health's active time, which leaves out
  paused time (the phone's duration, `finished_at − started_at`, does not).
  Logging a set while paused resumes once the set's Undo window closes, so
  Undo leaves the workout paused; that held resume is kept in memory only, so
  a crash inside those 5 seconds leaves Health paused until Resume (rare, and
  accepted). A phone claim while paused resumes too, and a press while the
  phone logs still resumes. Pause and resume asked for on the wrist (the
  buttons, the intents, Crown and side) tap once each; the resume a logged set
  or a claim causes is silent. The report carries `paused`.
- **Mirrors to the iPhone** once its session runs
  (`startMirroringToCompanionDevice`, errors logged, never surfaced), only so
  the phone may start the Live Activity from the background (below). The
  watch's session is still the only one that saves to Health.

## The Action button, Pause and Siri

The intents live in the watch app target (`ios/App/GymGo Watch App/`), never
in GymGoKit or an extension: Apple only offers the Action button to an app's
own intents. Their titles, descriptions and phrases must not contain "Apple"
(App Store Connect refuses the upload, ITMS-90626, which stopped build 7's
first upload); "Health" alone is fine.

- `StartGymGoWorkout` (`StartWorkoutIntent`, with a one-case `workoutStyle`
  parameter, "Today's Session"; without a parameter Settings offers only Open
  App). It starts today's session only if it is due today, never asks for
  Health permission on this path, waits at most 25 s for Health to record,
  and returns `ActionButtonPress` as the next action. A refusal is worded as
  the Today card words it ("Today's session is done", "Start it on your
  iPhone", "Turn on Health for GymGo", "Not due today: start it on the
  watch"): a press never trains a later day, which stays a tap on Start
  early.
- `ActionButtonPress`, the next action, donated once per Health session when
  it starts recording (`WorkoutController.onRecordingStarted`, set in the
  watch app).
- `PauseGymGoWorkout` and `ResumeGymGoWorkout` (`PauseWorkoutIntent`,
  `ResumeWorkoutIntent`): the Action and side buttons together.
- `GymGoShortcuts` (`AppShortcutsProvider`): "Start GymGo workout" for Siri.

A press during a session (`WatchSessionStore.actionButtonPressed()`) does the
first that applies:

| State | A press |
|---|---|
| The phone logs sets | nothing |
| Paused | resumes |
| Resting | skips the rest (`skipRest`) |
| A set in hand | Done with the numbers on screen (the same pure function as the Done button); reps 0 → nothing, and `.failure` |
| Anything else | nothing |

A press never finishes a workout. A set it logs gets the same 5 s Undo as any
other.

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
| **Rest over** | `.notification`, 600, `.notification`, 600, `.start`; once more 8 s later if the screen was not woken or touched, and only while that session still runs. While Health is not recording, the rest's end is also a local notification ("Rest over"), one per rest, replaced or removed as the rest changes and never sent with Vibrate off; delivered ones are cleared when the app comes to the front. **One cue per rest** (`RestAlert.cuer`): with the app active, or no notification that will sound, the app plays it; wrist down or in the background, the notification plays it with the system's sound and haptic and the app plays nothing. A Focus or Do Not Disturb can silence that notification (it is not Time Sensitive) |
| +30 s or Skip | `.click` |
| Finished or discarded on the iPhone | `.stop`, 500, `.directionDown` |
| Saved to Health | `.success` |
| Workout session refused or failed, Health save failed | `.failure` |
| Action button press with a set in hand at 0 reps (nothing logged) | `.failure` |

A record on a set with no rest after it (the first half of a superset) shows
on the set screen as a blue line until the rest that ends the round, which
leads with it.

**Upgrading from build 4:** a session saved by build 4 (`session.json`) never
comes back as running and never starts Health. Its unconfirmed events are
sent again, so the phone still gets every set.

## Complications (the watch face and the Smart Stack)

Nothing crosses the link for these: the watch app feeds its own widget
extension (`ios/App/GymGo Complications/`).

- After every save that changes it, the watch app writes **`glance.json`**
  to the App Group container (`group.com.liamdaly.gymgo`) and reloads the
  widget's timeline. It holds the **inputs** to the Today card (the home
  pages, the running session's progress, station and rest), never its
  wording, so the extension words each moment itself and midnight turns over
  with no reload. One rule words it: `TodayCard(inputs, now:)`, which the
  app's Today page uses too.
- Reload only when the glance changed, never for a rest that simply ran out
  (the timeline already holds that entry), and on a time zone change.
- Without the App Group the app writes nothing and the extension shows "Open
  GymGo on your iPhone". Never a crash.
- Rectangular, circular, corner and inline families. With no session: the
  day ("TODAY · WEEK 3 OF 5", "NEXT · FRI", "DONE TODAY"), the session's name
  and the week's marks; in a session, sets done and the station; resting, a
  live countdown (`Text(timerInterval:)`). System fonts. Smart Stack
  relevance is each training day's waking hours, 05:00 to 22:00, as a
  `.scheduled` date context (watchOS ignores per-entry scores).
- A session done on the wrist that the phone has not heard of reads "Done
  today" that day and "Done · Wed" on later days, on the face and on the
  app's Today page alike (`TodayInputs.doneHereDay`, from
  `WatchAppState.lastEndedStartedAt`). An early start ("Start early") marks
  the day it was trained done and its planned day rest.
- The glance records its time zone (`WatchGlance.zone`), so a launch after a
  zone change while the app was closed still reloads.

## The Live Activity on the iPhone

One activity per workout the watch runs, on the Lock Screen and in the
Dynamic Island: the session's title, elapsed time and heart rate; while
resting, a countdown and a draining bar (`rest.endsAt`, `rest.startedAt`)
with Up next; while lifting, `inHand`; "Logging on your iPhone" when the
phone has taken over; "Out of touch with your watch" once stale. It never
alerts: the rest's one cue stays the watch's.

- **Driven natively**, because the web view is frozen while the phone is
  locked: `WatchLink.onStateNative`, set in `AppDelegate` before
  `WatchLink.shared.start()` (a background launch never loads the plugin),
  hands every report to the manager. The attributes
  (`GymGoSessionAttributes`) and the pure content and start/update/end rule
  (`LiveSession`) are in GymGoKit.
- **Started** where ActivityKit allows it: at the phone's Start (native
  `startWatchWorkout`, in the foreground), when GymGo comes to the
  foreground during a watch session, and for a wrist start with the phone
  locked through **HealthKit workout mirroring**: the watch mirrors its
  session, which launches the phone app in the background with a one-time
  permission to start a Live Activity (`workoutSessionMirroringStartHandler`,
  set at every launch). If mirroring fails, the activity starts the next
  time GymGo is opened.
- At the phone's Start it reads "Starting on your watch", waits up to 5
  minutes for the watch's first report, ignores reports from before the tap,
  and comes down if `startWatchApp` fails.
- **Updated** from the reports, which already wake the phone: every change
  and every 30 s. `staleDate` 5 minutes ahead, or 60 minutes while paused
  (`LiveSession.staleAfter` and `pausedStaleAfter`, held equal to the
  companion's `WATCH_STALE_MS` and `WATCH_PAUSED_STALE_MS` by
  `fixtures/watch/stale.json`). **Ends** on `ended` or `none`, another
  workout, or a stale report seen in the foreground. In the background a
  stale report of its own changes nothing (the next report may be on its
  way), and a report the native decoder cannot read changes nothing. A stale
  rest is drawn nowhere.
- `WatchLink` keeps the last context it sent in `watch-context.json`, because
  a background launch may not have `WCSession.applicationContext`; the
  launch's tidy-up waits for `WatchLink.onActivated`, so the report that
  launched the app is applied first. Swiping the activity away holds for that
  workout; reinstalling the app is not a swipe.
- iOS forwards it to the watch's Smart Stack, which cannot be turned off in
  code; `WKSupportsLiveActivityLaunchAttributeTypes` makes a tap there open
  GymGo, and the watch gets a quiet small view.
- Not in build 7: a countdown for a rest the phone logs with no watch.

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
(5 minutes), `WATCH_PAUSED_STALE_MS` (60 minutes) and `staleAfter(report)`
(build 7), `watchStation(stations, exercises, setId)`, and
`openStations(stations, exercises, skipped)`, which leaves the watch's
skipped sets out of the companion's open stations, and
`companionTargets(members, watchSetId, skipped)`, each member's next set on
the companion's card, reading past skipped sets (counted as passed, so the
rounds stay in line) and saying when a member has only skipped sets left.

**The rules the watch ports** (pure, `src/domain/`):

```ts
// carry.ts: rule 1.
export function carryForward(sets: readonly CarrySet[], repLow: number | null | undefined, loading: LoadingProfile): Carried | null;
export interface Carried { weight_kg: number; reps: number; stepped: StepDown | null }
export interface StepDown { from: { weight: number; reps: number }; repLow: number }

// supersets.ts: rule 4.
export function nextStation(open: readonly boolean[], from: number): number | null;

// watch.ts: rule 5, which buildWatchSnapshot uses for every set.
export function upNextFor(fromStation: number, next: UpNextSet | null, stations: ReadonlyArray<{ name: string; outline: string }>): WatchUpNext;
export interface UpNextSet { station: number; name: string; label: string; weight: number | null; reps: number | null }
export const WATCH_FINISH: WatchUpNext; // { name: 'Finish', detail: 'Last set done' }
```

`setHints` (`src/domain/setHints.ts`) reads `carryForward`: `HintEntry` has
`repRange`, `HintSource` has `'stepped'`, and `SetHints.stepDown` is the
`StepDown` behind a stepped placeholder, or null. `SUGGESTION_VERB` in
`src/domain/progression.ts` is the one table of the engine's words, re-exported
as `VERB` from `src/features/workout/setPlan.ts`.
