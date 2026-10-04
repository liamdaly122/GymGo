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
it needs a home on `workout_exercises` too, or it does nothing.

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
- Conflict resolution is last-write-wins on `updated_at`. Because finished sets
  are immutable, genuine conflicts can only occur on routines and settings.
- `last_synced_at` lives in settings and is the only cursor the pull needs.
- `user_id` is null on local rows until magic-link sign-in exists; it is
  backfilled once at sign-in.

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

The Docker daemon is unavailable in the build environment, so push and pull are
tested against a stand-in client and `fake-indexeddb`. The wipe-and-restore round
trip against a live project has to be run by hand.

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
with `/progress/lifts`). Settings is the gear on Today. Programme and Plans were
two tabs for one idea, History and Progress two for another; the owner tested
the merge in the drafts and chose it. A tab stays lit on the screens beneath it
(`Layout.tsx`), so a session opened from Progress still reads as Progress.

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
while empty, the suggestion as a placeholder, and Done logs exactly that through
`completeSetWith` — values and tick in one write. An empty tick used to save
0kg × 0. With nothing to show — no suggestion and nothing typed — Done asks for
the number rather than logging zero. The button says what it will log
("Done · 102.5 × 6"), and its accessible name reads it out.

**Focus never moves on its own.** The station is seeded from the first one with
anything unticked, and after that it only moves because you tapped the strip or
"Next exercise", which is what the Done bar becomes once a station is finished.
If it followed the session, the last Done of a station would teleport the screen
while you are about to correct a mistyped rep — and every `.first()` in the
browser suites would quietly retarget. The set in hand does move on Done; that
is inside the station, and it is the point.

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
the top, and it closes itself when it runs out. Its "up next" line is published
by the logging screen. In Pro it offers a drop, rest-pause or myo on the set
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
  Fat-loss goals shorten rest, which is a real difference.
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
its prescription. The sets and rest were written for the slot, not the lift.

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
`kind: 'estimate'` with a reason that names the reference, because it must never
read as history.

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
`test:rollover` and `test:planswap`. They expect a
preview server on `127.0.0.1:5185` — `test:offline` runs its own on 5190. Each
takes a `BASE_URL` override.

**Accessible names are this app's test API.** Around 1,700 lines of Playwright
key on them, so renaming one is a breaking change to the suites even when the
screen looks identical. These in particular are load-bearing:

- `Set N weight in kilograms`, `Set N repetitions` — the set in hand's fields,
  and the same fields in a set's sheet; `Warm-up N …` and `Drop under set N …`
  on their own sequences
- `Mark set N done` — the Done bar. Its name goes on to say what it will log
  ("Mark set 1 done, 100kg × 5"), so match it with a pattern
- `Edit set N…` — a set's chip, which opens its sheet; `Delete set N` and
  `Delete set N for good` live inside
- `<Exercise>, N of M sets done` — the station strip, and the only handle on
  session order now that one station renders at a time
- `More for <Exercise>` — the overflow, which everything secondary now sits
  behind
- `Swap <Exercise> for something else`, `Move <Exercise> earlier` / `later`,
  `Readiness low` — inside it
- the `timer` role, `Skip rest`, `Show sets` — the rest
- `Swap <Exercise>`: the swap on a planned exercise, in the builder, the
  session editor and a day's sheet. The panel it opens is a dialog of the same
  name. `Swap for` is the reach, a group holding `Today`, `Every <session>`,
  `Just <session>` and `Whole plan`
- the `Calendar` region, its list (`This week`, `Next week`, `Week of …`),
  and `Previous week` / `Next week`
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
