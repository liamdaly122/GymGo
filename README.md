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
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Unit tests over the pure domain logic |
| `npm run typecheck` | Types only |
| `npm run seed:build` | Rebuild the seeded exercise database from the vendored dataset |
| `npm run seed:check` | Assert every seeded exercise has a valid movement pattern |

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
