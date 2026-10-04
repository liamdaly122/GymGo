import { describe, expect, it } from 'vitest';
import {
  blockProgress,
  buildSchedule,
  currentSession,
  currentWeek,
  groupByWeek,
  isBlockComplete,
  runningPlan,
  slotForRoutine,
  weekRange,
  weekStrip,
  type ScheduledSession,
  type SessionStatus,
} from './schedule';
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

  it('rolls a session that was not trained onto today', () => {
    const schedule = build(makePlan(), [], new Date(2026, 7, 6)); // Thursday of week 1
    const monday = schedule.find((session) => session.week === 1 && session.sessionIndex === 0)!;
    expect(monday.date).toBe('2026-08-06');
    expect(monday.status).toBe('today');
    expect(monday.movedFrom).toBe('2026-08-03');
    expect(monday.plannedDate).toBe('2026-08-03');
    // Nothing is left behind today, and next week is untouched.
    expect(schedule.every((session) => session.date >= '2026-08-06')).toBe(true);
    const nextMonday = schedule.find((session) => session.week === 2 && session.sessionIndex === 0)!;
    expect(nextMonday.date).toBe('2026-08-10');
    expect(nextMonday.movedFrom).toBeNull();
  });

  /**
   * Completion matches on week and session index, not on the date, so training
   * Monday's session on Wednesday ticks off Monday's session rather than leaving
   * a hole and inventing an extra workout — and it sits on the Wednesday, where
   * it was actually done.
   */
  it('puts a session trained late on the day it was trained', () => {
    const workouts = [
      makeWorkout({
        plan_id: 'plan-1',
        plan_week: 1,
        plan_session_index: 0,
        started_at: '2026-08-05T12:00:00.000Z', // Wednesday, not Monday
      }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    const monday = schedule.find((session) => session.week === 1 && session.sessionIndex === 0)!;
    expect(monday.status).toBe('done');
    expect(monday.date).toBe('2026-08-05');
    expect(monday.plannedDate).toBe('2026-08-03');
    expect(monday.workoutId).toBeDefined();
    // Thursday's session is still Thursday's.
    const thursday = schedule.find((session) => session.week === 1 && session.sessionIndex === 1)!;
    expect(thursday.date).toBe('2026-08-06');
    expect(thursday.status).toBe('today');
  });

  it('ignores workouts from a different plan', () => {
    const workouts = [
      makeWorkout({ plan_id: 'other-plan', plan_week: 1, plan_session_index: 0 }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    const monday = schedule.find((session) => session.week === 1 && session.sessionIndex === 0)!;
    expect(monday.status).toBe('today');
    expect(monday.workoutId).toBeUndefined();
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
    // Monday was trained, so Wednesday has nothing rolling onto it.
    const workouts = [
      makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0, started_at: '2026-08-03T12:00:00.000Z' }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 5)); // Wednesday
    expect(currentSession(schedule)!.date).toBe('2026-08-06');
  });

  it('reports which week the block is in', () => {
    const trained = [
      ['2026-08-03', 1, 0], ['2026-08-06', 1, 1], ['2026-08-10', 2, 0], ['2026-08-13', 2, 1],
    ].map(([day, week, index]) =>
      makeWorkout({ plan_id: 'plan-1', plan_week: week as number, plan_session_index: index as number, started_at: `${day}T12:00:00.000Z` }),
    );
    const schedule = build(makePlan(), trained as never, new Date(2026, 7, 17)); // week 3 Monday
    expect(currentWeek(schedule)).toBe(3);
  });

  it('waits on the week you are actually up to, not the calendar', () => {
    // Two weeks in and nothing trained: the block is still on week 1.
    const schedule = build(makePlan(), [], new Date(2026, 7, 17));
    expect(currentWeek(schedule)).toBe(1);
    expect(currentSession(schedule)!.date).toBe('2026-08-17');
  });

  it('counts progress through the block', () => {
    const workouts = [
      makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0, started_at: '2026-08-03T12:00:00.000Z' }),
    ];
    const schedule = build(makePlan(), workouts as never, new Date(2026, 7, 6));
    const progress = blockProgress(schedule);
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(10);
    expect(progress.endsOn).toBe('2026-09-03');
    expect(progress.daysBehind).toBe(0);
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
    expect(schedule.every((session) => session.movedFrom === null)).toBe(true);
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

describe('rolling a missed session forward', () => {
  /** Monday, Wednesday and Friday: Push, Pull, Legs — the example the owner chose from. */
  const ppl = makePlan({
    training_days: [1, 3, 5],
    routine_ids: ['push', 'pull', 'legs'],
    days_per_week: 3,
  });
  const pplNames = new Map([
    ['push', 'Push'],
    ['pull', 'Pull'],
    ['legs', 'Legs'],
  ]);
  const plot = (workouts: unknown[], today: Date) =>
    buildSchedule({ plan: ppl, routineNames: pplNames, workouts: workouts as never, today });
  const trained = (week: number, index: number, day: string) =>
    makeWorkout({ plan_id: 'plan-1', plan_week: week, plan_session_index: index, started_at: `${day}T12:00:00.000Z` });
  const firstWeek = (schedule: ReturnType<typeof plot>) =>
    schedule.filter((session) => session.week === 1).map((session) => `${session.date} ${session.name}`);

  it('moves only the missed session when there is room for it', () => {
    // Monday missed, and it is Tuesday.
    const schedule = plot([], new Date(2026, 7, 4));
    expect(firstWeek(schedule)).toEqual(['2026-08-04 Push', '2026-08-05 Pull', '2026-08-07 Legs']);
    expect(schedule.find((session) => session.name === 'Push')!.movedFrom).toBe('2026-08-03');
    expect(schedule.find((session) => session.name === 'Pull')!.movedFrom).toBeNull();
  });

  it('bumps the next session a day when the missed one lands on it', () => {
    // Monday and Tuesday both missed; it is Wednesday.
    const schedule = plot([], new Date(2026, 7, 5));
    expect(firstWeek(schedule)).toEqual(['2026-08-05 Push', '2026-08-06 Pull', '2026-08-07 Legs']);
    const pull = schedule.find((session) => session.week === 1 && session.name === 'Pull')!;
    expect(pull.movedFrom).toBe('2026-08-05');
    // And the next week is back on Monday, Wednesday and Friday.
    expect(schedule.filter((session) => session.week === 2).map((session) => session.date)).toEqual([
      '2026-08-10',
      '2026-08-12',
      '2026-08-14',
    ]);
  });

  it('keeps coming back until it is trained', () => {
    for (const day of [4, 5, 8]) {
      const push = plot([], new Date(2026, 7, day)).find((session) => session.week === 1 && session.sessionIndex === 0)!;
      expect(push.status).toBe('today');
      expect(push.date).toBe(`2026-08-0${day}`);
    }
  });

  it('never puts two sessions on one day after training', () => {
    // Monday's Push was finally trained on Wednesday — Wednesday's Pull waits for tomorrow.
    const schedule = plot([trained(1, 0, '2026-08-05')], new Date(2026, 7, 5));
    expect(firstWeek(schedule)).toEqual(['2026-08-05 Push', '2026-08-06 Pull', '2026-08-07 Legs']);
    expect(schedule.find((session) => session.name === 'Push')!.status).toBe('done');
    expect(currentSession(schedule)!.name).toBe('Pull');
  });

  it('leaves later sessions on their own days when one is trained early', () => {
    // Monday trained, then Wednesday's Pull done a day early on Tuesday.
    const schedule = plot([trained(1, 0, '2026-08-03'), trained(1, 1, '2026-08-04')], new Date(2026, 7, 4));
    expect(firstWeek(schedule)).toEqual(['2026-08-03 Push', '2026-08-04 Pull', '2026-08-07 Legs']);
  });

  it('keeps sessions still to do in order and a day apart when trained out of order', () => {
    // Monday missed; Wednesday's Pull trained early on Tuesday instead.
    const schedule = plot([trained(1, 1, '2026-08-04')], new Date(2026, 7, 4));
    const toDo = schedule.filter((session) => session.status !== 'done');
    const dates = toDo.map((session) => session.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(toDo[0]!.name).toBe('Push');
    expect(toDo[0]!.date).toBe('2026-08-05');
  });

  it('does not finish a block until every session is done', () => {
    // Weeks after the planned end, with nothing trained.
    const schedule = plot([], new Date(2026, 9, 1));
    expect(isBlockComplete(schedule)).toBe(false);
    expect(currentSession(schedule)!.week).toBe(1);
    expect(currentSession(schedule)!.date).toBe('2026-10-01');
  });

  it('reports how far past its planned end the block will run', () => {
    // Everything trained on its day except the very last session, two days late.
    const workouts = plot([], new Date(2026, 7, 3))
      .filter((session) => !(session.week === 5 && session.sessionIndex === 2))
      .map((session) => trained(session.week, session.sessionIndex, session.plannedDate));
    const schedule = plot(workouts, new Date(2026, 8, 6)); // Sunday after the planned Friday finish
    const progress = blockProgress(schedule);
    expect(progress.done).toBe(14);
    expect(progress.endsOn).toBe('2026-09-06');
    expect(progress.daysBehind).toBe(2);
  });

  it('fills the earliest slot still to do for a routine', () => {
    const fresh = plot([], new Date(2026, 7, 5));
    expect(slotForRoutine(fresh, 'push')).toMatchObject({ week: 1, sessionIndex: 0 });

    const afterWeekOne = plot([trained(1, 0, '2026-08-03')], new Date(2026, 7, 5));
    expect(slotForRoutine(afterWeekOne, 'push')).toMatchObject({ week: 2, sessionIndex: 0 });

    const allPush = plot(
      [1, 2, 3, 4, 5].map((week) => trained(week, 0, `2026-08-0${week}`)),
      new Date(2026, 7, 6),
    );
    expect(slotForRoutine(allPush, 'push')).toBeNull();
  });
});

describe('grouping a block into weeks', () => {
  const plan = (weeks: number) =>
    makePlan({ block_weeks: weeks, training_days: [1, 3, 5], started_at: '2026-08-03T09:00:00.000Z' });

  it('returns one entry per week of the block', () => {
    const schedule = buildSchedule({
      plan: plan(5),
      routineNames: new Map(),
      workouts: [],
      today: new Date('2026-08-05T09:00:00.000Z'),
    });

    const weeks = groupByWeek(schedule, 5);
    expect(weeks.map((entry) => entry.week)).toEqual([1, 2, 3, 4, 5]);
    expect(weeks.at(-1)!.modifier.isDeload).toBe(true);
  });

  it('keeps a week that holds no sessions rather than renumbering the rest', () => {
    // Fed directly: a schedule missing week 2 entirely. Whatever produced the
    // gap, "week 3 of 5" has to stay week 3 for the label to mean anything.
    const schedule = buildSchedule({
      plan: plan(5),
      routineNames: new Map(),
      workouts: [],
      today: new Date('2026-08-05T09:00:00.000Z'),
    }).filter((session) => session.week !== 2);

    const weeks = groupByWeek(schedule, 5);
    expect(weeks.map((entry) => entry.week)).toEqual([1, 2, 3, 4, 5]);
    expect(weeks[1]!.sessions).toHaveLength(0);
    expect(weeks[2]!.sessions.length).toBeGreaterThan(0);
    // Week 5 is still the deload even though week 2 came up empty.
    expect(weeks[4]!.modifier.isDeload).toBe(true);
  });

  it('counts what has been done in each week', () => {
    const schedule = buildSchedule({
      plan: plan(5),
      routineNames: new Map(),
      workouts: [
        makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 0 }),
        makeWorkout({ plan_id: 'plan-1', plan_week: 1, plan_session_index: 1 }),
      ],
      today: new Date('2026-08-07T09:00:00.000Z'),
    });

    const weeks = groupByWeek(schedule, 5, 1);
    expect(weeks[0]!.done).toBe(2);
    expect(weeks[0]!.isCurrent).toBe(true);
    expect(weeks[1]!.done).toBe(0);
    expect(weeks[1]!.isCurrent).toBe(false);
  });

  it('orders each week by date', () => {
    const schedule = buildSchedule({
      plan: plan(5),
      routineNames: new Map(),
      workouts: [],
      today: new Date('2026-08-05T09:00:00.000Z'),
    });

    const dates = groupByWeek(schedule, 5)[2]!.sessions.map((session) => session.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('knowing when a block is over', () => {
  const scheduleWith = (statuses: SessionStatus[]): ScheduledSession[] =>
    statuses.map((status, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      plannedDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
      movedFrom: null,
      week: 1,
      sessionIndex: index,
      routineId: 'r1',
      name: 'Day',
      status,
      modifier: weekModifier(1, 5),
    }));

  it('is over when everything has been trained', () => {
    expect(isBlockComplete(scheduleWith(['done', 'done', 'done']))).toBe(true);
  });

  it('is not over while something is still to come', () => {
    expect(isBlockComplete(scheduleWith(['done', 'done', 'upcoming']))).toBe(false);
    expect(isBlockComplete(scheduleWith(['done', 'today']))).toBe(false);
  });

  it('is not over while a skipped session is still to do', () => {
    // A skipped session rolls forward rather than being written off, so it
    // holds the block open until it is made up — or the block is ended early.
    const plan = makePlan();
    const all = build(plan, [], new Date(2026, 7, 3));
    const workouts = all
      .filter((session) => !(session.week === 2 && session.sessionIndex === 0))
      .map((session) =>
        makeWorkout({
          plan_id: 'plan-1',
          plan_week: session.week,
          plan_session_index: session.sessionIndex,
          started_at: `${session.plannedDate}T12:00:00.000Z`,
        }),
      );
    const schedule = build(plan, workouts as never, new Date(2026, 8, 20));
    expect(isBlockComplete(schedule)).toBe(false);
    expect(currentSession(schedule)).toMatchObject({ week: 2, sessionIndex: 0, date: '2026-09-20' });
  });

  it('is not over when there is no schedule at all', () => {
    // A plan with no training days would otherwise declare itself finished the
    // moment it was created.
    expect(isBlockComplete([])).toBe(false);
  });
});

describe('the block that is running', () => {
  const first = makePlan({ id: 'block-1', started_at: '2026-06-01T08:00:00.000Z', completed_at: '2026-07-06T08:00:00.000Z' });
  const second = makePlan({ id: 'block-2', started_at: '2026-07-06T08:00:00.000Z' });
  const other = makePlan({ id: 'other', started_at: '2026-07-01T08:00:00.000Z', routine_ids: ['r-mine'] });

  it('is the newest plan not yet finished', () => {
    expect(runningPlan([first, other, second])?.id).toBe('block-2');
    expect(runningPlan([first])).toBeNull();
    expect(runningPlan([{ ...second, deleted_at: '2026-07-07T08:00:00.000Z' }, other])?.id).toBe('other');
  });

  /** Both blocks hold the same routines; only one of them is being trained. */
  it('holding a routine is the block that runs it, not the one that wrote it', () => {
    expect(runningPlan([first, second, other], 'r-upper')?.id).toBe('block-2');
    expect(runningPlan([first, second, other], 'r-mine')?.id).toBe('other');
    expect(runningPlan([first], 'r-upper')).toBeNull();
  });
});

describe('paging the week strip', () => {
  // Five weeks of Monday and Thursday from Monday 3 August.
  const schedule = build(makePlan());

  it('runs from the first week of the block to the last', () => {
    expect(weekRange(schedule, new Date(2026, 7, 3))).toEqual({ first: 0, last: 4 });
    // Wednesday of week 3: two weeks back, two ahead.
    expect(weekRange(schedule, new Date(2026, 7, 19))).toEqual({ first: -2, last: 2 });
  });

  it('always includes this week', () => {
    // The block starts next Monday; today is the Thursday before.
    expect(weekRange(schedule, new Date(2026, 6, 30))).toEqual({ first: 0, last: 5 });
    expect(weekRange([], new Date(2026, 7, 3))).toEqual({ first: 0, last: 0 });
  });

  it('reaches as far as a session has rolled', () => {
    const rolled = schedule.map((session, index) =>
      index === schedule.length - 1 ? { ...session, date: '2026-09-14' } : session,
    );
    expect(weekRange(rolled, new Date(2026, 7, 3)).last).toBe(6);
  });

  it('counts weeks from the day the week starts on', () => {
    // A Sunday: the end of a Monday week, the start of a Sunday one.
    expect(weekRange(schedule, new Date(2026, 7, 9), 1).first).toBe(0);
    expect(weekRange(schedule, new Date(2026, 7, 9), 0).first).toBe(-1);
  });
});
