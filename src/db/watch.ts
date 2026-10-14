/**
 * The database side of the watch: everything the phone sends it, and applying
 * what the watch sends back. The protocol is docs/watch-protocol.md; the
 * shapes are src/domain/watchProtocol.ts.
 *
 * The rules that decide the list live in `src/domain/watch.ts`; this only
 * reads what they need out of Dexie. Applying goes through `mutations.ts`
 * like any tap, so `updated_at`, the outbox and the backup all work unchanged.
 */
import { db } from './db';
import { completeSetWith, discardWorkout, finishWorkout, planRoutineStart, replayWatchStart } from './mutations';
import {
  composeWorkout,
  composeWorkoutRows,
  exerciseSessions,
  planScheduleFor,
  sessionPreview,
  suggestionFor,
  type WorkoutView,
  type WorkoutExerciseView,
} from './queries';
import { SETTINGS_ID, type Workout } from './schema';
import { previousPerformance } from '@/domain/previousPerformance';
import { recordMarks } from '@/domain/prs';
import { restSecondsFor } from '@/domain/rest';
import { localIsoDate, weekStrip, type ScheduledSession } from '@/domain/schedule';
import { parseStartLayout, rowsFromLayout, type StartLayout } from '@/domain/startLayout';
import { sessionStations } from '@/domain/supersets';
import { buildWatchSnapshot, type WatchEntryInput, type WatchSnapshot } from '@/domain/watch';
import {
  WATCH_PROTOCOL_VERSION,
  type WatchContext,
  type WatchEvent,
  type WatchHome,
  type WatchReady,
  type WatchWeekDay,
} from '@/domain/watchProtocol';
import { nowIso } from '@/lib/dates';

/** A station's name and outline, as the phone's rest screen words them. */
export type DescribeStation = (entries: readonly WorkoutExerciseView[]) => { name: string; outline: string };

interface SnapshotOptions {
  /** The rest for a lift with none of its own. */
  defaultRest?: number;
  /** The session's name, as Today shows it. */
  title?: string;
  /** Defaults to now. */
  sentAt?: string;
}

/**
 * The list for a workout's view: the same whether the workout is in the
 * database or laid out in memory, so the ready session the watch is sent is
 * exactly what the replayed workout will show.
 */
async function snapshotFromView(
  view: WorkoutView,
  describe: DescribeStation,
  options: SnapshotOptions = {},
): Promise<WatchSnapshot> {
  const workoutId = view.workout.id;
  const entries: WatchEntryInput[] = [];
  for (const item of view.exercises) {
    const exercise = item.exercise;
    if (!exercise) continue;
    const history = (await exerciseSessions(exercise.id)).filter((session) => session.workout_id !== workoutId);
    entries.push({
      workoutExerciseId: item.workoutExercise.id,
      exerciseId: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment,
      technique: item.workoutExercise.technique,
      restSeconds: item.workoutExercise.rest_seconds ?? restSecondsFor(exercise) ?? options.defaultRest ?? 120,
      setupNote: exercise.setup_notes,
      loading: item.loading,
      sets: item.sets,
      suggestion: await suggestionFor(view.workout, exercise.id),
      previous: previousPerformance(history),
      priorMarks: recordMarks(history.flatMap((session) => session.sets)),
    });
  }

  // Only the exercises the snapshot kept: one whose exercise row is missing has no lift to show.
  const kept = view.exercises.filter((item) => item.exercise);
  const stations = sessionStations(kept.map((item) => item.workoutExercise)).map((members) => ({
    members,
    ...describe(members.map((index) => kept[index]!)),
  }));

  return buildWatchSnapshot({
    workoutId,
    title: options.title ?? 'Workout',
    startedAt: view.workout.started_at,
    sentAt: options.sentAt ?? nowIso(),
    entries,
    stations,
  });
}

/** The list for the workout under way, or null when there is none to send. */
export async function watchSnapshotFor(
  workoutId: string,
  describe: DescribeStation,
  options: SnapshotOptions = {},
): Promise<WatchSnapshot | null> {
  const view = await composeWorkout(workoutId);
  if (!view || view.workout.finished_at !== null) return null;
  return snapshotFromView(view, describe, options);
}

