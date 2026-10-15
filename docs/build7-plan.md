# Build 7: the plan

> **Status, 15 October 2026: built, reviewed and shipped as build 8** (build
> 7's upload was refused for the word "Apple" in an App Intent's
> description). Waiting for Liam's device test (`docs/ios-guide.md` 9.9).
> Decided items are recorded as decisions 18–24 in `docs/native-roadmap.md`.
> Changes after this plan, from the review: after a step-down the next
> session builds from the weight that worked (decision 20); a set logged
> while paused resumes once its Undo window closes, and a phone claim while
> paused resumes (decision 22); the Lock Screen clock counts wall-clock time
> (decision 23); pause and resume tap on the wrist; a drop hands its round's
> rest on. The contract as built is `docs/watch-protocol.md`; two review
> findings were deferred to `docs/backlog.md`.

Liam asked for the brainstorm's top 5 (`docs/feature-ideas.md`), watch face
complications and the rest countdown on the iPhone's Lock Screen, as build 7.
The smart coaching ideas wait (`docs/backlog.md`). The research behind this
plan, checked against the Xcode 27.0 SDKs and the code, is summarised at the
end. Where the research left a choice to Liam, the choice made here is marked
**Decided** so he can change it after trying it.

`docs/watch-protocol.md` stays the contract. This file says what changes in
it and who builds what; the protocol doc is updated to match in the contract
step.

## The seven features

### 1. Why this number, and last time, on the wrist

- **Phone:** `buildWatchSnapshot` sends, per lift:
  - `plan: { kind, verb, reason } | null` from the lift's `Suggestion`. `verb`
    is the phone's own word (`SUGGESTION_VERB`, moved from
    `src/features/workout/setPlan.ts` into `src/domain/progression.ts` next to
    the kind, and re-exported from setPlan.ts so the screens are unchanged).
    `reason` is clamped to 320 characters.
  - `lastTime: { day: 'YYYY-MM-DD', top: { weight, reps }, sets: [{ weight, reps }] } | null`
    from `previousPerformance`: `day` is the local date of `performed_at`
    (never relative words, since the watch may be days past the context),
    `top` is the best working set (the watch never re-derives that rule),
    `sets` the working sets in order.
- **Watch, set screen header:** `Set 1 of 4 · Go up` while the set's numbers
  are still the snapshot's suggestion (`source == "suggestion"` and neither
  rule 1 nor rule 2 replaced them). After a carry there is no verb: the
  numbers are what you did. A step down shows `Lighter` (feature 2). The
  station fraction (`2/6`) is dropped while a verb shows.
- **Watch, lift sheet:** a "Plan" block (verb and full reason, wrapped) and
  "Last time · 3 Oct" with `97.5 × 8, 8, 7`. `dayLabel` words the day.
- **Watch, rest:** Up next adds `Last 97.5 × 8` when the set after the rest is
  the first of its lift today (nothing in `doneToday`, nothing logged here),
  in the line where the setup note goes; the setup note wins when both exist.

### 2. Step down a notch when reps fall short

