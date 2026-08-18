/**
 * Transforms the vendored free-exercise-db dump into the app's seed database.
 *
 *   data/exercises.raw.json  ->  src/db/seed.data.json
 *
 * Run with `npm run seed:build`. The output is committed, so the app never
 * fetches anything at runtime and the build works offline.
 *
 * The interesting work here is deriving `movement_pattern`, which the source
 * dataset does not carry. The brief makes that field load-bearing: the workout
 * generator builds sessions from patterns rather than named exercises, and swap
 * suggestions match on it when a rack is taken. So it must be populated for
 * every single row, and `npm run seed:check` enforces that.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

type RawExercise = {
  id: string;
  name: string;
  force: 'push' | 'pull' | 'static' | null;
  level: 'beginner' | 'intermediate' | 'expert';
  mechanic: 'compound' | 'isolation' | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
};

/**
 * Categories that represent loadable lifting. Stretching, cardio and
 * plyometrics are dropped: they have no honest movement pattern, and letting
 * them through would mean swap suggestions could offer a hamstring stretch as
 * an alternative to a squat.
 */
const LIFTING_CATEGORIES = new Set([
  'strength',
  'powerlifting',
  'olympic weightlifting',
  'strongman',
]);

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

const EQUIPMENT_MAP: Record<string, string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  bands: 'bands',
  'body only': 'bodyweight',
  'e-z curl bar': 'ez_bar',
  'exercise ball': 'exercise_ball',
  'medicine ball': 'medicine_ball',
  other: 'other',
};

/**
 * Hand corrections, keyed by the source dataset's slug.
 *
 * These are exercises the rules below cannot classify, almost always because
 * the source record has a null `force`. Corrections live here rather than in
 * the data file so they survive a refresh from upstream.
 */
const PATTERN_OVERRIDES: Record<string, string> = {
  Balance_Board: 'core',
  'Band_Assisted_Pull-Up': 'vertical_pull',
  Conans_Wheel: 'carry',
  'Push-Up_Wide': 'horizontal_push',
  Smith_Machine_Decline_Press: 'horizontal_push',
  // Band walk for the abductors, not a rowing movement.
  Monster_Walk: 'isolation',
  // A get-up is trunk work end to end, whichever style it finishes in.
  'Kettlebell_Turkish_Get-Up_(Squat_style)': 'core',
  Spider_Crawl: 'core',
};

const re = {
  carry: /\b(farmer|carry|carries|suitcase|yoke|conan|sled (push|drag)|bear crawl)/i,
  lunge: /\b(lunge|split squat|step.?up|bulgarian)/i,
  /**
   * Hip-extension family. Tested BEFORE squat so a Romanian deadlift cannot be
   * mistaken for a squat, and before the olympic rule so a front squat taken
   * with a clean grip stays a squat.
   */
  hinge: /\b(deadlift|good morning|hip thrust|glute bridge|hip bridge|hip lift|hip extension|kickback|romanian|kettlebell swing|back extension|hyperextension|pull.?through)/i,
  squat: /\b(squat|leg press|hack)/i,
  /** Olympic lifts: the pull that drives them is a hinge. */
  olympic: /\b(clean|snatch|jerk)/i,
  verticalPush: /\b(overhead|shoulder press|military|push press|handstand|landmine press)/i,
  verticalPull: /\b(pull.?up|chin.?up|pulldown|pull.?down|lat pull|muscle.?up)/i,
  horizontalPull: /\b(row|face pull|rear delt)/i,
  horizontalPush: /\b(bench|push.?up|chest press|dip|fly|flye|floor press)/i,
  unilateral: /\b(single|one.?arm|one.?leg|one.?handed|split|bulgarian|pistol|lunge|step.?up|suitcase|unilateral|alternat)/i,
};

/**
 * Resolves a movement pattern from the source record.
 *
 * Order matters: the most specific structural cues (carries, lunges) are tested
 * before the broad isolation catch-all, and the isolation catch-all sits ahead
 * of the push/pull rules because a cable fly is isolation work regardless of
 * which direction it pushes.
 */
