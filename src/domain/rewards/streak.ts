/**
 * The weekly streak: weeks in a row that hit their target.
 *
 * Weekly, not daily, because the plan has rest days in it on purpose. A daily
 * streak would make the deload week and every rest day cost something, which
 * is exactly backwards. The owner chose this over a daily streak and over a
 * looser "any session that week".
 *
 * A week's target is the block's own days. Any session that counts goes
 * toward it, freestyle included, so a missed plan session can be made up.
 * Every fourth week in a row banks a free week (two at most), spent by itself
 * when a week falls short — a holiday or a cold keeps the streak, without
 * adding to it. A week still under way never breaks anything.
 *
 * Nothing is stored. Like the schedule, it is worked out from the plans, the
 * sessions and the date, so a restore or a new phone tells the same story.
 *
 * Pure.
 */
import type { Plan } from '@/db/schema';
import { localIsoDate } from '../schedule';

/** What a week asks for when no block has ever run. */
export const DEFAULT_WEEKLY_TARGET = 3;
/** Every this many weeks in a row banks a free week. */
export const WEEKS_PER_BANKED = 4;
/** The most free weeks that can be held at once. */
export const MAX_BANKED = 2;

/**
 * - `hit`: the target was met;
 * - `banked`: it fell short, and a banked week kept the streak going;
 * - `short`: it fell short, and the streak ended;
 * - `open`: this week, still under way.
 */
export type WeekStatus = 'hit' | 'banked' | 'short' | 'open';

export interface StreakWeek {
  /** The week's first day, ISO date only, local. */
  start: string;
  target: number;
  sessions: number;
  status: WeekStatus;
}

export interface Streak {
  /** Weeks in a row that hit the target — this one included once it has. */
  current: number;
  best: number;
  /** Free weeks in hand. */
  banked: number;
  thisWeek: { start: string; sessions: number; target: number; hit: boolean };
  /** Every week from the first session's to this one, oldest first. */
  weeks: StreakWeek[];
}

const noon = (iso: string) => new Date(`${iso}T12:00:00`);

/** `iso` moved by whole days, read at noon so a clock change cannot skip one. */
export function addIsoDays(iso: string, days: number): string {
  const date = noon(iso);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

/** The first day of the week holding `iso`. `weekStartsOn`: 1 = Monday, 0 = Sunday. */
export function weekStartOf(iso: string, weekStartsOn: number): string {
  const offset = (noon(iso).getDay() - weekStartsOn + 7) % 7;
  return addIsoDays(iso, -offset);
}

/** The local calendar day an instant fell on. */
export const dayOf = (instant: string): string => localIsoDate(new Date(instant));

/** The block running on `day`: the newest started by then and not closed before it. */
function planOn(day: string, plans: readonly Plan[]): Plan | null {
  let found: Plan | null = null;
  for (const plan of plans) {
    if (plan.deleted_at !== null || dayOf(plan.started_at) > day) continue;
    if (plan.completed_at !== null && dayOf(plan.completed_at) < day) continue;
    if (!found || plan.started_at > found.started_at) found = plan;
  }
  return found;
}

/**
 * How many sessions the week starting `weekStart` asks for.
 *
 * The block's own days: each day of the week counts when the block running
 * that day trains on it. So a block that starts midweek asks only for the days
 * it has left, and one closed midweek only for the days it ran — but a week
 * with a block in it always asks for at least one. With no block at all that
 * week, the last block's days a week; with none ever, three.
 */
export function weekTarget(weekStart: string, plans: readonly Plan[]): number {
  let planned = 0;
  let running = false;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addIsoDays(weekStart, offset);
    const plan = planOn(day, plans);
    if (!plan) continue;
    running = true;
    if (plan.training_days.includes(noon(day).getDay())) planned += 1;
  }
  if (running) return Math.max(1, planned);

  const weekEnd = addIsoDays(weekStart, 6);
  let last: Plan | null = null;
  for (const plan of plans) {
    if (plan.deleted_at !== null || dayOf(plan.started_at) > weekEnd) continue;
    if (!last || plan.started_at > last.started_at) last = plan;
  }
  return last && last.training_days.length > 0 ? last.training_days.length : DEFAULT_WEEKLY_TARGET;
}

/**
 * Walks the weeks as sessions arrive, oldest first, so the session that hits
 * a week's target can be credited with it. `count` takes each session that
 * counts; `finish` closes every week before today's and reports.
 */
export function streakWalk(plans: readonly Plan[], weekStartsOn: number) {
  const weeks: StreakWeek[] = [];
  let run = 0;
  let best = 0;
  let banked = 0;

  const open = (start: string): StreakWeek => {
    const week: StreakWeek = { start, target: weekTarget(start, plans), sessions: 0, status: 'open' };
    weeks.push(week);
    return week;
  };

  const close = (week: StreakWeek) => {
    if (week.status !== 'open') return;
    if (run > 0 && banked > 0) {
      week.status = 'banked';
      banked -= 1;
    } else {
      week.status = 'short';
      run = 0;
      banked = 0;
    }
  };

  /** The week starting `start`, every week before it closed. */
  const reach = (start: string): StreakWeek => {
    let week = weeks.at(-1);
    if (!week) return open(start);
    while (week.start < start) {
      close(week);
      week = open(addIsoDays(week.start, 7));
    }
    return week;
  };

  return {
    /** A session that counts, trained on `day`. Says whether it hit its week's target. */
    count(day: string): { hit: boolean; week: StreakWeek; streak: number } {
      const week = reach(weekStartOf(day, weekStartsOn));
      week.sessions += 1;
      if (week.status === 'open' && week.sessions >= week.target) {
        week.status = 'hit';
        run += 1;
        best = Math.max(best, run);
        if (run % WEEKS_PER_BANKED === 0) banked = Math.min(MAX_BANKED, banked + 1);
        return { hit: true, week, streak: run };
      }
      return { hit: false, week, streak: run };
    },

    /** The best streak so far, for badges awarded along the way. */
    best: () => best,

    finish(today: string): Streak {
      const start = weekStartOf(today, weekStartsOn);
      const current = weeks.length > 0 ? reach(start) : null;
      const thisWeek =
        current && current.start === start
          ? { start, sessions: current.sessions, target: current.target, hit: current.status === 'hit' }
          : { start, sessions: 0, target: weekTarget(start, plans), hit: false };
      return { current: run, best, banked, thisWeek, weeks };
    },
  };
}
