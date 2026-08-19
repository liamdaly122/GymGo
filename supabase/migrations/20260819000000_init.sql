-- GymGo initial schema.
--
-- Mirrors the Dexie schema in src/db/schema.ts field for field. The sync layer
-- is deliberately dumb: it copies rows across without translating them, which
-- only works while both sides agree on names and types. If you change one,
-- change the other in the same commit.
--
-- Row level security is enabled on every table BEFORE any row can be inserted,
-- per the brief. The policy is the same everywhere: you can only ever see and
-- touch your own rows, enforced by Postgres rather than by the client.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}',
  equipment text not null,
  movement_pattern text not null,
  is_compound boolean not null default false,
  is_unilateral boolean not null default false,
  experience_level text not null,
  fatigue_cost integer not null default 3,
  demo_url text,
  default_rest_seconds integer not null default 120,
  setup_notes text,
  is_custom boolean not null default false,
  source_id text,
  increment_kg numeric,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.gyms (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  equipment_available text[] not null default '{}',
  bar_weights numeric[] not null default '{}',
  plates_available numeric[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.routines (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  notes text,
  archived boolean not null default false,
  generated_from_plan_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.routine_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid not null,
  exercise_id uuid not null,
  position integer not null default 0,
  superset_group text,
  technique text not null default 'straight',
  target_sets integer not null default 3,
  rep_range_low integer not null default 8,
  rep_range_high integer not null default 12,
  target_rir integer,
  tempo text,
  rest_seconds integer,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.plans (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  goal text not null,
  days_per_week integer not null,
  block_weeks integer not null default 5,
  current_week integer not null default 1,
  started_at timestamptz not null,
  routine_ids uuid[] not null default '{}',
  training_days integer[] not null default '{}',
  phase_name text,
  deload_week integer,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid,
  plan_id uuid,
  plan_week integer,
  plan_session_index integer,
  gym_id uuid,
  started_at timestamptz not null,
  finished_at timestamptz,
  bodyweight_kg numeric,
  readiness text,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.workout_exercises (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_id uuid not null,
  exercise_id uuid not null,
  position integer not null default 0,
  superset_group text,
  technique text not null default 'straight',
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.sets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_exercise_id uuid not null,
  parent_set_id uuid,
  set_index integer not null default 0,
  type text not null default 'working',
  weight_kg numeric not null default 0,
  reps integer not null default 0,
  rir integer,
  is_amrap boolean not null default false,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.body_metrics (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  metric text not null,
  value numeric not null,
  unit text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table if not exists public.settings (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  units text not null default 'kg',
  default_gym_id uuid,
  mode text not null default 'beginner',
  default_rest_seconds integer not null default 120,
  sound_on boolean not null default true,
  vibrate_on boolean not null default true,
  week_starts_on integer not null default 1,
  last_synced_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

-- Written to by a scheduled job so the free-tier project does not pause after
-- seven idle days. Not synced, and holds nothing personal.
create table if not exists public.keepalive (
  id uuid primary key default gen_random_uuid(),
  pinged_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The pull is always "everything of mine changed since a cursor", so every
-- table is indexed on exactly that.
-- ---------------------------------------------------------------------------

create index if not exists exercises_user_updated_idx on public.exercises (user_id, updated_at);
create index if not exists gyms_user_updated_idx on public.gyms (user_id, updated_at);
create index if not exists routines_user_updated_idx on public.routines (user_id, updated_at);
create index if not exists routine_exercises_user_updated_idx on public.routine_exercises (user_id, updated_at);
create index if not exists plans_user_updated_idx on public.plans (user_id, updated_at);
create index if not exists workouts_user_updated_idx on public.workouts (user_id, updated_at);
create index if not exists workout_exercises_user_updated_idx on public.workout_exercises (user_id, updated_at);
create index if not exists sets_user_updated_idx on public.sets (user_id, updated_at);
create index if not exists body_metrics_user_updated_idx on public.body_metrics (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled on every table before a single row exists. The rule is written into
-- the database rather than the client, so even a leaked anon key cannot read
-- another account's training history.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'exercises', 'gyms', 'routines', 'routine_exercises', 'plans',
    'workouts', 'workout_exercises', 'sets', 'body_metrics', 'settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    execute format('drop policy if exists %I on public.%I', target || '_select_own', target);
    execute format('drop policy if exists %I on public.%I', target || '_insert_own', target);
    execute format('drop policy if exists %I on public.%I', target || '_update_own', target);
    execute format('drop policy if exists %I on public.%I', target || '_delete_own', target);

    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      target || '_select_own', target);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      target || '_insert_own', target);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      target || '_update_own', target);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      target || '_delete_own', target);
  end loop;
end
$$;

-- The keepalive table holds no personal data, but it is still not readable or
-- writable by the anon key: only the scheduled job's service role touches it.
alter table public.keepalive enable row level security;