function derivePattern(ex: RawExercise): string | null {
  const override = PATTERN_OVERRIDES[ex.id];
  if (override) return override;

  const name = ex.name;
  const primary = ex.primaryMuscles[0] ?? '';
  const isCompound = ex.mechanic === 'compound';

  // Loaded locomotion first: a suitcase carry is a carry even though the trunk
  // does the work, so this has to beat the abdominals rule below.
  if (re.carry.test(name)) return 'carry';
  if (re.lunge.test(name)) return 'lunge';

  // Trunk work is core whether or not the dataset calls it compound. A barbell
  // rollout is marked compound with a push force vector, and would otherwise
  // fall through and be logged as a chest movement.
  if (primary === 'abdominals') return 'core';
  if (primary === 'lower back' && !isCompound) return 'core';

  // A cable fly is isolation work regardless of which direction it pushes, so
  // this sits ahead of the push and pull rules.
  if (!isCompound) return 'isolation';

  if (re.hinge.test(name)) return 'hinge';
  if (re.squat.test(name)) return 'squat';
  if (re.olympic.test(name)) return 'hinge';
  if (re.verticalPull.test(name)) return 'vertical_pull';
  if (re.verticalPush.test(name)) return 'vertical_push';
  if (re.horizontalPull.test(name)) return 'horizontal_pull';
  if (re.horizontalPush.test(name)) return 'horizontal_push';

  // Fall back to the force vector plus the muscle worked.
  if (ex.force === 'push') return primary === 'shoulders' ? 'vertical_push' : 'horizontal_push';
  if (ex.force === 'pull') return primary === 'lats' ? 'vertical_pull' : 'horizontal_pull';
  if (primary === 'lower back') return 'core';

  return null;
}

/** Rough systemic cost, 1 (trivial) to 5 (very taxing). Feeds generator fatigue budgeting. */
function deriveFatigueCost(ex: RawExercise, pattern: string): number {
  if (!('mechanic' in ex) || ex.mechanic !== 'compound') return pattern === 'core' ? 1 : 2;
  const heavyPattern = pattern === 'squat' || pattern === 'hinge';
  const freeWeight = ex.equipment === 'barbell' || ex.equipment === 'dumbbell';
  if (heavyPattern && ex.equipment === 'barbell') return 5;
  if (heavyPattern || (freeWeight && pattern !== 'core')) return 4;
  return 3;
}

/**
 * Stable UUIDv5-style id derived from the source slug, so rebuilding the seed
 * produces the same ids and does not churn the file or orphan history.
 */
const NAMESPACE = 'a9f1c3e8-6b47-4d21-9c5a-2e7b8d0f4a13';
function stableId(sourceId: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex'))
    .update(sourceId)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const raw = JSON.parse(readFileSync(resolve(root, 'data/exercises.raw.json'), 'utf8')) as RawExercise[];
const lifting = raw.filter((ex) => LIFTING_CATEGORIES.has(ex.category));

const unresolved: string[] = [];
const seed = lifting.map((ex) => {
  const pattern = derivePattern(ex);
  if (!pattern) unresolved.push(`${ex.id} (${ex.name})`);

  const isCompound = ex.mechanic === 'compound';
  const image = ex.images[0];

  return {
    id: stableId(ex.id),
    source_id: ex.id,
    name: ex.name,
    primary_muscle: ex.primaryMuscles[0] ?? 'other',
    secondary_muscles: ex.secondaryMuscles,
    equipment: EQUIPMENT_MAP[ex.equipment ?? 'other'] ?? 'other',
    movement_pattern: pattern,
    is_compound: isCompound,
    is_unilateral: re.unilateral.test(ex.name),
    experience_level: ex.level,
    fatigue_cost: deriveFatigueCost(ex, pattern ?? 'isolation'),
    demo_url: image ? `${IMAGE_BASE}/${image}` : null,
    // Brief's rest defaults: compounds 150-180s, isolation 60-90s.
    default_rest_seconds: isCompound ? 180 : 75,
    setup_notes: null,
    is_custom: false,
    increment_kg: null,
  };
});

seed.sort((a, b) => a.name.localeCompare(b.name, 'en'));

if (unresolved.length > 0) {
  console.error(`\n${unresolved.length} exercise(s) have no movement pattern:`);
  for (const item of unresolved) console.error(`  - ${item}`);
  console.error('\nAdd them to PATTERN_OVERRIDES in scripts/build-seed.ts.\n');
  process.exit(1);
}

writeFileSync(resolve(root, 'src/db/seed.data.json'), `${JSON.stringify(seed, null, 2)}\n`);

const byPattern = seed.reduce<Record<string, number>>((acc, ex) => {
  acc[ex.movement_pattern!] = (acc[ex.movement_pattern!] ?? 0) + 1;
  return acc;
}, {});

console.log(`Seed built: ${seed.length} exercises (from ${raw.length} source records)`);
console.log('By movement pattern:');
for (const [pattern, count] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pattern.padEnd(18)} ${count}`);
}
