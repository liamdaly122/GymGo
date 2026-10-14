/**
 * Starting a workout from a routine, split in two: laying it out, and the
 * rows that layout becomes.
 *
 * The copy is the whole point of starting from a routine: the workout holds
 * its own rows, never a live reference, which is what makes editing a routine
 * afterwards unable to change a session already performed (CLAUDE.md, rule 2).
 * That copy used to live inside `startWorkoutFromRoutine`. It lives here now,
 * unchanged, so that it can run without writing anything.
 *
 * That is what lets a session start on the watch. The phone lays the next
 * session out in advance, with real IDs, and sends it; the watch runs it and
 * echoes the layout back in its start event; and the phone writes exactly
 * those rows when its inbox drains (`replayWatchStart`). A layout carried in
 * the event cannot drift: if the routine was edited in between, the watch's
 * sets still land on the rows the watch ran.
 *
 * Pure. The database layer reads the routine and writes the rows.
 */
import type { RoutineExercise, Workout, WorkoutExercise, WorkoutSet } from '@/db/schema';
import { setsForWeek, type WeekModifier } from './programmes/block';
import { schemeSetTypes } from './schemes';
import { SET_TYPES, TECHNIQUES, type Readiness, type SetType, type Technique } from './types';

/** The block slot a session was laid out for. */
export interface StartSlot {
  planId: string;
  week: number;
  sessionIndex: number;
}

export interface StartLayoutSet {
  id: string;
  type: SetType;
}

export interface StartLayoutExercise {
  /** The workout exercise row's ID. */
  id: string;
  /** The library exercise. */
  exerciseId: string;
  supersetGroup: string | null;
  technique: Technique;
  /** A rest the lifter typed into the routine, copied; null means the lift's own. */
  restSeconds: number | null;
  tempo: string | null;
  sets: StartLayoutSet[];
}

export interface StartLayout {
  workoutId: string;
  routineId: string;
  gymId: string | null;
  /** The slot it was laid out for, or null outside a running block. */
  slot: StartSlot | null;
  exercises: StartLayoutExercise[];
}

/** Where the workout is filed: the slot it fills, or the plan alone, or nothing. */
export interface StartFiling {
  planId: string | null;
  week: number | null;
  sessionIndex: number | null;
}

/**
 * Lays a routine out as a session, with an ID for every row it will become.
 *
 * Exactly what starting a routine has always done: the live rows in order;
 * at least one set each; a block week reshapes the count (week 3 adds two,
 * the deload halves them); a pyramid lays out one working top set and back-off
 * sets around it; the rest and tempo come across as prescribed.
 */
export function layoutFromRoutine(
  rows: readonly RoutineExercise[],
  header: Omit<StartLayout, 'exercises' | 'workoutId'>,
  modifier: WeekModifier | null,
  makeId: () => string,
): StartLayout {
  const workoutId = makeId();
  const ordered = rows.filter((row) => row.deleted_at === null).sort((a, b) => a.position - b.position);
  return {
    workoutId,
    routineId: header.routineId,
    gymId: header.gymId,
    slot: header.slot ? { ...header.slot } : null,
    exercises: ordered.map((row) => {
      const base = Math.max(1, row.target_sets ?? 1);
      const count = modifier ? setsForWeek(base, modifier) : base;
      const types = schemeSetTypes(row.technique, count);
      return {
        id: makeId(),
        exerciseId: row.exercise_id,
        supersetGroup: row.superset_group,
        technique: row.technique,
        // Copied, not referenced: editing the routine's rest later must not
        // change what this session was performed under.
        restSeconds: row.rest_seconds,
        tempo: row.tempo,
        sets: Array.from({ length: count }, (_unused, index) => ({
          id: makeId(),
          type: types[index] ?? ('working' as const),
        })),
      };
    }),
  };
}

/**
 * The rows a layout becomes: the workout, its exercises and their sets, empty
 * and unticked.
 *
 * The routine says "3 sets of 5 to 8"; starting it puts three rows on screen
 * ready to type into. They count for nothing until ticked, and finishWorkout
 * discards any left untouched, so an abandoned plan never becomes fake history.
 */
