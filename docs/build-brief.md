# Gym app build brief

Author: Liam
Version: 3
Date: 10 August 2026
Purpose: project brief to hand to Claude Code at the start of the build

## What I'm building

A personal workout tracker that replaces Gymverse. Single user, my phone only, no accounts, no server, no subscription. Installed to the home screen as a progressive web app.

It needs to do three things Gymverse does well: build me a sensible plan, hold a proper exercise database, and get out of the way while I'm logging. It also needs a Pro mode that supports the training techniques Gymverse only half handles.

## Rules for the build

- Offline first. The app must work fully with no signal in a gym basement. Supabase is the backup and sync layer, never the thing standing between me and logging a set.
- No analytics, no telemetry, no third party services beyond Supabase and Vercel.
- Data exportable to JSON and CSV at any time, and importable again. I am not swapping one lock-in for another.
- Weights stored in kg as numbers. Dates stored as ISO 8601 strings, UTC.
- No feature that requires an app store submission or a paid developer account.
- The workout generator runs locally as a rules engine. No AI API call at runtime.
- Everything must stay inside the free tiers of Supabase and Vercel.

## Stack

- React with Vite, TypeScript, built as a static single page app
- Dexie (IndexedDB) as the local working store, read and written on every interaction
- Supabase (Postgres, Auth, row level security) as the remote store for backup and sync
- Tailwind for styling
- Recharts for progress charts
- vite-plugin-pwa for the service worker and manifest
- Hosted and deployed on Vercel, free tier, connected to the GitHub repo
- Git repo from the first commit

Plain Vite rather than Next.js. There is no server rendering to do, the whole app is one user's local data, and a static build keeps the service worker behaviour predictable.

## Architecture

Local first with background sync. This is not optional given where I train.

1. Every read and write in the UI hits Dexie. Nothing in the interface ever waits on the network.
2. Every mutation is also appended to a local outbox table with a sequence number.
3. When a connection is available, the outbox flushes to Supabase, then anything changed remotely since the last sync is pulled down.
4. Sync status shows as a small indicator only. It never blocks, never shows a spinner over the log screen, and a failed sync is retried silently on the next opportunity.

**Rules that make this work:**

- Record IDs are UUIDs generated on the client with crypto.randomUUID, so a record exists and is valid before the server has ever seen it.
- Every table carries user_id, created_at, updated_at and deleted_at.
- Deletes are soft. Set deleted_at, never remove the row, or the delete will not propagate.
- Conflict resolution is last write wins on updated_at. Because finished sets are immutable, genuine conflicts can only happen on routines and settings, which is acceptable.
- last_synced_at is stored in settings and is the only cursor the pull needs.

## Data model

Get this right before any UI exists. The same shape exists twice: as Dexie tables locally and as Postgres tables in Supabase. Keep the field names identical so the sync layer stays dumb.

Every table below also has: user_id (uuid), created_at, updated_at, deleted_at.

**exercises**
id, name, primary_muscle, secondary_muscles, equipment, movement_pattern, is_compound, is_unilateral, experience_level, fatigue_cost, demo_url, default_rest_seconds, setup_notes, is_custom

movement_pattern is one of: squat, hinge, lunge, horizontal_push, vertical_push, horizontal_pull, vertical_pull, carry, core, isolation. This field is what makes both the generator and the swap suggestions work, so it must be populated for every exercise including custom ones.

**gyms**
id, name, equipment_available, bar_weights, plates_available, is_default

**routines**
id, name, notes, created_at, archived, generated_from_plan_id

**routine_exercises**
id, routine_id, exercise_id, position, superset_group, technique, target_sets, rep_range_low, rep_range_high, target_rir, tempo, rest_seconds

**workouts**
id, routine_id (nullable, freestyle sessions have none), gym_id, started_at, finished_at, bodyweight_kg, readiness, notes

**workout_exercises**
id, workout_id, exercise_id, position, superset_group, technique, notes

**sets**
id, workout_exercise_id, parent_set_id (nullable), set_index, type, weight_kg, reps, rir, is_amrap, completed, completed_at

**plans**
id, name, goal, days_per_week, block_weeks, current_week, started_at, routine_ids

**body_metrics**
id, date, metric, value, unit

**settings**
units, default_gym_id, mode (beginner or pro), default_rest_seconds, sound_on, vibrate_on

### The one rule that matters

Routines and workouts are separate tables on purpose. Editing a routine must never change a workout I have already done. Finished sets are immutable. Every chart, PR and progression suggestion reads from the workout tables, never from the routine tables. If this gets collapsed into one table to save effort, the history becomes worthless.

## Beginner and Pro modes

