import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { GymGoDB } from './db';
import { SETTINGS_ID } from './schema';
import { importFromJson } from './backup';
import { EXPORT_FORMAT } from '@/lib/export';

/**
 * A database written by version 1 of the app, opened by version 2.
 *
 * This is the path nobody exercises by hand — the app on the phone already has
 * data, and a botched upgrade loses it or leaves rows the new code cannot read.
 */
async function makeVersion1Database(name: string) {
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    exercises: 'id, name, primary_muscle, movement_pattern, equipment, source_id, is_custom',
    gyms: 'id, name',
    routines: 'id, name, updated_at',
    routine_exercises: 'id, routine_id, exercise_id, [routine_id+position]',
    workouts: 'id, started_at, finished_at, routine_id, gym_id',
    workout_exercises: 'id, workout_id, exercise_id, [workout_id+position]',
    sets: 'id, workout_exercise_id, [workout_exercise_id+set_index]',
    plans: 'id, name',
    body_metrics: 'id, date, metric, [metric+date]',
    settings: 'id',
    outbox: '++seq, table_name, row_id',
    keepalive: 'id',
  });
  await legacy.open();

  const sync = {
    user_id: null,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    deleted_at: null,
  };

  // Rows exactly as version 1 wrote them: no plan or calendar fields at all.
  await legacy.table('workouts').add({
    id: 'old-workout',
    routine_id: null,
    gym_id: null,
    started_at: '2026-07-01T10:00:00.000Z',
    finished_at: '2026-07-01T11:00:00.000Z',
    bodyweight_kg: 80,
    readiness: null,
    notes: 'from the old version',
    ...sync,
  });
  await legacy.table('plans').add({
    id: 'old-plan',
    name: 'Old plan',
    goal: 'hypertrophy',
    days_per_week: 3,
    block_weeks: 1,
    current_week: 1,
    started_at: '2026-07-01T10:00:00.000Z',
    routine_ids: ['r1'],
    ...sync,
  });
  await legacy.table('settings').add({
    id: SETTINGS_ID,
    units: 'kg',
    default_gym_id: null,
    mode: 'beginner',
    default_rest_seconds: 120,
    sound_on: true,
    vibrate_on: true,
    last_synced_at: null,
    ...sync,
  });

  legacy.close();
}

describe('upgrading a version 1 database', () => {
  it('keeps existing data and backfills the new fields', async () => {
    const name = `gymgo-migration-${Date.now()}`;
    await makeVersion1Database(name);

    const upgraded = new GymGoDB(name);
    await upgraded.open();

    const workout = await upgraded.workouts.get('old-workout');
    expect(workout, 'the old workout survived').toBeDefined();
    expect(workout!.notes).toBe('from the old version');
    expect(workout!.bodyweight_kg).toBe(80);
    // Sessions logged before blocks existed belong to no block.
    expect(workout!.plan_id).toBeNull();
    expect(workout!.plan_week).toBeNull();
    expect(workout!.plan_session_index).toBeNull();

    const plan = await upgraded.plans.get('old-plan');
    expect(plan!.training_days).toEqual([]);
    expect(plan!.phase_name).toBeNull();
    expect(plan!.deload_week).toBeNull();
    expect(plan!.completed_at).toBeNull();

    const settings = await upgraded.settings.get(SETTINGS_ID);
    expect(settings!.week_starts_on).toBe(1);
    expect(settings!.default_rest_seconds).toBe(120);

    upgraded.close();
  });
});

describe('importing a version 1 backup', () => {
  it('restores it rather than refusing a file made before blocks existed', async () => {
    const db = new GymGoDB(`gymgo-import-${Date.now()}`);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));

    const v1Backup = JSON.stringify({
      format: EXPORT_FORMAT,
      schema_version: 1,
      exported_at: '2026-07-01T10:00:00.000Z',
      tables: {
        workouts: [
          {
            id: 'w-old',
            routine_id: null,
            gym_id: null,
            started_at: '2026-07-01T10:00:00.000Z',
            finished_at: '2026-07-01T11:00:00.000Z',
            bodyweight_kg: null,
            readiness: null,
            notes: null,
            user_id: null,
            created_at: '2026-07-01T10:00:00.000Z',
            updated_at: '2026-07-01T10:00:00.000Z',
            deleted_at: null,
          },
        ],
      },
    });

    const result = await importFromJson(v1Backup);
    expect(result.schema_version).toBe(1);
    expect(result.live_counts.workouts).toBe(1);

    db.close();
  });
});
