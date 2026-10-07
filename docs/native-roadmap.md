# GymGo on iPhone and Apple Watch: roadmap

Author: Liam Daly
Date: 7 October 2026
Status: Agreed, nothing built yet. Decisions are recorded at the end.
Builds on: `docs/build-brief.md` (version 3) and `CLAUDE.md`
Step-by-step guide for doing it: `docs/ios-guide.md`

## The short version

- **The iPhone app is the web app we already have, running inside a thin
  native shell (Capacitor).** It runs the same React code, the same Dexie
  database and the same screens, so it is identical because it is the same
  code. Nothing gets rewritten.
- **The watch app is written in Swift (SwiftUI).** watchOS has no web view, so
  no web app can run on a watch. It is a companion: it shows the set in hand
  and the rest, logs sets from the wrist (including from the Ultra's Action
  button), and hands everything to the phone, which stays the single source of
  truth.
- **Personal use means TestFlight internal testing.** You are the only tester.
  There is no App Store listing and no App Review, and nobody else can install
  it. A build lasts 90 days, so a scheduled rebuild keeps it alive.
- **The work happens in a Claude Code session on your Mac,** because only a
  Mac can run Xcode. The guide covers moving this cloud chat across.

## Where this starts from

What exists today, from reading the repo:

- About 19,600 lines of TypeScript, 8,600 lines of unit tests (676 tests, all
  passing) and 17 browser suites (about 3,700 lines of Playwright, keyed on
  accessible names).
- There are 21 routes and 3 tabs, plus a full-screen workout area with the set
  in hand, the station strip, its sheets and the rest takeover. There is one
  Recharts chart; the other charts are hand-drawn SVG and CSS.
- The rules are the product: counting, records, the schedule and roll-forward,
  progression, rotation, rewards and supersets. Each one lives in exactly one
  place in `src/domain/`, and each is tested in both directions.
- `HashRouter`, every asset bundled (fonts, 345 exercise photos, the seed), no
  `fetch` outside `src/sync/`. This already behaves like an app packaged with
  everything it needs, which is what makes the wrap cheap.
- **The GitHub repo is public, and it has no `main` branch.** The default
  branch is `claude/markdown-instructions-review-e0rk5v`, and this roadmap
  lives on `claude/wonderful-galileo-6td7bh`. Public is fine as long as no
  secret is ever committed (`.env.local` is already gitignored). Phase 0 makes
  a `main` branch so that "push to main" means something.

## The decision: wrap the web app, write the watch app

| | Capacitor shell (chosen) | React Native | SwiftUI rewrite |
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

## The setup

- **Mac:** Apple silicon with Xcode 27.
- **iPhone 14 Pro** (Dynamic Island, no Action button) and **Apple Watch
  Ultra 2** (Action button, double tap), both on 26.6.x today.
- **Minimum versions: iOS 26.0 and watchOS 26.0.** The app runs on what the
  devices have now and keeps working when they move to 27. Xcode 27 builds
  for both, and Apple's current documentation describes Xcode 27's screens,
  so the help pages match what you see. APIs new in 27 (such as HealthKit's
  limited-history check) sit behind availability checks.
- **Devices in Xcode 27** are managed in Device Hub, which replaced the
  Simulator app and the Devices window. While the iPhone is on iOS 26 it is
  paired by cable, and it has to stay plugged in to run the watch app. On iOS
  and watchOS 27 the watch pairs with the Mac directly over Wi-Fi, which Apple
  calls more reliable, so updating both devices before Phase 4 is worth
  considering. Each OS update means pairing again.
- **Toolchain:** Node 24 LTS (the project needs at least 22.12, and never 23),
  Capacitor 8.5 with Swift Package Manager (no CocoaPods).
- **Where Claude works:** a local Claude Code session in `~/Developer/GymGo`
  on the Mac. It builds with `xcodebuild`, drives the simulators and reads the
  errors itself. You do the few things only a person can do: your Apple ID,
  your devices' screens, Apple's websites, and approving what Claude asks to
  run. Xcode 27 can also hand Claude its own build tools (the Xcode MCP bridge).

## Phases at a glance