One data model, two levels of interface density. Do not build two apps. Every field is stored either way and simply left null when unused, so switching modes never loses data and never migrates anything.

**Beginner mode shows:** exercise name, weight, reps, tick to complete, rest timer, suggested weight for the set, plain language plan.

**Pro mode adds:** RIR, set type, technique per exercise, tempo, per exercise rest overrides, superset grouping, estimated 1RM, weekly volume by muscle group, plate calculator, deload controls, raw data export.

The switch lives in settings, but individual Pro features should also be reachable from a long press or an overflow menu in Beginner mode, so I can use one advanced thing without flipping the whole app over.

## Advanced techniques (Pro mode)

Each technique is a value on routine_exercises.technique and workout_exercises.technique. Child sets hang off a parent set through parent_set_id.

- **Straight sets** - the default, same weight and rep target across sets
- **Pyramid** - weight ascends, reps descend across sets
- **Reverse pyramid** - heaviest working set first, then back-off sets at reduced weight
- **Superset** - two exercises grouped, alternating, one rest after the pair
- **Giant set** - three or more exercises in a group
- **Drop set** - one working set followed by immediate child sets at reduced weight, no rest
- **Rest-pause** - one working set, then child sets after 15 to 20 seconds each
- **Myo-reps** - an activation set followed by short child clusters
- **Cluster sets** - fixed intra-set rest, logged as child sets
- **AMRAP final set** - last set flagged, reps open ended
- **Back-off sets** - lower percentage sets logged after the top set
- **Tempo** - a four digit string such as 3-1-1-0, displayed during the set

### Counting rules

Child sets count towards weekly volume but never towards top set personal records. A drop set at 40kg must not overwrite a 100kg PR, and it must not appear as the previous performance figure next session. The previous performance line always shows the best working set from the last time I did that exercise.

## Smart workout generator

A local rules engine, not a black box. It must be able to explain each choice in plain English.

**Inputs:** days per week, minutes per session, goal (strength, hypertrophy, general fitness), experience level, gym profile (which sets available equipment), priority muscle groups, excluded exercises and injuries.

**Split selection by days per week:**
- 2 or 3 days: full body
- 4 days: upper and lower, twice each
- 5 days: push, pull, legs plus upper and lower
- 6 days: push, pull, legs, twice through

**Session construction:** each session template is a list of slots defined by movement pattern, not by exercise. For example a lower session might be hinge, squat, lunge, hamstring isolation, calf, core. The engine then fills each slot from the exercise database, filtered by equipment at the selected gym, experience level and exclusions, preferring compounds early and varying accessories across the week.

**Volume and rep targets:**
- Hypertrophy: 10 to 20 working sets per muscle group per week, 6 to 12 reps
- Strength: 8 to 12 sets per muscle group per week, 3 to 6 reps on main lifts
- General: 8 to 12 sets, 8 to 15 reps

**Rest defaults:** compounds 150 to 180 seconds, isolation 60 to 90 seconds, supersets 90 seconds after the pair.

**Blocks:** plans run in five week blocks. Weeks one to four progress, week five is a deload at roughly half the working volume. At the end of a block, keep the main lifts and rotate the accessories.

Generation must be deterministic given the same inputs and seed, so I can regenerate and compare. Every generated routine is saved as a normal editable routine, not a locked plan.

## Progression engine

Double progression, per exercise, based on a rep range.

1. If every working set hit the top of the rep range at the same weight, suggest adding one increment next session and dropping back to the bottom of the range.
2. Increment defaults: 2.5kg for lower body compounds, 1.25kg for upper body and isolation work. Configurable per exercise. Never suggest a weight I cannot load with the plates at the selected gym.
3. If I fail to reach the bottom of the rep range on the same exercise in two consecutive sessions, suggest a 10% deload.
4. Estimated 1RM uses Epley: weight x (1 + reps / 30). Store the best estimate per session and chart the trend.
5. If readiness is logged as low before a session, scale suggested loads down by 10% for that session only, and do not count that session towards the failure counter in rule 3.

Suggestions appear as pre-filled placeholder values in the set row. Always editable, never enforced, never blocking.

## Other features worth having

- **Setup notes per exercise** that persist and appear during the set. Seat height, pin position, grip width, which bar. Small feature, saves real time.
- **Swap exercise** mid session, suggesting alternatives with the same movement pattern that are available at the current gym. For when a rack is taken.
- **Warm up generator** that ramps from an empty bar to the working weight in three or four sets based on percentages.
- **Gym profiles** so a home session only offers equipment I actually own, and a commercial gym session offers everything.
- **Session summary** on finish: duration, total volume, sets per muscle group, any PRs hit, comparison against the last time I ran that routine.
- **Repeat last session** as a one tap start.
- **Plate calculator** showing per side loading for the selected bar.
- **Percentage table** from an estimated or entered 1RM.
- **Progress photos** stored locally in IndexedDB, never uploaded.
- **CSV export** structured for analysis in a spreadsheet, one row per set with all context flattened.