export function rowsFromLayout(
  layout: StartLayout,
  filing: StartFiling,
  at: { startedAt: string; now: string; readiness: Readiness | null },
): { workout: Workout; workoutExercises: WorkoutExercise[]; sets: WorkoutSet[] } {
  const sync = () => ({ user_id: null, created_at: at.now, updated_at: at.now, deleted_at: null });

  const workout: Workout = {
    id: layout.workoutId,
    routine_id: layout.routineId,
    plan_id: filing.planId,
    plan_week: filing.week,
    plan_session_index: filing.sessionIndex,
    // Recorded so weight suggestions round to the plates that were actually
    // there, rather than whichever gym happens to be default when you look back.
    gym_id: layout.gymId,
    started_at: at.startedAt,
    finished_at: null,
    bodyweight_kg: null,
    readiness: at.readiness,
    notes: null,
    ...sync(),
  };

  const workoutExercises: WorkoutExercise[] = layout.exercises.map((entry, position) => ({
    id: entry.id,
    workout_id: workout.id,
    exercise_id: entry.exerciseId,
    position,
    superset_group: entry.supersetGroup,
    technique: entry.technique,
    notes: null,
    rest_seconds: entry.restSeconds,
    tempo: entry.tempo,
    ...sync(),
  }));

  const sets: WorkoutSet[] = layout.exercises.flatMap((entry) =>
    entry.sets.map((set, setIndex) => ({
      id: set.id,
      workout_exercise_id: entry.id,
      parent_set_id: null,
      set_index: setIndex,
      type: set.type,
      weight_kg: 0,
      reps: 0,
      /*
       * Null, always. `rir` means "what the lifter assessed", and nothing else.
       *
       * This used to be seeded with the block week's PRESCRIBED reps-in-reserve,
       * a number nobody had judged, and the progression engine read it back as
       * evidence. The target still reaches the lifter, from
       * `routine_exercises.target_rir` and `weekModifier.targetRir`, shown as a
       * target rather than pre-filled as an answer.
       */
      rir: null,
      is_amrap: false,
      completed: false,
      completed_at: null,
      ...sync(),
    })),
  );

  return { workout, workoutExercises, sets };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);
const isCount = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

/**
 * A layout echoed back by the watch, checked before anything is written from
 * it: every ID it minted is a UUID and appears once, and every set type and
 * technique is one the app knows. Null when anything is off.
 *
 * The watch never reads a layout, only echoes it, so a bad one means a bug
 * somewhere; refusing it is safer than writing half of it. Unknown fields are
 * left behind, and the result is a fresh copy.
 */
export function parseStartLayout(value: unknown): StartLayout | null {
  if (!isObject(value)) return null;
  const { workoutId, routineId, gymId, slot, exercises } = value;
  if (typeof workoutId !== 'string' || !UUID.test(workoutId)) return null;
  if (!isText(routineId) || !isTextOrNull(gymId)) return null;

  let parsedSlot: StartSlot | null = null;
  if (slot !== null) {
    if (!isObject(slot) || !isText(slot.planId) || !isCount(slot.week, 1) || !isCount(slot.sessionIndex, 0)) {
      return null;
    }
    parsedSlot = { planId: slot.planId, week: slot.week, sessionIndex: slot.sessionIndex };
  }

  if (!Array.isArray(exercises)) return null;
  const minted = new Set<string>([workoutId.toLowerCase()]);
  const mint = (id: unknown): id is string => {
    if (typeof id !== 'string' || !UUID.test(id) || minted.has(id.toLowerCase())) return false;
    minted.add(id.toLowerCase());
    return true;
  };

  const parsed: StartLayoutExercise[] = [];
  for (const entry of exercises) {
    if (!isObject(entry) || !mint(entry.id)) return null;
    const { exerciseId, supersetGroup, technique, restSeconds, tempo, sets } = entry;
    if (!isText(exerciseId) || !isTextOrNull(supersetGroup) || !isTextOrNull(tempo)) return null;
    if (typeof technique !== 'string' || !(TECHNIQUES as readonly string[]).includes(technique)) return null;
    const rest = restSeconds === null ? null : typeof restSeconds === 'number' ? restSeconds : Number.NaN;
    if (rest !== null && !(Number.isFinite(rest) && rest >= 0)) return null;
    if (!Array.isArray(sets)) return null;
    const parsedSets: StartLayoutSet[] = [];
    for (const set of sets) {
      if (!isObject(set) || !mint(set.id)) return null;
      if (typeof set.type !== 'string' || !(SET_TYPES as readonly string[]).includes(set.type)) return null;
      parsedSets.push({ id: set.id, type: set.type as SetType });
    }
    parsed.push({
      id: entry.id,
      exerciseId,
      supersetGroup,
      technique: technique as Technique,
      restSeconds: rest,
      tempo,
      sets: parsedSets,
    });
  }

  return { workoutId, routineId, gymId, slot: parsedSlot, exercises: parsed };
}
