/**
 * Plotting a training block onto real dates.
 *
 * A plan on its own is a week you repeat. This is what turns it into something
 * with a Tuesday: given a start date and which weekdays you train, it lays every
 * session of every week onto the calendar and works out what you have done,
 * what is today, and what you have missed.
 *
 * Pure — the query layer supplies the plan, its routines and the workouts.
 */
import type { Plan, Workout } from '@/db/schema';
import { weekModifier, type WeekModifier } from './programmes/block';

export type SessionStatus = 'done' | 'today' | 'upcoming' | 'missed';

export interface ScheduledSession {
  /** ISO date only, YYYY-MM-DD. */
  date: string;
  week: number;
  /** Index into the plan's routine_ids — which day of the weekly rotation. */
  sessionIndex: number;
  routineId: string | undefined;
  name: string;
  status: SessionStatus;
  /** The workout that satisfied this slot, if it has been trained. */
  workoutId?: string;
  modifier: WeekModifier;
}

/** ISO date-only string for a Date, in local time rather than UTC. */
function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The first calendar date on or after `from` that falls on one of `weekdays`.
 * Used to anchor week 1 rather than assuming the block starts on a training day.
 */
function firstTrainingDate(from: Date, weekdays: number[]): Date {
  if (weekdays.length === 0) return from;
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(from, offset);
    if (weekdays.includes(candidate.getDay())) return candidate;
  }
  return from;
}

export interface BuildScheduleInput {
  plan: Plan;
  /** Routine names by id, so each slot can be labelled. */
  routineNames: Map<string, string>;
  /** Every workout belonging to this plan. */
  workouts: Workout[];
  /** Defaults to now. Injected so the status logic is testable. */
  today?: Date;
}

/**
 * Every session of the block, in date order.
 *
 * Completion is matched on `plan_week` and `plan_session_index` rather than on
 * the date, so training Tuesday's session on Wednesday still ticks Tuesday off
 * instead of leaving a hole and inventing an extra workout.
 */
export function buildSchedule(input: BuildScheduleInput): ScheduledSession[] {
  const { plan, routineNames, workouts } = input;
  const today = input.today ?? new Date();
  const todayIso = localIsoDate(today);

  const weekdays = [...plan.training_days].sort((a, b) => a - b);
  if (weekdays.length === 0) return [];

  const done = new Map<string, Workout>();
  for (const workout of workouts) {
    if (workout.deleted_at !== null) continue;
    if (workout.plan_id !== plan.id) continue;
    if (workout.plan_week === null || workout.plan_session_index === null) continue;
    done.set(`${workout.plan_week}:${workout.plan_session_index}`, workout);
  }

  const startDate = new Date(plan.started_at);
  const startIso = localIsoDate(startDate);
  const start = firstTrainingDate(startDate, weekdays);
  // Anchor to the start of that week so week 1 covers the whole calendar week.
  const weekOneAnchor = addDays(start, -((start.getDay() - weekdays[0]! + 7) % 7));

  const sessions: ScheduledSession[] = [];

  for (let week = 1; week <= plan.block_weeks; week += 1) {
    const modifier = weekModifier(week, plan.block_weeks);

    weekdays.forEach((weekday, sessionIndex) => {
      const offsetFromAnchor = (weekday - weekOneAnchor.getDay() + 7) % 7;
      const date = addDays(weekOneAnchor, (week - 1) * 7 + offsetFromAnchor);
      const iso = localIsoDate(date);

      // A block started on Wednesday has no Monday session. Without this, the
      // day you create a plan it already shows a missed workout.
      if (iso < startIso && !done.has(`${week}:${sessionIndex}`)) return;

      const workout = done.get(`${week}:${sessionIndex}`);
      const routineId = plan.routine_ids[sessionIndex];

      let status: SessionStatus;
      if (workout) status = 'done';
      else if (iso === todayIso) status = 'today';
      else if (iso < todayIso) status = 'missed';
      else status = 'upcoming';

      sessions.push({
        date: iso,
        week,
        sessionIndex,
        routineId,
        name: routineId ? (routineNames.get(routineId) ?? `Day ${sessionIndex + 1}`) : `Day ${sessionIndex + 1}`,
        status,
        ...(workout ? { workoutId: workout.id } : {}),
        modifier,
      });
    });
  }

  return sessions.sort((a, b) => a.date.localeCompare(b.date));
}

/** The session to offer on the Train screen: today's, else the next one due. */
export function currentSession(schedule: ScheduledSession[]): ScheduledSession | null {
  return (
    schedule.find((session) => session.status === 'today') ??
    schedule.find((session) => session.status === 'upcoming') ??
    schedule.filter((session) => session.status === 'missed').at(-1) ??
    null
  );
}

/** Which block week the plan is actually in, from what has been trained. */
export function currentWeek(schedule: ScheduledSession[]): number {
  return currentSession(schedule)?.week ?? schedule.at(-1)?.week ?? 1;
}

export interface BlockProgress {
  done: number;
  missed: number;
  total: number;
  /** Completed as a fraction of sessions that have come due. */
  adherence: number;
}

export function blockProgress(schedule: ScheduledSession[]): BlockProgress {
  const done = schedule.filter((session) => session.status === 'done').length;
  const missed = schedule.filter((session) => session.status === 'missed').length;
  const due = done + missed;
  return {
    done,
    missed,
    total: schedule.length,
    adherence: due === 0 ? 1 : done / due,
  };
}

/**
 * Has the block run its course?
 *
 * True when nothing is left to train: no session is today, and none is still
 * upcoming. Missed sessions do not hold a block open — a week you skipped in
 * week two is not a reason to keep week five running in March.
 *
 * An empty schedule is not complete. A plan whose training days were cleared
 * would otherwise report itself finished the moment it was made.
 */
export function isBlockComplete(schedule: ScheduledSession[]): boolean {
  if (schedule.length === 0) return false;
  return !schedule.some(
    (session) => session.status === 'today' || session.status === 'upcoming',
  );
}

/** One week of a block, with its sessions, for the expanded plan view. */
export interface WeekSummary {
  week: number;
  modifier: WeekModifier;
  sessions: ScheduledSession[];
  done: number;
  /** True for the week the next unfinished session falls in. */
  isCurrent: boolean;
}

/**
 * The whole block, week by week.
 *
 * Every week is present even when it holds no sessions — a block started
 * mid-week drops the days before the start date, and a reader counting
 * "week 3 of 5" needs the gap to still be week 3 rather than silently
 * renumbering the weeks after it.
 */
export function groupByWeek(
  schedule: ScheduledSession[],
  totalWeeks: number,
  currentWeek?: number,
): WeekSummary[] {
  const total = Math.max(1, Math.round(totalWeeks));

  return Array.from({ length: total }, (_unused, index) => {
    const week = index + 1;
    const sessions = schedule
      .filter((session) => session.week === week)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      week,
      modifier: weekModifier(week, total),
      sessions,
      done: sessions.filter((session) => session.status === 'done').length,
      isCurrent: week === currentWeek,
    };
  });
}

/** The seven dates of the week containing `date`, for the week strip. */
export function weekStrip(date: Date, weekStartsOn = 1): Date[] {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  const first = addDays(date, -offset);
  return Array.from({ length: 7 }, (_unused, index) => addDays(first, index));
}

export { localIsoDate };