| Phase | What you get | Size |
|---|---|---|
| 0 | The repo works on the Mac, a `main` branch, the brief updated | S |
| 1 | GymGo on your iPhone as a real app, identical | L |
| 2 | TestFlight and Xcode Cloud; history moved across; Vercel retired | M |
| 3 | Rest alerts with the phone locked; the countdown on the Lock Screen and in the Dynamic Island | M |
| 4 | Watch app: the set in hand and the rest on your wrist | M |
| 5 | Log whole sessions from the watch, Action button included, with the phone in your bag | L |
| 6 | Apple Health: every workout saved, body weight read | M |
| 7 | Extras: complications, starting a session from the watch | M to L |

Sizes are rough: S is an evening, M is a few evenings, L is a week or more of
evenings.

## Phase 0: Groundwork (S)

1. **Make the repo work on a Mac.** Three things found while checking it:
   - All 17 browser suites hard-code a Linux Chromium path
     (`/opt/pw-browsers/...`), so none of them launch on a Mac. Fall back to
     Playwright's own browser when that path is missing (`npx playwright
     install chromium`).
   - One unit test (`src/db/plans.test.ts:140`) fails between midnight and
     1am in British Summer Time, because the tests run in local time. Pin
     the test clock or the time zone.
   - CLAUDE.md's description of the suites' ports is out of date (two suites
     default to 5180, `test:offline` reads `PREVIEW_URL` and starts no
     server). Correct it.
2. **`main` and `dev` branches.** Push the roadmap branch to `main` and to
   `dev`, and make `main` the default branch on GitHub. `main` means "what is
   on the phone": Xcode Cloud builds every change to it. Day-to-day work
   happens on `dev` and is merged into `main` when a change is ready for the
   phone, so a burst of commits doesn't become a burst of builds. Vercel keeps
   deploying from its own branch until it is retired, so the home-screen app
   is untouched in the meantime.
3. **Brief version 4.** The brief currently says "No feature that requires an
   app store submission or a paid developer account", and lists the Apple
   Watch as out of scope. Replace the store rule with "Distributed by
   TestFlight to my own devices only; never listed on the App Store." Move the
   Apple Watch out of "Out of scope", and rewrite "Known limits": the watch,
   Apple Health and background timers are all possible in a native app.
4. **CLAUDE.md** gains the rules in "Rules to add to CLAUDE.md" below, as each
   phase lands.
5. **Apple's agreements.** Apple updated the Developer Program License
   Agreement on 18 August 2026. Accept it at developer.apple.com/account,
   and anything pending in App Store Connect under Business, or the first
   upload fails with "PLA Update available".

Done when: `npm test` and the browser suites pass on the Mac, `main` exists
and is the default, and the brief and CLAUDE.md say what is being built.

## Phase 1: GymGo on the iPhone, identical (L)

### 1.1 Add the shell

- Install Capacitor 8.5 (`@capacitor/core`, `@capacitor/ios`, and
  `@capacitor/cli` as a dev dependency), all on the same version.
- `npx cap init GymGo com.liamdaly.gymgo --web-dir dist`. The `--web-dir`
  matters: run without a terminal attached, which is how Claude runs
  commands, the CLI otherwise picks `www`.
- `capacitor.config.ts`: background `#0c0c0b` (unset, the web view is white
  and flashes on launch and overscroll), `ios.contentInset: 'never'` (the
  default; the app's safe-area CSS does the work, as it does now),
  `ios.allowsLinkPreview: false`, and a dark status bar through the core
  `SystemBars` plugin (`style: 'DARK'` means light text on a dark ground).
  Capacitor's config docs call that option Android-only, though the 8.5.3 iOS
  source reads it; if the status bar stays dark on dark, use
  `@capacitor/status-bar` with `Style.Dark` instead.
  Never set `server.url`, which is for live reload only.
- Build the web app, then `npx cap add ios` once. That creates `ios/App/`
  with `App.xcodeproj`, the Swift Package `CapApp-SPM` and a UIScene
  `SceneDelegate.swift`. Commit `ios/`; its own `.gitignore` already leaves
  out the generated parts. Never delete it to add it again.
- In Xcode: Display Name "GymGo", iPhone only, **portrait only** (the
  template allows landscape), minimum iOS 26.0.
- **Launch screen and icon.** The template launches on Capacitor's own logo
  on a white background. Replace both: a near-black launch screen, and a
  1024 × 1024 app icon made from `assets/icon-apple.svg` (add it to
  `scripts/build-icons.ts`).
- **Privacy manifest.** Using `@capacitor/preferences` and
  `@capacitor/filesystem` means adding `PrivacyInfo.xcprivacy` with their
  required reasons (UserDefaults `CA92.1`, file timestamps `C617.1`).

### 1.2 A native build

- `npm run build:ios` runs `vite build --mode ios`. In that mode
  `vite.config.ts` leaves out `VitePWA`. WKWebView does not run service
  workers in an app (Apple confirms it), and the app doesn't need one: every
  file ships inside the app, so it is offline by construction.
- `npm run ios` runs `build:ios`, then `npx cap sync ios`. Claude builds and
  installs from there with `xcodebuild`, or you press Run in Xcode.
- **Not `npx cap run ios`.** Xcode 27 replaced the Simulator app with Device
  Hub, and Capacitor's runner cannot find simulators until its fix ships
  (Capacitor issue 8620).
- **Never convert the project to Xcode 27.2's new JSON project format.**
  `cap sync` then stops updating the Swift packages without reporting an
  error (Capacitor issue 8607). Keep `App.xcodeproj/project.pbxproj`.
- The web build is untouched until the website is retired.

### 1.3 `src/platform/`: the only place that knows it is in an app

Each capability gets one small module with a web fallback, so the browser
suites and the website keep working unchanged:

| Today | File | In the app |
|---|---|---|
| Screen Wake Lock | `src/hooks/useWakeLock.ts` | `@capacitor-community/keep-awake` 8.x (or a ten-line local plugin; on iOS it only sets `isIdleTimerDisabled`), on for the whole `WorkoutShell` as now |
| `navigator.vibrate` | `src/lib/feedback.ts:66` | `@capacitor/haptics`. Safari has no vibration API, so the Vibrate toggle has never done anything on your iPhone. In the app it works, and its hint ("Ignored on iOS Safari…") changes to match |
| Web Audio tones | `src/lib/feedback.ts` | Kept as they are. The app sets its audio session to mix with other audio, so the rest beep plays over your music instead of stopping it |
| `<a download>` export | `src/db/backup.ts:134` | That does nothing inside a web view. Write the file with `@capacitor/filesystem` and open the share sheet (`@capacitor/share`): Save to Files, AirDrop or Mail |
| `<input type="file">` import | `src/features/settings/SettingsScreen.tsx:169` | Already opens the Files picker in WKWebView. Test it |
| `visibilitychange` (5 listeners) | wake lock, elapsed clock, `useToday`, rest timer, sync | Fires in WKWebView too. Check all five, and back them with `@capacitor/app`'s resume event if any misbehave |

**Local plugins** (the watch bridge, the Live Activity, HealthKit) are Swift
classes in the app target. With Capacitor 8.5's UIScene template they are
registered from a `CAPBridgeViewController` subclass that
`SceneDelegate.swift` creates; the storyboard method in older guides no longer
applies.

**Leave `@capacitor/keyboard` out.** It hides the bar above the keyboard by
default, and that bar holds the Done key: the weight and reps keypads have no
return key, so there would be no way to close the keyboard. It also replaces
WKWebView's own Safari-like keyboard handling. Add it only if testing shows a
problem, with `resize: 'none'` and the bar switched back on.

A boundary test, in the same style as `scripts/boundaries.test.ts`: only
`src/platform/` imports `@capacitor/*`; `src/domain/` never imports
`src/platform/`; and the workout screens still never import `@/sync`.

### 1.4 Parity pass, side by side with the home-screen app

Go through every route and overlay in the app, on the phone, next to the
current home-screen app:

- **Status bar:** light text over the near-black ground.
- **Launch:** no white flash and no Capacitor logo.
- **Safe areas:** the 12 `env(safe-area-inset-*)` uses: the tab bar, resume
  bar, sheets, toast, done bar and the rest takeover, around the Dynamic
  Island.
- **Keyboard:** the set-in-hand fields, the number fields in sheets, and the
  sign-in form (typed in, but Sign in not pressed until Phase 2). The Done bar
  should not jump.
- **Focus:** Capacitor lets `autoFocus` raise the keyboard without a tap,
  which Safari does not. Three screens use it
  (`src/features/gyms/GymsScreen.tsx:97`,
  `src/features/exercises/ExercisePicker.tsx:44`,
  `src/features/plan/PlanScreen.tsx:216`). Decide on the phone whether each
  should keep it.
- **Scrolling and touch:** rubber-banding (the body already sets
  `overscroll-behavior-y: none`), the calendar swipe, and the tap-to-skip on
  the rest clock.
- **Type:** every input is at least 16px, so focusing one never zooms.
- **Offline:** aeroplane mode from a cold start. Fonts, photos and the seed
  all load from inside the app.

### 1.5 Keep the data safe

This is the one place where the native app is weaker by default. Capacitor's
storage guide says iOS can reclaim a web view's IndexedDB and localStorage
when the phone runs low on space. The home-screen app has a version of the
same risk already (the brief's "iOS can evict local browser storage"). Three
layers of protection:

1. **The Supabase backup, unchanged.** A wiped app restores everything on the
   next sign-in.
2. **A snapshot on the phone itself.** After every Finish, and once a day,
   write the same JSON as "Export everything" into the app's Documents folder
   with `@capacitor/filesystem`, and keep the last seven. iOS does not reclaim
   those files. They go into the iPhone's iCloud backup, and with
   `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` they show in
   Files under On My iPhone → GymGo.
3. **Restore on an empty launch.** If the database is empty but a snapshot
   exists, offer to restore it. `importFromJson` already does the work, and it
   queues every row for backup. **Wipe and reseed deletes the snapshots too**,
   so a deliberate wipe (such as Phase 2's) is never offered back.

Also move the small localStorage keys that matter onto `@capacitor/preferences`,
which iOS does not reclaim:

- the Supabase session;
- the backup ledger (`gymgo.backup.*`);
- the plan builder's choices (`gymgo.builder`);
- the once-per-phone flags (`gymgo.once.*`).

The once-per-phone flags matter most. If localStorage were cleared while the
database survived, `clearGeneratedRests` would run a second time and could
clear a 3:00 rest you typed in yourself, then back that up, which CLAUDE.md
says must never happen. The running rest (`gymgo.rest`) can stay where it is,
because it is throwaway by design.

### 1.6 First install

Claude builds; you pick your team in Xcode, connect the iPhone and press Run
(the guide walks through it). The first run also registers the bundle ID and
the phone with your developer account.

**While testing, stay signed out of backup,** or test workouts would be
uploaded into your real history. Phase 2 wipes the test data before the first
sign-in.

**Done when:**

- A full planned session logs in aeroplane mode on the app: the rest timer,
  the screen staying on, the plate diagram, a record flash with its sound and
  a buzz.
- Killing the app mid-rest and reopening it brings the rest back (the
  existing behaviour).
- Every route and overlay matches the home-screen app side by side.
- Export opens the share sheet, and importing from Files restores.
- `npm test` and all 17 browser suites still pass.

## Phase 2: TestFlight, Xcode Cloud, moving across, retiring Vercel (M)

1. **Info.plist:** `ITSAppUsesNonExemptEncryption` = `NO`. The app only uses
   HTTPS, which is exempt. Without it, every build waits in "Missing
   Compliance" until the questions are answered.
2. **App Store Connect record.** Name must be unique across the whole store
   even for an app that is never released, so "GymGo" may be taken; a variant
   works, and the name under the icon stays "GymGo". Bundle ID
   `com.liamdaly.gymgo` (permanent after the first upload), SKU of your
   choosing. Then an internal testing group with only you in it.
3. **First upload by hand** from Xcode (Archive, then Distribute App,
   TestFlight Internal Only), to prove the record, signing and TestFlight
   work before automating anything.
4. **Xcode Cloud** (25 compute hours a month come with your membership):
   - `ios/App/ci_scripts/ci_post_clone.sh` (executable, `#!/bin/sh`) installs
     Node with Homebrew, then runs `npm ci`, `npm test`, `npm run build:ios`
     and `npx cap sync ios`. It runs before Xcode resolves Swift packages,
     which is exactly when it has to, because `CapApp-SPM` points into
     `node_modules`.
   - `Package.resolved`, the shared scheme and Xcode Cloud's
     `xcshareddata/xcodecloud/manifest.json` are committed; Xcode Cloud will
     not resolve packages on its own.
   - Xcode Cloud counts build numbers from 1, so before its first build the
     next build number is set (App Store Connect, Xcode Cloud settings) above
     the one uploaded by hand.
   - The Supabase URL and publishable (anon) key are workflow environment
     variables. Never the secret or service-role key.
   - Start conditions: changes to `main`, a **weekly** schedule (so a quiet
     spell never lets the 90-day expiry lock you out), and manual.
   - Archive action set to TestFlight (Internal Testing Only), with a
     TestFlight Internal Testing post-action that adds your group. The
     group's own automatic distribution does not pick up Xcode Cloud builds,
     so the first cloud build is checked by hand.
   - The alternative is GitHub Actions: free on a public repo, but signing
     is harder to set up, so Xcode Cloud stays the choice.
5. **TestFlight on the phone**, with automatic updates on. Installing from
   TestFlight replaces the Xcode-installed copy and keeps its data.
6. **Update speed.** A push now reaches the phone in about 20 to 40 minutes
   (build plus processing), instead of at the next launch.
7. **Move your history across.** The new app cannot see the home-screen
   app's data: it lives at a different origin, in a different sandbox.
   - In the home-screen app: Back up now, until it reads "Backed up", and
     Export everything as JSON. Keep the file.
   - Save your Supabase password in the Passwords app first. The save
     prompt may not appear inside the app.
   - In the new app: **wipe the test data first** (Settings, Wipe and reseed),
     then sign in. Its first round restores before it uploads anything (step
     1 of `syncNow`). Without the wipe, the test sessions from Phase 1 would
     be uploaded into your history.
   - When the new app reads "Backed up", check that Settings → On this device
     shows the same Exercises, Workouts and Sets in both apps.
   - The plan builder's choices (`gymgo.builder`: time, experience,
     priorities, lifts to avoid) live in the old app's localStorage, not in
     the backup or the export, so they are set again by hand. The end of a
     block reads Lifts to avoid, so this matters.
8. **Retire Vercel**, after at least one real session in the new app:
   - remove the home-screen icon;
   - delete the Vercel project;
   - delete `vercel.json`, rewrite `docs/deploy.md`, and correct the Vercel
     mentions in README, `supabase/README.md`, CLAUDE.md, the brief and
     `.env.local.example`;
   - the PWA plugin, `test:offline` and the PWA icons can go too, or stay as
     a web build for development (decide then);
   - **keep** `.github/workflows/keepalive.yml`. It keeps Supabase awake and
     has nothing to do with Vercel. GitHub switches scheduled workflows off
     in a public repo after 60 days without a commit, so check it every
     couple of months.

**Done when:** a push to `main` reaches your phone through TestFlight without
you touching the Mac, every count matches the old app, and Vercel is gone.

## Phase 3: Rest alerts when locked, the Lock Screen countdown (M)

The screens don't change. Each item fixes a limit the brief had to accept.

1. **Rest alerts with the phone locked.** When Done starts a rest, schedule a
   time-sensitive local notification for the rest's end time (the App target
   needs the Time Sensitive Notifications capability, added before the first
   permission prompt). Move it on
   ±30s, and cancel it on Skip, on a drop, on Finish and on Discard. While the
   app is open the in-app tone plays instead, so you never get both. With the
   phone locked and the watch on your wrist, iOS shows the notification on
   the watch, so you get a tap on the wrist before any watch code exists.
2. **A Live Activity: the rest on the Lock Screen and in the Dynamic Island.**
   - A widget extension target (`com.liamdaly.gymgo.restactivity`) with
     "Include Live Activity", and `NSSupportsLiveActivities` on the app. No
     push notifications needed.
   - A Live Activity can only be **started** while the app is open, so it
     starts with the workout and each Done updates it with the new rest's end
     time. `Text(timerInterval:)` counts down on its own with nothing
     running.
   - It lasts up to 8 hours, which covers any session; Finish and Discard end
     it.
   - It also appears on the watch's Smart Stack automatically (watchOS 11
     and later), so it should have a small watch layout.
   - The App Group `group.com.liamdaly.gymgo` is shared by the app and the
     widget. It does not reach the watch, which is a separate device.
   - Keep the app and the widget extension on the same minimum iOS, or
     Capacitor's `CapApp-SPM` can quietly change its platform version on the
     next sync.
