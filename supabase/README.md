# Supabase

The remote store. It is a **backup and sync layer, never something the app waits
on** — every read and write in the UI hits Dexie, and sync happens behind it.

## Setting it up

```bash
npm install -g supabase          # or use npx
supabase link --project-ref <your-project-ref>
supabase db push                 # applies supabase/migrations
```

Then set the two variables in `.env.local` and in Vercel (Production and
Preview):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Only ever the **anon public** key. The service role key stays in the Supabase
dashboard and never appears in this repo, in Vercel, or in the bundle.

## What the migration does

- Creates every table in `src/db/schema.ts`, field for field. The sync layer
  copies rows without translating them, which only works while both sides agree
  — change one and change the other in the same commit.
- Enables row level security on every table **before any row exists**, with
  `auth.uid() = user_id` on select, insert, update and delete. The rule lives in
  Postgres, so even a leaked anon key cannot read another account's history.
- Indexes each table on `(user_id, updated_at)`, which is the only shape the
  pull ever queries.

## Keeping the project awake

A free project pauses after seven days without database activity. Training three
or four times a week keeps it awake by itself, but a fortnight away would not.
`.github/workflows/keepalive.yml` writes one row a day and prunes anything older
than a week.
