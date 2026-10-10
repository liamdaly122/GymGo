# GymGo

A single-user, offline-first PWA workout tracker. One user, one phone, no
accounts in the hot path, no subscription. Installed to the home screen.

Source of truth for requirements: `docs/build-brief.md`.

## Stack

- React 19 + Vite + TypeScript, built as a static single page app
- Dexie (IndexedDB) as the local working store — read and written on every interaction
- Supabase (Postgres, Auth, RLS) as the remote store for backup and sync — *later*
- Tailwind v4 for styling, with the look in component classes (see "Design")
- Big Shoulders Display and Barlow from `@fontsource` (OFL-1.1), bundled and precached
- Recharts for progress charts
- vite-plugin-pwa for the service worker and manifest
- Vercel, free tier, static build
- Capacitor 8 as the iPhone app's shell: the same bundle in a WKWebView, with
  `src/platform/` the only code that knows (see "The iPhone app")

Plain Vite rather than Next.js: there is no server rendering to do, the whole app
is one user's local data, and a static build keeps service worker behaviour
predictable.

## The rules that must not be broken

### 1. Local first — the UI never awaits the network

Every read and write in the UI hits Dexie. Nothing in the interface ever waits on
a network call. Supabase is a backup and sync layer, never the thing standing
between the user and logging a set.

**If a code path appears where the UI awaits a Supabase call, that is a bug.**

Sync status is a small indicator only. It never blocks, never shows a spinner
over the log screen, and a failed sync is retried silently next opportunity.

### 2. Finished workouts are immutable

`routines` and `workouts` are separate tables **on purpose**. Editing a routine
must never change a workout already performed.

This is guaranteed structurally, not by convention: starting a workout from a
routine **copies** `routine_exercises` into `workout_exercises`. It never holds a
live reference. See `startWorkoutFromRoutine` in `src/db/mutations.ts`.

The copy has to carry **everything the session needs**, not just the exercise
ids. `rest_seconds` and `tempo` were left off the copy at first, and because
`workout_exercises` had nowhere to put them the rest timer silently fell back to
each exercise's generic default — so a strength primary prescribed 210s and an
accessory prescribed 75s both rested the same, and the plan generator's rest
values were decorative. If a prescription field is added to `routine_exercises`,
it needs a home on `workout_exercises` too, or it does nothing. Rest has since
moved to the lift (see "Rest follows the lift"), so a generated row carries
none. A rest typed into a routine is an override, and it is still copied.

Every chart, PR and progression suggestion reads from the **workout** tables,
never from the routine tables. If this gets collapsed into one table to save
effort, the history becomes worthless.

### 3. Child set counting

A child set is any set with a non-null `parent_set_id` — drop set continuations,
rest-pause clusters, myo-rep clusters, cluster-set pieces.

- Child sets **DO** count toward weekly volume.
- Child sets **NEVER** count toward top-set personal records.
- Child sets **NEVER** appear as the previous performance figure.

A drop set at 40kg must not overwrite a 100kg PR, and must not show up as last
session's number. The previous performance line always shows the **best working
set** from the last time that exercise was performed.

These rules live in exactly one place each — `src/domain/volume.ts`,
`src/domain/prs.ts`, `src/domain/previousPerformance.ts` — and are unit tested in
both directions. Do not re-derive them per screen.

Whether something **beats what came before** is decided once too: `marksBroken`
in `prs.ts`, which the finish screen, the session list, the block report, the
rewards and the flash on Done all ask. It compares three marks — the heaviest
top set, the best estimated max, and the most reps at 0kg. The third is for
unloaded bodyweight work: a pull-up with nothing added logs 0kg, which nothing
is heavier than, and Epley has nothing to multiply, so for most of this
project's life going from eight pull-ups to twelve was never a record. Reps
count only where neither side carried any load; anywhere else, more reps at a
weight already raises the estimated max, and counting both would double every
rep record. A lift's first session is a first, never a record.

Child sets are created in exactly one place too: `addChildSet` in
`src/db/mutations.ts`. That is what makes the rules apply rather than merely
exist — for two years of this file's history they governed nothing, because
nothing could create a child set. Nesting a child under a child is refused: the
rules depend on "which set is the top set" having one answer.

Drop weights round **down** through the gym's actual plates. You cannot load
80.4kg, and a drop that rounded upward would not be one. Two edge cases are
deliberate: a coarse cable stack or a light dumbbell steps down one real
increment when 80% rounds back onto the parent, and a bare bar is left alone
because nothing lighter can be loaded.

Rest after a superset is `restsAfterSet` in `src/domain/supersets.ts`, and it
is the same shape of rule: rest runs after a working set unless a **later**
member of the station still has its set to do in the same round. Judged by
round, so a pair whose halves have different set counts still rests after A1's
extra set. Grouping is stored on the rows, not derived from adjacency, so
removing something from between a pair does not silently dissolve it.

### 4. Units and dates

- Weights are stored in **kg as numbers**. Never strings, never lbs in the store.
  Display conversion happens at the edge only.
- Dates are stored as **ISO 8601 strings in UTC** (`new Date().toISOString()`).
  Use the helpers in `src/lib/dates.ts`; do not hand-roll date formatting.
- Body metric `date` fields are ISO date-only strings (`YYYY-MM-DD`).

### 5. Sync rules

- Record IDs are UUIDs generated on the client with `crypto.randomUUID`, so a
  record is valid before the server has ever seen it. See `src/lib/ids.ts`.
- Every table carries `user_id`, `created_at`, `updated_at`, `deleted_at`.
- **Deletes are soft.** Set `deleted_at`; never remove the row, or the delete will
  not propagate. Every query must filter `deleted_at == null`.
- Every mutation is also appended to a local `outbox` table with a sequence number.
  The outbox records WHAT changed, not how: push reads the current row out of
  Dexie and upserts the whole thing. Replaying the queued patch would blank every
  column it did not mention, since patches are partial.
- **Every row a mutation changes is queued, including what it changes as a side
  effect.** `finishWorkout` used to tidy away untouched sets and empty exercises
  without queueing them. Because a backup round runs mid-session, the cloud kept
  them live, and a restore brought empty sets back into finished workouts.
  `removeSet` and `removeExerciseFromWorkout` had the same gap for the rows they
  take with them. An import queues every row it restores. The mutation tests
  check that every changed row is queued, across a backup round mid-session.
- Conflict resolution is last-write-wins on `updated_at`, **on the server as
  well as the phone**: the `keep_newest_row` trigger skips any upload older than
  the stored row, so an upload can only move a row forward in time. A first
  backup, an old export restored, or a phone that was offline for a week can
  never roll the cloud back. Because finished sets are immutable, genuine
  conflicts can only occur on routines and settings.
- **First-run rows are factory defaults.** The seeded library, the starter gym
  and default settings are stamped `FACTORY_DEFAULT` (the epoch, in
  `src/db/schema.ts`), so they lose every conflict. Stamped with the moment of
  install, a new phone signing in would have overwritten the user's settings and
  exercise notes, on the phone and then in the cloud.