3. **Optional: a home screen widget** showing the next session, from a
   snapshot the app writes into the App Group whenever the schedule changes.

**One cue per rest.** Once the watch app runs the session (Phase 4), the watch
gives the rest cue itself, so the phone stops scheduling its notification and
the Live Activity updates stop alerting. Otherwise both devices would buzz.

**Done when:** with the phone locked in your pocket, the end of a rest buzzes,
and the Lock Screen and Dynamic Island show the countdown.

## Phase 4: Watch app, the set and the rest on your wrist (M)

### 4.1 The hard fact this design follows

iOS freezes a web view's JavaScript when the app goes into the background,
and that is a WebKit limit, not a Capacitor one. The watch can wake the
phone app's native Swift code, but the React app and Dexie stay frozen until
you open the phone. So with the phone locked in a bag, the watch cannot ask
the phone what comes next, and the phone cannot write anything to Dexie.

Everything below follows from that.

### 4.2 The pieces

- **A watchOS app target**, "Watch App for Existing iOS App", bundle ID
  `com.liamdaly.gymgo.watchkitapp`, minimum watchOS 26.0. One target, no
  extension. It does not run without the phone app installed.
- **`GymGoKit`, a Swift package** shared by phone and watch. It holds:
  - the snapshot and event types (`Codable`);
  - the Bold design tokens: ground, chalk, blue (`hot`) and muted;
  - the bundled Big Shoulders Display and Barlow fonts (OFL, as on the web).
  The watch is not the web app, but it should look like the same app:
  near-black, poster-sized chalk numbers and one blue highlight.