/** What a workout is called: its routine's session name ("Push"), or "Workout" for one started empty. */
async function workoutTitle(workout: Pick<Workout, 'routine_id'>): Promise<string> {
  const routine = workout.routine_id ? await db.routines.get(workout.routine_id) : undefined;
  return routine ? (routine.name.split(' — ').at(-1) ?? routine.name) : 'Workout';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The current calendar week as the phone's calendar strip shows it: each day
 * done, planned, today or a rest day, with the session's name. Where a day
 * holds two sessions, the one still to do is the one shown, as on the phone.
 */
function weekOf(schedule: readonly ScheduledSession[], today: Date, weekStartsOn: number): WatchWeekDay[] {
  const byDate = new Map<string, ScheduledSession>();
  for (const session of schedule) {
    const existing = byDate.get(session.date);
    if (!existing || (existing.status === 'done' && session.status !== 'done')) byDate.set(session.date, session);
  }
  return weekStrip(today, weekStartsOn).map((day) => {
    const date = localIsoDate(day);
    const session = byDate.get(date);
    return {
      date,
      weekday: WEEKDAYS[day.getDay()]!,
      state: !session ? 'rest' : session.status === 'done' ? 'done' : session.status === 'today' ? 'today' : 'planned',
      name: session?.name ?? null,
    };
  });
}

/**
 * The session `currentSession` offers, laid out as it would start
 * (`planRoutineStart`, nothing written), its snapshot built from those rows
 * by the same path as a real workout's, and the layout as an opaque string
 * for the watch to echo back when it starts it.
 *
 * The rows are filed under the slot the layout was offered for, in memory, so
 * the week's load (the deload's lighter numbers) reaches the suggestions.
 */
async function readySession(
  current: ScheduledSession,
  planId: string,
  today: Date,
  describe: DescribeStation,
  snapshot: Required<Pick<SnapshotOptions, 'sentAt'>> & SnapshotOptions,
): Promise<WatchReady | null> {
  if (!current.routineId) return null;
  const layout = await planRoutineStart(current.routineId, { today });
  if (!layout) return null;

  const { workout, workoutExercises, sets } = rowsFromLayout(
    layout,
    {
      planId: layout.slot?.planId ?? null,
      week: layout.slot?.week ?? null,
      sessionIndex: layout.slot?.sessionIndex ?? null,
    },
    { startedAt: snapshot.sentAt, now: snapshot.sentAt, readiness: null },
  );
  const view = await composeWorkoutRows(workout, workoutExercises, sets);
  const preview = await sessionPreview(current.routineId, current.modifier);

  return {
    key: `${planId}:${current.week}:${current.sessionIndex}`,
    routineId: current.routineId,
    name: current.name,
    date: current.date,
    status: current.status === 'today' ? 'today' : 'upcoming',
    movedFrom: current.movedFrom,
    week: { week: current.modifier.week, totalWeeks: current.modifier.totalWeeks, label: current.modifier.label },
    minutes: preview.minutes,
    exercises: preview.items.map((item) => ({
      name: item.name,
      kit: item.kit,
      work: `${item.sets} × ${item.reps}`,
      badge: item.badge,
      superset: item.superset,
    })),
    layout: JSON.stringify(layout),
    snapshot: await snapshotFromView(view, describe, { ...snapshot, title: await workoutTitle(workout) }),
  };
}

/**
 * Everything the phone sends the watch, built whole every time: the workout
 * open on the phone, and what the watch shows when none is running.
 *
 * `today` is the phone's day (any time on it). Workouts that ended on the
 * phone in the last 24 hours are listed in `closed`, which is how Finish and
 * Discard on the phone reach the watch.
 */
export async function watchContextFor(
  today: Date,
  describe: DescribeStation,
  options: { phoneClaim: { workoutId: string; at: string } | null; settings: { sound: boolean; vibrate: boolean } },
): Promise<WatchContext> {
  const sentAt = nowIso();
  const now = Date.parse(sentAt);
  const todayIso = localIsoDate(today);
  const stored = await db.settings.get(SETTINGS_ID);
  const snapshotOptions = { sentAt, defaultRest: stored?.default_rest_seconds };

  const workouts = await db.workouts.toArray();
  // More than one open should not happen; if it does, the newest is the one in hand.
  const open = workouts
    .filter((workout) => workout.deleted_at === null && workout.finished_at === null)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];

  const live = open
    ? await watchSnapshotFor(open.id, describe, { ...snapshotOptions, title: await workoutTitle(open) })
    : null;

  const doneToday: WatchHome['doneToday'] = [];
  for (const workout of workouts
    .filter(
      (candidate) =>
        candidate.deleted_at === null &&
        candidate.finished_at !== null &&
        localIsoDate(new Date(candidate.started_at)) === todayIso,
    )
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
    doneToday.push({ workoutId: workout.id, name: await workoutTitle(workout) });
  }

  // Finished, or thrown away after being started, in the last day. A
  // finished workout deleted later from history still ended as a finish.
  const recent = (iso: string | null): iso is string => iso !== null && now - Date.parse(iso) <= DAY_MS;
  const closed: WatchHome['closed'] = workouts
    .flatMap((workout): WatchHome['closed'] => {
      if (recent(workout.finished_at)) return [{ workoutId: workout.id, how: 'finished', at: workout.finished_at }];
      if (workout.finished_at === null && recent(workout.deleted_at)) {
        return [{ workoutId: workout.id, how: 'discarded', at: workout.deleted_at }];
      }
      return [];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const planned = await planScheduleFor(today);
  const ready =
    !open && planned?.current
      ? await readySession(planned.current, planned.plan.id, today, describe, snapshotOptions)
      : null;

  const state: WatchHome['state'] = open
    ? 'running'
    : !planned
      ? 'noPlan'
      : ready
        ? 'ready'
        : planned.current
          ? // A session is due but cannot be laid out: its routine is gone.
            // Nothing can start it, so the watch says so as it does with no plan.
            'noPlan'
          : 'blockDone';

  return {
    v: WATCH_PROTOCOL_VERSION,
    sentAt,
    live,
    home: {
      today: todayIso,
      state,
      doneToday,
      closed,
      ready,
      week: planned ? weekOf(planned.schedule, today, stored?.week_starts_on ?? 1) : [],
    },
    phoneClaim: options.phoneClaim,
    settings: options.settings,
  };
}

/** What the watch sends: the contract is in src/domain/watchProtocol.ts. */
export type { WatchEvent } from '@/domain/watchProtocol';

/**
 * What became of one event. `deferred` waits in the inbox: its workout has
 * not arrived yet.
 */
export type WatchEventOutcome = 'applied' | 'skipped' | 'deferred';

/** How long an event that cannot be applied yet is kept trying, by its own time. */
export const WATCH_EVENT_TTL_MS = 7 * DAY_MS;

interface ApplyContext {
  /** Open workouts a start must not discard as empty: the batch has events for them. */
  keepOpen?: ReadonlySet<string>;
  /** Set events this batch has already dealt with, which a finish's copies skip. */
  handled?: ReadonlySet<string>;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

async function applyCompleteSet(event: WatchEvent): Promise<WatchEventOutcome> {
  const workout = await db.workouts.get(event.workoutId);
  // Its start has not been applied yet: a quick copy can overtake the queued one.
  if (!workout) return 'deferred';
  if (workout.deleted_at !== null || workout.finished_at !== null) return 'skipped';
  // Malformed: retrying cannot mend it.
  if (!event.setId || !isNumber(event.weight) || !isNumber(event.reps) || Number.isNaN(Date.parse(event.at))) {
    return 'skipped';
  }

  const set = await db.sets.get(event.setId);
  if (!set || set.deleted_at !== null) return 'skipped';
  const workoutExercise = await db.workout_exercises.get(set.workout_exercise_id);
  if (!workoutExercise || workoutExercise.workout_id !== event.workoutId || workoutExercise.deleted_at !== null) {
    return 'skipped';
  }
  // The same set logged on both: the later time wins, as everywhere else. An
  // equal time is this very event applied before.
  if (set.completed && set.completed_at && Date.parse(set.completed_at) >= Date.parse(event.at)) return 'skipped';
  await completeSetWith(event.setId, { weight_kg: event.weight, reps: event.reps }, { completedAt: event.at });
  return 'applied';
}

async function hasLoggedSets(workoutId: string): Promise<boolean> {
  const rows = await db.workout_exercises.where({ workout_id: workoutId }).toArray();
  if (rows.length === 0) return false;
  const sets = await db.sets.where('workout_exercise_id').anyOf(rows.map((row) => row.id)).toArray();
  return sets.some((set) => set.completed && set.deleted_at === null);
}

/**
 * Applies one event from the watch, as the same mutation a tap would make.
 *
 * Safe to apply twice: an event carries its own ID, and the native inbox
 * drops one it has applied. Beyond that, a set the phone has since deleted,
 * or a workout already finished or discarded, skips rather than throws: the
 * watch was out of touch, and neither may be written to. An event for a
 * workout the phone does not have yet is deferred: its start is on its way.
 */
export async function applyWatchEvent(event: WatchEvent, context: ApplyContext = {}): Promise<WatchEventOutcome> {
  switch (event.kind) {
    case 'startWorkout': {
      let layout: StartLayout | null = null;
      try {
        layout = event.layout ? parseStartLayout(JSON.parse(event.layout)) : null;
      } catch {
        layout = null;
      }
      if (!layout || layout.workoutId !== event.workoutId || (event.routineId && event.routineId !== layout.routineId)) {
        // Only ever made by this phone, so a bad one is a bug; retrying cannot mend it.
        console.warn('GymGo: a start from the watch with an unreadable layout', event);
        return 'skipped';
      }
      return replayWatchStart(layout, event.at, { keepOpen: context.keepOpen });
    }
    case 'completeSet':
      return applyCompleteSet(event);
    case 'skipRest':
      // The rest runs on the watch while it runs the session. Nothing to write.
      return 'applied';
    case 'finish': {
      const workout = await db.workouts.get(event.workoutId);
      if (!workout) return 'deferred';
      if (workout.deleted_at !== null || workout.finished_at !== null) return 'skipped';
      // The sets the watch had not had confirmed, first, so a Finish that
      // overtook its last sets cannot tidy them away.
      const seen = new Set(context.handled ?? []);
      for (const set of event.sets ?? []) {
        if (set.kind !== 'completeSet' || set.workoutId !== event.workoutId || seen.has(set.id)) continue;
        seen.add(set.id);
        await applyCompleteSet(set);
      }
      // Stamped when Finish was pressed on the wrist, not when the phone was opened.
      await finishWorkout(event.workoutId, { finishedAt: event.at });
      return 'applied';
    }
    case 'discard': {
      const workout = await db.workouts.get(event.workoutId);
      if (!workout) return 'deferred';
      if (workout.deleted_at !== null || workout.finished_at !== null) return 'skipped';
      // The watch offers Discard only before its first set. Should the phone
      // have logged sets meanwhile, they are not thrown away from the wrist.
      if (await hasLoggedSets(event.workoutId)) return 'skipped';
      await discardWorkout(event.workoutId, { deletedAt: event.at });
      return 'applied';
    }
    default:
      return 'skipped';
  }
}

export interface WatchDrainResult {
  /** Event IDs to acknowledge: applied, or skipped for good. */
  acknowledge: string[];
  /** Left in the inbox for the next drain: deferred, or threw. */
  keep: string[];
  /** Workouts a `finish` event finished, so the caller writes the phone's snapshot. */
  finished: string[];
}

const RANK: Record<string, number> = { startWorkout: 0, finish: 2 };

/**
 * Applies a batch from the inbox: starts first, so a set can find its
 * workout; then everything else by when it happened on the wrist; then
 * finishes, so a set logged on the wrist is never tidied away by a Finish in
 * the same batch.
 *
 * An event that throws is not acknowledged and is tried again next drain, as
 * is one deferred; either is dropped once it is more than seven days old by
 * its own time. If a start throws, every event for that workout waits with it.
 */
export async function applyWatchEvents(events: readonly WatchEvent[], now: Date = new Date()): Promise<WatchDrainResult> {
  const acknowledge = new Set<string>();
  const keep = new Set<string>();
  const finished: string[] = [];

  // Each ID once: the inbox may hold both copies of an event.
  const unique = new Map<string, WatchEvent>();
  for (const event of events) {
    if (typeof event?.id !== 'string' || event.id === '') continue;
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  const time = (event: WatchEvent) => Date.parse(event.at);
  const ordered = [...unique.values()]
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        (RANK[a.event.kind] ?? 1) - (RANK[b.event.kind] ?? 1) ||
        (time(a.event) || 0) - (time(b.event) || 0) ||
        a.index - b.index,
    )
    .map(({ event }) => event);

  // The watch's own workouts: a start never discards one of these as empty,
  // because their sets are in this batch.
  const keepOpen = new Set(ordered.filter((event) => event.kind !== 'startWorkout').map((event) => event.workoutId));
  const failedStarts = new Set<string>();
  const handled = new Set<string>();

  const hold = (event: WatchEvent, why: string) => {
    if (now.getTime() - time(event) > WATCH_EVENT_TTL_MS) {
      console.warn(`GymGo: dropping a watch event ${why} for more than seven days`, event);
      acknowledge.add(event.id);
    } else {
      keep.add(event.id);
    }
  };

  for (const event of ordered) {
    if (Number.isNaN(time(event)) || typeof event.workoutId !== 'string') {
      console.warn('GymGo: a watch event that cannot be read', event);
      acknowledge.add(event.id);
      continue;
    }
    if (failedStarts.has(event.workoutId)) {
      hold(event, 'waiting on its start');
      continue;
    }
    try {
      const outcome = await applyWatchEvent(event, { keepOpen, handled });
      if (outcome === 'deferred') {
        hold(event, 'waiting on its workout');
        continue;
      }
      acknowledge.add(event.id);
      if (event.kind === 'completeSet') handled.add(event.id);
      if (event.kind === 'finish') {
        // Its copies of the sets were dealt with too, so the watch can forget them.
        for (const set of event.sets ?? []) if (typeof set?.id === 'string') acknowledge.add(set.id);
        if (outcome === 'applied' && !finished.includes(event.workoutId)) finished.push(event.workoutId);
      }
    } catch (cause) {
      console.warn('GymGo: could not apply a watch event', event, cause);
      if (event.kind === 'startWorkout') failedStarts.add(event.workoutId);
      hold(event, 'failing');
    }
  }

  for (const id of acknowledge) keep.delete(id);
  return { acknowledge: [...acknowledge], keep: [...keep], finished };
}
