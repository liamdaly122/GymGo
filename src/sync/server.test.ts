import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './testing/fakeSupabase';
import { ensureUser, selectRows, serverRows, upsertRows } from './testing/pgRest';
import { SYNCED_TABLES } from './client';
import { db } from '@/db/db';
import { seedIfEmpty } from '@/db/seed';
import {
  addChildSet,
  completeSetWith,
  createCustomExercise,
  createGym,
  createRoutinesFromPlan,
  finishWorkout,
  startWorkoutFromRoutine,
  updateSettings,
} from '@/db/mutations';
import { buildPlan } from '@/domain/programmes/plan';
import type { BodyMetric } from '@/db/schema';

/**
 * The server half of backup, on real Postgres with the migrations exactly as
 * they will be pasted into the Supabase SQL editor.
 *
 * Three things are proved here that no amount of client testing can: the SQL
 * runs, one account can never see or change another's rows, and an upload can
 * only move a row forward in time.
 */

let server: FakeSupabase;
beforeAll(async () => {
  server = await createFakeSupabase();
});

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('the migrations', () => {
  it('can be run a second time without harm', async () => {
    const { MIGRATIONS } = await import('./testing/fakeSupabase');
    for (const sql of MIGRATIONS) await server.pg.exec(sql);
  });

  it('turn row level security on for every table that syncs', async () => {
    const result = await server.pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    const secured = new Map(result.rows.map((row) => [row.relname, row.relrowsecurity]));
    for (const table of SYNCED_TABLES) expect(secured.get(table), table).toBe(true);
  });

  it('put the newest-write-wins trigger on every table that syncs', async () => {
    const result = await server.pg.query<{ table: string }>(
      "select event_object_table as table from information_schema.triggers where trigger_name = 'keep_newest_row'",
    );
    const guarded = new Set(result.rows.map((row) => row.table));
    for (const table of SYNCED_TABLES) expect(guarded.has(table), table).toBe(true);
  });
});

const routine = (id: string, userId: string, name: string, updatedAt: string) => ({
  id,
  user_id: userId,
  name,
  notes: null,
  archived: false,
  generated_from_plan_id: null,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: updatedAt,
  deleted_at: null,
});

describe('one account per history', () => {
  it('never shows one account the rows of another', async () => {
    const mine = await ensureUser(server.pg, 'owner@example.com');
    const theirs = await ensureUser(server.pg, 'stranger@example.com');
    await upsertRows(server.pg, mine, 'routines', [
      routine('0b6a3a63-4ac2-4c5a-9a2b-5d1f0d7c1001', mine, 'Mine', '2026-08-02T10:00:00.000Z'),
    ]);

    expect(await selectRows(server.pg, theirs, 'routines')).toEqual([]);
  });

  it("refuses to let one account overwrite or forge another's rows", async () => {
    const mine = await ensureUser(server.pg, 'owner@example.com');
    const theirs = await ensureUser(server.pg, 'stranger@example.com');
    const id = '0b6a3a63-4ac2-4c5a-9a2b-5d1f0d7c1002';
    await upsertRows(server.pg, mine, 'routines', [routine(id, mine, 'Mine', '2026-08-02T10:00:00.000Z')]);

    await expect(
      upsertRows(server.pg, theirs, 'routines', [routine(id, theirs, 'Taken', '2026-09-01T10:00:00.000Z')]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      upsertRows(server.pg, theirs, 'routines', [
        routine('0b6a3a63-4ac2-4c5a-9a2b-5d1f0d7c1003', mine, 'Forged', '2026-09-01T10:00:00.000Z'),
      ]),
    ).rejects.toThrow(/row-level security/);

    const stored = (await serverRows(server.pg, 'routines')).find((row) => row['id'] === id);
    expect(stored!['name']).toBe('Mine');
  });
});

describe('every row the app writes can be stored', () => {
  /**
   * The sync layer copies rows without translating them, so a column the app
   * writes and the server lacks fails the whole upload. This builds real rows
   * through the app's own code — a seeded library, a generated plan, a
   * finished session with a drop set — and stores every one of them.
   */
  async function lifeOfTheApp() {
    await seedIfEmpty();
    const exercises = await db.exercises.toArray();
    const plan = buildPlan({ goalId: 'build_muscle', splitId: 'upper_lower', days: 4 }, exercises, {});
    const { routineIds } = await createRoutinesFromPlan(plan);
    const workoutId = await startWorkoutFromRoutine(routineIds[0]!);
    const firstExercise = (await db.workout_exercises.where({ workout_id: workoutId }).toArray())[0]!;
    const firstSet = (await db.sets.where({ workout_exercise_id: firstExercise.id }).toArray())[0]!;
    await completeSetWith(firstSet.id, { weight_kg: 102.5, reps: 6 });
    await addChildSet(firstSet.id, 'drop');
    await finishWorkout(workoutId);
    await createCustomExercise({
      name: 'Landmine press',
      primary_muscle: 'shoulders',
      secondary_muscles: ['triceps'],
      equipment: 'barbell',
      movement_pattern: 'vertical_push',
      is_compound: true,
      is_unilateral: true,
      experience_level: 'intermediate',
      fatigue_cost: 3,
      demo_url: null,
      default_rest_seconds: 120,
      setup_notes: 'Bar in the corner',
      increment_kg: 2.5,
    });
    await createGym('Garage', { equipment_available: ['dumbbell', 'bodyweight'] });
    await updateSettings({ mode: 'pro' });
    const metric: BodyMetric = {
      id: crypto.randomUUID(),
      date: '2026-08-03',
      metric: 'bodyweight',
      value: 82.4,
      unit: 'kg',
      user_id: null,
      created_at: '2026-08-03T07:00:00.000Z',
      updated_at: '2026-08-03T07:00:00.000Z',
      deleted_at: null,
    };
    await db.body_metrics.add(metric);
  }

  it('stores every table, field for field', async () => {
    await lifeOfTheApp();
    const userId = await ensureUser(server.pg, 'owner@example.com');

    for (const table of SYNCED_TABLES) {
      const rows = (await db.table(table).toArray()) as Array<Record<string, unknown>>;
      expect(rows.length, `${table} should have rows to check`).toBeGreaterThan(0);
      await upsertRows(
        server.pg,
        userId,
        table,
        rows.map((row) => ({ ...row, user_id: userId })),
      );
    }
  });

  it('moves a row forward in time, never back', async () => {
    await lifeOfTheApp();
    const userId = await ensureUser(server.pg, 'owner@example.com');

    for (const table of SYNCED_TABLES) {
      const first = (await db.table(table).toArray())[0] as Record<string, unknown>;
      const row: Record<string, unknown> = { ...first, user_id: userId };
      // Far ahead of anything an earlier test stored, so the first write here
      // is the newest the server has seen.
      const at = (iso: string) => ({ ...row, updated_at: iso });
      const stored = async () =>
        Date.parse(
          (await serverRows(server.pg, table)).find((candidate) => candidate['id'] === row['id'])![
            'updated_at'
          ] as string,
        );

      await upsertRows(server.pg, userId, table, [at('2099-09-02T10:00:00.000Z')]);
      await upsertRows(server.pg, userId, table, [at('2099-09-01T10:00:00.000Z')]);
      expect(await stored(), `${table}: a stale upload must not win`).toBe(Date.parse('2099-09-02T10:00:00.000Z'));

      await upsertRows(server.pg, userId, table, [at('2099-09-03T10:00:00.000Z')]);
      expect(await stored(), `${table}: a newer upload must`).toBe(Date.parse('2099-09-03T10:00:00.000Z'));
    }
  });
});