- **`WatchBridge`, a local Capacitor plugin** in the iPhone app:
  - starts the WatchConnectivity session at launch, in native code;
  - sends the latest snapshot (`updateApplicationContext`: newest wins);
  - receives events from the watch into an inbox file, even while the web
    view is frozen.
- **`src/domain/watch.ts`** (pure, unit tested): `buildWatchSnapshot` turns the
  active workout into what the watch shows. See "The session snapshot" below.
- **`src/platform/watch.ts`:** watches the active workout and the rest, and
  sends a new snapshot whenever either changes.

**Swift settings for the new targets.** Xcode 27's new targets most likely
default to Swift 5 language mode with the main actor as the default
isolation (check each new target's Build Settings: Swift Language Version,
Default Actor Isolation). Keep that, but mark every WatchConnectivity and HealthKit delegate method
`nonisolated`: both frameworks call them on background threads, which
quietly misbehaves in Swift 5 mode and crashes in Swift 6 mode. Copy the
values out and hop to the main actor for the UI. The watch app uses
`WKApplicationDelegate`; `WKExtensionDelegate` is deprecated in watchOS 27.

### 4.3 A workout session keeps the watch app on your wrist

Without one, a watch app drops into the background as soon as you lower your
wrist and stops running. Strength apps on the watch use an `HKWorkoutSession`
(`traditionalStrengthTraining`) for this:

