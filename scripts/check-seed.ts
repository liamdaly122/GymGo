/**
 * Validates the built seed database. Run by `npm run seed:check`.
 *
 * The brief makes `movement_pattern` mandatory for every exercise, because both
 * the workout generator and swap suggestions are built on it. A silently null
 * pattern would degrade those features rather than break them, which is exactly
 * the kind of fault that survives to production — so it fails the build here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const MOVEMENT_PATTERNS = new Set([
  'squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push',
  'horizontal_pull', 'vertical_pull', 'carry', 'core', 'isolation',
]);
const EQUIPMENT = new Set([
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands',
  'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
]);
const LEVELS = new Set(['beginner', 'intermediate', 'expert']);

type SeedExercise = Record<string, unknown> & { id: string; name: string };

const seed = JSON.parse(
  readFileSync(resolve(root, 'src/db/seed.data.json'), 'utf8'),
) as SeedExercise[];

const problems: string[] = [];
const seenIds = new Set<string>();
const seenSourceIds = new Set<string>();

for (const ex of seed) {
  const where = `${ex.name} (${ex.id})`;

  if (!MOVEMENT_PATTERNS.has(ex.movement_pattern as string)) {
    problems.push(`${where}: invalid movement_pattern ${JSON.stringify(ex.movement_pattern)}`);
  }
  if (!EQUIPMENT.has(ex.equipment as string)) {
    problems.push(`${where}: invalid equipment ${JSON.stringify(ex.equipment)}`);
  }
  if (!LEVELS.has(ex.experience_level as string)) {
    problems.push(`${where}: invalid experience_level ${JSON.stringify(ex.experience_level)}`);
  }
  if (typeof ex.name !== 'string' || ex.name.trim() === '') {
    problems.push(`${ex.id}: empty name`);
  }
  if (typeof ex.default_rest_seconds !== 'number' || (ex.default_rest_seconds as number) <= 0) {
    problems.push(`${where}: bad default_rest_seconds`);
  }
  const fatigue = ex.fatigue_cost as number;
  if (typeof fatigue !== 'number' || fatigue < 1 || fatigue > 5) {
    problems.push(`${where}: fatigue_cost out of range 1-5`);
  }
  if (seenIds.has(ex.id)) problems.push(`${where}: duplicate id`);
  seenIds.add(ex.id);

  const sourceId = ex.source_id as string;
  if (seenSourceIds.has(sourceId)) problems.push(`${where}: duplicate source_id ${sourceId}`);
  seenSourceIds.add(sourceId);
}

if (problems.length > 0) {
  console.error(`\nSeed check FAILED with ${problems.length} problem(s):\n`);
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  if (problems.length > 40) console.error(`  ...and ${problems.length - 40} more`);
  console.error('');
  process.exit(1);
}

console.log(`Seed check passed: ${seed.length} exercises, all fields valid.`);
