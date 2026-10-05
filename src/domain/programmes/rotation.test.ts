import { describe, expect, it } from 'vitest';
import seedData from '@/db/seed.data.json';
import type { Exercise } from '@/db/schema';
import type { Equipment, Goal } from '../types';
import { SPLITS } from './splits';
import { buildPlan, type GeneratedPlan } from './plan';
import { prescribe, roleForPrescription } from './prescribe';
import { liftFamily } from '../search';
import { rotateAccessories, type Rotation, type RotationRow } from './rotation';

/** The real seeded library, with the sync fields the app stamps on insert. */
const EXERCISES: Exercise[] = (seedData as unknown as Array<Record<string, unknown>>).map(
  (row) =>
    ({
      ...row,
      user_id: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      deleted_at: null,
    }) as Exercise,
);

const COMMERCIAL: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'machine',
  'bands', 'bodyweight', 'ez_bar', 'exercise_ball', 'medicine_ball', 'other',
];
const DUMBBELL_HOME: Equipment[] = ['dumbbell', 'bodyweight'];

const byName = (name: string) => {
  const exercise = EXERCISES.find((candidate) => candidate.name === name);
  if (!exercise) throw new Error(`No exercise called ${name}`);
  return exercise;
};

/** A generated plan's sessions as the rows `createRoutinesFromPlan` writes. */
function rowsOf(plan: GeneratedPlan): RotationRow[][] {
  return plan.sessions.map((session) =>
    session.exercises.map((entry, position) => ({
      id: `${session.dayIndex}:${position}`,
      exercise: entry.exercise,
      rep_range_low: entry.prescription.repLow,
      rep_range_high: entry.prescription.repHigh,
      target_rir: entry.prescription.targetRir,
    })),
  );
}

/** The rows after a rotation is applied, as the next block would hold them. */
function applied(rows: RotationRow[][], rotations: Rotation[]): RotationRow[][] {
  const to = new Map(rotations.map((rotation) => [rotation.rowId, rotation.to]));
  return rows.map((session) => session.map((row) => ({ ...row, exercise: to.get(row.id) ?? row.exercise })));
}

const roleOf = (plan: GeneratedPlan, rowId: string) => {
  const [day, position] = rowId.split(':').map(Number);
  return plan.sessions[day!]!.exercises[position!]!.slot.role;
};

describe('reading a row’s role off its prescription', () => {
  it('reads back every role the generator writes, for every goal', () => {
    for (const profile of ['hypertrophy', 'strength', 'general'] as Goal[]) {
      for (const role of ['primary', 'secondary', 'accessory'] as const) {
        const written = prescribe(profile, role);
        const row = {
          rep_range_low: written.repLow,
          rep_range_high: written.repHigh,
          target_rir: written.targetRir,
        };
        expect(roleForPrescription(profile, row), `${profile} ${role}`).toBe(role);
      }
    }
  });

  /**
   * What the lifter chose is theirs. A row added by hand has no RIR target,
   * and one re-prescribed no longer matches: neither may be read as an
   * accessory, or the next block would rotate it away.
   */
  it('reads no role into a row added or changed by hand', () => {
    const byHand = { rep_range_low: 8, rep_range_high: 12, target_rir: null };
    for (const profile of ['hypertrophy', 'strength', 'general'] as Goal[]) {
      expect(roleForPrescription(profile, byHand)).toBeNull();
    }
    expect(roleForPrescription('hypertrophy', { rep_range_low: 12, rep_range_high: 20, target_rir: 1 })).toBeNull();
    expect(roleForPrescription('hypertrophy', { rep_range_low: 10, rep_range_high: 15, target_rir: 2 })).toBeNull();
  });
});