- the app comes back on screen when you raise your wrist, and stays on the
  always-on display (the countdown keeps ticking at the lower rate);
- timers and haptics keep running;
- you get heart rate and elapsed time;
- if the watch app crashes, watchOS relaunches it and the session is
  recovered.

**The watch is the primary session, and the phone mirrors it.** That is
Apple's own advice when there is a watch app. Starting a workout on the phone
opens the watch app on its own (`startWatchApp(with:)`); the watch starts the
session and mirrors it to the phone (`startMirroringToCompanionDevice`),
which keeps the two in step. The phone's mirroring handler is set in native
launch code, because the web view may be frozen. With no watch, the phone runs
its own session (possible since iOS 26).

Capabilities: HealthKit on both targets, Background Modes on the watch
(Workout processing, plus Audio for the haptic), and Health usage strings on
both. Starting Apple's own Workout app during a GymGo session ends GymGo's,
because the watch runs one workout at a time.

### 4.4 What the watch shows in this phase

The phone does the logging; the watch shows the same state:

- **The set in hand:** the exercise, "Set 2 of 4" (from `setOrdinals`) and
  the weight × reps, poster-sized.
- **The rest:** the countdown from the end time, "Up next" and a "New record"
  in blue when there is one. **One firm tap on the wrist when it ends.** The
  watch counts down by itself, so this works with the phone locked. (A haptic
  briefly pauses heart-rate collection, which is why it is one tap and not a
  pattern.)
