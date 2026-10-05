import { describe, expect, it } from 'vitest';
import type { Plan } from '@/db/schema';
import { addIsoDays, DEFAULT_WEEKLY_TARGET, streakWalk, weekStartOf, weekTarget } from './streak';

/** Local noon on a date, as an ISO instant. */
const noonOf = (day: string) => new Date(`${day}T12:00:00`).toISOString();

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    name: 'Build muscle · Full body',
    goal: 'hypertrophy',
    days_per_week: 3,
    block_weeks: 5,
    current_week: 1,
    started_at: noonOf('2026-08-03'),
    routine_ids: ['a', 'b', 'c'],
    // Monday, Wednesday, Friday.
    training_days: [1, 3, 5],
    phase_name: null,
    deload_week: 5,
    completed_at: null,
    user_id: null,
    created_at: noonOf('2026-08-03'),
    updated_at: noonOf('2026-08-03'),
    deleted_at: null,
    ...overrides,
  };
}

/** 7 September 2026 is a Monday. */
const MONDAY = '2026-09-07';

describe('weeks', () => {
  it('start on the day the settings say', () => {
    expect(weekStartOf('2026-09-09', 1)).toBe(MONDAY);
    expect(weekStartOf(MONDAY, 1)).toBe(MONDAY);
    // A Sunday ends a Monday week, and starts a Sunday one.
    expect(weekStartOf('2026-09-13', 1)).toBe(MONDAY);
    expect(weekStartOf('2026-09-13', 0)).toBe('2026-09-13');
  });
});

describe('what a week asks for', () => {
  it('is three when no block has ever run', () => {
    expect(weekTarget(MONDAY, [])).toBe(DEFAULT_WEEKLY_TARGET);
  });

  it('is the running block’s days', () => {
    expect(weekTarget(MONDAY, [plan()])).toBe(3);
    expect(weekTarget(MONDAY, [plan({ training_days: [1, 2, 4, 5] })])).toBe(4);
  });

  it('asks a block that starts midweek only for the days it has left', () => {
    const wednesday = plan({ started_at: noonOf('2026-09-09') });
    expect(weekTarget(MONDAY, [wednesday])).toBe(2);
  });

  it('asks a block closed midweek only for the days it ran', () => {
    const closedTuesday = plan({ completed_at: noonOf('2026-09-08') });
    expect(weekTarget(MONDAY, [closedTuesday])).toBe(1);
  });

  it('always asks for at least one in a week with a block in it', () => {
    const fromSaturday = plan({ started_at: noonOf('2026-09-12') });
    expect(weekTarget(MONDAY, [fromSaturday])).toBe(1);
  });

  it('carries the last block’s days a week into a week with none running', () => {
    const ended = plan({ training_days: [1, 2, 4, 5], completed_at: noonOf('2026-08-30') });
    expect(weekTarget(MONDAY, [ended])).toBe(4);
  });

  it('reads the newest block when two overlap', () => {
    const older = plan({ id: 'old', training_days: [1, 2, 3, 4, 5] });
    const newer = plan({ id: 'new', started_at: noonOf('2026-08-10'), training_days: [2, 4] });
    expect(weekTarget(MONDAY, [older, newer])).toBe(2);
  });
});

/** Three sessions on each of `weeks` weeks from MONDAY, by day offset from that week's Monday. */
function trainWeeks(walk: ReturnType<typeof streakWalk>, weeks: number[], days = [0, 2, 4]) {
  for (const week of weeks) {
    for (const day of days) walk.count(addIsoDays(MONDAY, week * 7 + day));
  }
}

describe('the streak', () => {
  it('counts weeks in a row that hit the target', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1, 2]);
    const streak = walk.finish(addIsoDays(MONDAY, 3 * 7));
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
    expect(streak.weeks.map((week) => week.status)).toEqual(['hit', 'hit', 'hit', 'open']);
  });

  it('credits the session that hits the target, and only that one', () => {
    const walk = streakWalk([plan()], 1);
    expect(walk.count(MONDAY).hit).toBe(false);
    expect(walk.count(addIsoDays(MONDAY, 2)).hit).toBe(false);
    expect(walk.count(addIsoDays(MONDAY, 4))).toMatchObject({ hit: true, streak: 1 });
    // A fourth session that week is welcome, and earns no second hit.
    expect(walk.count(addIsoDays(MONDAY, 5)).hit).toBe(false);
  });

  it('never breaks on the week still under way', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1]);
    walk.count(addIsoDays(MONDAY, 14));
    const streak = walk.finish(addIsoDays(MONDAY, 16));
    expect(streak.current).toBe(2);
    expect(streak.thisWeek).toEqual({ start: addIsoDays(MONDAY, 14), sessions: 1, target: 3, hit: false });
  });

  it('counts this week once it is hit', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1, 2]);
    expect(walk.finish(addIsoDays(MONDAY, 18)).current).toBe(3);
  });

  it('ends on a week that falls short', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1]);
    walk.count(addIsoDays(MONDAY, 14));
    trainWeeks(walk, [3]);
    const streak = walk.finish(addIsoDays(MONDAY, 25));
    expect(streak.weeks.map((week) => week.status)).toEqual(['hit', 'hit', 'short', 'hit']);
    expect(streak.current).toBe(1);
    expect(streak.best).toBe(2);
  });

  it('ends after a week with nothing in it, once that week is over', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1]);
    expect(walk.finish(addIsoDays(MONDAY, 22)).current).toBe(0);
  });

  it('banks a free week every fourth week in a row, and spends it on a short one', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1, 2, 3]);
    // Week 5 empty: the banked week covers it. Week 6 trained.
    trainWeeks(walk, [5]);
    const streak = walk.finish(addIsoDays(MONDAY, 6 * 7));
    expect(streak.weeks.map((week) => week.status)).toEqual(['hit', 'hit', 'hit', 'hit', 'banked', 'hit', 'open']);
    // The banked week kept it going without adding to it.
    expect(streak.current).toBe(5);
    expect(streak.banked).toBe(0);
  });

  it('holds two banked weeks at most', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, Array.from({ length: 12 }, (_unused, week) => week));
    expect(walk.finish(addIsoDays(MONDAY, 12 * 7)).banked).toBe(2);
  });

  it('loses banked weeks when the streak ends', () => {
    const walk = streakWalk([plan()], 1);
    trainWeeks(walk, [0, 1, 2, 3]);
    // Two empty weeks: the first spends the bank, the second ends it.
    trainWeeks(walk, [6]);
    const streak = walk.finish(addIsoDays(MONDAY, 7 * 7));
    expect(streak.weeks.map((week) => week.status).slice(4, 7)).toEqual(['banked', 'short', 'hit']);
    expect(streak.current).toBe(1);
    expect(streak.banked).toBe(0);
  });

  it('files a Sunday session by the week start the settings use', () => {
    const sunday = '2026-09-13';
    const mondayWeeks = streakWalk([], 1);
    mondayWeeks.count(sunday);
    expect(mondayWeeks.finish(sunday).thisWeek.start).toBe(MONDAY);
    const sundayWeeks = streakWalk([], 0);
    sundayWeeks.count(sunday);
    expect(sundayWeeks.finish(sunday).thisWeek.start).toBe(sunday);
  });

  it('is nothing at all before the first session', () => {
    const streak = streakWalk([plan()], 1).finish(MONDAY);
    expect(streak).toMatchObject({ current: 0, best: 0, banked: 0, weeks: [] });
    expect(streak.thisWeek).toEqual({ start: MONDAY, sessions: 0, target: 3, hit: false });
  });
});
