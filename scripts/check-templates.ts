/**
 * Validates that every plan the UI can offer can actually be built.
 *
 * Run by `npm run templates:check`. Mirrors `seed:check`: the failure mode this
 * guards against is quiet, not loud — a slot no gym profile can fill produces a
 * thinner plan rather than an error, and nobody notices until a real session.
 *
 * Four gym profiles are checked. The commercial one must be perfect. The
 * constrained ones are allowed gaps — a dumbbell-only garage genuinely has no
 * hamstring isolation — but must still yield a usable session.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRAINING_GOALS } from '../src/domain/programmes/goals.ts';
import { SPLITS } from '../src/domain/programmes/splits.ts';
import { assessPlan, buildPlan } from '../src/domain/programmes/plan.ts';
import { STAPLE_IDS } from '../src/domain/programmes/staples.ts';
import type { Exercise } from '../src/db/schema.ts';
import type { Equipment } from '../src/domain/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const seed = JSON.parse(
  readFileSync(resolve(root, 'src/db/seed.data.json'), 'utf8'),
) as Array<Record<string, unknown>>;

const EXERCISES: Exercise[] = seed.map(
  (row) =>
    ({
      ...row,
      user_id: null,
      created_at: '',
      updated_at: '',
      deleted_at: null,
    }) as unknown as Exercise,
);

/**
 * `mustBeComplete` marks a gym that has no excuse: everything must fill.
 * The constrained profiles are allowed to rule combinations out — a garage with
 * a barbell genuinely cannot run a five-day body-part split — but each one must
 * still leave the lifter with at least one workable option at every day count,
 * or the selector would be a dead end.
 */
const PROFILES: Array<{ name: string; equipment: Equipment[]; mustBeComplete: boolean }> = [
  {
    name: 'commercial gym',
    equipment: [
      'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands',
      'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
    ],
    mustBeComplete: true,
  },
  { name: 'home: barbell + bodyweight', equipment: ['barbell', 'bodyweight'], mustBeComplete: false },
  { name: 'home: dumbbells + bodyweight', equipment: ['dumbbell', 'bodyweight'], mustBeComplete: false },
  { name: 'bodyweight only', equipment: ['bodyweight'], mustBeComplete: false },
];

const problems: string[] = [];
let combinations = 0;

for (const profile of PROFILES) {
  let unfilledTotal = 0;
  let notViable = 0;
  const viableDays = new Set<number>();
  const allDays = new Set<number>();

  for (const goal of TRAINING_GOALS) {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        combinations += 1;
        allDays.add(days);
        const where = `${profile.name} · ${goal.label} · ${split.label} · ${days}d`;

        let plan;
        try {
          plan = buildPlan({ goalId: goal.id, splitId: split.id, days }, EXERCISES, {
            equipment: profile.equipment,
          });
        } catch (cause) {
          problems.push(`${where}: threw — ${cause instanceof Error ? cause.message : cause}`);
          continue;
        }

        if (plan.sessions.length !== days) {
          problems.push(`${where}: produced ${plan.sessions.length} sessions, expected ${days}`);
        }

        unfilledTotal += plan.unfilledCount;
        const viability = assessPlan(plan);
        if (viability.viable) viableDays.add(days);
        else notViable += 1;

        if (profile.mustBeComplete && plan.unfilledCount > 0) {
          const gaps = plan.sessions
            .filter((session) => session.unfilled.length > 0)
            .map((session) => `${session.name}(${session.unfilled.map((s) => s.pattern).join(',')})`)
            .join(' ');
          problems.push(`${where}: ${plan.unfilledCount} unfilled slot(s) — ${gaps}`);
        }
        if (profile.mustBeComplete && !viability.viable) {
          problems.push(`${where}: not viable — ${viability.reason}`);
        }
      }
    }
  }

  // Every gym must leave at least one workable option at each day count.
  for (const days of [...allDays].sort((a, b) => a - b)) {
    if (!viableDays.has(days)) {
      problems.push(`${profile.name}: nothing workable at ${days} days a week`);
    }
  }

  console.log(
    `  ${profile.name.padEnd(30)} unfilled: ${String(unfilledTotal).padStart(4)}   ` +
      `ruled out: ${String(notViable).padStart(3)}   ` +
      `workable day counts: ${[...viableDays].sort((a, b) => a - b).join(', ') || 'none'}`,
  );
}

// A staple that no longer resolves is a silent downgrade in plan quality.
const bySourceId = new Set(seed.map((row) => row.source_id as string));
const missingStaples = STAPLE_IDS.filter((id) => !bySourceId.has(id));
if (missingStaples.length > 0) {
  problems.push(`staples missing from the seed data: ${missingStaples.join(', ')}`);
}

if (problems.length > 0) {
  console.error(`\nTemplate check FAILED with ${problems.length} problem(s):\n`);
  for (const problem of problems.slice(0, 30)) console.error(`  - ${problem}`);
  if (problems.length > 30) console.error(`  ...and ${problems.length - 30} more`);
  console.error('');
  process.exit(1);
}

console.log(
  `\nTemplate check passed: ${combinations} goal/split/day combinations across ` +
    `${PROFILES.length} gym profiles, ${STAPLE_IDS.length} staples all present.`,
);