- `last_synced_at` lives in settings and is the only cursor the pull needs.
  Writing it is bookkeeping and leaves `updated_at` alone. The pull orders by
  `id` within a timestamp, because hundreds of rows share one and Postgres may
  order ties differently from page to page. It converts timestamps back to
  `toISOString()`, because Postgres writes them as `+00:00`.
- `user_id` is null on local rows until sign-in; it is backfilled once at
  sign-in.

## Sync lives behind a wall

`src/sync/` is the only place that talks to Supabase, and `scripts/boundaries.test.ts`
fails the build if that slips:

- nothing under `src/features/` may construct a Supabase client
- `src/features/workout/` may not import `@/sync` at all — the logging path must
  never know the network exists
- `src/db/` may not import `@/sync` either
- only `SyncSection.tsx` reaches sync, for signing in and reading status

Signing in is the one deliberate, user-initiated wait in the app. Everything else
observes a status store and carries on.

**Sign-in is by email and password, typed into the app** (`signInWithPassword`
in `src/sync/auth.ts`). The one account is made once in the Supabase dashboard
(Authentication → Users → Add user, with Auto Confirm User), so signing in
sends no email, and no template, SMTP or URL setting can break it. This departs
from the brief's magic link on purpose, after two emailed sign-ins failed:

- On an iPhone a link in Mail opens Safari, which keeps its storage apart from
  the home-screen app. The link signed Safari in and left the app signed out.
- A six-digit code typed into the app gets round that, but the code has to be
  in the email, and Supabase's built-in email will not let its templates be
  edited. Only a custom SMTP server unlocks them, which is another service,
  and the owner's Outlook one refused to send.

Do not bring an emailed sign-in back without answering both. The sign-in is a
real form, so Return submits and the phone offers to keep the password.

**A refused sign-in says what to do, not what failed.** `explainSignInError` in
`src/sync/signInErrors.ts` turns Supabase's codes and statuses into the step or
the setting, and where it is in the dashboard. Supabase answers a wrong
password and an account nobody made with the same "Invalid login credentials",
and on a first sign-in the second is likelier, so the answer says how to make
one. Nothing it says may suggest deleting the account: every backed-up row
references `auth.users` `on delete cascade`, so that would delete the backup.
The guide sets a forgotten password from the SQL Editor instead. Supabase's raw
wording is passed through only for codes the function does not recognise.

**The outbox alone does not make a backup.** `syncNow` in `src/sync/engine.ts`
runs one round in this order:

1. A phone that has never finished a round **restores first** (a pull with no
   cursor). This comes before any upload, so a fresh install's placeholders
   never reach the cloud. The untouched starter gym it made is then dropped
   (`dropPlaceholderGyms`).
2. It pushes the outbox.
3. The first time an account backs up from a phone, it **uploads every row**
   (`uploadEverything`). Months of training, or an imported export, can predate
   signing in, and none of it was ever queued. After that, **once a day**, it
   uploads every row changed since the last pass, queued or not: the safety net
   under the outbox.
4. It pulls whatever changed elsewhere.

Uploads go in batches of 500. When those passes ran is device-local, so it
lives in `localStorage` (`src/sync/ledger.ts`), not in the synced settings row.
Losing it costs one extra full upload, which the server's trigger makes
harmless.

The Docker daemon is unavailable in the build environment, so a full local
Supabase cannot run. Instead `src/sync/testing/` stands in for Supabase Auth and
REST on real Postgres (PGlite, a dev dependency) with the migrations applied.
`src/sync/server.test.ts` checks the SQL itself: row level security between
accounts, the trigger, and that every row the app writes is accepted field for
field. `sync.test.ts` runs whole rounds against it, including wipe-and-restore.
`npm run test:backup` serves it over HTTP (`scripts/fake-supabase.ts`) and drives
the real supabase-js client in a browser, through a backup and then a restore
onto a brand-new phone. A live project's own account and keys can only be
checked by signing in on the phone.

## The iPhone app: the web build inside a native shell

The iPhone app is this web app, unchanged, inside Capacitor. It runs the same
React code and the same Dexie database, so it is identical because it is the
same code. The plan, the phases and the decisions are in
`docs/native-roadmap.md`; the step-by-step for the Mac and the devices is
`docs/ios-guide.md`.

- **Two builds from one source.** `npm run build:ios` is `vite build --mode
  ios`, which leaves out the PWA plugin: WKWebView does not run a service
  worker inside an app, and the app needs none, because every file ships in
  the bundle. `npm run ios` builds that and syncs it into `ios/App`. The web
  build is untouched.
- **`ios/` is committed**, with the generated parts left out by its own
  `.gitignore`. Never delete it to add it again, and never convert
  `App.xcodeproj` to Xcode 27.2's JSON project format: `cap sync` then stops
  updating the Swift packages without saying so. Build and install with
  `xcodebuild` or Xcode's Run button, not `npx cap run ios`, which cannot
  find Xcode 27's simulators. The package tools version is pinned to 6.2 in
  `capacitor.config.ts`, because `cap sync` writes the deployment target as
  `.iOS(.v26)` and that constant does not exist before it.
- **What the project sets:** iPhone only, portrait only, minimum iOS 26.0,
  bundle ID `com.liamdaly.gymgo`, the interface always dark (so the keyboard
  and the share sheet match), a launch screen that is the ground colour and
  nothing else, a status bar with light text (the `SystemBars` style in the
  config; its types say Android-only, the iOS plugin reads it), and a privacy
  manifest naming the required-reason APIs the plugins use. The icon is the
  same art as the home-screen icon, rendered by `npm run icons:build` at 1024
  with its alpha channel removed, which App Store Connect insists on. The
  audio session mixes with other audio, so the rest beep plays over music.

**`src/platform/` is the only place that knows it is inside an app.** Every
capability that differs between the browser and the shell gets one module
there with a web fallback, so the website and the browser suites see exactly
what they always did. Nothing outside `src/platform/` may import
`@capacitor/*`, and `src/domain/` may not import `src/platform/` at all;
`scripts/boundaries.test.ts` holds both lines.

- The screen stays on through the native idle timer (`keepAwake.ts`) rather
  than the web wake lock, and needs no re-acquiring on resume.
- Each "on" in a vibration pattern becomes a haptic (`haptics.ts`). Safari
  has no vibration API, so the Vibrate toggle never did anything on an iPhone
  before; the hint in Settings says what it does now.
- An export is written to the app's cache and offered through the share sheet
  (`files.ts`), because an anchor download does nothing in a web view.
  Closing the sheet is "cancelled", not an error, and gets no message.
- `@capacitor/keyboard` is deliberately left out: it hides the bar above the
  keyboard by default, and that bar holds the Done key the number pads need.

**The data is kept safe three ways,** because iOS can reclaim a web view's
IndexedDB and localStorage when the phone runs short of space, and that is
the one place the app is weaker by default:

1. The Supabase backup, unchanged: a wiped app restores on the next sign-in.
2. **A snapshot on the phone itself** (`snapshots.ts`): the same JSON as
   "Export everything", written into the app's Documents folder after every
   Finish and once a day, the newest seven kept. iOS does not reclaim those
   files, they go into the phone's iCloud backup, and they show in Files
   under On My iPhone → GymGo. Nothing is written while there is nothing of
   the lifter's own to keep (`hasUserData`), or a fresh install would offer
   its own empty copy back.
3. **Restore on an empty launch** (`useAppInit`): a launch that finds nothing
   of the lifter's own and a snapshot on the phone offers it back before the
   app opens. "Start fresh" declines that snapshot and no other.
   `importFromJson` does the restoring and queues every row for backup.
   **Wipe and reseed deletes the snapshots too**, so a deliberate wipe is
   never offered back.

The small localStorage keys that matter are **mirrored into UserDefaults**
(`durable.ts`): the once-per-phone flags, the plan builder's choices and the
backup ledger, copied back at launch before anything reads them. The once
flags matter most: with localStorage cleared and the database intact,
`clearGeneratedRests` would run a second time and could clear a rest typed by
hand. The Supabase session lives in UserDefaults inside the app, so a
reclaimed web view does not sign the backup out. The running rest
(`gymgo.rest`) stays where it is: it is throwaway by design.

## Writes go through one place

`src/db/mutations.ts` is the only module that writes to Dexie. It stamps
`updated_at`, handles soft deletes, and will append to the outbox when sync
lands. Components call these functions; they never touch `db.table.put` directly.

## Exercise seed data

`data/exercises.raw.json` is vendored from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) — **Unlicense
(public domain)**. It is transformed at build time by `scripts/build-seed.ts`
into `src/db/seed.data.json`. The app never fetches it at runtime.

`movement_pattern` does not exist in the source dataset. It is derived by rules
plus a hand-written override table, and it **must be populated for every
exercise** — it is what makes both the generator and swap suggestions work.
`npm run seed:check` fails the build if any seeded exercise lacks a valid pattern.

## Design: "Bold"

Chosen by the owner from three tappable drafts, and ported from the approved
draft rather than re-imagined: near-black ground, chalk-white type,
poster-sized condensed numbers and one blue highlight.

- **Two colours, two jobs.** Chalk (`accent`) is the action — the one button you
  press next. Blue (`hot`) is the highlight — where you are, what moved, what
  improved. Blue on a button, or chalk on a state, blurs the only signal the
  palette carries. The competition plate colours (`p25`…`p1`) exist for the
  plate diagram and nothing else.
- **Type.** Big Shoulders Display for headlines, numbers and buttons, upper-cased
  by CSS; Barlow for everything you read. Both are bundled from `@fontsource`
  (latin subset, imported in `src/main.tsx`) and precached, never fetched, and
  `test:offline` checks they load with the network cut. Upper-casing is CSS
  only, so the DOM — and every accessible name — keeps its real case.
- **The look lives in `src/index.css`**, as component classes ported from the
  draft; `src/components/ui.tsx` only decides which apply. Screens are built
  from those parts — `Screen`, `ScreenHeader`, `BackLink`, `SectionLabel`,
  `Button`, `Sheet`, `Segmented`, `Toggle`, `Stat` — rather than re-deriving the
  look. The focus ring sits in the base layer so a component can draw its own:
  unlayered, it beat every component that tried.
- **The icon** is a chalk "GO" in the display face over a blue bar. The source
  art in `assets/` has the glyphs outlined to paths, because sharp's SVG
  renderer cannot load the bundled web font and would quietly substitute a
  system face. `npm run icons:build` rasterises it into `public/icons/`. iOS
  gets its own full-bleed variant (`icon-apple.svg`): it rounds the corners
  itself and fills transparent ones with black. The maskable variant keeps the
  art inside the 40% safe-zone circle.

## Where things live

Three tabs: **Today** (`/`), **Plan** (`/plan`) and **Progress** (`/progress`,
with `/progress/lifts`, `/progress/body` and `/progress/awards`). Settings is
the gear on Today. Programme and Plans were two tabs for one idea, History and
Progress two for another; the owner tested the merge in the drafts and chose
it. A tab stays lit on the screens beneath it (`Layout.tsx`), so a session
opened from Progress still reads as Progress.

The plan builder hangs off Plan at `/plan/new`. The old routes — `/routines`,
`/history` and `/plans/…` — redirect in `App.tsx`, query string and all, so an
installed home-screen app, a bookmark or a back-stack entry still lands.

Today is a poster: the next session as the headline, its work as sets × reps,
and one Start button. Under it the calendar opens on this week and pages through
the rest of the block, by swipe or by the arrows, as far as `weekRange` says
sessions go. Each training day carries a short session name. Every training day
goes somewhere: a done day opens what was logged, and a planned one opens a
sheet with that session as it will be that week, with a swap on every exercise.
Only the session up next starts from the sheet, so nothing is trained out of
turn from the calendar. A rest day is not a button. A swipe that starts on a day
must not also open it, which is what the strip's `onClickCapture` is for.

## The block lifecycle

A plan runs for five weeks and then it has to end. `plan.completed_at` sat in
the schema unwritten for most of this project's life, so a finished block stayed
on the home screen forever, and there was no way to start another.

**Nothing is ever missed: a session not trained rolls forward.** `buildSchedule`
in `src/domain/schedule.ts` puts a trained session on the day it was actually
trained, and walks the sessions still to do in plan order, putting each on the
latest of its planned day, today (tomorrow if this plan was already trained
today), and the day after the previous session still to do. So a missed Monday
becomes today and keeps coming back until it is done; later sessions stay on
their own days unless the rolled one lands on them, when they are bumped a day
in order; and once caught up the plan is back on its usual days. That is the
behaviour the owner chose over shifting the whole plan back. Nothing is stored —
the dates are derived from the plan, the workouts and the date — which is also
why sessions missed before the rule existed came back under it. `movedFrom`
says where a rolled session was meant to be, and the screens say so.

**"Today" has to be live.** A live query only re-runs when the database
changes, so a phone left open overnight would still show yesterday's plan.
`useToday` (`src/hooks/useToday.ts`) ticks at local midnight and when the app
returns to the foreground, and every schedule query takes it as a dependency.

`isBlockComplete` is the rule: nothing is today and nothing is upcoming — which,
since nothing can be missed, means every session is done. A skipped week holds
the block open by design; **End this block early** is the deliberate way out.
An empty schedule is deliberately not complete, or a plan with no training days
would declare itself finished the moment it was made.

A workout started from a plan routine fills `slotForRoutine`: the earliest
session still to do for that routine, wherever it has rolled to. Reading the
week off "where the block is up to" could name a week whose session for that
routine was already trained, and overwrite it.

**A session belongs to the block that is running.** `runningPlan` in
`src/domain/schedule.ts` is the rule: the newest plan not yet finished, and,
given a routine, the newest that holds it. Not `generated_from_plan_id`, which
names the block that first wrote the routine. Reading that filed every block-two
session under block one, so the new block never saw them. Its first session
rolled forward forever and it could never finish. A routine whose block has
ended belongs to no block.