## Feature scope

**Version 1:** log a workout, exercise library with search and filter, routine builder, history, previous performance inline, rest timer, export and import, installed to the home screen.

**Version 2:** Pro mode, advanced techniques, progression engine, exercise detail with charts and PRs, plate calculator, swap suggestions, setup notes.

**Version 3:** smart generator, plans and blocks, progress dashboard, gym profiles, body metrics, progress photos.

**Out of scope:** social feed, leaderboards, nutrition tracking, video library, Apple Watch app, anything requiring an account.

## Supabase setup

- One project, free tier. One user, which is me.
- Supabase Auth with an email magic link. Sign in once on the phone and stay signed in.
- Row level security enabled on every table before a single row is inserted, with a policy of auth.uid() = user_id on select, insert, update and delete.
- The client only ever gets the anon public key. The service role key stays in the Supabase dashboard and never appears in the repo, in Vercel, or in the app bundle.
- Schema managed through the Supabase CLI with migrations committed to supabase/migrations in the repo, so the schema is version controlled alongside the code.
- The seed exercise database loads through a seed script, not by hand in the dashboard.
- Progress photos, if I add them, go in Supabase Storage rather than the database.

### Free tier constraints to design around

- 500MB database. Set data is tiny, so the only thing that could approach this is photos. Keep those in Storage.
- Two active projects. One for this, one spare.
- Free projects pause after seven days with no database activity, and need a manual restore from the dashboard. Training three or four times a week keeps it awake by itself, but a fortnight away would pause it. Add a GitHub Actions cron on a daily schedule that writes one row to a keepalive table and deletes anything older than a week. GitHub Actions rather than a Vercel cron, because the free Vercel plan is stingy with cron jobs and the repo is already on GitHub.
- A paused project does not lose data, and the app keeps working offline regardless, so this is an annoyance rather than a risk.

## Vercel setup

- Import the GitHub repo, framework preset Vite, static build.
- Push to main deploys production. Branches get preview URLs, which is the safe way to test a change before it reaches the phone I actually train with.
- Environment variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set in project settings for both production and preview.
- The installed home screen app must point at the production domain only. Do not install a preview URL, or there will be two service workers and two local databases on the same phone.
- Free Hobby plan, personal non-commercial use, which is exactly what this is.

## Known limits to design around

- A web app cannot ship an Apple Watch app or read Apple Health. Bodyweight gets entered manually.
- Background timers on iOS are unreliable. Use the Screen Wake Lock API during an active workout and keep the timer on screen rather than relying on a background notification.
- No exercise video library. Seed from an open dataset such as free-exercise-db or wger, check the licence terms, and store a demo link per exercise where I want one.
- iOS can evict local browser storage from sites that go unused. Installing to the home screen and syncing to Supabase means a wiped local database is a resync rather than a loss, which is the main argument for having a remote store at all.

## Build order

1. Dexie schema, seed exercise data with movement patterns tagged, and a script to wipe and reseed
2. Log a freestyle workout end to end and save it, local only
3. History list and workout detail view
4. Routine builder and starting a workout from a routine
5. Previous performance inline
6. Rest timer and wake lock
7. PWA manifest, icons, service worker, deployed to Vercel, installed to the home screen and tested in a real session
8. Export and import to JSON
9. Supabase project, matching schema through migrations, RLS policies, magic link sign in
10. Outbox, push and pull sync, sync status indicator, and a deliberate test where I wipe local storage and restore everything from Supabase
11. Pro mode and advanced techniques
12. Progression engine
13. Smart generator and plans
14. Charts and progress dashboard

Steps 1 to 8 are local only and prove the thing is actually usable in a gym. Sync goes in afterwards, because a sync layer bolted onto a data model I have not lived with yet will be the wrong sync layer. Step 8 gives me a manual backup in the meantime, so nothing is at risk while sync does not exist.

## Notes for Claude Code

Write a CLAUDE.md at the root covering the stack, the immutability rule, the child set counting rules, kg and ISO date conventions, the local first rule and the sync rules above. Commit after every working slice.

- No secret ever enters the repo. Keys live in .env.local, which is gitignored, and in Vercel project settings.
- The service role key is never used in client code for any reason.
- Never introduce a code path where the UI awaits a Supabase call. If one appears, it is a bug.
- Schema changes go through a Supabase migration file, never through the dashboard.
- Ask before changing the schema once step 2 is done.
