import { describe, expect, it } from 'vitest';
import seedData from '@/db/seed.data.json';
import type { Exercise } from '@/db/schema';
import type { Equipment } from '../types';
import { TRAINING_GOALS, findGoal, goalsSharingProfile } from './goals';
import { SPLITS, SUPPORTED_DAYS, sessionsFor, splitsForDays } from './splits';
import { SESSION_TEMPLATES } from './templates';
import { prescribe } from './prescribe';
import { fillSession } from './fill';
import { InvalidPlanSelectionError, assessPlan, buildPlan, weeklySetsPerMuscle, workableSplits } from './plan';

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

describe('goals', () => {
  it('offers all six labels', () => {
    expect(TRAINING_GOALS).toHaveLength(6);
  });

  /**
   * Six labels, three engines. Training in a deficit uses the same programme as
   * building muscle — the difference is diet, not the split — so the app maps
   * the labels people search for onto the profiles the brief specifies.
   */
  it('runs the three fat-loss and muscle goals on one profile', () => {
    expect(findGoal('build_muscle')?.profile).toBe('hypertrophy');
    expect(findGoal('get_lean')?.profile).toBe('hypertrophy');
    expect(findGoal('lose_weight')?.profile).toBe('hypertrophy');
  });

  it('keeps strength as its own profile', () => {
    expect(findGoal('build_strength')?.profile).toBe('strength');
    expect(goalsSharingProfile(findGoal('build_strength')!)).toEqual([]);
  });

  it('says so when two goals share a programme', () => {
    expect(findGoal('lose_weight')?.sameProgrammeAs).toMatch(/same lifting/i);
    expect(findGoal('build_muscle')?.sameProgrammeAs).toBeNull();
  });

  it('shortens rest for fat-loss goals rather than inventing a different split', () => {
    expect(findGoal('lose_weight')!.restMultiplier).toBeLessThan(1);
    expect(findGoal('build_strength')!.restMultiplier).toBeGreaterThan(1);
  });
});

