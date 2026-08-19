# GymGo

A single-user, offline-first PWA workout tracker. One user, one phone, no
accounts in the hot path, no subscription. Installed to the home screen.

Source of truth for requirements: `docs/build-brief.md`.

## Stack

- React 19 + Vite + TypeScript, built as a static single page app
- Dexie (IndexedDB) as the local working store — read and written on every interaction
- Supabase (Postgres, Auth, RLS) as the remote store for backup and sync — *later*
- Tailwind v4 for styling
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

### 4. Units and dates

- Weights are stored in **kg as numbers**. Never strings, never lbs in the store.
  Display conversion happens at the edge only.
- Dates are stored as **ISO 8601 strings in UTC** (`new Date().toISOString()`).
  Use the helpers in `src/lib/dates.ts`; do not hand-roll date formatting.
- Body metric `date` fields are ISO date-only strings (`YYYY-MM-DD`).

### 5. Sync rules (for when sync is built — steps 9 and 10)

- Record IDs are UUIDs generated on the client with `crypto.randomUUID`, so a
  record is valid before the server has ever seen it. See `src/lib/ids.ts`.
- Every table carries `user_id`, `created_at`, `updated_at`, `deleted_at`.
- **Deletes are soft.** Set `deleted_at`; never remove the row, or the delete will
  not propagate. Every query must filter `deleted_at == null`.
- Every mutation is also appended to a local `outbox` table with a sequence number.
- Conflict resolution is last-write-wins on `updated_at`. Because finished sets
  are immutable, genuine conflicts can only occur on routines and settings.
- `last_synced_at` lives in settings and is the only cursor the pull needs.
- `user_id` is null on local rows until magic-link sign-in exists; it is
  backfilled once at sign-in.

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

When a bug is found by driving the app, add the regression test at the lowest
layer that can catch it.

## Conventions

- Commit after every working slice.
- `src/domain/` is pure: no Dexie import, no React, no I/O. That is what makes it
  testable, and the counting rules are exactly what needs testing.
- Beginner and Pro are one data model with two levels of interface density. Do
  not build two apps. Unused fields are stored null, so switching modes never
  loses data and never migrates anything.
