import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { completePlan, startNextBlock } from './mutations';
import { newId } from '@/lib/ids';
import { nowIso } from '@/lib/dates';
import type { Plan } from './schema';

const ROUTINE_IDS = ['routine-a', 'routine-b'];

async function makePlan(overrides: Partial<Plan> = {}): Promise<string> {
  const plan: Plan = {
    id: newId(),
    name: 'Build muscle · Upper / Lower',
    goal: 'hypertrophy',
    days_per_week: 2,
    block_weeks: 5,
    current_week: 5,
    started_at: '2026-07-01T09:00:00.000Z',
    routine_ids: ROUTINE_IDS,
    training_days: [1, 4],
    phase_name: 'Deload',
    deload_week: 5,
    completed_at: null,
    user_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
    ...overrides,
  };
  await db.plans.add(plan);
  return plan.id;
}

const livePlans = async () =>
  (await db.plans.toArray()).filter((plan) => plan.deleted_at === null);

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('closing a block', () => {
  it('stamps completed_at so it stops being the active plan', async () => {
    const planId = await makePlan();

    await completePlan(planId);

    expect((await db.plans.get(planId))!.completed_at).not.toBeNull();
  });

  it('queues the change for sync', async () => {
    const planId = await makePlan();
    await completePlan(planId);

    const queued = await db.outbox.where({ table_name: 'plans' }).toArray();
    expect(queued.some((entry) => entry.row_id === planId)).toBe(true);
  });
});

describe('starting the next block', () => {
  it('closes the old one and opens a new one', async () => {
    const first = await makePlan();

    const second = await startNextBlock(first);

    expect((await db.plans.get(first))!.completed_at).not.toBeNull();
    const next = (await db.plans.get(second))!;
    expect(next.completed_at).toBeNull();
    expect(next.current_week).toBe(1);
    expect(next.phase_name).toBe('Foundations');
  });

  it('reuses the same routines rather than regenerating them', async () => {
    const first = await makePlan();

    const next = (await db.plans.get(await startNextBlock(first)))!;

    // New exercise ids would throw away the history the progression engine
    // reads to carry achieved weights forward.
    expect(next.routine_ids).toEqual(ROUTINE_IDS);
    expect(next.training_days).toEqual([1, 4]);
    expect(next.block_weeks).toBe(5);
  });

  it('numbers each block instead of stacking suffixes', async () => {
    const first = await makePlan();
    const second = await startNextBlock(first);
    const third = await startNextBlock(second);

    const names = (await livePlans()).map((plan) => plan.name).sort();
    expect(names).toEqual([
      'Build muscle · Upper / Lower',
      'Build muscle · Upper / Lower (block 2)',
      'Build muscle · Upper / Lower (block 3)',
    ]);
    expect((await db.plans.get(third))!.name).toBe('Build muscle · Upper / Lower (block 3)');
  });

  it('leaves exactly one plan running', async () => {
    const first = await makePlan();
    await startNextBlock(first);

    const running = (await livePlans()).filter((plan) => plan.completed_at === null);
    expect(running).toHaveLength(1);
  });

  it('gives the new block its own id and timestamps', async () => {
    const first = await makePlan();
    const second = await startNextBlock(first);

    expect(second).not.toBe(first);
    const next = (await db.plans.get(second))!;
    expect(Date.parse(next.started_at)).toBeGreaterThan(Date.parse('2026-07-01T09:00:00.000Z'));
  });
});
