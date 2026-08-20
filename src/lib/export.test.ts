import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, ImportError, buildExport, exportFilename, parseImport, toCsv, type ExportTables } from './export';
import { SCHEMA_VERSION } from '@/db/schema';
import { makeDropSet, makeExercise, makeSet, makeWorkout } from '@/domain/testFactories';
import type { Workout, WorkoutExercise } from '@/db/schema';

const sync = {
  user_id: null,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  deleted_at: null,
};

const workout: Workout = makeWorkout({
  // Pinned: workoutExercise below joins to this id.
  id: 'w1',
  bodyweight_kg: 82.5,
  readiness: 'normal',
  notes: 'Felt strong, back a bit tight',
});

const exercise = makeExercise({ name: 'Barbell Squat', secondary_muscles: [] });

const workoutExercise: WorkoutExercise = {
  id: 'we1',
  workout_id: 'w1',
  exercise_id: exercise.id,
  position: 0,
  superset_group: null,
  technique: 'drop_set',
  notes: null,
  rest_seconds: null,
  tempo: null,
  ...sync,
};

function tablesWith(sets: ExportTables['sets']): ExportTables {
  return {
    exercises: [exercise],
    gyms: [],
    routines: [],
    routine_exercises: [],
    workouts: [workout],
    workout_exercises: [workoutExercise],
    sets,
    plans: [],
    body_metrics: [],
    settings: [],
  };
}

describe('JSON export', () => {
  it('stamps the format and schema version', () => {
    const result = buildExport(tablesWith([]), '2026-08-18T09:00:00.000Z');
    expect(result.format).toBe(EXPORT_FORMAT);
    expect(result.schema_version).toBe(SCHEMA_VERSION);
    expect(result.exported_at).toBe('2026-08-18T09:00:00.000Z');
  });

  it('round trips exactly', () => {
    const sets = [makeSet({ workout_exercise_id: 'we1', weight_kg: 100, reps: 5 })];
    const original = buildExport(tablesWith(sets), '2026-08-18T09:00:00.000Z');
    const restored = parseImport(JSON.stringify(original));
    expect(restored.tables).toEqual(original.tables);
  });

  it('names the file by date', () => {
    expect(exportFilename('json', new Date('2026-08-18T09:00:00.000Z'))).toBe(
      'gymgo-backup-2026-08-18.json',
    );
  });
});

describe('import validation', () => {
  it('rejects a file that is not JSON', () => {
    expect(() => parseImport('not json at all')).toThrow(ImportError);
  });

  it('rejects a JSON file that is not a GymGo backup', () => {
    expect(() => parseImport('{"hello":"world"}')).toThrow(/not exported by GymGo/);
  });

  it('refuses a backup from a newer schema rather than mangling it', () => {
    const future = JSON.stringify({
      format: EXPORT_FORMAT,
      schema_version: SCHEMA_VERSION + 5,
      exported_at: '',
      tables: {},
    });
    expect(() => parseImport(future)).toThrow(/newer version of GymGo/);
  });

  it('rejects a malformed table rather than importing part of it', () => {
    const broken = JSON.stringify({
      format: EXPORT_FORMAT,
      schema_version: SCHEMA_VERSION,
      exported_at: '',
      tables: { sets: 'nope' },
    });
    expect(() => parseImport(broken)).toThrow(/"sets" section/);
  });

  it('tolerates a backup missing a table, restoring it empty', () => {
    const partial = JSON.stringify({
      format: EXPORT_FORMAT,
      schema_version: SCHEMA_VERSION,
      exported_at: '',
      tables: { workouts: [workout] },
    });
    const result = parseImport(partial);
    expect(result.tables.workouts).toHaveLength(1);
    expect(result.tables.body_metrics).toEqual([]);
  });
});

describe('CSV export', () => {
  const { parent, children } = makeDropSet(
    { workout_exercise_id: 'we1', weight_kg: 100, reps: 5, set_index: 0 },
    [60],
  );
  const csv = toCsv(tablesWith([parent, ...children]));
  const lines = csv.trim().split('\r\n');

  it('writes a header and one row per completed set', () => {
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('exercise_name');
    expect(lines[0]).toContain('is_child_set');
  });

  it('flattens the workout context onto every row', () => {
    expect(lines[1]).toContain('Barbell Squat');
    expect(lines[1]).toContain('squat');
    expect(lines[1]).toContain('82.5');
  });

  it('marks child sets so a spreadsheet can exclude them from records', () => {
    expect(lines[1]).toContain(',false,');
    expect(lines[2]).toContain(',true,');
  });

  it('gives no 1RM estimate for a child set, since a drop set is not a max', () => {
    const parentCells = lines[1]!.split(',');
    const childCells = lines[2]!.split(',');
    const index = lines[0]!.split(',').indexOf('estimated_1rm_kg');
    expect(Number(parentCells[index])).toBeCloseTo(116.7, 1);
    expect(childCells[index]).toBe('');
  });

  it('quotes values containing commas so the file stays parseable', () => {
    const withComma = toCsv(tablesWith([makeSet({ workout_exercise_id: 'we1' })]));
    expect(withComma).toContain('"Felt strong, back a bit tight"');
  });

  it('excludes sets that were never completed', () => {
    const planned = makeSet({ workout_exercise_id: 'we1', completed: false });
    expect(toCsv(tablesWith([planned])).trim().split('\r\n')).toHaveLength(1);
  });
});
