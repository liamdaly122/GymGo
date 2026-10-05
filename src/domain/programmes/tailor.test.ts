import { describe, expect, it } from 'vitest';
import seedData from '@/db/seed.data.json';
import type { Exercise } from '@/db/schema';
import type { Equipment } from '../types';
import { liftFamily } from '../search';
import { SPLITS } from './splits';
import { buildPlan, pinExercises, slotIndexOf, weeklySetsPerMuscle, type GeneratedPlan } from './plan';
import { explainPick } from './explain';
import { peakMinutes, tailorPlan } from './tailor';
import { WEEKLY_SET_TARGET } from './prescribe';
import { rotateAccessories } from './rotation';

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

const upperLower = (options: Parameters<typeof buildPlan>[2] = {}) =>
  buildPlan({ goalId: 'build_muscle', splitId: 'upper_lower', days: 4 }, EXERCISES, {
    equipment: COMMERCIAL,
    ...options,
  });

const names = (plan: GeneratedPlan) => plan.sessions.flatMap((session) => session.exercises.map((e) => e.exercise.name));

describe('lifts to avoid', () => {
  it('keeps every version of an avoided lift out of the whole plan', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        const plan = buildPlan({ goalId: 'build_muscle', splitId: split.id, days }, EXERCISES, {
          equipment: COMMERCIAL,
          avoidFamilies: ['deadlift', 'overhead press'],
        });
        for (const name of names(plan)) {
          expect(['deadlift', 'overhead press'], `${split.label} ${days}d kept ${name}`).not.toContain(liftFamily(name));
        }
      }
    }
  });

  it('changes nothing when nothing is avoided, so existing plans are unchanged', () => {
    expect(names(upperLower({ avoidFamilies: [] }))).toEqual(names(upperLower()));
    expect(names(tailorPlan(upperLower(), {}))).toEqual(names(upperLower()));
  });

  it('never rotates an avoided lift in at the end of a block', () => {
    const plan = upperLower();
    const rows = plan.sessions.map((session) =>
      session.exercises.map((entry, position) => ({
        id: `${session.dayIndex}:${position}`,
        exercise: entry.exercise,
        rep_range_low: entry.prescription.repLow,
        rep_range_high: entry.prescription.repHigh,
        target_rir: entry.prescription.targetRir,
      })),
    );
    const everyFamily = [...new Set(EXERCISES.map((exercise) => liftFamily(exercise.name)).filter(Boolean))] as string[];
    // Rule out every curl: the biceps accessories have nowhere to rotate to.
    const rotations = rotateAccessories('hypertrophy', rows, EXERCISES, {
      equipment: COMMERCIAL,
      avoidFamilies: ['curl'],
    });
    expect(everyFamily).toContain('curl');
    for (const { to } of rotations) expect(liftFamily(to.name)).not.toBe('curl');
  });
});

describe('priority muscles', () => {
  it('adds a set to each lift led by a priority muscle', () => {
    const plain = upperLower();
    const tailored = tailorPlan(plain, { priorities: ['shoulders'] });
    plain.sessions.forEach((session, day) => {
      session.exercises.forEach((entry, index) => {
        const after = tailored.sessions[day]!.exercises[index]!;
        const extra = entry.exercise.primary_muscle === 'shoulders' ? 1 : 0;
        expect(after.prescription.sets, entry.exercise.name).toBe(entry.prescription.sets + extra);
      });
    });
  });

  it('stops at the goal’s weekly ceiling', () => {
    const tailored = tailorPlan(
      buildPlan({ goalId: 'build_muscle', splitId: 'push_pull_legs', days: 6 }, EXERCISES, { equipment: COMMERCIAL }),
      { priorities: ['chest', 'triceps'] },
    );
    const direct = weeklySetsPerMuscle(tailored, { includeSecondary: false });
    expect(direct.get('chest') ?? 0).toBeLessThanOrEqual(WEEKLY_SET_TARGET.hypertrophy.high);
    expect(direct.get('triceps') ?? 0).toBeLessThanOrEqual(WEEKLY_SET_TARGET.hypertrophy.high);
  });
});