- **After the rest:** the next set, which is already in the snapshot.
- **Heart rate** from the workout session, small, under the clock.

From this phase the watch gives the rest cue whenever it runs the session, so
the phone's notification stands down (one cue per rest, Phase 3).

**Testing reality:** watch installs from Xcode are slow, `transferUserInfo`
(which the inbox relies on) does not work in the Simulator, and workout
mirroring needs real devices. Screens are built in the Simulator; the link
with the phone, HealthKit and the workout session are tested on the real
devices; and day-to-day use comes from TestFlight.

**Done when:** you start a session on the phone and the watch app opens on its
own. You press Done on the phone, lock it and pocket it. The watch counts the
rest down, taps your wrist at the end and shows the next set.

## Phase 5: Logging from the watch (L)

### 5.1 What you can do on the wrist

- **Done** logs the set in hand, the way the phone's Done bar does
  ("Done · 102.5 × 6").
- **The Action button logs the set too.** While GymGo's workout is running,
  the app donates "log this set" as the Action button's next action, so one
  press means Done. You choose GymGo as the Action button's workout app once,
  in the watch's Settings. To be listed there at all, the watch app must adopt
  `StartWorkoutIntent` (in the watch app itself, not an extension), whose
  `perform()` has to start a workout session. Phase 5 adds it and decides
  what a press does with no session running (for example, start the watch's
  session and say "Start the session on your iPhone"). Starting the planned
  session from the watch stays in Phase 7. **Double tap** does the same as
  Done while the app is on screen.
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
- Each event goes by `transferUserInfo` (queued, in order, delivered for
  certain), and by `sendMessage` as well when the phone is reachable, which
  is faster and wakes the phone app's native code. Every event carries its
  own UUID, so the copy that arrives second is dropped.
