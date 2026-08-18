/**
 * Reads and writes the whole local database for export and import.
 *
 * Until sync exists this is the only backup route, so the restore has to be
 * all-or-nothing: a half-applied import would be worse than no import.
 */
import { db } from './db';
import {
  EXPORT_TABLE_NAMES,
  buildExport,
  parseImport,
  toCsv,
  type ExportTables,
  type GymGoExport,
} from '@/lib/export';
import { nowIso } from '@/lib/dates';

async function readAllTables(): Promise<ExportTables> {
  const [
    exercises, gyms, routines, routine_exercises, workouts,
    workout_exercises, sets, plans, body_metrics, settings,
  ] = await Promise.all([
    db.exercises.toArray(),
    db.gyms.toArray(),
    db.routines.toArray(),
    db.routine_exercises.toArray(),
    db.workouts.toArray(),
    db.workout_exercises.toArray(),
    db.sets.toArray(),
    db.plans.toArray(),
    db.body_metrics.toArray(),
    db.settings.toArray(),
  ]);

  // Soft-deleted rows are kept in the export on purpose: dropping them would
  // mean a restore could resurrect something deleted before the backup, and
  // would lose the tombstones sync needs.
  return {
    exercises, gyms, routines, routine_exercises, workouts,
    workout_exercises, sets, plans, body_metrics, settings,
  };
}

export async function exportAsJson(): Promise<GymGoExport> {
  return buildExport(await readAllTables(), nowIso());
}

export async function exportAsCsv(): Promise<string> {
  return toCsv(await readAllTables());
}

export interface ImportResult {
  /** Rows restored per table, INCLUDING soft-deleted tombstones. */
  counts: Record<string, number>;
  /**
   * Rows the user will actually see, per table. Tombstones are restored but
   * are not something to report back as "restored workouts".
   */
  live_counts: Record<string, number>;
  schema_version: number;
  exported_at: string;
}

/**
 * Replaces the entire local database with the contents of a backup.
 *
 * Validated first, then applied inside one transaction, so a bad file cannot
 * leave the database half-written. The outbox is cleared too: queued mutations
 * describe rows from a database that no longer exists.
 */
export async function importFromJson(raw: string): Promise<ImportResult> {
  const backup = parseImport(raw);

  const tables = [
    db.exercises, db.gyms, db.routines, db.routine_exercises, db.workouts,
    db.workout_exercises, db.sets, db.plans, db.body_metrics, db.settings,
    db.outbox,
  ];

  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()));

    await db.exercises.bulkAdd(backup.tables.exercises);
    await db.gyms.bulkAdd(backup.tables.gyms);
    await db.routines.bulkAdd(backup.tables.routines);
    await db.routine_exercises.bulkAdd(backup.tables.routine_exercises);
    await db.workouts.bulkAdd(backup.tables.workouts);
    await db.workout_exercises.bulkAdd(backup.tables.workout_exercises);
    await db.sets.bulkAdd(backup.tables.sets);
    await db.plans.bulkAdd(backup.tables.plans);
    await db.body_metrics.bulkAdd(backup.tables.body_metrics);
    await db.settings.bulkAdd(backup.tables.settings);
  });

  return {
    counts: Object.fromEntries(
      EXPORT_TABLE_NAMES.map((name) => [name, backup.tables[name].length]),
    ),
    live_counts: Object.fromEntries(
      EXPORT_TABLE_NAMES.map((name) => [
        name,
        (backup.tables[name] as Array<{ deleted_at?: string | null }>).filter(
          (row) => row.deleted_at === null || row.deleted_at === undefined,
        ).length,
      ]),
    ),
    schema_version: backup.schema_version,
    exported_at: backup.exported_at,
  };
}

/**
 * Hands a generated file to the browser.
 *
 * A blob URL rather than a data URL: iOS Safari truncates large data URLs, and
 * a full history export is not small.
 */
export function downloadFile(contents: string, filename: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so Safari has actually started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
