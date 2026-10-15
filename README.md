# GymGo

A personal, offline-first workout tracker. Single user, one phone, no accounts,
no subscription. Installed to the home screen as a PWA.

Requirements live in [`docs/build-brief.md`](docs/build-brief.md).
Working rules for contributors (human or agent) live in [`CLAUDE.md`](CLAUDE.md).
Notes from the gym that are not yet done live in [`docs/backlog.md`](docs/backlog.md).

The iPhone and Apple Watch apps: [`docs/native-roadmap.md`](docs/native-roadmap.md)
(start at "Where things stand") and the step-by-step
[`docs/ios-guide.md`](docs/ios-guide.md). The iPhone app is this web build
inside Capacitor; the watch app is native SwiftUI, its logic and screens in
`ios/GymGoKit`. Both reach the owner's own devices through TestFlight.

## Getting started

```bash
npm install
npm run dev
```

The app works fully offline with no configuration. Supabase is a later addition
for backup and sync, and is not required to log workouts.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Dev server (service worker deliberately off) |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the production build, service worker and all |
| `npm run test` | Unit and integration tests over the domain rules and the database |
| `npm run test:e2e` | Drives a real browser through the whole app, against a dev server on port 5185 (`CLAUDE.md`, "Testing") |
| `npm run test:plans` | Drives the plan selector end to end, against a dev server on port 5185 |
| `npm run test:swap`, `test:gyms`, `test:pro`, `test:block`, `test:programme`, `test:toolkit`, `test:smart`, `test:session`, `test:rollover`, `test:planswap`, `test:report`, `test:body`, `test:rewards`, `test:companion` | The other browser suites, one per feature, against a dev server on port 5185 (`CLAUDE.md`, "Testing") |
| `npm run test:offline` | Installs the service worker, cuts the network, logs a workout — run `npm run build`, then `npm run preview -- --port 5190` |
| `npm run test:backup` | A backup and a restore onto a new phone, against a stand-in Supabase it starts itself |
| `npm run typecheck` | Types only |
| `npm run seed:build` | Rebuild the seeded exercise database from the vendored dataset |
| `npm run seed:check` | Assert every seeded exercise has a valid movement pattern |
| `npm run templates:check` | Assert every plan the selector can offer is actually buildable |
| `npm run icons:build` | Regenerate PWA icons from `assets/*.svg` |
| `npm run images:build` | Rebuild the bundled exercise photos |
| `npm run build:ios` | The production build for the iPhone app, without the service worker |
| `npm run ios` | `build:ios`, then copies it into `ios/App`. Run before any Xcode build |
| `npm run fixtures:watch` | Rewrite `fixtures/watch/`, which hold the watch's Swift rules to the TypeScript |
| `npm run fonts:watch` | Rebuild the watch's TrueType fonts from `@fontsource` |

## What is built

Build-order steps 1 to 8 from the brief — the local-only app:

- [x] Dexie schema, seeded exercise database, wipe-and-reseed
- [x] Log a freestyle workout end to end
- [x] Exercise library with search, filters and per-exercise setup notes
- [x] History, workout detail and session summary
- [x] Routine builder, and starting a workout from a routine
- [x] Previous performance inline
- [x] Rest timer and screen wake lock
- [x] PWA manifest, icons, offline service worker
- [x] Export to JSON and CSV, import from JSON

Plus, brought forward from step 13:

- [x] Pre-built plan selector — goal, split and days, built from your gym's
      equipment and saved as ordinary editable routines

Plus:

- [x] Progression engine — double progression, per-exercise increments, deloads,
      plate rounding, every suggestion explained
- [x] Five-week training blocks with a deload, plotted onto a calendar
- [x] Redesign: navy ground, exercise photography, Progress tab with charts
- [x] Supabase backup and sync — schema, RLS, email and password sign-in, a full
      first backup, a daily catch-up and restore onto a new phone (needs your
      project; the setup steps are in `supabase/README.md`)

- [x] Pro mode and the advanced set techniques — drop sets, rest-pause, myo-reps
      and supersets
- [x] Accessory rotation between blocks, and a report at the end of each block
- [x] Body weight log; a percentage table and weight step for every lift
- [x] Plan builder inputs from the brief — time per session, experience,
      priority muscles, lifts to avoid — and a reason for every pick
- [x] Pyramids, tempo on screen, back-off and cluster sets, and Pro tools
      reachable from Beginner mode
- [x] Records flash the moment Done logs them, bodyweight lifts included; XP,
      levels, a weekly streak with banked weeks, and 38 badges — all worked out
      from the training log, so nothing new is stored or synced

Still to come: progress photos, kept on the phone.

## Exercise data

Seeded from [free-exercise-db](https://github.com/yuhonas/free-exercise-db),
which is released under the **Unlicense** (public domain). The dataset is
vendored into `data/` and transformed at build time — the app never fetches it
at runtime.

## Environment

Copy `.env.local.example` to `.env.local`. Both variables stay empty until the
Supabase project exists; the app works fully without them and says so in
Settings. For the deployed app they are set in Vercel — see
`supabase/README.md`.

No secret belongs in this repo. The Supabase service role key is never used in
client code.
