# GymGo on iPhone and Apple Watch: roadmap

Author: Liam Daly
Date: 7 October 2026
Status: Proposal, nothing built yet
Builds on: `docs/build-brief.md` (version 3) and `CLAUDE.md`

## The short version

- **The iPhone app is the web app we already have, running inside a thin
  native shell (Capacitor).** It runs the same React code, the same Dexie
  database and the same screens, so it is identical because it is the same
  code. Nothing gets rewritten.
- **The watch app has to be written in Swift (SwiftUI).** watchOS has no web
  view, so no web app can run on a watch. It is a companion: it shows the set
  in hand and the rest, logs sets from the wrist, and hands everything to the
  phone, which stays the single source of truth.
- **Personal use means TestFlight internal testing.** You are the only tester.
  There is no App Store listing and no App Review, and nobody else can install
  it. A build lasts 90 days, so a scheduled rebuild keeps it alive.
- **You need a Mac with Xcode** for the setup and for the watch work. There is
  a Plan B below if that is a problem.

## Where this starts from

What exists today, from reading the repo:

- About 19,600 lines of TypeScript, 8,600 lines of unit tests and 17 browser
  suites (about 3,700 lines of Playwright, keyed on accessible names).
- There are 21 routes and 3 tabs, plus a full-screen workout area with the set
  in hand, the station strip, its sheets and the rest takeover. There is one
  Recharts chart; the other charts are hand-drawn SVG and CSS.
- The rules are the product: counting, records, the schedule and roll-forward,
  progression, rotation, rewards and supersets. Each one lives in exactly one
  place in `src/domain/`, and each is tested in both directions.
- `HashRouter`, every asset bundled (fonts, 345 exercise photos, the seed), no
  `fetch` outside `src/sync/`. This already behaves like an app packaged with
  everything it needs, which is what makes the wrap cheap.

## The decision: wrap the web app, write the watch app

| | Capacitor shell (recommended) | React Native | SwiftUI rewrite |
|---|---|---|---|
| iPhone screens identical | Yes, it is the same code | No, every screen redrawn | No, every screen redrawn |
| Domain rules reused | All of them, unchanged | Most, the TS can be shared | None, all ported to Swift |
| Existing tests still prove the app | Yes | Domain only | No |
| Two copies of every rule to keep in step | No | No | Yes, forever |
| Watch app | SwiftUI | SwiftUI | SwiftUI |
| Size of the job | Weeks | Months | Many months |

A rewrite would also break the promise the project is built on: a rule lives
in one place. With a Swift copy of the schedule, the progression engine and
the counting rules, every future change would have to be made twice and
checked twice, and "identical" would slip a little with every release.

Capacitor runs the bundle in WKWebView, which is the same WebKit engine that
runs the home-screen app now. So the look, the fonts, the gestures and the
type all carry across as they are.

The watch is the one piece that has to be native whatever the route, so it
gets its own design, set out below.

## Before starting

What you need:

- **A Mac with Xcode 26.** It is needed to create the project and sign it,
  add the watch target, run on your own devices and debug the watch.
- **Your iPhone and Apple Watch**, paired, with Developer Mode switched on.
- **Your Apple Developer account** (you have this).
- **The Supabase project you already use.** Nothing changes server side.

Set the minimum OS to whatever your own phone and watch run. Nobody else has
to be supported, and the newest versions give every API in this plan with no
fallbacks: mirrored workouts arrived in iOS 17 and watchOS 10, and HealthKit
workouts on the iPhone itself in iOS 26.

**Plan B, without a Mac.** Xcode Cloud can build, sign and upload to
TestFlight from the repo with no Mac involved after the first setup. The
first setup (the project, the watch target, capabilities, first signing) is
far easier with Xcode open, so a borrowed Mac or a rented cloud Mac for a day
or two would do it. Every change after that would be tried through TestFlight
builds, which is slow for watch work (about 20 to 40 minutes per attempt).

