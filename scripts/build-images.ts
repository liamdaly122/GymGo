/**
 * Bundles exercise photography for the lifts plans actually use.
 *
 * Photos are the single biggest difference between this looking like a product
 * and looking like a prototype. Bundling all 675 would add 5-7MB to the service
 * worker precache and slow every install; bundling none leaves grey cards.
 *
 * So the set is DERIVED rather than guessed: every goal, split and day count is
 * generated against four gym profiles and the union of exercises the filler
 * picks is taken. That guarantees every plan the app can produce has photos,
 * without carrying the long tail nobody will ever be shown.
 *
 * Source images are from the already-vendored free-exercise-db (Unlicense).
 * Output is committed, so a clean checkout builds without network access.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { TRAINING_GOALS } from '../src/domain/programmes/goals.ts';
import { SPLITS } from '../src/domain/programmes/splits.ts';
import { buildPlan } from '../src/domain/programmes/plan.ts';
import { STAPLE_IDS } from '../src/domain/programmes/staples.ts';
import { swapSuggestions } from '../src/domain/search.ts';
import type { Exercise } from '../src/db/schema.ts';
import type { Equipment } from '../src/domain/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/exercise-images');
const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

const seed = JSON.parse(
  readFileSync(resolve(root, 'src/db/seed.data.json'), 'utf8'),
) as Array<Record<string, unknown>>;

const EXERCISES: Exercise[] = seed.map(
  (row) => ({ ...row, user_id: null, created_at: '', updated_at: '', deleted_at: null }) as unknown as Exercise,
);

const PROFILES: Equipment[][] = [
  ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands', 'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other'],
  ['barbell', 'bodyweight'],
  ['dumbbell', 'bodyweight'],
  ['bodyweight'],
];

/** Every exercise any plan the app can build might show. */
function exercisesPlansUse(): Set<string> {
  const used = new Set<string>();

  for (const equipment of PROFILES) {
    for (const goal of TRAINING_GOALS) {
      for (const split of SPLITS) {
        for (const days of split.daysSupported) {
          // Two seeds, because "Shuffle" re-rolls and should not hit a blank.
          for (const seedValue of [0, 1]) {
            const plan = buildPlan(
              { goalId: goal.id, splitId: split.id, days },
              EXERCISES,
              { equipment, seed: seedValue },
            );
            for (const session of plan.sessions) {
              for (const entry of session.exercises) {
                if (entry.exercise.source_id) used.add(entry.exercise.source_id);
              }
            }
          }
        }
      }
    }
  }

  // The curated staples too — they are what search surfaces first.
  for (const id of STAPLE_IDS) used.add(id);

  // And whatever the swap screen can offer instead of any of them. Swapping is
  // a prominent screen now, and a list of grey initials tiles undercuts the
  // point of having photography at all.
  const bySourceId = new Map(EXERCISES.map((exercise) => [exercise.source_id, exercise]));
  for (const id of [...used]) {
    const exercise = bySourceId.get(id);
    if (!exercise) continue;
    const { direct, alternative } = swapSuggestions(exercise, EXERCISES, { limit: 10 });
    for (const candidate of [...direct, ...alternative]) {
      if (candidate.source_id) used.add(candidate.source_id);
    }
  }

  return used;
}

const wanted = exercisesPlansUse();
const bySourceId = new Map(seed.map((row) => [row.source_id as string, row]));

mkdirSync(outDir, { recursive: true });

const manifest: string[] = [];
let downloaded = 0;
let reused = 0;
let failed = 0;
let bytes = 0;

console.log(`Bundling images for ${wanted.size} exercises that plans actually use…`);

for (const sourceId of [...wanted].sort()) {
  const row = bySourceId.get(sourceId);
  if (!row) continue;

  const demoUrl = row.demo_url as string | null;
  if (!demoUrl) continue;

  const outPath = resolve(outDir, `${sourceId}.webp`);

  if (existsSync(outPath)) {
    reused += 1;
    manifest.push(sourceId);
    bytes += readFileSync(outPath).length;
    continue;
  }

  try {
    const response = await fetch(demoUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const input = Buffer.from(await response.arrayBuffer());

    const webp = await sharp(input)
      .resize(420, 280, { fit: 'cover', position: 'centre' })
      .webp({ quality: 72, effort: 6 })
      .toBuffer();

    writeFileSync(outPath, webp);
    manifest.push(sourceId);
    downloaded += 1;
    bytes += webp.length;
  } catch (cause) {
    failed += 1;
    console.warn(`  could not fetch ${sourceId}: ${cause instanceof Error ? cause.message : cause}`);
  }
}

manifest.sort();
writeFileSync(
  resolve(root, 'src/db/image-manifest.json'),
  `${JSON.stringify(manifest, null, 0)}\n`,
);

console.log(
  `\n  ${manifest.length} images (${downloaded} new, ${reused} reused` +
    `${failed > 0 ? `, ${failed} failed` : ''})`,
);
console.log(`  ${(bytes / 1024 / 1024).toFixed(2)} MB total`);