describe('fitting a time limit', () => {
  it('fits the hardest week of every session when it can, and keeps every main lift', () => {
    const plain = upperLower();
    const tailored = tailorPlan(plain, { minutes: 75 });
    tailored.sessions.forEach((session, day) => {
      expect(session.peakMinutes, session.name).toBeLessThanOrEqual(75);
      expect(peakMinutes(session.exercises)).toBe(session.peakMinutes);
      const mains = plain.sessions[day]!.exercises.filter((entry) => entry.slot.role === 'primary');
      for (const main of mains) {
        expect(session.exercises.some((entry) => entry.exercise.id === main.exercise.id), main.exercise.name).toBe(true);
      }
    });
  });

  it('says what it cut', () => {
    const tailored = tailorPlan(upperLower(), { minutes: 60 });
    const cut = tailored.sessions.flatMap((session) => session.trimmed ?? []);
    expect(cut.length).toBeGreaterThan(0);
    // Accessories go first.
    expect(cut.some((lift) => lift.cut === 'dropped')).toBe(true);
  });

  it('cuts nothing it does not have to', () => {
    const tailored = tailorPlan(upperLower(), { minutes: 300 });
    for (const session of tailored.sessions) expect(session.trimmed).toEqual([]);
  });

  it('owns up when even the main lifts do not fit', () => {
    const tailored = tailorPlan(upperLower(), { minutes: 30 });
    const over = tailored.sessions.filter((session) => (session.peakMinutes ?? 0) > 30);
    expect(over.length).toBeGreaterThan(0);
    for (const session of tailored.sessions) {
      expect(session.exercises.filter((entry) => entry.slot.role === 'primary').length).toBeGreaterThan(0);
    }
  });

  it('never drops a lift you swapped in by hand', () => {
    const plain = upperLower();
    const upperA = plain.sessions[0]!;
    const accessory = upperA.exercises.find((entry) => entry.slot.role === 'accessory')!;
    const curl = EXERCISES.find((exercise) => exercise.name === 'Concentration Curls')!;
    const pinned = pinExercises(plain, [{ dayIndex: 0, slotIndex: slotIndexOf(upperA, accessory), exercise: curl }]);

    const tailored = tailorPlan(pinned, { minutes: 45 });

    expect(tailored.sessions[0]!.exercises.some((entry) => entry.exercise.id === curl.id)).toBe(true);
  });

  it('cuts a priority muscle’s work last', () => {
    const tailored = tailorPlan(upperLower(), { minutes: 60, priorities: ['shoulders'] });
    for (const session of tailored.sessions) {
      const cutShoulders = (session.trimmed ?? []).filter((lift) => lift.exercise.primary_muscle === 'shoulders');
      const cutOthers = (session.trimmed ?? []).filter(
        (lift) => lift.exercise.primary_muscle !== 'shoulders' && lift.cut === 'dropped',
      );
      // Shoulder work only goes once everything optional elsewhere has.
      if (cutShoulders.length > 0) {
        const left = session.exercises.filter(
          (entry) => entry.slot.optional && entry.exercise.primary_muscle !== 'shoulders',
        );
        expect(left, `${session.name} cut shoulder work before ${left.map((e) => e.exercise.name)}`).toEqual([]);
        expect(cutOthers.length).toBeGreaterThan(0);
      }
    }
  });

  it('comes out the same every time', () => {
    const once = tailorPlan(upperLower(), { minutes: 60, priorities: ['biceps'] });
    const again = tailorPlan(upperLower(), { minutes: 60, priorities: ['biceps'] });
    expect(JSON.stringify(again.sessions)).toBe(JSON.stringify(once.sessions));
  });
});

describe('explaining each pick', () => {
  it('gives every exercise a plain-English reason that names its job', () => {
    for (const session of upperLower().sessions) {
      for (const entry of session.exercises) {
        const reason = explainPick(entry);
        expect(reason, entry.exercise.name).toMatch(/^(Main lift|Second lift|Accessory): /);
        expect(reason.length, reason).toBeLessThan(140);
      }
    }
  });

  it('says why a main lift is on a barbell', () => {
    const squat = upperLower().sessions[1]!.exercises[0]!;
    expect(squat.exercise.equipment).toBe('barbell');
    expect(explainPick(squat)).toMatch(/smallest steps/);
  });

  it('says when the kit ran out and something else stood in', () => {
    const plan = buildPlan({ goalId: 'build_muscle', splitId: 'upper_lower', days: 4 }, EXERCISES, {
      equipment: ['dumbbell', 'bodyweight'],
    });
    const fallback = plan.sessions
      .flatMap((session) => session.exercises)
      .find((entry) => entry.exercise.movement_pattern !== entry.slot.pattern);
    expect(fallback, 'a dumbbell-only gym should need a fallback somewhere').toBeDefined();
    expect(explainPick(fallback!)).toMatch(/nothing in your kit does hamstrings isolation, so a hip hinge instead/i);
  });

  it('owns the extra set on a priority muscle', () => {
    const tailored = tailorPlan(upperLower(), { priorities: ['biceps'] });
    const curl = tailored.sessions.flatMap((session) => session.exercises).find((entry) => entry.prioritySets);
    expect(explainPick(curl!)).toMatch(/\+1 set because biceps is a priority/);
  });
});
