# GymGo

A personal, offline-first workout tracker. Single user, one phone, no accounts,
no subscription. Installed to the home screen as a PWA.

Requirements live in [`docs/build-brief.md`](docs/build-brief.md).
Working rules for contributors (human or agent) live in [`CLAUDE.md`](CLAUDE.md).

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
| `npm run test:e2e` | Drives a real browser through the whole app against `npm run dev` |
| `npm run test:offline` | Installs the service worker, cuts the network, logs a workout — run against `npm run preview` |
| `npm run typecheck` | Types only |
| `npm run seed:build` | Rebuild the seeded exercise database from the vendored dataset |
| `npm run seed:check` | Assert every seeded exercise has a valid movement pattern |
| `npm run icons:build` | Regenerate PWA icons from `assets/*.svg` |

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

Still to come: Supabase sync, Pro mode and advanced techniques, the progression
engine, the smart generator, charts.

## Exercise data

Seeded from [free-exercise-db](https://github.com/yuhonas/free-exercise-db),
which is released under the **Unlicense** (public domain). The dataset is
vendored into `data/` and transformed at build time — the app never fetches it
at runtime.

## Environment

Copy `.env.local.example` to `.env.local`. Both variables stay empty until the
Supabase project exists; nothing in the local-only build reads them.

No secret belongs in this repo. The Supabase service role key is never used in
client code.
