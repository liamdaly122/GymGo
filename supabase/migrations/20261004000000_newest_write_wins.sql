-- Last write wins, enforced by the server rather than trusted to the client.
--
-- Sync resolves conflicts on updated_at. Until now only the pull honoured that:
-- a device pulling a row keeps whichever copy is newer. The push did not, so
-- any upload replaced the stored row outright. That was safe only while every
-- upload was a fresh edit. It stops being safe the moment a device sends rows
-- it did not just change:
--
--   * a first backup sends everything on the phone, including factory-default
--     settings and a seeded exercise library;
--   * a phone restored from an old JSON export sends that export;
--   * a phone that was offline for a week sends edits older than ones made
--     elsewhere since.
--
-- Each of those could roll the cloud copy backwards. With this trigger an
-- update older than the stored row is skipped, so an upload can only ever move
-- a row forward in time. Equal timestamps go through: that is the same write
-- arriving twice, and applying it again changes nothing.
--
-- Idempotent, like the migrations before it, so it is safe to run again.

create or replace function public.keep_newest_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    -- Returning null from a BEFORE trigger skips this row's update. In an
    -- upsert that means the stored, newer row stays exactly as it was.
    return null;
  end if;
  return new;
end;
$$;

comment on function public.keep_newest_row() is
  'Skips an update older than the stored row, so sync is last-write-wins on the server too.';

do $$
declare
  target text;
begin
  foreach target in array array[
    'exercises', 'gyms', 'routines', 'routine_exercises', 'plans',
    'workouts', 'workout_exercises', 'sets', 'body_metrics', 'settings'
  ]
  loop
    execute format('drop trigger if exists keep_newest_row on public.%I', target);
    execute format(
      'create trigger keep_newest_row before update on public.%I '
      'for each row execute function public.keep_newest_row()',
      target);
  end loop;
end
$$;