Part of **rule 1, carry forward**, on both sides ("start at the set just done,
lighter when it fell short of the range"), with fixtures.

When the latest working set L of the lift (top-level, `working`, not AMRAP,
weight above 0, loading not `free`) has `L.reps < repLow`, and the next set
carries (`carries` true: not a warm-up, child, typed or pyramid back-off set):

1. `epley = estimate1RM(L) / (1 + repLow / 30)`, the weight that should give
   `repLow` reps (the same estimate as `prs.ts`);
2. `floor = 0.9 × L.weight`;
3. `target = loadableWeight(max(epley, floor), down)`;
4. `weight = min(target, nextLoadableBelow(L.weight))`, so at least one real
   step and, unless one step is already more, at most 10% lighter;
5. reps become `repLow`.

**Decided:**
- When nothing lighter can be loaded (a bare bar, the lightest dumbbell, a
  stack's first plate), the set carries **unchanged**: same weight, same reps
  as L. Raising the rep target to one just missed would be wrong.
- No step down for `free` loading (bodyweight with added weight, bands): its
  numbers fall off the watch's ladder.
- At or above `repLow`, or with no rep range (freestyle), carry is exactly as
  today.

Worked examples (from the research, run with the repo's own functions):
barbell 100 × 5 on 8–10 → 90 × 8; 100 × 7 → 95 × 8; 100 × 2 → 90 × 8;
60 × 5 on 6–8 → 57.5 × 6; dumbbell 27.5 × 6 on 8–12 → 25 × 8; stack 40 × 9 on
10–15 → 35 × 10; bar 20 × 5 → 20 × 5 (unchanged).

- **Phone:** a pure `carryForward(sets, repLow, loading)` in a new
  `src/domain/carry.ts`, used by `setHints` in place of `latestWorkingSet`.
  `HintSource` and `WatchHintSource` gain `'stepped'`; `SetHints` gains
  `stepDown: { from: { weight, reps }, repLow } | null`; `HintEntry` gains
  `repRange`. The set in hand's plan line shows the chip **Lighter** with
  "5 was under 8, so 90kg for 8." (in `SetInHand.tsx` and the companion's
  `ExerciseInfo.tsx`).
- **Snapshot:** `WatchLift.repLow?: number | null`; `WatchSet.amrap?: true`
  and the `doneToday` entries' `amrap?: true`, sent only when true.
- **Watch:** `carriedSet` takes the lift's `repLow`, `loading` and `ladder`; a
  `nextLoadableBelow` port (barbell: the previous ladder rung at or above the
  bar; fixed step: `max(step, ceil(w/step)·step − step)`; never the ladder's
  0 rung). `LoggedSet.isAmrap?` (Optional: it is persisted).
- **Fixtures:** `carry.json` cases gain optional `repLow`, `loading`,
  `ladder`, `amrap` and an expected `stepped`; one case per example above,
  plus: at the bottom of the range, no range, an AMRAP short set, the latest
  set a warm-up / drop / back-off, unloaded bodyweight 0 × n, a tie, and
  `nextLoadableBelow` per loading profile including the fixed-step floor.
  Every existing case still passes with `repLow` absent.

### 3. Run the session your way from the wrist

- **Tap a station** on the watch's This session page to go there. **Skip this
  set** and **Done with this lift** in the lift sheet. A tapped station that
  has only skipped sets left brings them back.
- **Watch model (`WatchSession`):** `focus: String?` (the focused station's
  first member's `workoutExerciseId`: an index shifts when the phone
  reorders, this does not) and `skipped: [String]` (set IDs), both decoded
  with `decodeIfPresent` defaults. `receive(_:)` keeps `focus` and filters
  `skipped` to IDs still in the snapshot; `.replaced` resets both.
- **Set in hand:** candidates are the snapshot's sets minus logged minus
  skipped. The focused station's first candidate in list order if it has
  one (list order already puts warm-ups first, superset rounds in turn and
  children after their parent); otherwise the first candidate of the
  station `nextStation(open, focus)` picks; with no focus, the first
  candidate (today's behaviour). Logging a set focuses its station.
- **Skip this set** skips the set and its children. **Done with this lift**
  skips every remaining set of the station in hand (a superset's whole
  station).
- **Rest when a superset half is skipped:** if the set just logged has no
  rest after it only because its round's partner set was skipped, it takes
  that skipped set's rest.
- **Up next** after a jump or skip is worded the phone's way by a port of a
  new exported TS function `upNextFor` (extracted from `buildWatchSnapshot`,
  which then uses it): same station → `{lift name, "label · w × r"}` ("BW"
  for 0); new station → `{station name, outline}`; nothing left → Finish.
  `nextStation` is ported too. Both are new watch rules, so both get
  fixtures: `stations.json` and `upnext.json`.
- **Counts:** skipped sets are neither done nor remaining. The Finish
  confirmation reads "14 of 18 logged · 2 skipped"; with everything left
  skipped the all-logged view says "Nothing left · 2 skipped"; the session
  list marks skipped sets; the last-of-lift cue ignores them.
- **No new event:** Finish already tidies unlogged sets on the phone.
- **State report:** `skipped: string[]` (always present, `[]` when none) so
  the companion's `open` leaves them out and its Up next matches the watch's.

### 4. The Action button, Pause/Resume, Siri, Undo

- **Intents live in the watch app target** (`ios/App/GymGo Watch App/`), never
  in GymGoKit or an extension (Apple's rule for the Action button):
  - `StartGymGoWorkout: StartWorkoutIntent` with an `@Parameter` `workoutStyle`
    of a one-case `AppEnum` (`today`, shown "Today's Session", subtitle "From
    your plan"). Without `@Parameter` Settings only offers Open App.
    `perform()` calls the store's `startFromActionButton()`, waits at most
    25 s for Health to be recording, never asks for Health permission on this
    path, and returns `.result(actionButtonIntent: ActionButtonPress())`.
    Refusals throw an error worded like the Today card ("Today's session is
    done", "Start it on your iPhone", "Turn on Health for GymGo").
  - `ActionButtonPress`, the **next action**, donated once per Health session
    from `WorkoutController.onRecordingStarted` (after `beginCollection`
    succeeds in `start()`, and at the end of `recover()`), set from the watch
    target in `GymGoApp`.
  - `PauseGymGoWorkout: PauseWorkoutIntent`, `ResumeGymGoWorkout:
    ResumeWorkoutIntent` (Action + side together).
  - `GymGoShortcuts: AppShortcutsProvider` ("Start GymGo workout").
- **A press during the session** (`WatchSessionStore.actionButtonPressed()`):
  phone logs → nothing; **paused → resume (Decided)**; resting → Skip; a set
  in hand → Done with the numbers on screen (one pure function shared with
  `SetInHandView`; reps 0 → nothing and the `.failed` haptic, never 0 × 0);
  anything else → nothing. A press never finishes.
- **A press with no session:** starts today's session only if it is due today.
  "Start early" stays a tap on the watch: a press never trains a later day,
  and says so ("Not due today: start it on the watch").
- **Pause/Resume:** `WorkoutController.pause()`, `resume()`, `isPaused`,
  `pausedAt` (source of truth: the `HKWorkoutSession` state, also read on
  recovery). HealthKit's `pauseOrResumeRequest` event (Crown + side on any
  watch) toggles, but is ignored within 2 s of a pause or resume intent so a
  press is never undone by its own echo. UI: a blue "Paused" line on the set
  screen with a chalk **Resume** button (no double-tap shortcut: Done keeps
  it), and Pause/Resume on the metrics page. The rest keeps its wall-clock
  end. The metrics clock shows Health's active time (paused time excluded).
  While paused the rest-over notification fallback is on (treat paused as not
  recording for that). **Decided:** logging a set while paused resumes.
- **State report:** `paused: string | null` (watch clock, ISO, when the pause
  began; `session` stays `running`). The companion shows "Paused", and a
  paused watch goes stale after 60 minutes instead of 5
  (`staleAfter(report)` in `companion.ts`, used by both `loggingSurface` and
  `useCompanionMode`).
- **Undo:** every set logged on the watch (Done, double tap, the Action
  button) shows "Logged · Undo" for 5 seconds. The set is logged on the watch
  at once (and saved), but its event is not sent to the phone until the
  window closes; Undo removes it and puts the set back in hand, with the rest
  it started cancelled. A Finish within the window sends at once.

### 5. The "Done." celebration after a wrist finish

- `src/lib/celebrate.ts` (localStorage, every access in try/catch): two lists,
  `finishedOnWatch` ({id, at}, written when a drain's `result.finished` lands)
  and `celebrated` (written by the session summary whenever it shows with
  `fresh: true`).
- A pure rule, `celebrationFor(workouts, finishedOnWatch, celebrated, now)` in
  `src/domain/celebrate.ts`: the newest workout that the watch finished,
  `finished_at` set, not deleted, finished within the last 12 hours and not in
  the future, and not celebrated.
- Today shows a banner above the level strip: a region named **Finished on
  your watch** with a link **See how it went**, opening `/history/:id` with
  `fresh: true`, once.
- Tests: the rule in Vitest; the drain records `finished` (Vitest, against the
  stubbed bridge); `test:companion` shows the banner and that it goes once
  seen.

### 6. Watch face complications

- **Data:** the watch app writes `glance.json` to the App Group container
  (`group.com.liamdaly.gymgo`) after every save that changes it, and reloads
  the widget's timeline. The glance holds the **inputs** to the Today card,
  not its wording, so the extension words each moment itself and midnight
  turns over with no reload.
- **One rule:** `WatchAppState.todayCard(now:)` becomes `TodayCard(inputs,
  now:)`, used by the app and the extension.
- **Families:** rectangular (Smart Stack and faces), circular (faces and the
  Smart Stack), corner, inline. No session: "TODAY · WEEK 3 OF 5" / "NEXT ·
  FRI" / "DONE TODAY", the session name, the week's marks. During a session:
  sets done, the station; resting: a live countdown
  (`Text(timerInterval:)`). System fonts (custom fonts in widget extensions
  are unproven). GymGo blue marks where you are, accentable on tinted faces.
- **Smart Stack:** `relevance()` with `.scheduled` date contexts for each
  training day's waking hours. No per-entry scores (watchOS ignores them).
- **Reload budget:** reload only when the glance changed, never for a rest
  that has simply run out (the timeline already has that entry); reload on a
  time zone change.
- **Missing App Group:** the app writes nothing and the extension shows "Open
  GymGo on your iPhone". Never a crash.
- Xcode's template files (the emoji widget and the dead "Timer" control) are
  deleted; `Assets.xcassets` and `Info.plist` stay.

### 7. The rest countdown on the iPhone Lock Screen (Live Activity)

- **One activity per workout** the watch runs, on the Lock Screen and in the
  Dynamic Island: the session title and elapsed time, heart rate; while
  resting a countdown (`Text(timerInterval:)` and a draining bar) with Up
  next; while lifting the exercise and "Set 2 of 4 · 100 × 5"; "Logging on
  your iPhone" when the phone has taken over; "Out of touch with your watch"
  once stale. No alerts ever: the rest's one cue stays the watch's.
- **Shared type:** `GymGoSessionAttributes` and the pure content and
  start/update/end rule (`LiveSession`) in GymGoKit, fenced
  `#if canImport(ActivityKit) && os(iOS)` for the attributes.
- **Driver: native**, because the web view is frozen while the phone is
  locked. `WatchLink` gains `onStateNative`, set in `AppDelegate` before
  `WatchLink.shared.start()` (a background launch never loads the plugin).
  The manager `LiveSessionActivities.swift` is added to the App target in
  `project.pbxproj` by hand, classic format, like `WatchLink.swift`.
- **Starting** (ActivityKit only allows it in the foreground):
  - at the phone's Start, from native `startWatchWorkout` (the app is in the
    foreground then): "Starting on your watch", updated by the first report;
  - when GymGo comes to the foreground during a watch session;
  - for a wrist start with the phone locked, through **HealthKit workout
    mirroring**: the watch mirrors its session to the phone
    (`startMirroringToCompanionDevice`), which launches the phone app in the
    background with a one-time permission to start a Live Activity. The phone
    sets `workoutSessionMirroringStartHandler` at every launch from a stored
    `HKHealthStore`. The watch's session is still the only one that saves to
    Health. If mirroring fails or needs anything the phone does not have, the
    activity simply starts the next time GymGo is opened.
- **Updating and ending** from the watch's reports, which already wake the
  phone (`sendMessage`), every change and every 30 s. `staleDate` 5 minutes
  ahead. Ends on `ended`/`none`, another workout, or 5 minutes of silence.
- **State report gains** `inHand: { name, detail } | null` (exactly what the
  watch's set screen shows) and `rest.startedAt` (ISO), so the bar is exact.
- **The watch's own copy:** iOS forwards Live Activities to the watch's Smart
  Stack and that cannot be turned off in code. The watch app's Info.plist sets
  `WKSupportsLiveActivityLaunchAttributeTypes` to `GymGoSessionAttributes` so
  a tap opens GymGo on the watch, and the watch gets a quiet `.small` view.
- `NSSupportsLiveActivities` = YES in the App's `Info.plist`.
- **Not in build 7:** a countdown for a rest the **phone** logs with no watch
  (it would need a second driver from the web app).

## Contract changes, in one place

All additive; protocol and snapshot versions stay 1. Every new Swift field in
a snapshot type, `LoggedSet` or anything saved in `watch-state.json` is
**Optional** (a synthesised decoder throws on a missing non-Optional key, and
a failed restore loses unconfirmed sets). An Optional with a default decodes
to nil, so readers treat nil as false or empty.

| Where | Addition |
|---|---|
| `WatchLift` (TS `src/domain/watch.ts`, Swift `Snapshot.swift`) | `plan?: { kind, verb, reason } \| null`, `lastTime?: { day, top: {weight, reps}, sets: [{weight, reps}] } \| null`, `repLow?: number \| null` |
| `WatchSet` | `amrap?: true` |
| `WatchLift.doneToday[]` (Swift `DoneSet`) | `amrap?: true` |
| `WatchHintSource` | `'stepped'` (a String in Swift already) |
| `WatchEntryInput` | `suggestion` widens to `Pick<Suggestion, 'weight_kg' \| 'reps' \| 'kind' \| 'reason'> \| null`; `repRange: { low, high } \| null` |
| `LoggedSet` (Swift) | `isAmrap: Bool?` |
| `WatchSession` (Swift) | `focus: String?`, `skipped: [String]` (hand-written decoder, `decodeIfPresent`) |
| `WatchStateReport` (TS `watchProtocol.ts`, Swift `Protocol.swift`) | `skipped: string[]`; `paused: string \| null`; `inHand: { name, detail } \| null`; `rest.startedAt?: string`. `paused` and `inHand` join `Wire.nullableKeys`. `readReport` on the phone copies them, defaulting `skipped` to `[]`, `paused` and `inHand` to null; the dev seam's defaults too. **`session` gets no new value**: a build 6 phone rejects an unknown one. |
| New fixtures | `carry.json` (extended), `stations.json`, `upnext.json`, and `state.json` (a report with every field, written by TS and decoded by the Swift tests) |

## Who builds what

The contract step lands first on `dev`: the shapes above in both languages,
the TS rules the watch ports (`carryForward`, `upNextFor`), their fixtures,
and `docs/watch-protocol.md`. Then five builders work in parallel, each in
its own worktree, each owning its files:

| Part | Owns |
|---|---|
| **phone** | `src/**` except the contract files' shapes, `e2e/companion.mjs`, `scripts/watchFixtures.ts`, `fixtures/watch/*` |
| **watch-logic** | `ios/GymGoKit/Sources/GymGoKit/**` except the files below, `GymGoWatchUI`'s `WatchSessionStore.swift`, `SetInHandView.swift`, `RestView.swift`, `SessionListView.swift`, `SummaryView.swift`, `WatchRootView.swift`, `PhoneLink.swift`, the GymGoKit tests for them |
| **watch-platform** | `GymGoWatchUI`'s `WorkoutController.swift`, `RestAlerts.swift`, `WorkoutPages.swift`, `IdlePages.swift`, a new `WatchSessionStore+Action.swift`, `GymGoKit/Pause.swift` (new, pure), `ios/App/GymGo Watch App/**` |
| **complications** | `GymGoKit/Glance.swift` (new), `GymGoKit/Home.swift` (keeping `WatchAppState.todayCard(now:)` as it is called today, so no screen changes), `GymGoWatchUI/GlancePublisher.swift` (new), `GymGoWatchUI/WatchApp.swift`, `ios/App/GymGo Complications/**` |
| **liveactivity** | `GymGoKit/LiveSession.swift` and `LiveSessionAttributes.swift` (new), `ios/App/App/**` (AppDelegate, WatchLink, the new manager, Info.plist), `ios/App/GymGo Live Activity/**`, `ios/App/App.xcodeproj/project.pbxproj` (only to add the manager to the App target), `ios/App/GymGo-Watch-App-Info.plist` |

Seams between them (names fixed here so they can be built at the same time):

- `WorkoutController` (watch-platform) exposes `isPaused: Bool`, `pausedAt:
  Date?`, `pause()`, `resume()`, `onRecordingStarted: (() -> Void)?`, and
  calls `startMirroringToCompanionDevice()` once its session runs (errors
  logged, never surfaced).
- `WatchSessionStore` (watch-logic) exposes, for the Action button and the
  Undo: `logSetOnScreen() -> Bool` (Done with the numbers on screen; false
  when there is nothing to log), `skipRest()`, `startToday()`,
  `undoLastSet()`, and `onSaved: ((WatchAppState) -> Void)?`, called at the
  end of every `save()` whether or not a state file exists (the complications
  publisher hangs off it), and `syncRestAlert()`, which watch-platform calls
  after every pause and resume. It reads `workout.isPaused` and
  `workout.pausedAt` for the report and for the rest alert (paused counts as
  not recording), and resumes on a set logged while paused.
- `onRecordingStarted` is set in `GymGoApp.swift` (watch-platform) to donate
  `ActionButtonPress`.
- The pure "numbers on screen" function and `nextLoadableBelow` live in
  GymGoKit (watch-logic); `SetInHandView` and `actionButtonPressed` both use
  the former.
- `WatchLink.onStateNative: ((ReceivedState) -> Void)?` and the native
  `startWatchWorkout` path (liveactivity) start the activity at the phone's
  Start.

## What only the devices can prove

The Action button's next action on the Ultra (Settings → Action Button →
Workout → GymGo → First Press: **Today's Session**); a press while paused;
Pause with Action + side; whether a paused session keeps haptics wrist-down;
complications on the face and in the Smart Stack, including the countdown in
Always On; the Live Activity's background updates after a watch wake;
mirroring launching the phone with the phone locked; whether the forwarded
Live Activity pops up over GymGo's own workout on the watch (if it does, turn
off Auto-Launch for GymGo in the Watch app → Smart Stack).

## Research behind this plan

The research notes (on the Action button, the complications, the Live
Activity and the app side, each with a skeptic's check) and the typechecked
drafts of the complications and the Live Activity were in a session
scratchpad and are not in the repo. This plan and `docs/watch-protocol.md`
are what survives.