- On the phone, the native side writes events to the inbox; the React app
  drains it in order:
  - on launch and on resume, before anything else;
  - straight away if the app is already open.

  Each event goes through the same mutations as a tap. A completed set goes
  through `completeSetWith`, so `updated_at`, the outbox and the backup all
  work unchanged.
- **`completeSetWith` gains an optional `completedAt`,** so a set logged on
  the wrist at 18:42 is stamped 18:42, not when you next opened the phone.
  That matters because records (`recordSetIds`) and the early bird and night
  owl badges read those times.
- **The drain skips a set the phone has deleted.** `completeSetWith` checks
  only that the workout is unfinished, not that the set still exists, so the
  drain has to.
- **Finish on the phone drains the inbox first.** `finishWorkout` soft-deletes
  every unticked set, and a finished workout is immutable, so sets the watch
  logged but the phone had not yet applied would otherwise be lost.
- **If the same set is logged on both,** the later time wins. That is the
  same last-write-wins rule as everywhere else.

**Done when:**

- A whole session (a superset, a pyramid and a record) is logged on the watch,
  some of it with the Action button, with the phone locked in a bag.
- Opening the phone shows every set with the right times, the right records
  and the right session list, and it backs up.
- The reverse also works: log on the phone and the watch keeps up.

## Phase 6: Apple Health (M)

1. **Every workout saved to Apple Health** as Traditional Strength Training,
   with the duration, heart rate and active energy.
   - With the watch: the watch's primary session saves it at Finish
     (`finishWorkout` on the builder), so it counts towards your Activity
     rings. Only the primary session saves, so there is no duplicate.
   - Without the watch: the phone saves it.
   - Either way the workout carries GymGo's workout ID as its sync
     identifier, so saving again replaces rather than duplicates.
   - `finishWorkout` can report nothing even when it worked (when the watch
     is locked), so that is not treated as a failure.
2. **Body weight read from Apple Health** into Progress → Body, one entry a
   day through `logBodyMetric`, read when the app opens.
   - **A weight you typed in GymGo is never overwritten.** Health fills the
     days you have no entry for.
   - HealthKit does not say when you have refused access: refused looks like
     "no data". So an empty list says so and points to Health's settings,
     rather than claiming there are no weigh-ins.
   - On iOS 27 you can grant access to only recent history, so an import
     after updating may come back shorter. The app checks for that.
3. **One more switch in Settings** for each (save workouts, read weight), under
   Sound and Vibrate. That is the only change to the iPhone screens.
4. **A privacy policy.** Apple requires one for any app using HealthKit. TestFlight
   internal testing may not enforce it, but it costs a paragraph:
   `docs/privacy.md`, with a public URL because the repo is public.

**Done when:** a finished session appears in the Health and Fitness apps once,
with heart rate, and a weigh-in from your scales appears in Progress → Body.

## Phase 7: Extras (M to L, each optional)

1. **Complications and the Smart Stack:** the next session and its day, and
   during a session the rest countdown.
