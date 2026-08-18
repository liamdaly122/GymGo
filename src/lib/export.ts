/**
 * Export and import. Pure — the Dexie read and write live in src/db/backup.ts.
 *
 * The brief's requirement is plain: data must be exportable to JSON and CSV at
 * any time, and importable again. Until sync exists this is also the only
 * backup, so the JSON round trip has to be exact rather than lossy.
 */
import type {
  BodyMetric,
  Exercise,
  Gym,
  Plan,
  Routine,
  RoutineExercise,
  Settings,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/db/schema';
import { SCHEMA_VERSION } from '@/db/schema';
import { estimate1RMRounded } from '@/domain/epley';
import { isChildSet } from '@/domain/sets';

export const EXPORT_FORMAT = 'gymgo-export' as const;

export interface ExportTables {
  exercises: Exercise[];
  gyms: Gym[];
  routines: Routine[];
  routine_exercises: RoutineExercise[];
  workouts: Workout[];
  workout_exercises: WorkoutExercise[];
  sets: WorkoutSet[];
  plans: Plan[];
  body_metrics: BodyMetric[];
  settings: Settings[];
}

export interface GymGoExport {
  format: typeof EXPORT_FORMAT;
  schema_version: number;
  exported_at: string;
  tables: ExportTables;
}

export const EXPORT_TABLE_NAMES = [
  'exercises',
  'gyms',
  'routines',
  'routine_exercises',
  'workouts',
  'workout_exercises',
  'sets',
  'plans',
  'body_metrics',
  'settings',
] as const satisfies ReadonlyArray<keyof ExportTables>;

export function buildExport(tables: ExportTables, exportedAt: string): GymGoExport {
  return {
    format: EXPORT_FORMAT,
    schema_version: SCHEMA_VERSION,
    exported_at: exportedAt,
    tables,
  };
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Validates a file before anything is written.
 *
 * Import replaces the entire local database, so a malformed file must be
 * rejected up front rather than discovered halfway through the restore.
 */
export function parseImport(raw: string): GymGoExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ImportError('That file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ImportError('That file does not contain a GymGo backup.');
  }

  const candidate = parsed as Partial<GymGoExport>;
  if (candidate.format !== EXPORT_FORMAT) {
    throw new ImportError('That file was not exported by GymGo.');
  }
  if (typeof candidate.schema_version !== 'number') {
    throw new ImportError('That backup has no schema version.');
  }
  if (candidate.schema_version > SCHEMA_VERSION) {
    throw new ImportError(
      `That backup was made by a newer version of GymGo (schema ${candidate.schema_version}, ` +
        `this app understands ${SCHEMA_VERSION}). Update the app first.`,
    );
  }
  if (typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new ImportError('That backup has no data in it.');
  }

  const tables = candidate.tables as unknown as Record<string, unknown>;
  for (const name of EXPORT_TABLE_NAMES) {
    const value = tables[name];
    if (value !== undefined && !Array.isArray(value)) {
      throw new ImportError(`The "${name}" section of that backup is malformed.`);
    }
  }

  // Missing tables are tolerated and restored empty: an older backup simply
  // did not have them, which is not a reason to refuse the whole file.
  const normalised = Object.fromEntries(
    EXPORT_TABLE_NAMES.map((name) => [name, (tables[name] as unknown[] | undefined) ?? []]),
  ) as unknown as ExportTables;

  return {
    format: EXPORT_FORMAT,
    schema_version: candidate.schema_version,
    exported_at: typeof candidate.exported_at === 'string' ? candidate.exported_at : '',
    tables: normalised,
  };
}

const CSV_COLUMNS = [
  'workout_id',
  'workout_started_at',
  'workout_finished_at',
  'routine_name',
  'gym_name',
  'bodyweight_kg',
  'readiness',
  'exercise_name',
  'primary_muscle',
  'movement_pattern',
  'equipment',
  'is_compound',
  'technique',
  'set_index',
  'set_type',
  'is_child_set',
  'parent_set_id',
  'weight_kg',
  'reps',
  'rir',
  'is_amrap',
  'estimated_1rm_kg',
  'completed_at',
  'workout_notes',
] as const;

/** Escapes a value for CSV. Quotes anything containing a comma, quote or newline. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * One row per set, with all context flattened, structured for analysis in a
 * spreadsheet.
 *
 * Only completed sets are included: an untouched planned row is not something
 * that happened, and it would skew any total computed over the file.
 */
export function toCsv(tables: ExportTables): string {
  const exerciseById = new Map(tables.exercises.map((row) => [row.id, row]));
  const routineById = new Map(tables.routines.map((row) => [row.id, row]));
  const gymById = new Map(tables.gyms.map((row) => [row.id, row]));
  const workoutById = new Map(tables.workouts.map((row) => [row.id, row]));
  const workoutExerciseById = new Map(tables.workout_exercises.map((row) => [row.id, row]));

  const rows = tables.sets
    .filter((set) => set.deleted_at === null && set.completed)
    .map((set) => {
      const workoutExercise = workoutExerciseById.get(set.workout_exercise_id);
      const workout = workoutExercise ? workoutById.get(workoutExercise.workout_id) : undefined;
      const exercise = workoutExercise ? exerciseById.get(workoutExercise.exercise_id) : undefined;
      const routine = workout?.routine_id ? routineById.get(workout.routine_id) : undefined;
      const gym = workout?.gym_id ? gymById.get(workout.gym_id) : undefined;
      return { set, workoutExercise, workout, exercise, routine, gym };
    })
    .filter((row) => row.workout !== undefined && row.workout.deleted_at === null)
    .sort((a, b) => {
      const byDate =
        Date.parse(a.workout!.started_at) - Date.parse(b.workout!.started_at);
      if (byDate !== 0) return byDate;
      const byPosition = (a.workoutExercise?.position ?? 0) - (b.workoutExercise?.position ?? 0);
      if (byPosition !== 0) return byPosition;
      return a.set.set_index - b.set.set_index;
    });

  const lines = [CSV_COLUMNS.join(',')];

  for (const row of rows) {
    const { set, workout, workoutExercise, exercise, routine, gym } = row;
    lines.push(
      [
        workout!.id,
        workout!.started_at,
        workout!.finished_at,
        routine?.name,
        gym?.name,
        workout!.bodyweight_kg,
        workout!.readiness,
        exercise?.name,
        exercise?.primary_muscle,
        exercise?.movement_pattern,
        exercise?.equipment,
        exercise?.is_compound,
        workoutExercise?.technique,
        set.set_index,
        set.type,
        isChildSet(set),
        set.parent_set_id,
        set.weight_kg,
        set.reps,
        set.rir,
        set.is_amrap,
        // Child sets get no estimate: a drop set's low number is not a max.
        isChildSet(set) ? '' : estimate1RMRounded(set.weight_kg, set.reps),
        set.completed_at,
        workout!.notes,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** `gymgo-backup-2026-08-18.json` */
export function exportFilename(extension: 'json' | 'csv', now = new Date()): string {
  return `gymgo-backup-${now.toISOString().slice(0, 10)}.${extension}`;
}