`startNextBlock` closes the old plan and opens a new one **on the same
routines**. Achieved weights carry forward for free, because the progression
engine reads an exercise's history across every session ever logged rather than
per plan. Regenerating the routines would hand back new exercise ids and throw
that history away. Choosing a different split is what "Build a new plan", on
Plan, is for.

**The main lifts stay and the accessories rotate.** That is the brief's rule for
a block's end, and it lives in `rotateAccessories`
(`src/domain/programmes/rotation.ts`). No column says which rows are
accessories, and none should be added for it: a new column is a migration the
owner has to run by hand in Supabase, or backups fail on it. Instead
`roleForPrescription` reads the role back off a row's prescription — within a
goal each role has its own rep range, and only accessories aim for RIR 1 — so a
row added by hand (RIR null) or re-prescribed matches nothing and never rotates.

A replacement is another version of the same lift (`liftFamily`), ranked as a
swap is. The dataset files rear, side and front delt raises all under
shoulders, and a hip adduction under quadriceps, so rotating by muscle turned a
rear delt fly into a front raise and leg extensions into hip adductions. Only a
lift with no family, and core work, may become a different exercise; a lift with
nothing to rotate to stays. Last block's accessories, and anything already
rotated in that week, are kept out where the gym allows, so the week genuinely
changes, and the block after brings most of them back with their history.
Rotation repoints rows in place and queues them, as a swap does, so it cannot
reach a finished workout. The preview on the finished card and in the report
runs the same function over the same rows (`nextBlockRotation` in
`src/db/blocks.ts`), so it lists exactly what starting will do. The switch
beside it keeps the accessories as they are.

**The block report** (`/progress/blocks/:planId`, `buildBlockReport` in
`src/domain/blockReport.ts`) is what a block did: sessions trained of planned,
each main lift's estimated max from its first session to its last, the records
it set, and the weekly sets each muscle got against the goal's target
(`WEEKLY_SET_TARGET`). Every number comes from the workout tables through the
usual gates. The routines only say which lifts are main: rows prescribed as
primaries, which rotation never touches. The deload week is left out of the
lift changes, the sparkline and the weekly average — it is lighter on purpose,
and counting it made every lift look as if it dropped at the end. A record has
to beat every earlier session, this block's included. A lift's first session
ever is a first, not a record, and a freestyle session mid-block is history
but not the block's record. Today's finished hero opens the report, Plan's
finished card and the report both carry the next-block panel, and Progress
lists past blocks that had something trained in them, and the running block
"so far".

## The logging screen shows one station, and one set

The unit on screen is a **station**: a solo exercise, or a whole superset group.
Not one exercise — an A1/A2 pair is performed by alternating, so splitting it
across two screens would make it unloggable. `sessionStations` in
`src/domain/supersets.ts` does the grouping, and like every other superset rule
it reads the stored `superset_group` rather than adjacency, so a pair with
something between them is still one station.

Inside the station, one set is on screen: the **set in hand**, poster-sized,
with a single Done bar under your thumb. Which set that is comes from
`setInHand` in `src/domain/supersets.ts`, in the order the work is performed:
warm-ups first, then working sets by round across the station — A1, A2, A1, A2,
never all of A1 first — and each child set straight after its parent, before
the partner's turn. Everything else is a chip (`SetChips`) that opens the set
(`SetSheet`): fix the numbers, untick it, delete it, and in Pro hang a drop,
rest-pause or myo off it.

Before the station, a five-exercise session put 147 interactive controls on the
page, only 40 of which were the weight and reps fields the task actually needs,
and one exercise card rendered taller than the window.

**Done logs the numbers on screen.** The big fields show what was typed or,
while empty, a placeholder, and Done logs exactly that through
`completeSetWith` — values and tick in one write. An empty tick used to save
0kg × 0. With nothing to show — no suggestion and nothing typed — Done asks for
the number rather than logging zero. The button says what it will log
("Done · 102.5 × 6"), and its accessible name reads it out.

**From the second set on, the placeholder is the set just done.** In order:
- a pyramid's scheme target;
- the working set done most recently today (`latestWorkingSet` in
  `src/domain/sets.ts`);
- the suggestion;
- last time.

So set 1 starts at the suggestion, and every set after it starts at what you
actually did. The next set is then a nudge of a stepper, not two numbers typed
again. That was the owner's first note from the gym: a lift with no history
showed "–" on every set. Warm-ups, drops, back-offs and old 0 × 0 ticks are
never carried.

**Focus moves on when the last rest is over, and never on a tick.**
- **On arrival** focus is pinned to the first station with anything unticked.
- **After that it moves** for one of two reasons:
  - you moved it: the strip, the session list, "Next exercise" (what the Done bar becomes once a station is finished), or adding an exercise;
  - the rest after a station's last set ran its course.
- **How the move works.** Done hands the screen the id of the rest that followed (`start` returns it). The screen moves only when `lastRun` says that rest ran out or was skipped.
- **What holds it back.**
  - A drop stops the rest without running it.
  - A set added during that rest keeps the screen where it is: a back-off, a rest-pause, or one more.
  - So does any tap.
- **Where it goes:** `nextStation` in `src/domain/supersets.ts`, the next station with work left, else one skipped earlier. "Next exercise" and the rest's "Up next" use the same rule, so all three name the same place.

The owner chose this from the gym, and their note is why: the last rest of an
exercise said "Up next: Set 1", because the screen had already jumped to the
next station under it.

Following "first unticked" instead would jump the screen on the last tick. That
is a bad moment to move: Show sets is how you fix a rep you just mistyped, and
waiting for the rest keeps the finished station there. The set in hand does
move on Done; that is inside the station, and it is the point.

**Every rest names an exercise.** `upNext` is `{ name, detail }`:
- mid-exercise it is the set coming up ("Set 3 of 4 · 100 × 5");
- after a station's last set it is the next station, with its kit and work from `stationOutline` ("Machine · 3 × 10–15").

Both lines are clamped to one, so a long name cannot push Pro's technique row
into the buttons.

**The strip names every station, and "Exercise N/M" opens the whole session.**
- Pills carry their state and the exercise's name, cut short past 11rem.
- A finished pill recedes to a check and a faint name. A chalk block the width of a name would read as a button to press.
- The focused pill scrolls itself into view.
- The header button opens `SessionSheet`:
  - every station in order, with each exercise's kit and sets × reps (`exerciseOutline`);
  - how far along each one is;
  - where you are, in blue.
- Tapping a row goes there.
- Knowing what is coming means knowing which machine to go and claim. That was the owner's fourth note.

**At most one border between you and the background.** The station sits on the
ground colour; the only bordered things are the chips, the sheets and the
dashed Add set. Nested cards are what made the old card unreadable, not the
amount of information on it. `Card` belongs on the read screens — Plan,
Progress, a session's detail — not on the one you operate.

