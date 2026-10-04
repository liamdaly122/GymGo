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

## 3. Create your account

GymGo signs in with an email address and a password, and you make the account
yourself, once, here. Signing in sends no email, so the email templates, SMTP
Settings and URL Configuration play no part in it.

1. **Authentication → Users → Add user → Create new user**.
2. Enter your email address and a long password (the phone will remember it
   for you). Tick **Auto Confirm User**, then **Create user**. Any address
   works: nothing is ever sent to it.
3. Recommended: **Authentication → Sign In / Providers**, switch **Allow new
   users to sign up** off, and save. Your account already exists, and this
   stops anyone else making one on your project. Signing in still works.

**Never delete this user.** Every backed-up row belongs to it, and deleting it
deletes the whole backup with it. A forgotten password is a reset instead:
[Setting the password directly](#setting-the-password-directly).

If **Add user** says the address is already registered, an earlier attempt at
signing in by email left an unfinished account behind. Give that one a
password the same way.

If you switched on custom SMTP for an emailed sign-in, switch it off again
under **Authentication → Emails → SMTP Settings**. Nothing uses it now.

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
2. **Settings → Backup**: enter the email and password from step 3 and tap
   **Sign in**. Let the phone save the password when it offers.
3. The first backup sends everything on the phone: every workout you have
   logged, including anything you imported from an export. Leave the app open
   on Wi-Fi until Backup says **Backed up**.

From then on it backs up by itself whenever there is signal, within a couple
of minutes of a change. It also checks everything over once a day, and
Settings shows when it last did. To see the copy for yourself, open **Table
Editor → workouts** in Supabase.

## Getting everything back

On a new phone, or after removing and re-adding the home-screen app: install
GymGo, open **Settings → Backup**, sign in with the same email and password,
and everything comes back. It says how many workouts it restored. Your
settings, gyms and exercise notes come back too, and the new install's blank
defaults do not overwrite them.

## If signing in goes wrong

The app explains every refusal in Settings → Backup. For the full reason,
Supabase's **Logs → Auth** has each request and what went wrong with it.

| The app says | Why | What to do |
| --- | --- | --- |
| Wrong email or password | Supabase gives the same answer for a mistyped password and an account that was never made. | Check that **Authentication → Users** lists your address. If it does not, make the account (step 3). If it does, set a new password (below). |
| That account has not been confirmed | It was made without **Auto Confirm User** ticked. | Run the SQL below. It confirms the account as well. |
| Email sign-in is switched off | **Authentication → Sign In / Providers → Email** is off. | Turn it on. **Allow new users to sign up** can stay off. |
| Supabase has blocked this account | The user is banned. | **Authentication → Users**, open it, and unban it. |
| Supabase is limiting sign-in attempts | Too many tries close together. | Wait a few minutes. |
| Could not reach Supabase | No signal, or a wrong project URL. | Try again with signal. If it persists, check `VITE_SUPABASE_URL` in Vercel and redeploy. |
| Supabase is not answering properly | The project is paused or having a bad moment. | Open the Supabase dashboard; a paused project offers **Restore**. |

### Setting the password directly

For a forgotten password, an account that was never confirmed, or one left
behind by an earlier attempt at signing in by email. A reset email would carry
a link, and a link does not reach the home-screen app, so set it here: **SQL
Editor → New query**, put in your email and the new password, and **Run**:

```sql
update auth.users
set encrypted_password = extensions.crypt('your new password', extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now())
where email = 'you@example.com'
returning email;
```

It should answer with one row: your email. It confirms the account if it never
was, and leaves the backup untouched. Delete the query afterwards, so the
password does not stay in the editor.

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
  supabase-js client in a browser. It logs a workout, is refused a wrong
  password, signs in with the right one and backs up. Then a brand-new phone
  signs in and gets everything back.

The one thing these cannot check is your own project: the account you made
and the keys. Signing in once on the phone and seeing **Backed up** is that
check.
