-- Carry the routine's prescribed rest and tempo onto the workout.
--
-- The plan generator prescribes rest per slot — 210s for a strength primary,
-- 75s for an accessory — and stored it only on routine_exercises, which the
-- active workout never reads. The timer therefore fell back to the exercise's
-- generic default and every plan's prescribed rest was decorative.
--
-- These are copied at workout start rather than referenced, so editing a
-- routine still cannot change a session already performed.

alter table public.workout_exercises
  add column if not exists rest_seconds integer,
  add column if not exists tempo text;

comment on column public.workout_exercises.rest_seconds is
  'Rest in seconds copied from the routine. Null means use the exercise default.';
comment on column public.workout_exercises.tempo is
  'Four-digit tempo such as "3-1-1-0", copied from the routine.';