**One line of prose maximum, with the rest behind a tap.** The suggestion is
the placeholder in the field — that is what the brief specifies — plus one plan
line carrying a verb chip and the reason, clamped to a line. There is no `Use`
any more: Done logs the suggestion when nothing is typed, so taking it is the
same tap as logging it.

Everything that is not logging a set — swap, warm-up, move earlier, move later,
remove, and in Pro the superset toggle — lives in one overflow sheet per
exercise, opened by the `More for …` button. In a superset the other half sits
under the set in hand with its own chips and overflow, so pairing two exercises
never hides one of them.

**A record says so the moment Done logs it.** `setBreaksRecord` judges the
numbers being logged against the lift's history (`useRecordMarks`, finished
sessions only) and today's earlier sets of it, before the write, so the tone
plays straight from the tap — iOS makes no sound without one. The rest screen
leads with it in blue, saying what it beat; its clock shrinks a step to make
room, which keeps Pro's technique row clear of the buttons on a 375 × 667
phone. The first half of a superset round has no rest to lead, so it gets a
blue toast instead. The set's chip turns blue and its name ends `, record` —
derived from history and the order the sets were ticked (`recordSetIds`), so
it survives a reload. A first, a tie, a warm-up, a drop and a back-off set
never flash: the same gate as every record.

Finishing lands on the session's own detail screen with `state: { fresh: true }`,
which makes it read "Done." with one button back to Today. The summary you see
in the gym is the record you find later.

## The steppers move the number you can see

Quick-adjust steps from the number on screen, and while the field is still empty
that number is the **placeholder**, not zero. Stepping from zero offered "+ 20" —
the bare bar — beside a suggested 102.5kg, so one tap threw the suggestion away
and called it an adjustment. `stepFrom` in `src/domain/plates.ts` therefore
carries the base it was computed from, and one tap moves by what the equipment
can actually make (`nextLoadableAbove`/`nextLoadableBelow`), not a fixed 1kg.

The fields in `SetInHand` are controlled, so a second fast tap reads the first
tap's result rather than a stale base, and writes go through `useWriteQueue`.
Tapping a stepper while the field is focused fires blur — which commits the
typed value — and then click; the queue keeps those writes in that order.

Deleting a set that has work on it asks first and names what would be lost;
deleting an untouched one does not, because there is nothing to lose and the
confirm would be friction for its own sake. Delete lives in the set's sheet, so
the set in hand has none — it used to sit one thumb-width from the tick you
press after every single set. Add set carries forward what was typed into the
set in hand, never its placeholder: the new set gets the same suggestion as its
own.

## Rest follows the lift

These are the owner's numbers from a first evening in the gym, the same on
every goal:
- **big lifts rest 2:30**;
- **medium lifts rest 2:00**;
- **light and isolation work rests 1:30**.

`restSecondsFor` in `src/domain/rest.ts` reads the tier off the exercise:
- **Big** is a compound at `fatigue_cost` 4 or 5, meaning a squat or hinge, or a barbell or dumbbell compound. Squats, deadlifts, hip thrusts, bench, overhead press, rows, lunges, the leg press.
- **Medium** is any other compound: machines, cables, pull-ups, dips, pulldowns.
- **Light** is isolation and core.

This departs from the brief on purpose. The brief gives "compounds 150 to 180
seconds, isolation 60 to 90"; the owner trained with that and asked for these.

**How it used to work.** Rest came from the plan:
- a role's figure in the prescription table;
- stretched by the goal (fat loss 0.75, strength 1.2);
- written onto every generated row, with the seed's 180s and 75s behind it.

So a muscle-building main lift rested 3:00 and a strength one 4:10. A leg
extension swapped into a squat's slot kept the squat's rest.

**Now it is worked out each time, not stored,** like the schedule:
- A generated row writes no rest of its own, so a swap or a rotation rests as the new lift does.
- A rest typed into the routine editor is an override, copied onto the session like any prescription.
- Everything that shows a rest asks `restSecondsFor`: the timer, the station header, the routine editor's placeholder, "about N min", and the builder's time limit.
- The exercise column `default_rest_seconds` is written by the seed to match, and read by nothing. A library seeded under the old rule therefore cannot keep it.

**Plans made before the change gave their rests back, once per phone.**
- `clearGeneratedRests` runs from `useAppInit` through `onceOnThisPhone` (`src/lib/once.ts`, a localStorage flag).
- It clears only rows still exactly as generated (`roleForPrescription`) whose rest the old generator could have written for that role. `wasGeneratedRest` keeps the retired figures for that alone. A rest the lifter typed stays.
- Every row it changes is queued. Workouts keep the rest they were performed with.
- It runs once per phone, not every launch, because a 3:00 typed later is one of the old generator's figures and must not be cleared again.

## The in-gym toolkit

The app is used one-handed, on a phone, under a bar. Three rules came out of
building for that:

**Set numbers come from `setOrdinals` in `src/domain/sets.ts`, never the array
index.** A warm-up ramp sits in front of the working sets, so indexing by
position turns the first working set into "Set 4" — which is not what a lifter
counts, not what the rep range refers to, and would have silently repointed
every `getByLabel('Set 1 …')` in the browser suites at a warm-up rung. Warm-ups
are numbered on their own sequence — the chips read W1 W2 W3 W4, then 1 — and a
child set inherits its parent's number: a drop hanging off set 3 is still set 3.
Because that gives a child the same number as its parent, children also carry a
name of their own — "Drop under set 1" — or a screen reader announces two
identical controls. The names live in `src/features/workout/setNames.ts`.

**Warm-ups round down through the gym's plates and are never automatic.**
`warmupRamp` in `src/domain/warmup.ts` opens a barbell ramp with the empty bar,
because a percentage of a light squat is often lighter than the bar itself. A
rung that is at or above the working weight, or that rounds onto the rung
before it, is dropped rather than repeated — so a narrow range gives two sets
rather than four near-identical ones, and a bare bar gives none at all. The
generator is a button: nothing the user did not ask for may enter their log.

**The plate diagram rides on the set in hand.** `PlateDiagram` draws the bar
from `plateBreakdown`, heaviest plates innermost in competition colours, with
the breakdown in words beneath for anyone who cannot see it. Other equipment
gets a line instead — two 22.5kg dumbbells, a pin in a stack. It is shown in
**both** modes — the brief lists it under Pro, but it is information rather
than density, and Beginner mode is precisely who does not know how to load a
bar. A dumbbell weight reads "kg each" and is stored exactly as typed, so
tonnage counts the logged number and the counting rules are untouched.

