/**
 * Plotting a training block onto real dates.
 *
 * A plan on its own is a week you repeat. This is what turns it into something
 * with a Tuesday: given a start date and which weekdays you train, it lays every
 * session of every week onto the calendar and works out what you have done,
 * what is today, and what is still to come.
 *
 * Nothing is ever missed. A session you do not train rolls forward a day at a
 * time until you do — see `buildSchedule` for the rule.
 *
 * Pure — the query layer supplies the plan, its routines and the workouts.
 */
import type { Plan, Workout } from '@/db/schema';
import { weekModifier, type WeekModifier } from './programmes/block';

/**
 * The block that is running: the latest live plan not yet finished. Only one
 * runs at a time, but an import or a sync can leave two open, and the newest
 * is the one being trained.
 *
 * With `routineId`, the running block that holds that routine — which is not
 * the routine's `generated_from_plan_id`: the next block runs the same
 * routines, and that field still names the block that first wrote them.
 */
export function runningPlan(plans: readonly Plan[], routineId?: string): Plan | null {
  const running = plans.filter(
    (plan) =>
      plan.deleted_at === null &&
      plan.completed_at === null &&
      (routineId === undefined || plan.routine_ids.includes(routineId)),
  );
  running.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return running[0] ?? null;
}

export type SessionStatus = 'done' | 'today' | 'upcoming';

export interface ScheduledSession {
  /**
   * Where the session sits now, ISO date only. For a done session, the day it
   * was actually trained; for one still to do, the day it has rolled to.
   */
  date: string;
  /** Where the plan originally put it. */
  plannedDate: string;
  /**
   * The planned date, when a session still to do has rolled past it — what the
   * screen says when it explains why Monday's workout is on a Tuesday.
   */
  movedFrom: string | null;
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

/** The ISO date after `iso`. Read at noon so a clock change cannot skip a day. */
function nextIsoDate(iso: string): string {
  return localIsoDate(addDays(new Date(`${iso}T12:00:00`), 1));
}

/** Whole days from one ISO date to another; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000,
  );
}

const latest = (...dates: string[]): string => dates.reduce((a, b) => (b > a ? b : a));

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
 * the date, so training Monday's session on a Wednesday ticks off Monday's
 * session instead of leaving a hole and inventing an extra workout.
 *
 * The rollover rule. A session you have trained sits on the day you trained it.
 * One still to do, taken in the order the plan runs them, sits on the latest of:
 *
 * - the day the plan put it on;
 * - today — or tomorrow, if a session of this plan was trained today;
 * - the day after the previous session still to do.
 *
 * So a missed Monday becomes today and keeps coming back until it is trained,
 * later sessions stay on their own days unless the rolled one lands on top of
 * them — then they are bumped a day, in order — and once you catch up the plan
 * is back on its usual days. Nothing is stored: the dates are worked out from
 * the plan, the workouts and the date, which is also why sessions missed before
 * this rule existed come back under it.
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

  // One session a day: once something from this plan has been trained today,
  // the next one waits for tomorrow rather than asking for a double.
  const trainedToday = [...done.values()].some(
    (workout) => localIsoDate(new Date(workout.started_at)) === todayIso,
  );
  const floor = trainedToday ? nextIsoDate(todayIso) : todayIso;

  const startDate = new Date(plan.started_at);
  const startIso = localIsoDate(startDate);
  const start = firstTrainingDate(startDate, weekdays);
  // Anchor to the start of that week so week 1 covers the whole calendar week.
  const weekOneAnchor = addDays(start, -((start.getDay() - weekdays[0]! + 7) % 7));

  const sessions: ScheduledSession[] = [];
  // Slots come out of these loops in the order the plan runs them, which is
  // also the order of their planned dates — the rollover walk depends on it.
  let previousToDo: string | null = null;

  for (let week = 1; week <= plan.block_weeks; week += 1) {
    const modifier = weekModifier(week, plan.block_weeks);

    weekdays.forEach((weekday, sessionIndex) => {
      const offsetFromAnchor = (weekday - weekOneAnchor.getDay() + 7) % 7;
      const plannedDate = localIsoDate(addDays(weekOneAnchor, (week - 1) * 7 + offsetFromAnchor));
      const workout = done.get(`${week}:${sessionIndex}`);

      // A block started on Wednesday has no Monday session. Without this, the
      // day you create a plan it already shows a workout to catch up on.
      if (plannedDate < startIso && !workout) return;

      let date: string;
      let status: SessionStatus;
      let movedFrom: string | null = null;

      if (workout) {
        date = localIsoDate(new Date(workout.started_at));
        status = 'done';
      } else {
        date = latest(plannedDate, floor, previousToDo ? nextIsoDate(previousToDo) : plannedDate);
        previousToDo = date;
        status = date === todayIso ? 'today' : 'upcoming';
        if (date > plannedDate) movedFrom = plannedDate;
      }

      const routineId = plan.routine_ids[sessionIndex];
      sessions.push({
        date,
        plannedDate,
        movedFrom,
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

  return sessions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.week - b.week || a.sessionIndex - b.sessionIndex,
  );
}

/**
 * The session to offer on the Train screen: today's, else the next one due.
 *
 * Nothing is ever behind today — a session not trained has already rolled onto
 * today — so the first session still to do is always the right answer, and
 * there is no "pick up the one you missed" case any more.
 */
export function currentSession(schedule: ScheduledSession[]): ScheduledSession | null {
  return (
    schedule.find((session) => session.status === 'today') ??
    schedule.find((session) => session.status === 'upcoming') ??
    null
  );
}

/** Which block week the plan is actually in, from what has been trained. */
export function currentWeek(schedule: ScheduledSession[]): number {
  return currentSession(schedule)?.week ?? schedule.at(-1)?.week ?? 1;
}

/**
 * The slot a workout started from this routine fills: the earliest one still to
 * do, wherever it has rolled to.
 *
 * Reading the week off "where the block is up to" instead could hand back a
 * week whose session for this routine was already trained, and the new workout
 * would then overwrite it. Null when every session for the routine is done, so
 * an extra workout never steals a slot.
 */
export function slotForRoutine(
  schedule: ScheduledSession[],
  routineId: string,
): ScheduledSession | null {
  return (
    schedule
      .filter((session) => session.status !== 'done' && session.routineId === routineId)
      .sort((a, b) => a.week - b.week || a.sessionIndex - b.sessionIndex)[0] ?? null
  );
}

export interface BlockProgress {
  done: number;
  total: number;
  /** The date of the block's last session, wherever it now sits. */
  endsOn: string | null;
  /**
   * How many days later than planned the block will finish, because sessions
   * rolled forward. Never negative: finishing early is just finishing.
   */
  daysBehind: number;
}

export function blockProgress(schedule: ScheduledSession[]): BlockProgress {
  const done = schedule.filter((session) => session.status === 'done').length;
  const last = schedule.at(-1);
  const plannedEnd = schedule.reduce<string | null>(
    (end, session) => (end === null || session.plannedDate > end ? session.plannedDate : end),
    null,
  );
  return {
    done,
    total: schedule.length,
    endsOn: last?.date ?? null,
    daysBehind: last && plannedEnd ? Math.max(0, daysBetween(plannedEnd, last.date)) : 0,
  };
}

/**
 * Has the block run its course?
 *
 * True when nothing is left to train: no session is today, and none is still
 * upcoming. Because a session not trained rolls forward rather than being
 * missed, that means every session has been done — a skipped week holds the
 * block open until it is made up. Ending a block early is a deliberate act,
 * not something the calendar does on your behalf.
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
