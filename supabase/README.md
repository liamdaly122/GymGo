# Backup: setting up Supabase

GymGo keeps everything on the phone first. Connected to a free Supabase
project, it also copies every workout off the phone as you log it, so a lost
phone, a wiped browser or a reinstalled home-screen app is a restore rather
than a loss. It is a **backup and sync layer, never something the app waits
on**: every read and write in the app hits the phone's own database, and the
backup runs behind it.

About 15 minutes, once. Everything here stays inside the free plans of
Supabase, Vercel and GitHub.

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) and choose **New project**.
2. Name it (say `gymgo`), set a database password (keep it somewhere safe;
   GymGo never needs it), and pick the region nearest you.
3. Wait a minute or two for it to finish setting up.

## 2. Create the tables

In the project, open **SQL Editor** → **New query**. Paste in each file from
`supabase/migrations/`, **in order**, and press **Run** after each:

1. `20260819000000_init.sql`: the tables, and row level security on every
   one of them
2. `20260820000000_workout_exercise_prescription.sql`
3. `20261004000000_newest_write_wins.sql`: the server keeps the newest copy
   of every row

Each one is safe to run again, so if you are not sure what an existing project
has, run all three. The editor may ask you to confirm because the scripts
replace policies and triggers; that is expected.

With the Supabase CLI instead: `supabase link --project-ref <ref>` then
`supabase db push`.

## 3. Turn on sign-in by code

GymGo signs in with a six-digit code from an email. Not a password, and not
only a link: on an iPhone a link opens Safari, which keeps its storage apart
from the home-screen app, so tapping it would sign Safari in and leave the app
signed out.

1. **Authentication → Emails → Templates**. In both **Magic Link** and
   **Confirm signup**, add the code to the message body, for example:

   ```html
   <h2>Your GymGo code</h2>
   <p>Type this into the app: <strong>{{ .Token }}</strong></p>
   <p>Or, in a browser, <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>
   ```

   The first email you ever get uses Confirm signup, and every one after that
   uses Magic Link, so both need it.
2. **Authentication → URL Configuration**. Set **Site URL** to your app's
   address (for example `https://gymgo.vercel.app`) and add the same address
   under **Redirect URLs**. That is where the link in the email goes.
3. Sign in with **the same email address as your Supabase account**. The
   built-in email service only delivers to members of the project's team, and
   only a few emails an hour. For one person that is all you need. Another
   address would need adding to the team, or your own SMTP server.

## 4. Give the app the project's address and public key

Open **Project Settings → API Keys** (and **Data API** for the URL) and copy:

- the **Project URL**, `https://<ref>.supabase.co`
- the **publishable** key (`sb_publishable_…`), or, if the project shows
  them, the legacy **anon public** key. Either works.

**Never** the secret key (`sb_secret_…`) or the legacy **service_role** key.
Those bypass every security rule and must not go anywhere near the app.

In **Vercel → your project → Settings → Environment Variables**, add both for
**Production** and **Preview**:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the publishable or anon key>
```

Then **Deployments → the latest one → ⋯ → Redeploy**. The values are baked in
when the app is built, so an existing build does not see them. For local
development, put the same two lines in `.env.local` (gitignored).

## 5. Sign in on the phone

1. Open GymGo. Close it fully and open it again if Settings still says
   "Not connected yet": the phone keeps the previous version until a fresh
   launch.
2. **Settings → Backup**: enter your email, tap **Email me a code**, and type
   the code from the email into the app.
3. The first backup sends everything on the phone: every workout you have
   logged, including anything you imported from an export. Leave the app open
   on Wi-Fi until Backup says **Backed up**.

From then on it backs up by itself whenever there is signal, within a couple
of minutes of a change. It also checks everything over once a day, and
Settings shows when it last did. To see the copy for yourself, open **Table
Editor → workouts** in Supabase.

## Getting everything back

On a new phone, or after removing and re-adding the home-screen app: install
GymGo, open **Settings → Backup**, sign in with a code, and everything comes
back. It says how many workouts it restored. Your settings, gyms and exercise
notes come back too, and the new install's blank defaults do not overwrite
them.

## 6. Keep the project awake (recommended)

A free project pauses after seven days without activity. Training every week
keeps it awake by itself, but a fortnight off would pause it. A paused project
loses nothing, and the app keeps working offline throughout, but backups stop
until it is restored from the dashboard. Projects paused for a long time
become harder to restore.

`.github/workflows/keepalive.yml` prevents that with one tiny write a day. In
**GitHub → the repo → Settings → Secrets and variables → Actions**, add two
repository secrets:

- `SUPABASE_URL`: the Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: the **secret** key (`sb_secret_…`), or the
  legacy service_role key

This is the one place the secret key belongs. It never goes in the repo, in
Vercel or in the app. To check it, open **Actions → Supabase keepalive → Run
workflow**.

## What keeps the data safe

- **Row level security** on every table, enabled before any row exists:
  `auth.uid() = user_id` for select, insert, update and delete. The rule is in
  Postgres, so even someone holding the public key cannot read or change
  another account's rows.
- **The newest copy wins, on the server too.** A trigger skips any upload
  older than the row it would replace. A phone restored from an old export,
  or one that was offline for a week, can only move the backup forward, never
  roll it back.
- **First-run defaults lose every conflict.** The exercise library, starter
  gym and default settings a new install makes are stamped as factory
  defaults, so signing in on a new phone restores your settings and notes
  rather than overwriting them.
- **Export still works.** Settings → Your data → Export everything as JSON is
  a copy you hold yourself, independent of any service.

## How this is tested

The Docker daemon is not available where GymGo is built, so a full local
Supabase cannot run there. What runs instead:

- `src/sync/testing/` stands in for Supabase Auth and REST on **real
  Postgres** (PGlite) with these migrations applied. `server.test.ts` proves
  the SQL runs and runs again, that one account can neither read nor overwrite
  another's rows, that every row the app writes is accepted field for field,
  and that an older upload never replaces a newer row. `sync.test.ts` runs the
  whole backup round against it, including the wipe-and-restore.
- `npm run test:backup` serves the same stand-in over HTTP and drives the real
  supabase-js client in a browser. It logs a workout, signs in with a code and
  backs up. Then a brand-new phone signs in and gets everything back.

The one thing these cannot check is your own project's dashboard settings:
email templates, URLs and keys. Signing in once on the phone and seeing
**Backed up** is that check.