The rest timer and the wake lock live in `WorkoutShell`, a layout route wrapping
both `/workout/:id` and its swap child. They used to sit inside
`ActiveWorkoutScreen`, so tapping "Swap" mid-rest unmounted both: the countdown
vanished and the screen was free to sleep. The rest fills the screen while it
runs, with the page beneath it `inert`; "Show sets" shrinks it to a bar across
the top, and it closes itself when it runs out. Its "up next" lines, always an
exercise's name, are published by the logging screen. In Pro it offers a drop, rest-pause or myo on the set
just done: a drop stops the rest, the others restart it at the technique's own
short gap. The countdown persists to `localStorage` — deliberately not Dexie,
since it is ephemeral interface state with nothing to sync — and the
end-of-rest cue is seeded as already-fired on restore, or a rest that expired
while the app was closed would beep the moment it came back. The time left is
derived from a clock that only ticks while a rest runs, capped at the rest's own
length so the first frame of a new rest reads 3:00 rather than "63:00". It used
to live in state that started at zero, which made every rest look over for one
frame: the cue fired the moment you pressed Done and whenever a running rest was
restored — and since it fires once per end time, not again when that rest ran
out. `test:toolkit` stubs `navigator.vibrate` to hold it to that.

**A pyramid is one working top set and back-off sets around it**, laid out when
the session starts (`schemeSetTypes` in `src/domain/schemes.ts`): the top set
first in a reverse pyramid, last in a pyramid. Using the set types the counting
rules already know is what kept every other rule unchanged. The progression
engine judges `working` sets only, so it moves the top set against the rep range
and a back-off set's extra reps cannot read as failure or as a double jump;
records and last time read the top set; volume counts every set. Each back-off
set's placeholder is `schemeTarget`: 10% lighter per step from the top set,
rounded down through the plates, for two more reps, worked out from today's top
set once it is done. The routine editor's Pro block picks the scheme, and the
set in hand labels the others "Ramp" or "Back-off". Tempo, set on a routine and
copied onto the session, shows on the set in hand, and a tap spells it out.

**Beginner reaches Pro tools through sheets, never on the screen you log on.**
The brief wants one advanced thing usable "without flipping the whole app
over". RIR, AMRAP, the techniques — drop, rest-pause, myo, cluster, back-off —
in the set sheet, and the overflow's superset toggle, are there in both modes,
because a sheet is already a tap away. The set in hand's RIR row and the rest
screen's technique row stay Pro, which keeps Beginner's logging screen as plain
as it promises; `test:pro` checks exactly that screen.

Each lift's screen has a **weight step** (`exercise.increment_kg`, which
`incrementFor` always read and nothing set) and the brief's **percentage
table**: from the best estimated max or one you type, each row rounded down
through the default gym's plates (`loadablePercentageTable`), so every load can
be made and none is heavier than its percentage. A typed max is not stored:
that would need a column.

## Body weight

The brief: "Bodyweight gets entered manually." Progress → Body logs it to
`body_metrics`, which had been in the schema, synced and backed up, with nothing
writing it. One entry per metric per day (`logBodyMetric`, on the `[metric+date]`
index), so a second weigh-in corrects the first. The chart plots the seven-day
average (`src/domain/bodyMetrics.ts`), because a day's reading swings by a kilo
with water and salt, and the change over 30 days says nothing until there is a
month to measure. Dates are the lifter's own calendar day (`isoDate`), as
"today" is everywhere else: in UTC, a weigh-in just after midnight in summer was
filed under yesterday. Only body weight is offered; the functions take the
metric, so measurements could follow without rework.

## Rewards: XP, levels, a weekly streak and badges

The owner asked for training to feel addictive. What this rewards is what
makes a lifter stronger — turning up, finishing the plan, beating their own
numbers — and nothing that works against it.

**Nothing is stored.** `computeRewards` (`src/domain/rewards/`) works it all
out from the finished workouts, the plans and the date, every time, as the
schedule is worked out. So there is no column and no migration for the owner
to run, nothing to sync, a restore or a new phone arrives at exactly the same
level, and the history from before this existed counted the day it shipped.
`loadRewards` (`src/db/rewards.ts`) reads the tables in one pass; `useRewards`
ticks with `useToday`, so the streak's week turns over at midnight. The price
of deriving it is that changing a constant re-scores everyone's history, which
is the right trade for a one-user app.

**XP** (`XP` in `rewards.ts`): 50 for a session that counts, 5 a set up to 30,
25 for a plan session, 50 a record, 100 for the session that hits its week,
300 for the one that finishes a block with every slot trained, 100 for coming
back after two weeks away, and 100 a badge. A session counts with three sets
or more, warm-ups never among them; fewer still pays for its sets and records,
but not the session or the week. Set XP stops at 30 so junk volume pays
nothing extra. Records are `recordsBrokenPerSession`'s, so never a first and
never a drop; a full block is `buildSchedule`'s own rule. Each level asks 100
XP more than the last, from 300: quick at first, about level 10 after six
weeks, level 30 after a year.

**The streak is weekly** (`streak.ts`), chosen by the owner over a daily one
and over "any session that week". A daily streak would make every rest day and
the deload cost something. A week asks for the running block's own training
days in it — prorated when a block starts or is closed midweek, never less
than one; with no block running, the last block's days a week; with none
ever, three. Any session that counts goes toward it, freestyle included, so a
missed plan session can be made up. Every fourth week in a row banks a free
week, two at most, spent by itself on a short week: it keeps the streak going
without adding to it. The week under way never breaks anything.

**Badges** (`badges.ts`): 38 in seven families — sessions, streak weeks,
records, tonnes lifted (through `volume.ts`, so drops count), blocks finished
with every session trained, plates on a barbell (record-eligible sets only: a
140kg drop is not three plates), and three moments: a comeback, an early bird
before 7am and a night owl after 9pm, in local time.

It shows in three places: Today's strip, once anything has been earned; the
"XP earned" section on a session's summary, where the bar fills and a level-up
gets a poster only when `fresh`; and Progress → Awards.

**The badges are drawn** (`BadgeArt.tsx` in `src/features/rewards/`): inline
SVG on a 120 grid, like the icon set scaled up, so there is nothing to fetch
or precache and the number uses the bundled display face. Each family has its
own silhouette, so they read apart at a glance:
- a hex dumbbell head for sessions;
- a pennant with a flame for the streak;
- a rosette for records;
- a kettlebell for tonnage;
- a calendar page carrying the block's own five-week shape;
- an octagon with the bar and its real plate count;
- a coin for each moment.

Tiers climb by detail, not by colour: an inner ring, then a star, then laurels
on the top badge of every family. It uses app colours only, the owner's choice
over bronze, silver and gold, which would have been three colours nothing else
uses. The art names no colour at all — every one comes from a class in
`index.css` — and `badgeArt.test.ts` fails if a hex value or a plate colour
gets in. The next badge in each family wears a blue ring as far round as the
family has got. A badge earned in the session just finished stamps itself in.
The art is `aria-hidden`, so the tiles' accessible names are unchanged.

## Gyms

`gyms.equipment_available` is what plan filling, plan viability warnings, swap
suggestions and plate rounding all read. Until there was an editor, every gym
claimed to own everything and all four were inert for anyone not in a fully
equipped commercial gym.

A new gym starts at bodyweight only: ticking what you own is quicker and more
honest than un-ticking what you do not. Deleting is soft and refuses the last
gym, because plans and plate rounding would have nothing left to work from; the
tombstone also gives up `is_default`, or it would win the fallback in
`defaultGymId` the moment a pull brought it back.

