import { describe, expect, it } from 'vitest';
import { blockProgress, buildSchedule, currentSession, currentWeek, weekStrip } from './schedule';
import { blockWeeks, formatWeekLabel, setsForWeek, weekModifier } from './programmes/block';
import { makeWorkout } from './testFactories';
import type { Plan } from '@/db/schema';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    name: 'Build muscle · Upper / Lower',
    goal: 'hypertrophy',
    days_per_week: 2,
    block_weeks: 5,
    current_week: 1,
    // A Monday.
    started_at: '2026-08-03T08:00:00.000Z',
    routine_ids: ['r-upper', 'r-lower'],
    training_days: [1, 4], // Monday and Thursday
    phase_name: null,
    deload_week: 5,
    completed_at: null,
    user_id: null,
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T08:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

const names = new Map([
  ['r-upper', 'Upper A'],
  ['r-lower', 'Lower A'],
]);

const build = (plan: Plan, workouts = [], today = new Date(2026, 7, 3)) =>
  buildSchedule({ plan, routineNames: names, workouts, today });

describe('the block week', () => {
  it('runs foundations, build, build, peak, deload', () => {
    expect(blockWeeks(5).map((week) => week.label)).toEqual([
      'Foundations',
      'Build',
      'Build',
      'Peak',
      'Deload',
    ]);
  });

  it('adds sets and closes in on failure across the accumulation weeks', () => {
    const weeks = blockWeeks(5).slice(0, 4);
    expect(weeks.map((week) => week.extraSets)).toEqual([0, 1, 2, 2]);
    // RIR falls: further from failure at the start, closest at the end.
    expect(weeks.map((week) => week.targetRir)).toEqual([3, 2, 2, 1]);
  });

  it('halves the volume on the deload and goes slightly lighter', () => {
    const deload = weekModifier(5, 5);
    expect(deload.isDeload).toBe(true);
    expect(setsForWeek(4, deload)).toBe(2);
    expect(deload.loadMultiplier).toBeLessThan(1);
  });

  it('makes the last accumulation week the hardest', () => {
    const weeks = blockWeeks(5);
    expect(weeks[3]!.targetRir).toBeLessThan(weeks[0]!.targetRir);
  });

  it('never prescribes zero sets, even on a deload', () => {
    expect(setsForWeek(1, weekModifier(5, 5))).toBeGreaterThanOrEqual(1);
  });

  it('keeps the deload last in a block of another length', () => {
    expect(blockWeeks(4).at(-1)!.isDeload).toBe(true);
    expect(blockWeeks(6).at(-1)!.isDeload).toBe(true);
  });

  it('clamps a stale week rather than breaking the screen', () => {
    expect(weekModifier(99, 5).week).toBe(5);
    expect(weekModifier(0, 5).week).toBe(1);
  });

  it('labels the week the way the UI shows it', () => {
    expect(formatWeekLabel(weekModifier(2, 5))).toBe('Week 2/5 — Build');
  });
});