describe('rotating the accessories for the next block', () => {
  const upperLower = buildPlan(
    { goalId: 'build_muscle', splitId: 'upper_lower', days: 4 },
    EXERCISES,
    { equipment: COMMERCIAL },
  );

  it('keeps every main lift and changes every accessory at a commercial gym', () => {
    const rows = rowsOf(upperLower);
    const rotations = rotateAccessories('hypertrophy', rows, EXERCISES, { equipment: COMMERCIAL });

    const rotated = new Set(rotations.map((rotation) => rotation.rowId));
    for (const row of rows.flat()) {
      const role = roleOf(upperLower, row.id);
      if (role === 'accessory') expect(rotated.has(row.id), `${row.exercise.name} should rotate`).toBe(true);
      else expect(rotated.has(row.id), `${row.exercise.name} is a ${role} lift and must stay`).toBe(false);
    }
    expect(rotations.length).toBeGreaterThan(0);
  });

  /**
   * The family keeps the job: the dataset files lateral, front and rear delt
   * raises all under shoulders, and leg extensions with hip adductions under
   * quadriceps, so the muscle alone would rotate a rear delt fly into a front
   * raise.
   */
  it('replaces each accessory with another version of the same lift', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        const plan = buildPlan({ goalId: 'build_muscle', splitId: split.id, days }, EXERCISES, {
          equipment: COMMERCIAL,
        });
        for (const { from, to } of rotateAccessories('hypertrophy', rowsOf(plan), EXERCISES, {
          equipment: COMMERCIAL,
        })) {
          expect(to.id).not.toBe(from.id);
          const family = liftFamily(from.name);
          if (family !== null && from.movement_pattern !== 'core') {
            expect(liftFamily(to.name), `${from.name} → ${to.name}`).toBe(family);
          } else if (from.movement_pattern === 'isolation') {
            expect(to.primary_muscle, `${from.name} → ${to.name}`).toBe(from.primary_muscle);
          }
        }
      }
    }
  });

  it('keeps a lift with no other version rather than swapping in the wrong thing', () => {
    const extension = byName('Leg Extensions');
    const adduction = byName('Cable Hip Adduction');
    const accessory = prescribe('hypertrophy', 'accessory');
    const rows: RotationRow[][] = [[
      { id: 'quads', exercise: extension, rep_range_low: accessory.repLow, rep_range_high: accessory.repHigh, target_rir: accessory.targetRir },
    ]];
    // Filed under quadriceps too, and not the same job at all.
    expect(rotateAccessories('hypertrophy', rows, [extension, adduction])).toEqual([]);
  });

  it('brings in new lifts rather than trading last block’s between sessions', () => {
    const rows = rowsOf(upperLower);
    const outgoing = new Set(
      rows.flat().filter((row) => roleOf(upperLower, row.id) === 'accessory').map((row) => row.exercise.id),
    );
    const rotations = rotateAccessories('hypertrophy', rows, EXERCISES, { equipment: COMMERCIAL });
    for (const { to } of rotations) {
      expect(outgoing.has(to.id), `${to.name} was already an accessory last block`).toBe(false);
    }
  });

  it('never puts one lift into a session twice', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        for (const equipment of [COMMERCIAL, DUMBBELL_HOME]) {
          const plan = buildPlan({ goalId: 'build_muscle', splitId: split.id, days }, EXERCISES, { equipment });
          const next = applied(
            rowsOf(plan),
            rotateAccessories('hypertrophy', rowsOf(plan), EXERCISES, { equipment }),
          );
          for (const session of next) {
            const ids = session.map((row) => row.exercise.id);
            expect(new Set(ids).size, `${split.label} ${days}d: ${session.map((r) => r.exercise.name)}`).toBe(ids.length);
          }
        }
      }
    }
  });

  it('only reaches for kit the gym has', () => {
    const plan = buildPlan({ goalId: 'build_muscle', splitId: 'full_body', days: 3 }, EXERCISES, {
      equipment: DUMBBELL_HOME,
    });
    const rotations = rotateAccessories('hypertrophy', rowsOf(plan), EXERCISES, { equipment: DUMBBELL_HOME });
    for (const { to } of rotations) expect(DUMBBELL_HOME).toContain(to.equipment);
  });

  it('rotates the same way every time for the same block', () => {
    const rows = rowsOf(upperLower);
    const first = rotateAccessories('hypertrophy', rows, EXERCISES, { equipment: COMMERCIAL });
    const again = rotateAccessories('hypertrophy', rows, EXERCISES, { equipment: COMMERCIAL });
    expect(again.map((rotation) => [rotation.rowId, rotation.to.id])).toEqual(
      first.map((rotation) => [rotation.rowId, rotation.to.id]),
    );
  });

  it('keeps rotating block after block', () => {
    const blockOne = rowsOf(upperLower);
    const blockTwo = applied(
      blockOne,
      rotateAccessories('hypertrophy', blockOne, EXERCISES, { equipment: COMMERCIAL }),
    );
    const third = rotateAccessories('hypertrophy', blockTwo, EXERCISES, { equipment: COMMERCIAL });
    const accessories = blockTwo.flat().filter((row) => roleOf(upperLower, row.id) === 'accessory');
    expect(third.map((rotation) => rotation.rowId).sort()).toEqual(accessories.map((row) => row.id).sort());
  });

  it('leaves a lift the lifter added by hand alone, and rotates nothing into it', () => {
    const curl = byName('Barbell Curl');
    const rows = rowsOf(upperLower);
    // Upper A, with a curl added by hand at the end: no RIR target.
    rows[0] = [
      ...rows[0]!,
      { id: 'by-hand', exercise: curl, rep_range_low: 8, rep_range_high: 12, target_rir: null },
    ];
    const rotations = rotateAccessories('hypertrophy', rows, EXERCISES, { equipment: COMMERCIAL });

    expect(rotations.some((rotation) => rotation.rowId === 'by-hand')).toBe(false);
    const upperA = applied(rows, rotations)[0]!;
    expect(upperA.filter((row) => row.exercise.id === curl.id)).toHaveLength(1);
  });

  it('leaves an accessory alone when the gym has nothing else for it', () => {
    const calf = byName('Standing Calf Raises');
    const squat = byName('Barbell Squat');
    const accessory = prescribe('hypertrophy', 'accessory');
    const primary = prescribe('hypertrophy', 'primary');
    const rows: RotationRow[][] = [
      [
        { id: 'squat', exercise: squat, rep_range_low: primary.repLow, rep_range_high: primary.repHigh, target_rir: primary.targetRir },
        { id: 'calf', exercise: calf, rep_range_low: accessory.repLow, rep_range_high: accessory.repHigh, target_rir: accessory.targetRir },
      ],
    ];
    // A library with one calf raise in it.
    const rotations = rotateAccessories('hypertrophy', rows, [squat, calf]);
    expect(rotations).toEqual([]);
  });
});