`startFreestyleWorkout` and `startWorkoutFromRoutine` stamp `gym_id`, so the
progression engine rounds to the plates the session was actually performed with
rather than a fallback.

## Pre-built plans

`src/domain/programmes/` turns a goal, a split and a number of days into a week
of sessions. All pure — the database layer writes the result out as ordinary
routines, which is what keeps this feature clear of the immutability rule.

- **Six goals, three engines.** Build muscle, Get lean and Lose weight run the
  same programme. Training in a deficit uses the same lifting; the diet does the
  fat loss. The app says so on screen rather than inventing a different split.
  Rest is not a goal's either: it follows the lift, the same on every plan (see
  "Rest follows the lift"), so the three now produce identical weeks.
- **Splits are gated by days per week.** There is no such thing as a two-day bro
  split. `daysSupported` decides what the selector may offer.
- **Templates are movement-pattern slots, never named exercises.** One template
  serves a commercial gym and a garage with dumbbells. Hard-coding exercise ids
  would break on a reseed and hand a home lifter a plan they cannot perform.
- **Filling is deterministic and degrades.** Same seed, same plan. A slot the
  gym cannot fill is reported, never fabricated and never thrown — a
  dumbbell-only gym genuinely has no hamstring isolation.
- **`staples.ts` is what stops plans looking mad.** Without it every variant
  ranks the same and the tiebreak picks at random, so plans open with a Barbell
  Guillotine Bench Press. Curated list, keyed by the dataset's stable slug, same
  override pattern as movement patterns.

`npm run templates:check` walks all 216 goal/split/day combinations across four
gym profiles. A commercial gym must fill everything; a constrained gym may rule
combinations out but must still leave one workable option at every day count.

**Adjust holds the rest of the brief's inputs**, and the order is fill, then
pins, then tailoring (`tailorPlan` in `tailor.ts`), so a time limit trims the
week the lifter actually chose:

- **Time per session sizes each day so its hardest week fits** (the owner's
  choice): the same `estimateDurationMinutes` and `setsForWeek` that Today uses
  for "about N min", so no screen shows a session over the limit. Cuts run
  least important first — optional accessories, a set off secondaries and
  accessories down to two, optional secondaries, a set off main lifts down to
  three — and a priority muscle's work goes only after all of that. A main
  lift or a hand-picked swap is never dropped. Each day lists its cuts, and one
  that still runs over says so.
- **Experience** reaches the fill's existing ranking.
- **Priority muscles** (up to two) get one more set on every lift they lead, up
  to the goal's weekly ceiling (`WEEKLY_SET_TARGET`).
- **Lifts to avoid** are lift families, so "no deadlifts" means every deadlift.
  There is deliberately no injury-to-lift table: which movements a bad shoulder
  tolerates is not for a rules engine to guess. The list reaches rotation too,
  so a block's end never brings an avoided lift back.

The choices live in localStorage (`src/lib/builderPrefs.ts`). A synced home
would need a new column, and a new column is a migration the owner runs by hand.
With nothing set, plans come out exactly as before.

**"Why these exercises?"** gives each pick one line from `explainPick`
(`explain.ts`), built from what the fill actually weighed: the slot's job, a
barbell for main lifts, a fallback when the kit ran out, a staple, a priority
set. It is the brief's "must be able to explain each choice in plain English".

## Changing exercises

"Swap this" means two things. Not wanting to deadlift is answered by a hip
thrust or a good morning, something else for the same muscles, and not by a
sumo deadlift. A taken rack is answered by the same lift on other kit.
`exerciseAlternatives` in `src/domain/search.ts` keeps them apart. It reads the
lift family from the name (`liftFamily`: every deadlift is a deadlift) and ranks
each group by weighted muscle overlap, with secondaries at a half. Planning
leads with the different exercise; mid-session leads with the same lift. The
different group offers one per family, because three good mornings are one
idea. Olympic lifts and "other" kit sink. Isolation and core are labels, not
movements, so they need the same primary muscle. A shared movement also needs
shared muscles, because the dataset files a glute-ham raise under rows.

**How far a swap reaches is chosen above the list**:

- today only, or every run of this session (mid-session)
- this session, or the whole plan (anywhere else)

The hint names every lift the swap will change. **"Whole plan" reaches by
family**, through `planSwapTargets`: in each session, the same exercise if it is
there, otherwise that session's version of the lift. It changes one per session,
because the replacement going in twice would double it up. A generated plan
almost never repeats an exercise, since it spreads variety across the week. The
four-day full body runs a conventional, a Romanian and a sumo deadlift, so
matching the exercise id would have left two of the three, and "no deadlifts"
would have done nothing.

Swaps write routine tables only, so neither a finished workout nor one under way
can be reached. The replacement takes the row over: its place, its superset and
its prescription, because the sets were written for the slot, not the lift.
Rest is the exception. It follows the lift, so the replacement rests as itself
unless the lifter typed a rest for that slot.

**In the builder a swap is a pin on a template slot** (`pinExercises`). It is
applied after the week is filled, because refilling with the old lift left out
would ripple through the variety rules and change lifts nobody touched. Shuffle
re-rolls everything else and keeps the pins. A lift swapped out of the whole
plan has its family kept out of every shuffle after it. The pinned exercise gets
the prescription the plan gives that slot.

## What the suggestion engine may read

`src/domain/progression.ts` reasons from history; `src/domain/coldStart.ts`
covers the case where there is none. Both are pure, and both are conservative on
purpose — a number with nothing behind it still looks authoritative.

**`sets.rir` means what the lifter assessed, and nothing else.** It used to be
stamped at creation with the block week's *target* (3, 2, 2, 1, 4), so every set
of every plan session arrived carrying an RIR nobody had judged. Reading that
back would have handed week 1 a double jump on the strength of a number the app
wrote itself. `startWorkoutFromRoutine` now writes `rir: null`; the week's target
still reaches the lifter, as a prescription on `routine_exercises.target_rir` and
`weekModifier.targetRir`, not as a pre-filled answer. Rows written before that
change are guarded by a fingerprint: an RIR identical across every set of a
session is not read back. That ignores a genuine "2, 2, 2", which errs
conservative — the safe direction for a self-reported number.

**Effort may withhold a jump or raise a rep target. It may never add load.**
That asymmetry is what makes a self-reported number safe to act on at all. An
AMRAP is the exception, because it is an objective count rather than a feeling —
but an AMRAP result must never *become* the next target either, so the fallback
rep range is built from the heaviest **non**-AMRAP set. Otherwise an open-ended
15 would demand 15 forever.

**The failure counter judges all of a session's working sets, not just the
heaviest.** Working up to a heavy top single and then hitting the range on the
back-offs is a good session, and reading only the top set recorded it as a
failure. It does *not* require the failures to be at the same weight: the brief
says "in two consecutive sessions", and backing off and still missing is exactly
when a deload is due.