describe('plotting a block onto dates', () => {
  it('lays out every session of every week', () => {
    const schedule = build(makePlan());
    expect(schedule).toHaveLength(10); // 2 days x 5 weeks
    expect(schedule[0]!.date).toBe('2026-08-03');
  });

  it('only uses the weekdays the plan trains on', () => {
    const schedule = build(makePlan());
    const weekdays = new Set(schedule.map((session) => new Date(`${session.date}T12:00:00`).getDay()));
    expect([...weekdays].sort()).toEqual([1, 4]);
  });

  it('marks today, the past and the future apart', () => {
    const schedule = build(makePlan(), [], new Date(2026, 7, 6)); // Thursday of week 1
    const byDate = new Map(schedule.map((session) => [session.date, session.status]));
    expect(byDate.get('2026-08-06')).toBe('today');
    expect(byDate.get('2026-08-03')).toBe('missed');
    expect(byDate.get('2026-08-10')).toBe('upcoming');
  });

  /**
   * Completion matches on week and session index, not on the date, so training
   * Monday's session on Wednesday still ticks Monday off rather than leaving a
   * hole and inventing an extra workout.
   */
  it('ticks off a session trained late', () => {
    const workouts = [
      makeWorkout({
        plan_id: 'plan-1',
        plan_week: 1,
        plan_session_index: 0,
        started_at: '2026-08-05T18:00:00.000Z', // Wednesday, not Monday
      }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    const monday = schedule.find((session) => session.date === '2026-08-03')!;
    expect(monday.status).toBe('done');
    expect(monday.workoutId).toBeDefined();
  });

  it('ignores workouts from a different plan', () => {
    const workouts = [
      makeWorkout({ plan_id: 'other-plan', plan_week: 1, plan_session_index: 0 }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    expect(schedule.find((session) => session.date === '2026-08-03')!.status).toBe('missed');
  });

  it('carries each week\'s shape onto its sessions', () => {
    const schedule = build(makePlan());
    expect(schedule.at(-1)!.modifier.isDeload).toBe(true);
    expect(schedule[0]!.modifier.label).toBe('Foundations');
  });

  it('returns nothing when no training days are set', () => {
    expect(build(makePlan({ training_days: [] }))).toEqual([]);
  });

  it('names each slot after its routine', () => {
    const schedule = build(makePlan());
    expect(schedule[0]!.name).toBe('Upper A');
    expect(schedule[1]!.name).toBe('Lower A');
  });
});

describe('where the plan is up to', () => {
  it('offers today\'s session when there is one', () => {
    const schedule = build(makePlan(), [], new Date(2026, 7, 6));
    expect(currentSession(schedule)!.date).toBe('2026-08-06');
  });

  it('offers the next one due when today is a rest day', () => {
    const schedule = build(makePlan(), [], new Date(2026, 7, 5)); // Wednesday
    expect(currentSession(schedule)!.date).toBe('2026-08-06');
  });

  it('reports which week the block is in', () => {
    const schedule = build(makePlan(), [], new Date(2026, 7, 17)); // week 3 Monday
    expect(currentWeek(schedule)).toBe(3);
  });

  it('scores adherence against sessions that have come due, not the whole block', () => {
    const workouts = [makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0 })];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    const progress = blockProgress(schedule);
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(10);
    // One done, none yet missed — a full block is not counted as 10% adherence.
    expect(progress.adherence).toBe(1);
  });
});

describe('the week strip', () => {
  it('starts on Monday by default', () => {
    const strip = weekStrip(new Date(2026, 7, 6), 1); // a Thursday
    expect(strip).toHaveLength(7);
    expect(strip[0]!.getDay()).toBe(1);
    expect(strip[6]!.getDay()).toBe(0);
  });

  it('can start on Sunday instead', () => {
    expect(weekStrip(new Date(2026, 7, 6), 0)[0]!.getDay()).toBe(0);
  });
});

describe('a block started mid-week', () => {
  /**
   * Found on screen: creating a plan on a Wednesday immediately showed a missed
   * Monday, because week 1 was anchored to the start of the calendar week.
   */
  it('has no sessions before the day it was created', () => {
    // Started Wednesday 5 August, trains Monday and Thursday.
    const plan = makePlan({ started_at: '2026-08-05T09:00:00.000Z' });
    const schedule = build(plan, [], new Date(2026, 7, 5));
    expect(schedule.every((session) => session.date >= '2026-08-05')).toBe(true);
    expect(schedule.some((session) => session.status === 'missed')).toBe(false);
  });

  it('still runs the full number of weeks', () => {
    const plan = makePlan({ started_at: '2026-08-05T09:00:00.000Z' });
    const schedule = build(plan, [], new Date(2026, 7, 5));
    expect(new Set(schedule.map((session) => session.week)).size).toBe(5);
  });

  it('keeps a session that was actually trained before the start date', () => {
    const plan = makePlan({ started_at: '2026-08-05T09:00:00.000Z' });
    const workouts = [
      makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0 }),
    ];
    const schedule = build(plan, workouts as never, new Date(2026, 7, 6));
    expect(schedule.some((session) => session.status === 'done')).toBe(true);
  });
});

describe('progress vs adherence', () => {
  /**
   * A bar across the block and an adherence score answer different questions.
   * Showing "1 of 14 · 7%" reads as terrible adherence when it is in fact a
   * perfect first session of a fresh block.
   */
  it('separates being early in a block from missing sessions', () => {
    const workouts = [makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0 })];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 3));
    const progress = blockProgress(schedule);

    // One of ten done: early in the block.
    expect(progress.done / progress.total).toBeLessThan(0.2);
    // But nothing has been missed, so adherence is perfect.
    expect(progress.adherence).toBe(1);
    expect(progress.missed).toBe(0);
  });
});