2. **Start the next planned session from the watch** with the phone in a
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
| Test sessions uploaded into real history | Fake workouts in your records, which can never be deleted | Phase 1: stay signed out. Phase 2: wipe before the first sign-in. After that: test in real sessions, or in an empty workout that is discarded |
| Both devices buzz at the end of a rest | Two cues for one rest | One cue per rest: the watch takes over once it runs the session (Phase 3) |
| A TestFlight build expires after 90 days | The app stops opening | A weekly scheduled Xcode Cloud build (Phase 2) |
| Watch debugging is slow and flaky | Slow progress on the watch | Simulator for screens, devices for HealthKit and the link, TestFlight for daily use |
| Updates are no longer instant | A fix takes 20 to 40 minutes to arrive | Xcode Cloud on every push to `main` |
| Web view differences (wake lock, vibration, download, keyboard, focus) | Something quietly behaves differently | Each goes through `src/platform/` with a web fallback, and is checked in 1.4 |
| A secret committed to a public repo | Anyone can read it | Only the publishable Supabase key ever goes into a build; `.env.local` stays gitignored |
| Capacitor's prebuilt framework is still built with the iOS 26 SDK | From April 2027 Apple requires the iOS 27 SDK; one user reports an upload rejected over it | Uploads with Xcode 27 are accepted today. Watch for Capacitor 9 (due by the end of 2026) and move to it before April |
| Xcode Cloud's "Latest Release" might not be Xcode 27 | A build on the wrong toolchain | Pick Xcode 27.0 or 27.1 by name in the workflow's Environment |
| Two copies of the app on one phone | History split across two databases | Remove the home-screen icon after moving across (Phase 2) |

## Testing

- **Everything that exists stays valid.** The app runs the same bundle, so
  `npm test` and the 17 browser suites still prove its behaviour, once Phase 0
  makes them run on the Mac.
- **New unit tests:** the `src/platform/` fallbacks, `buildWatchSnapshot`, the
  inbox drain (idempotent, in order, refused on a finished workout, skipping
  deleted sets) and the fixture generator.
- **XCTest:** `GymGoKit` decoding every fixture, the three ported rules, and
  the bridge's inbox file.
- **A short device checklist** in `docs/ios-guide.md`, run before relying on a
  build:
  - a cold start in aeroplane mode;
  - a rest that ends with the phone locked;
  - a session logged on the watch with the phone in a bag;
  - killing the app mid-rest;
  - a snapshot from the last Finish in Files, under On My iPhone → GymGo.
  Restoring from a snapshot is checked by Claude in the simulator, since it
  needs an emptied database.

## Rules to add to CLAUDE.md

Draft wording, to be added as each phase lands:

- **The native shell.** The iPhone app is the web build inside Capacitor.
  Nothing outside `src/platform/` may import `@capacitor/*`, and every module
  there has a web fallback, so the browser suites keep working.
  `scripts/boundaries.test.ts` enforces this.
- **The watch walks a list.** The phone works out the order, the rests and
  the targets (`buildWatchSnapshot`). The watch keeps exactly three rules of
  its own (carry forward, the back-off target, the record check), held to the
  TypeScript by `fixtures/watch/`. A fourth rule on the watch needs a fixture
  too, or it does not go in.
- **Watch events are taps.** They go through `src/db/mutations.ts` like any
  other write, with the time they happened on the wrist. The inbox is drained
  before anything else, and always before Finish.
- **One cue per rest.** Whichever device runs the session gives the cue; the
  other stays quiet.
- **Distribution.** TestFlight internal testing only. Only the publishable
  Supabase key goes into a build, as now; the repo is public, so nothing
  secret is ever committed.

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

## Decisions (7 October 2026)

1. **Mac:** yes, Apple silicon with **Xcode 27**. The native work runs in a
   local Claude Code session on the Mac (see `docs/ios-guide.md`).
2. **Devices:** iPhone 14 Pro and Apple Watch Ultra 2, on 26.6.x. The
   minimum versions are **iOS 26.0 and watchOS 26.0**, so the app works now
   and after the devices move to 27.
3. **The website:** retired once the app is working and your history has
   moved across (end of Phase 2). The Supabase keepalive in GitHub Actions
   stays, because it has nothing to do with Vercel.
4. **Phase 3:** yes.
5. **Apple Health:** yes to both. Save every workout, and read body weight
   (Phase 6).
6. **Bundle IDs:** `com.liamdaly.gymgo` for the phone,
   `com.liamdaly.gymgo.watchkitapp` for the watch,
   `com.liamdaly.gymgo.restactivity` for the Live Activity, and the App Group
   `group.com.liamdaly.gymgo`.
7. **The three gaps:** still open. The first two are queued as separate
   tasks, and none of them blocks the port.