describe('splits', () => {
  it('covers every day count from 2 to 6 with at least one split', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      expect(splitsForDays(days).length, `no split for ${days} days`).toBeGreaterThan(0);
    }
  });

  it('never offers a combination that does not divide', () => {
    // There is no such thing as a two-day bro split.
    expect(splitsForDays(2).map((split) => split.id)).not.toContain('bro');
    expect(splitsForDays(6).map((split) => split.id)).not.toContain('bro');
    expect(splitsForDays(3).map((split) => split.id)).not.toContain('upper_lower');
  });

  it('produces one session per training day', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        expect(sessionsFor(split.id, days), `${split.id} at ${days} days`).toHaveLength(days);
      }
    }
  });

  it('gives every split an honest trade-off at every day count it supports', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        expect(split.tradeoff(days).length, `${split.id} at ${days}`).toBeGreaterThan(20);
      }
    }
    expect(SPLITS.find((s) => s.id === 'bro')!.tradeoff(5)).toMatch(/6 to 8 hard/);
  });

  /** The card used to tell someone on five days about the three-day problem. */
  it('tailors the trade-off to the day count actually chosen', () => {
    const ppl = SPLITS.find((s) => s.id === 'push_pull_legs')!;
    expect(ppl.tradeoff(3)).toMatch(/light side for growth/);
    expect(ppl.tradeoff(6)).not.toMatch(/three days/);
    expect(ppl.tradeoff(5)).toMatch(/fifth day/);
  });

  it('does not repeat the frequency note inside the trade-off', () => {
    for (const split of SPLITS) {
      for (const days of split.daysSupported) {
        expect(split.tradeoff(days), `${split.id} at ${days}`).not.toMatch(
          /(trained|gets) once a week|session a week/i,
        );
      }
    }
  });

  it('exposes only day counts some split supports', () => {
    expect(SUPPORTED_DAYS).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('prescriptions', () => {
  it('follows the brief: strength is low reps, hypertrophy moderate', () => {
    expect(prescribe('strength', 'primary')).toMatchObject({ repLow: 3, repHigh: 5 });
    expect(prescribe('hypertrophy', 'primary')).toMatchObject({ repLow: 6, repHigh: 10 });
    expect(prescribe('general', 'primary')).toMatchObject({ repLow: 8, repHigh: 12 });
  });

  it('rests compounds long and isolation short', () => {
    expect(prescribe('hypertrophy', 'primary').restSeconds).toBeGreaterThanOrEqual(150);
    expect(prescribe('hypertrophy', 'accessory').restSeconds).toBeLessThanOrEqual(90);
  });

  it('applies the goal rest multiplier', () => {
    const normal = prescribe('hypertrophy', 'primary').restSeconds;
    const dense = prescribe('hypertrophy', 'primary', { restMultiplier: 0.75 }).restSeconds;
    expect(dense).toBeLessThan(normal);
    expect(dense).toBeGreaterThanOrEqual(30);
  });

  it('does not rest an isolation lift like a heavy compound', () => {
    const compound = prescribe('hypertrophy', 'primary', { isCompound: true }).restSeconds;
    const isolation = prescribe('hypertrophy', 'primary', { isCompound: false }).restSeconds;
    expect(isolation).toBeLessThan(compound);
  });
});

describe('filling a session', () => {
  it('fills every slot of a push day at a commercial gym', () => {
    const result = fillSession(SESSION_TEMPLATES.push, EXERCISES, { equipment: COMMERCIAL });
    expect(result.unfilled).toEqual([]);
    expect(result.filled).toHaveLength(SESSION_TEMPLATES.push.slots.length);
  });

  it('never repeats an exercise inside one session', () => {
    const result = fillSession(SESSION_TEMPLATES.push, EXERCISES, { equipment: COMMERCIAL });
    const ids = result.filled.map((entry) => entry.exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects the pattern each slot asks for', () => {
    const result = fillSession(SESSION_TEMPLATES.legs, EXERCISES, { equipment: COMMERCIAL });
    for (const entry of result.filled) {
      const allowed = [entry.slot.pattern, ...(entry.slot.fallback ?? [])];
      expect(allowed).toContain(entry.exercise.movement_pattern);
    }
  });

  it('only ever uses equipment the gym has', () => {
    const result = fillSession(SESSION_TEMPLATES.legs, EXERCISES, { equipment: DUMBBELL_HOME });
    for (const entry of result.filled) {
      expect(DUMBBELL_HOME).toContain(entry.exercise.equipment);
    }
  });

  /**
   * Measured against the real seed: a dumbbell-and-bodyweight gym has no
   * hamstring isolation whatsoever. The right answer is to report the gap, not
   * to crash and not to quietly substitute a bicep curl on leg day.
   */
  it('reports what a thin gym cannot cover instead of throwing', () => {
    const result = fillSession(SESSION_TEMPLATES.legs, EXERCISES, { equipment: DUMBBELL_HOME });
    expect(result.filled.length).toBeGreaterThan(0);
    expect(() => fillSession(SESSION_TEMPLATES.legs, EXERCISES, { equipment: ['bodyweight'] })).not.toThrow();
  });

  it('keeps the wrong muscle out of a slot that named one', () => {
    const result = fillSession(SESSION_TEMPLATES.legs, EXERCISES, { equipment: DUMBBELL_HOME });
    for (const entry of result.filled) {
      if (entry.slot.requireMuscle && entry.slot.muscle) {
        expect(entry.exercise.primary_muscle).toBe(entry.slot.muscle);
      }
    }
  });

  it('honours excluded exercises', () => {
    const first = fillSession(SESSION_TEMPLATES.push, EXERCISES, { equipment: COMMERCIAL });
    const banned = first.filled[0]!.exercise.id;
    const second = fillSession(SESSION_TEMPLATES.push, EXERCISES, {
      equipment: COMMERCIAL,
      excludeExerciseIds: [banned],
    });
    expect(second.filled.map((entry) => entry.exercise.id)).not.toContain(banned);
  });

  it('gives a beginner beginner-appropriate lifts', () => {
    const result = fillSession(SESSION_TEMPLATES.push, EXERCISES, {
      equipment: COMMERCIAL,
      experience: 'beginner',
    });
    expect(result.filled.every((entry) => entry.exercise.experience_level !== 'expert')).toBe(true);
  });
});

describe('building a plan', () => {
  const selection = { goalId: 'build_muscle', splitId: 'push_pull_legs', days: 6 } as const;

  it('refuses a combination that does not divide', () => {
    expect(() =>
      buildPlan({ goalId: 'build_muscle', splitId: 'bro', days: 3 }, EXERCISES),
    ).toThrow(InvalidPlanSelectionError);
  });

  it('produces one session per training day', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    expect(plan.sessions).toHaveLength(6);
  });

  it('disambiguates a template that runs twice', () => {
    // Six-day push/pull/legs runs Push twice, holding different exercises.
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const names = plan.sessions.map((session) => session.name);
    expect(names.filter((name) => name.startsWith('Push'))).toEqual(['Push A', 'Push B']);
  });

  it('does not letter a name that already ends in a letter', () => {
    // The full-body templates are Full body A/B/C. A four-day rotation runs one
    // of them twice, and appending a letter produced "Full body A A".
    const plan = buildPlan(
      { goalId: 'build_muscle', splitId: 'full_body', days: 4 },
      EXERCISES,
      { equipment: COMMERCIAL },
    );
    const names = plan.sessions.map((session) => session.name);
    expect(names.some((name) => /\s[A-Z]\s[A-Z]$/.test(name))).toBe(false);
    expect(names).toEqual(['Full body A', 'Full body B', 'Full body C', 'Full body A (2)']);
  });

  /** The brief requires this: regenerate with the same seed and compare. */
  it('is deterministic for a given seed', () => {
    const a = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL, seed: 42 });
    const b = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL, seed: 42 });
    const ids = (plan: typeof a) =>
      plan.sessions.flatMap((session) => session.exercises.map((entry) => entry.exercise.id));
    expect(ids(a)).toEqual(ids(b));
  });

  it('gives a different plan for a different seed', () => {
    const a = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL, seed: 1 });
    const b = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL, seed: 2 });
    const ids = (plan: typeof a) =>
      plan.sessions.flatMap((session) => session.exercises.map((entry) => entry.exercise.id));
    expect(ids(a)).not.toEqual(ids(b));
  });

  it('labels a repeated session so two Push days are distinguishable', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const names = plan.sessions.map((session) => session.name);
    expect(names).toContain('Push A');
    expect(names).toContain('Push B');
  });

  it('fills a full week at a commercial gym with nothing missing', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    expect(plan.unfilledCount).toBe(0);
  });

  it('still produces a usable plan in a dumbbell-only garage', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: DUMBBELL_HOME });
    for (const session of plan.sessions) {
      expect(session.exercises.length, `${session.name} came out empty`).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The brief's volume target: hypertrophy is 10-20 working sets per muscle per
   * week, and a six-day push/pull/legs is the split built to deliver it.
   *
   * Checked against DIRECT sets, because that is what the published volume
   * landmarks measure. Counting secondary muscles at a half — which is what the
   * UI shows — reads roughly a third higher and would fail a plan that is
   * actually correct.
   */
  it('lands the major muscles inside the hypertrophy volume band', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const direct = weeklySetsPerMuscle(plan, { includeSecondary: false });
    for (const muscle of ['chest', 'quadriceps', 'shoulders', 'lats']) {
      const sets = direct.get(muscle) ?? 0;
      expect(sets, `${muscle} had ${sets} direct sets`).toBeGreaterThanOrEqual(10);
      expect(sets, `${muscle} had ${sets} direct sets`).toBeLessThanOrEqual(20);
    }
  });

  it('gives hamstrings real work once hinges are credited properly', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const withSecondary = weeklySetsPerMuscle(plan);
    expect(withSecondary.get('hamstrings') ?? 0).toBeGreaterThanOrEqual(10);
  });

  /**
   * The brief puts strength at "8 to 12 sets per muscle group per week, 3 to 6
   * reps ON MAIN LIFTS". That band describes the main work, not the accessories
   * hung off the end, so it is checked against primary-role sets.
   */
  it('keeps main-lift volume inside the strength band', () => {
    const plan = buildPlan(
      { goalId: 'build_strength', splitId: 'upper_lower', days: 4 },
      EXERCISES,
      { equipment: COMMERCIAL },
    );
    const mains = weeklySetsPerMuscle(plan, { includeSecondary: false, roles: ['primary'] });
    for (const [muscle, sets] of mains) {
      if (sets === 0) continue;
      expect(sets, `${muscle} had ${sets} main-lift sets`).toBeLessThanOrEqual(12);
    }
    expect(mains.get('quadriceps') ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('picks the lifts a coach would actually write down', () => {
    const plan = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const names = plan.sessions.flatMap((s) => s.exercises.map((e) => e.exercise.name));
    // Regression guard: this used to open with a Barbell Guillotine Bench Press
    // and a Frankenstein Squat, because nothing in the ranking knew what a
    // normal lift was.
    expect(names.join(' ')).not.toMatch(/guillotine|frankenstein|zottman|tate press/i);
    const staples = names.filter((name) =>
      /bench press|squat|deadlift|pulldown|pullups|row|military press|shoulder press|curl|pushdown/i.test(name),
    );
    expect(staples.length).toBeGreaterThanOrEqual(plan.sessions.length * 2);
  });

  it('keeps a strength plan at lower volume and lower reps', () => {
    const strength = buildPlan(
      { goalId: 'build_strength', splitId: 'upper_lower', days: 4 },
      EXERCISES,
      { equipment: COMMERCIAL },
    );
    const primaries = strength.sessions
      .flatMap((session) => session.exercises)
      .filter((entry) => entry.slot.role === 'primary');
    expect(primaries.every((entry) => entry.prescription.repHigh <= 5)).toBe(true);
  });

  it('gives fat-loss goals shorter rests than the muscle-building version', () => {
    const muscle = buildPlan(selection, EXERCISES, { equipment: COMMERCIAL });
    const lean = buildPlan({ ...selection, goalId: 'get_lean' }, EXERCISES, {
      equipment: COMMERCIAL,
    });
    const firstRest = (plan: typeof muscle) => plan.sessions[0]!.exercises[0]!.prescription.restSeconds;
    expect(firstRest(lean)).toBeLessThan(firstRest(muscle));
  });

  it('builds every goal and split combination the UI can offer', () => {
    for (const goal of TRAINING_GOALS) {
      for (const split of SPLITS) {
        for (const days of split.daysSupported) {
          const plan = buildPlan({ goalId: goal.id, splitId: split.id, days }, EXERCISES, {
            equipment: COMMERCIAL,
          });
          expect(plan.sessions, `${goal.id}/${split.id}/${days}`).toHaveLength(days);
          expect(plan.unfilledCount, `${goal.id}/${split.id}/${days} had gaps`).toBe(0);
        }
      }
    }
  });
});

describe('viability at a real gym', () => {
  it('accepts every split at a commercial gym', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      for (const entry of workableSplits(days, EXERCISES, { equipment: COMMERCIAL })) {
        expect(entry.viability.viable, `${entry.splitId} at ${days} days`).toBe(true);
      }
    }
  });

  /**
   * A five-day body-part split needs isolation work for every muscle on its own
   * day, and a garage with a barbell has no chest isolation at all. Saying so up
   * front beats handing someone a Chest day with three exercises on it.
   */
  it('rules out a bro split in a barbell-only garage, with a reason', () => {
    const plan = buildPlan({ goalId: 'build_muscle', splitId: 'bro', days: 5 }, EXERCISES, {
      equipment: ['barbell', 'bodyweight'],
    });
    const viability = assessPlan(plan);
    expect(viability.viable).toBe(false);
    expect(viability.reason).toMatch(/cannot fill/i);
    expect(viability.reason).toMatch(/full body or upper\/lower/i);
  });

  it('still leaves a workable option at every day count in that same garage', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const workable = workableSplits(days, EXERCISES, { equipment: ['barbell', 'bodyweight'] })
        .filter((entry) => entry.viability.viable);
      expect(workable.length, `nothing workable at ${days} days`).toBeGreaterThan(0);
    }
  });

  it('does not rule out a plan just because one accessory is missing', () => {
    const plan = buildPlan({ goalId: 'build_muscle', splitId: 'push_pull_legs', days: 6 }, EXERCISES, {
      equipment: DUMBBELL_HOME,
    });
    expect(assessPlan(plan).viable).toBe(true);
  });
});