**What Claude Code can do here.** In this cloud sandbox (Linux) it can write
all of the TypeScript, the Capacitor config, the Swift for the plugins and
the watch app, the tests and the CI scripts. It cannot compile Swift or run a
simulator here. So the native phases are best run with Claude Code on your
Mac (desktop app or CLI), where it can build with `xcodebuild`, run the
simulators and read the errors itself. The TypeScript slices (`src/platform/`,
`src/domain/watch.ts`, fixtures) can still be done in cloud sessions.

## Phases at a glance

| Phase | What you get | Size | Needed for "identical"? |
|---|---|---|---|
| 0 | Brief and rules updated, Apple accounts set up | S | Yes |
| 1 | GymGo on your iPhone as a real app, identical | L | Yes |
| 2 | Push to main reaches your phone by TestFlight, history moved across | M | Yes |
| 3 | Rest alerts with the phone locked, Lock Screen countdown | M | No, recommended |
| 4 | Watch app: the set in hand and the rest on your wrist | M | Watch |
| 5 | Log whole sessions from the watch with the phone in your bag | L | Watch |
| 6 | Apple Health, complications, starting from the watch | M to L | Optional |

Sizes are rough: S is an evening, M is a few evenings, L is a week or more of
evenings.

## Phase 0: Change the brief, set up the accounts (S)

The brief rules this out as it stands: "No feature that requires an app store
submission or a paid developer account", and "Apple Watch app" is listed under
out of scope. So it changes first.

1. **Brief version 4.** Replace the store rule with "Distributed by TestFlight
   to my own devices only; never listed on the App Store." Move the Apple
   Watch out of "Out of scope". Rewrite "Known limits": the watch, Apple
   Health and background timers are all possible in a native app.
2. **CLAUDE.md** gains the rules in "Rules to add to CLAUDE.md" below, as each
   phase lands.
3. **Identifiers.** Pick a bundle ID prefix, for example
   `com.liamdaly.gymgo` for the phone, `com.liamdaly.gymgo.watchkitapp` for
   the watch and the App Group `group.com.liamdaly.gymgo`.
4. **App Store Connect.** Create the app record. The name has to be unique
   across the whole store even though it will never be released, so use
   something like "GymGo Liam". The name on your home screen is set separately
   and stays "GymGo". Create an internal testing group with only your Apple ID
   in it.
5. **Decide what happens to the website** (see Phase 2, step 7).

Done when: the brief and CLAUDE.md say what is being built, and the app
record and tester group exist.

## Phase 1: GymGo on the iPhone, identical (L)

### 1.1 Add the shell