**A cold start reasons from a lift you have done, never from a table.**
`estimateOpeningWeight` ranks references with `swapSuggestions`, where the same
movement on the same muscle comes first, prefers a reference on the same equipment, takes a
conservative fraction, rounds **down** through `loadableWeight`, and returns null
when nothing related has history. Saying nothing beats guessing. It surfaces as
`kind: 'estimate'` with a reason that names the exercise and the reference
("First time on …. From your …"), because it must never read as history, and a
variant of a lift already logged must read as the new exercise it is.
**Related means the same primary muscle, or the same movement.** "Isolation"
and "core" are labels, not movements (`isLoosePattern`), so sharing one counts
for nothing: counting it made every isolation lift related to every other, and
the owner saw curls, pushdowns and leg curls all estimated from side lateral
raises.

**Low readiness is the one thing that scales a suggested load**, by
`LOW_READINESS_MULTIPLIER`, and it applies to a cold-start estimate too — a
control that moved the numbers on some lifts and not others would look broken.
`ReadinessPrompt` is the only writer of `workout.readiness`; brief rule 5 was
implemented and unit tested for most of this project's life with no screen able
to trigger it.

## Security

- No secret ever enters the repo. Keys live in `.env.local` (gitignored) and in
  Vercel project settings.
- The client only ever gets the Supabase **anon public** key.
- The **service role key is never used in client code, for any reason.**
- Schema changes go through a Supabase migration file in `supabase/migrations`,
  never through the dashboard.

## Testing

Three layers, each earning its place:

- `npm run test` — Vitest. `src/domain/` is pure so the counting rules are
  tested directly; `src/db/` is tested against `fake-indexeddb`, which is where
  the immutability guarantee and the backup round trip live.
- `npm run test:e2e` — drives a real browser through the app. This is what
  caught the seeding race that StrictMode double-mounting exposed, and it is
  where the "editing a routine cannot change a finished workout" rule is proved
  through the UI rather than only in a unit test.
- `npm run test:offline` — installs the service worker against a production
  build, cuts the network, then logs a workout. This is the gym-basement case
  the whole architecture exists for, so it is not optional before a release.

The browser suites are split by feature: `test:e2e` (smoke, backup round trip),
`test:plans`, `test:swap`, `test:gyms`, `test:pro`, `test:block`,
`test:programme`, `test:toolkit`, `test:smart`, `test:session`,
`test:rollover`, `test:planswap`, `test:report`, `test:body` and
`test:rewards`, which runs at 375 × 667 to prove a record fits the rest screen
of the smallest phone. They expect a dev server on `127.0.0.1:5185`
(`npx vite --port 5185`), and each takes a `BASE_URL` override.
`test:offline` expects a preview server on `127.0.0.1:5190`
(`npm run preview -- --port 5190`), starts none of its own, and takes
`PREVIEW_URL` instead. `test:backup` is self-contained: it starts the
stand-in Supabase on 54329, builds a copy of the app pointed at it, and serves
that on 5191. Every suite launches through `e2e/browser.mjs`: Playwright's
own Chromium (`npx playwright install chromium`, once per machine), unless
`CHROMIUM_PATH` points at another build.

**Accessible names are this app's test API.** Around 1,700 lines of Playwright
key on them, so renaming one is a breaking change to the suites even when the
screen looks identical. These in particular are load-bearing:

- `Set N weight in kilograms`, `Set N repetitions` — the set in hand's fields,
  and the same fields in a set's sheet; `Warm-up N …` and `Drop under set N …`
  on their own sequences
- `Mark set N done` — the Done bar. Its name goes on to say what it will log
  ("Mark set 1 done, 100kg × 5"), so match it with a pattern
- `Edit set N…` — a set's chip, which opens its sheet; `Delete set N` and
  `Delete set N for good` live inside. A record set's name ends `, record`
- `<Exercise>, N of M sets done` — the station strip, and the only handle on
  session order now that one station renders at a time
- `More for <Exercise>` — the overflow, which everything secondary now sits
  behind
- `Swap <Exercise> for something else`, `Move <Exercise> earlier` / `later`,
  `Readiness low` — inside it
- the `timer` role, `Skip rest`, `Show sets` — the rest; and a `status`
  inside it, starting "New record", when the set just done was one
- `Swap <Exercise>`: the swap on a planned exercise, in the builder, the
  session editor and a day's sheet. The panel it opens is a dialog of the same
  name. `Swap for` is the reach, a group holding `Today`, `Every <session>`,
  `Just <session>` and `Whole plan`
- the `Calendar` region, its list (`This week`, `Next week`, `Week of …`),
  and `Previous week` / `Next week`
- `See the block report` on Today's finished hero and Plan's finished card;
  the report's `Main lifts`, `Records` and `Next block` regions; `Rotate
  accessories` (a switch), `See what changes` and `Start the next block`; and
  `Past blocks` and `See the block so far` on Progress
- the `Backup` region in Settings: `Email address`, `Password`, `Sign in`,
  `Back up now`, and its `status`, which reads `Backed up` once nothing is
  waiting
- `Body` on Progress, with `Today's weight in kilograms` and `Save weight`;
  on a lift's screen, the `Percentage table` region with `Your max in
  kilograms`, and the `Weight step` group
- `Adjust plan`, whose sheet holds the `Time per session`, `Experience`,
  `Priority muscles` and `Lifts to avoid` groups; `Why these exercises?` (a
  switch)
- `<Exercise> set scheme` in the routine editor; `Tempo <tempo>` on the set in
  hand; `+ Cluster` and `+ Back-off` with the other techniques
- Today's level strip, a link whose name starts `Level N`; on a session's
  summary, the `XP earned` region, `Badge earned` / `Badges earned`, and a
  `Level N` heading on a level-up; `Awards` on Progress, with the `Level`,
  `Streak` and `Badges` regions, each badge a button named `<Badge>, earned …`,
  `<Badge>, next up: …` or `<Badge>, not yet`
- `Exercise N of M, show the whole session`, the header button, which opens
  the `This session` dialog: one row per station, a superset's members inside
  it, each row named by its exercises, kit and work, ending `, done` when
  finished
- `Add exercise`, `Add set`, `Finish`, `Finish and save`, `Start empty workout`

`Add exercise` names exactly one control at a time: the empty state owns it
until there is a session, then the strip's `+` does. Two controls under one name
are ambiguous to a screen reader and resolve strictly in Playwright, so the
strip renders nothing at all when the session is empty.

**`innerText` respects CSS `text-transform`.** Display type is upper-cased by
CSS — headings, exercise names, buttons, labels — and innerText sees the
capitals, so a check for `/Resting/` can never match and passes whatever
happened. Two assertions sat there doing nothing before this was noticed. Match
case-insensitively, or read accessible names, which come from the DOM text.

When a bug is found by driving the app, add the regression test at the lowest
layer that can catch it.

## Conventions

- Commit after every working slice.
- `src/domain/` is pure: no Dexie import, no React, no I/O. That is what makes it
  testable, and the counting rules are exactly what needs testing.
- Beginner and Pro are one data model with two levels of interface density. Do
  not build two apps. Unused fields are stored null, so switching modes never
  loses data and never migrates anything.