- Add Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`).
  It uses Swift Package Manager, so there is no CocoaPods.
- `capacitor.config.ts`: app ID, app name "GymGo", `webDir: 'dist'`,
  background `#0c0c0b`. The web view draws edge to edge (`contentInset:
  'never'`), so the safe-area CSS the app already has does the work, as it does
  in the home-screen app.
- `npx cap add ios` creates `ios/App/`. Commit it: it is source code from here
  on.

### 1.2 A native build

- `npm run build:ios` runs `vite build --mode ios`. In that mode
  `vite.config.ts` leaves out `VitePWA`. WKWebView does not run service workers
  on an app's own scheme, and the app doesn't need one: every file ships
  inside the app, so it is offline by construction.
- `npm run ios` runs `build:ios`, then `cap sync ios`, then opens Xcode.
- The web build is untouched. `npm run build`, Vercel and `test:offline` stay
  exactly as they are.

### 1.3 `src/platform/`: the only place that knows it is in an app

Each capability gets one small module with a web fallback, so the browser
suites and the website keep working unchanged:

| Today | File | In the app |
|---|---|---|
| Screen Wake Lock | `src/hooks/useWakeLock.ts` | Native keep-awake plugin, on for the whole `WorkoutShell` as now |
| `navigator.vibrate` | `src/lib/feedback.ts:64` | `@capacitor/haptics`. Safari has no vibration API, so the Vibrate toggle has never done anything on your iPhone. In the app it works, and its hint ("Ignored on iOS Safari…") changes to match |
| Web Audio tones | `src/lib/feedback.ts` | Kept as they are. The app sets its audio session to mix with other audio, so the rest beep plays over your music instead of stopping it |
| `<a download>` export | `src/db/backup.ts:134` | That does nothing inside a web view. Write the file with `@capacitor/filesystem` and open the share sheet (`@capacitor/share`): Save to Files, AirDrop or Mail |
| `<input type="file">` import | `SettingsScreen.tsx:169` | Already opens the Files picker in WKWebView. Test it |
| `visibilitychange` (5 listeners) | wake lock, elapsed clock, `useToday`, rest timer, sync | Fires in WKWebView too. Check all five, and back them with `@capacitor/app`'s resume event if any misbehave |

A boundary test, in the same style as `scripts/boundaries.test.ts`: only
`src/platform/` imports `@capacitor/*`; `src/domain/` never imports
`src/platform/`; and the workout screens still never import `@/sync`.

### 1.4 Parity pass, side by side with the home-screen app

Go through every route and overlay in the app, on the phone, next to the
current home-screen app:

- **Status bar:** light text over the near-black ground, drawn over the web
  view (what `black-translucent` does now).
- **Launch:** launch screen and web view background in `#0c0c0b`, so it never
  flashes white.
- **Safe areas:** the 12 `env(safe-area-inset-*)` uses: the tab bar, resume
  bar, sheets, toast, done bar and the rest takeover.
- **Keyboard:** the set-in-hand fields, the number fields in sheets, the
  sign-in form. Pick the Capacitor keyboard resize mode that matches Safari, so
  the done bar does not jump.
- **Scrolling and touch:** rubber-banding (the body already sets
  `overscroll-behavior-y: none`), the calendar swipe, long-press link
  previews, and the tap-to-skip on the rest clock.
- **Type:** every input is at least 16px, so focusing one never zooms.
  Upper-casing stays in CSS.
- **Offline:** aeroplane mode from a cold start. Fonts, photos and the seed
  all load from inside the app.
- **Small phone:** the record still fits the rest screen at 375 × 667, as
  `test:rewards` proves on the web.

### 1.5 Keep the data safe

This is the one place where the native app is weaker by default. Capacitor's
own docs say iOS can reclaim a web view's IndexedDB and localStorage when the
phone runs low on space. The home-screen app has a version of the same risk
already (the brief's "iOS can evict local browser storage"). There are three
layers of protection:

1. **The Supabase backup, unchanged.** A wiped app restores everything on the
   next sign-in.
2. **A snapshot on the phone itself.** After every Finish, and once a day,
   write the same JSON as "Export everything" into the app's Documents folder
   with `@capacitor/filesystem`, and keep the last seven. iOS does not reclaim
   those files. They go into your iPhone's iCloud backup, and with file sharing
   switched on in `Info.plist` they show up in Files under On My iPhone →
   GymGo.
3. **Restore on an empty launch.** If the database is empty but a snapshot
   exists, offer to restore it. `importFromJson` already does the work, and it
   queues every row for backup.

Also move the small localStorage keys that matter onto native storage
(`@capacitor/preferences`):

- the Supabase session;
- the backup ledger (`gymgo.backup.*`);
- the plan builder's choices (`gymgo.builder`);
- the once-per-phone flags (`gymgo.once.*`).

The once-per-phone flags matter most. If localStorage were cleared while the
database survived, `clearGeneratedRests` would run a second time and could
clear a 3:00 rest you typed in yourself, which CLAUDE.md says must never
happen. The running rest (`gymgo.rest`) can stay where it is, because it is
throwaway by design.

### 1.6 First install

Plug the phone into the Mac, choose it in Xcode and press Run. A paid
account's development signing lasts a year, which is fine while building.
TestFlight takes over in Phase 2.

**Done when:**

- A full planned session logs in aeroplane mode on the app: the rest timer,
  the screen staying on, the plate diagram, a record flash with its sound and
  a buzz.
- Killing the app mid-rest and reopening it brings the rest back (the
  existing behaviour).
- Every route and overlay matches the home-screen app side by side.
- Export opens the share sheet, and importing from Files restores.
- Backup and restore work from inside the app.
- `npm test` and all 17 browser suites still pass on the web build.

## Phase 2: Shipping it to your phone (M)

1. **Info.plist:** set `ITSAppUsesNonExemptEncryption` to `NO`. The app only
   uses HTTPS, which is exempt, and this stops every upload pausing at the
   export compliance question.
2. **Version numbers:** the version comes from `package.json` and the build
   number from CI.
3. **Xcode Cloud** (25 compute hours a month come with your membership):
   - `ios/App/ci_scripts/ci_post_clone.sh` installs Node, then runs `npm ci`,
     `npm test`, `npm run build:ios` and `npx cap sync ios`. It has to run
     first, because the Swift packages point into `node_modules`.
   - The Supabase URL and anon key are Xcode Cloud environment variables. They
     are the public key only, never the service role key.
   - **Workflow one:** a push to `main` archives the app and sends it to your
     internal TestFlight group.
   - **Workflow two:** a monthly scheduled build, so a quiet spell never lets
     the 90-day expiry lock you out of your own app.
   - The alternative is GitHub Actions on a macOS runner with fastlane. It
     works, but on a private repo macOS minutes count ten times, so Xcode Cloud
     is the cheaper fit.
4. **TestFlight on the phone**, with automatic updates on.
5. **The update speed changes.** Today a push reaches the phone at the next
   launch, through the service worker. Now it is a build plus processing,
   about 20 to 40 minutes. For one person that is fine. Live web-bundle
   updates exist, but they mean a third-party service, which the brief rules
   out, so park them.
6. **Move your history across.**
   - In the home-screen app, Settings → Back up now, until the status reads
     "Backed up". Also export everything as JSON and keep the file.
   - Sign in on the new app. Its first round restores before it uploads
     anything (step 1 of `syncNow`), and it drops its own starter gym.
   - Check that Settings → On this device shows the same counts in both apps.
7. **Then remove the home-screen icon.** Two logging apps on one phone keep
   two databases, and a workout open in one is not in the other until both
   have synced. Keeping the website on Vercel is still worth it, because it
   costs nothing and works on a laptop. Since both sync through the same
   account, it is a second device rather than a second history.

**Done when:** a push to `main` reaches your phone through TestFlight without
you touching a Mac, and every count matches the old app.

## Phase 3: What the app can do that Safari could not (M, recommended)

The screens don't change. Each item fixes a limit the brief had to accept.

1. **Rest alerts with the phone locked.** When Done starts a rest, schedule a
   local notification for the rest's end time. Move it on ±30s, and cancel it
   on Skip, on a drop, on Finish and on Discard. While the app is open the
   in-app tone plays instead, so you never get both. This replaces "keep the
   timer on screen rather than relying on a background notification". A bonus:
   with the phone locked, iPhone notifications go to your watch, so you get a
   tap on the wrist before any watch code exists.
2. **The rest on the Lock Screen and the Dynamic Island** (a Live Activity):
   the countdown, "Up next" and the set count. It needs a small Swift widget
   extension, fed by a plugin when Done is pressed. The system draws the
   countdown from the end time, so nothing has to run while the phone is
   locked.
3. **Optional: a home screen widget** showing the next session ("Push ·
   Today · 5 exercises"), from a snapshot the app writes into the App Group
   whenever the schedule changes.

**Done when:** with the phone locked in your pocket, the end of a rest buzzes
and beeps, and the Lock Screen shows the countdown.

## Phase 4: Watch app, the set and the rest on your wrist (M)

### 4.1 The hard fact this design follows

iOS freezes a web view's JavaScript when the app goes into the background,
and that is a WebKit limit, not a Capacitor one. The watch can wake the
phone app's native Swift code, but the React app and Dexie stay frozen until
you open the phone. So with the phone locked in a bag, the watch cannot ask
the phone what comes next, and the phone cannot write anything to Dexie.

Everything below follows from that.

### 4.2 The pieces

- **A watchOS target** in the Xcode project (SwiftUI).
- **`GymGoKit`, a Swift package** shared by phone and watch. It holds:
  - the snapshot and event types (`Codable`);
  - the Bold design tokens: ground, chalk, blue (`hot`) and muted;
  - the bundled Big Shoulders Display and Barlow fonts (OFL, as on the web).
  The watch is not the web app, but it should look like the same app:
  near-black, poster-sized chalk numbers and one blue highlight.
- **`WatchBridge`, a local Capacitor plugin** in the iPhone app:
  - starts the WatchConnectivity session;
  - sends the latest snapshot (`updateApplicationContext`: newest wins);
  - receives events from the watch into an inbox file in the App Group
    container, even while the web view is frozen.
- **`src/domain/watch.ts`** (pure, unit tested): `buildWatchSnapshot` turns the
  active workout into what the watch shows. See "The session snapshot" below.
- **`src/platform/watch.ts`:** watches the active workout and the rest, and
  sends a new snapshot whenever either changes.

### 4.3 A workout session keeps the watch app on your wrist

Without one, a watch app drops into the background as soon as you lower your
wrist and stops running. Every strength app on the watch uses an `HKWorkoutSession`
(Traditional Strength Training) for this:

- the app comes back on screen when you raise your wrist;
- timers and haptics keep running;
- you get heart rate and elapsed time;
- it shows on the always-on display.

Whether the workout is saved to Apple Health at the end is a separate choice
(Phase 6). It can be thrown away instead. Starting a workout on the phone
opens the watch app on its own (`startWatchApp(with:)`), and finishing on the
phone ends it.

### 4.4 What the watch shows in this phase

The phone does the logging; the watch shows the same state:

- **The set in hand:** the exercise, "Set 2 of 4" (from `setOrdinals`) and
  the weight × reps, poster-sized.
- **The rest:** the countdown from the end time, "Up next" and a "New record"
  in blue when there is one. A firm tap on the wrist when it ends. The watch
  counts down by itself, so this works with the phone locked.
- **After the rest:** the next set, which is already in the snapshot.

**Done when:** you start a session on the phone and the watch app opens on its
own. You press Done on the phone, lock it and pocket it. The watch counts the
rest down, taps your wrist at the end and shows the next set.

## Phase 5: Logging from the watch (L)

### 5.1 What you can do on the wrist

- **Done** logs the set in hand, the way the phone's Done bar does
  ("Done · 102.5 × 6").
- **The Digital Crown** moves the weight through the weights your gym can
  actually load: the same steps as the phone's steppers, from a ladder the
  snapshot carries. Tap the reps to put the Crown on reps.
- **The rest** starts after a set exactly where the phone would start one,
  including supersets (A1 straight into A2, rest after the pair).
- **This session:** every station in order and how far along each is. Tap one
  to go there.
- **Finish** asks on the watch, then goes to the phone.

These stay on the phone, at least for now: adding exercises, swaps, adding
sets and child sets, the warm-up generator and fixing a done set.

### 5.2 The session snapshot: the watch walks a list, the phone does the thinking

The phone sends the watch every set still to do, already in the order
`setInHand` walks them: warm-ups first, then working sets round by round
across a superset, with each child set straight after its parent. Each entry
carries:

- the set ID, exercise, station and label;
- the weight and reps to show, and where they came from (scheme, carried,
  suggestion, last time);
- the loadable-weight ladder for the Crown, and the unit ("kg", "kg each",
  "kg added");
- the rest after it, from `restSecondsFor`, the routine's override and
  `restsAfterSet`, worked out by simulating the round;
- the "Up next" lines, and the marks to beat for a record.

The snapshot is built in TypeScript from the existing rules, so they still
live in one place, and the watch only follows the list. The phone sends a new
snapshot every time it can, and that corrects anything the watch had to
estimate.

### 5.3 The three rules the watch needs for itself

With the phone frozen, the watch has to work out three things on its own:

1. **Carry forward.** From the second set on, the placeholder is the set just
   done (`latestWorkingSet`). Warm-ups, drops and back-offs are never carried.
2. **The back-off target.** In a pyramid it comes from today's top set
   (`schemeTarget`): 10% lighter per step, rounded down through the ladder,
   two more reps.
3. **The record check.** It uses `marksBroken` against the marks in the
   snapshot: the heaviest top set, the best Epley estimate, and the most reps
   at 0kg. The same gate applies, so a first, a tie, a warm-up, a drop and a
   back-off never flash.

These are ported to Swift and held to the TypeScript by shared fixtures.
`npm run fixtures:watch` runs the TypeScript functions over a set of cases
and writes `fixtures/watch/*.json`. Vitest checks them, and an XCTest runs
the Swift port over the same files. If either side changes, the other side's
test fails.

### 5.4 Events and the inbox

- The watch writes each action to its own log first, so a crash or a relaunch
  mid-session keeps its place. The actions are: complete set X with W × R at
  time T, skip rest, and finish.
- It sends them with `sendMessage` when the phone is reachable (this wakes the
  phone app's native code, which writes them to the inbox and acknowledges
  them), and with `transferUserInfo` when it is not (queued, and delivered
  for certain once the phone app runs). Every event carries its own UUID, so a
  duplicate is dropped.
- On the phone, the React app drains the inbox in order:
  - on launch and on resume, before anything else;
  - straight away if the app is already open.

  Each event goes through the same mutations as a tap. A completed set goes
  through `completeSetWith`, so `updated_at`, the outbox and the backup all
  work unchanged.
- **`completeSetWith` gains an optional `completedAt`,** so a set logged on
  the wrist at 18:42 is stamped 18:42, not when you next opened the phone.
  That matters because records (`recordSetIds`) and the early bird and night
  owl badges read those times.
- **Finish on the phone drains the inbox first.** `finishWorkout` tidies away
  untouched sets, and a finished workout is immutable, so sets the watch
  logged but the phone had not yet applied would otherwise be lost.
- **If the same set is logged on both,** the later time wins. That is the
  same last-write-wins rule as everywhere else.

**Done when:**

- A whole session (a superset, a pyramid and a record) is logged on the watch
  with the phone locked in a bag.
- Opening the phone shows every set with the right times, the right records
  and the right session list, and it backs up.
- The reverse also works: log on the phone and the watch keeps up.

## Phase 6: Apple Health and extras (M to L, each one optional)

1. **Save each workout to Apple Health** at Finish, as Traditional Strength
   Training, with the duration, heart rate and active energy from the watch.
   Opt in. That means one more switch in Settings, under Sound and Vibrate.
2. **Complications and the Smart Stack:** the next session and its day, and
   during a session the rest countdown.
3. **Body weight from Apple Health** into Progress → Body, one entry a day
   through `logBodyMetric`, instead of typing it in (one of the brief's
   "known limits").
4. **Start the next planned session from the watch** with the phone in a
   locker. The phone sends ahead what Today would show. The watch starts it
   with IDs it makes itself, and the phone replays the start through
   `startWorkoutFromRoutine` with those IDs. This touches the immutability
   copy, `slotForRoutine` and `runningPlan`, so it is the biggest and riskiest
   item here, and it goes last.

## Risks

| Risk | What it would do | How it is handled |
|---|---|---|
| iOS reclaims web storage on a full phone | The database disappears | Supabase restore, a daily snapshot in Documents, restore on an empty launch, important keys in native storage (1.5) |
| JavaScript frozen while the phone is locked | The watch cannot reach the app's logic | The watch walks a precomputed list; events wait in a native inbox (4.1, 5.2, 5.4) |
| Logging on both devices at once | Two versions of one set | Event IDs, last write wins on time, the inbox drained before Finish (5.4) |
| The Swift rules drift from the TypeScript | The watch shows a different number | Only three small rules are ported, held by shared fixtures (5.3) |
| A TestFlight build expires after 90 days | The app stops opening | A monthly scheduled build (Phase 2) |
| No Mac | Setup and watch debugging are painful | Plan B: Xcode Cloud plus a borrowed or rented Mac for setup |
| Updates are no longer instant | A fix takes 20 to 40 minutes to arrive | Xcode Cloud on every push; the website stays as a fallback |
| Web view differences (wake lock, vibration, download) | Something quietly stops working | Each goes through `src/platform/` with a web fallback, and is checked in 1.4 |
| Two copies of the app on one phone | History split across two databases | Remove the home-screen icon after moving across (Phase 2) |

## Testing

- **Everything that exists stays valid.** The app runs the same bundle, so
  `npm test` and the 17 browser suites still prove its behaviour. Running them
  once in Playwright's WebKit on the Mac is a cheap way to get closer to
  WKWebView.
- **New unit tests:** the `src/platform/` fallbacks, `buildWatchSnapshot`, the
  inbox drain (idempotent, in order, refused on a finished workout) and the
  fixture generator.
- **XCTest:** `GymGoKit` decoding every fixture, the three ported rules, and
  the bridge's inbox file.
- **A short device checklist** in `docs/ios.md`, run before a release:
  - a cold start in aeroplane mode;
  - a rest that ends with the phone locked;
  - a session logged on the watch with the phone in a bag;
  - killing the app mid-rest;
  - restoring from a snapshot.

## Rules to add to CLAUDE.md

Draft wording, to be added as each phase lands:

- **The native shell.** The iPhone app is the web build inside Capacitor.
  Nothing outside `src/platform/` may import `@capacitor/*`, and every module
  there has a web fallback, so the website and the browser suites keep
  working. `scripts/boundaries.test.ts` enforces this.
- **The watch walks a list.** The phone works out the order, the rests and
  the targets (`buildWatchSnapshot`). The watch keeps exactly three rules of
  its own (carry forward, the back-off target, the record check), held to the
  TypeScript by `fixtures/watch/`. A fourth rule on the watch needs a fixture
  too, or it does not go in.
- **Watch events are taps.** They go through `src/db/mutations.ts` like any
  other write, with the time they happened on the wrist. The inbox is drained
  before anything else, and always before Finish.
- **Distribution.** TestFlight internal testing only. Only the anon key goes
  into a build, as now.

## Found while reading (these carry across as they are)

These are gaps in the app as it stands. They are not caused by this plan, but
because the app moves across unchanged, they come with it:

- **Setup notes never show during a set.** The brief asks for "Setup notes per
  exercise that persist and appear during the set", and the exercise screen
  says they are "Shown while you are logging this exercise". In fact nothing
  under `src/features/workout/` reads `setup_notes`. They would also be one of
  the most useful things to put on the watch.
- **The exercise picker's Pro hint says "Create a custom exercise from the
  library",** but the library has no control for it. `createCustomExercise`
  exists in `src/db/mutations.ts`, and nothing calls it.
- **`settings.units` and `settings.week_starts_on` have no control in
  Settings.** The week start does drive the calendar.

## Decisions needed from you

1. **Do you have a Mac with Xcode 26?** If not, which Plan B?
2. **Which iPhone and Apple Watch models**, on which OS versions? These set the
   minimums.
3. **The website:** keep it on Vercel as a second device, or retire it?
4. **Phase 3** (rest alerts when locked, the Lock Screen countdown): yes or no?
5. **Apple Health:** save workouts? Read body weight?
6. **The bundle ID prefix** (for example `com.liamdaly`).
7. **The three gaps above:** fix them before porting, or after?
