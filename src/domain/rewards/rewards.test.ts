import { describe, expect, it } from 'vitest';
import type { Plan, WorkoutSet } from '@/db/schema';
import type { Equipment } from '../types';
import { makeDropSet, makeSet, makeWorkout } from '../testFactories';
import { computeRewards, XP, type RewardSession, type RewardsInput } from './rewards';
import { addIsoDays } from './streak';

/** 7 September 2026 is a Monday. */
const MONDAY = '2026-09-07';
const at = (day: string, hour = 18) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

/** `count` working sets of `kg` × `reps`. */
const sets = (count: number, kg = 60, reps = 10): WorkoutSet[] =>
  Array.from({ length: count }, (_unused, index) => makeSet({ weight_kg: kg, reps, set_index: index }));

let sequence = 0;
function session(
  day: string,
  lifts: Array<[string, WorkoutSet[], Equipment?]>,
  options: { hour?: number; planId?: string; week?: number; index?: number } = {},
): RewardSession {
  sequence += 1;
  return {
    workout: makeWorkout({
      id: `w-${sequence}`,
      started_at: at(day, options.hour),
      finished_at: at(day, (options.hour ?? 18) + 1),
      plan_id: options.planId ?? null,
      plan_week: options.week ?? null,
      plan_session_index: options.index ?? null,
    }),
    exercises: lifts.map(([exerciseId, liftSets, equipment]) => ({
      exerciseId,
      equipment: equipment ?? 'dumbbell',
      sets: liftSets,
    })),
  };
}

const rewards = (sessions: RewardSession[], extra: Partial<RewardsInput> = {}) =>
  computeRewards({ sessions, plans: [], weekStartsOn: 1, today: new Date(`${addIsoDays(MONDAY, 70)}T12:00:00`), ...extra });

const linesOf = (result: ReturnType<typeof rewards>, workoutId: string) =>
  Object.fromEntries(result.sessions.get(workoutId)!.lines.map((line) => [line.source, line]));

describe('XP for a session', () => {
  it('pays for turning up and for each set', () => {
    const one = session(MONDAY, [['curl', sets(5)]]);
    const lines = linesOf(rewards([one]), one.workout.id);
    expect(lines.session!.xp).toBe(XP.session);
    expect(lines.sets).toMatchObject({ label: '5 sets', xp: 5 * XP.perSet });
  });

  it('stops paying for sets at thirty, so padding a session earns nothing', () => {
    const long = session(MONDAY, [['curl', sets(40)]]);
    expect(linesOf(rewards([long]), long.workout.id).sets).toMatchObject({ label: '40 sets', xp: 30 * XP.perSet });
  });

  it('needs three sets before a session counts as one', () => {
    const two = session(MONDAY, [['curl', sets(2)]]);
    const result = rewards([two]);
    const reward = result.sessions.get(two.workout.id)!;
    expect(reward.counts).toBe(false);
    expect(linesOf(result, two.workout.id).session).toBeUndefined();
    // The sets it did still pay, and it counts for nothing toward the week.
    expect(linesOf(result, two.workout.id).sets!.xp).toBe(2 * XP.perSet);
    expect(result.streak.weeks).toEqual([]);
  });

  it('never pays for warm-ups', () => {
    const warm = session(MONDAY, [['curl', [...sets(2), makeSet({ type: 'warmup' }), makeSet({ type: 'warmup' })]]]);
    expect(rewards([warm]).sessions.get(warm.workout.id)!.counts).toBe(false);
  });

  it('pays a little more for a session from the plan', () => {
    const planned = session(MONDAY, [['curl', sets(5)]], { planId: 'plan-1', week: 1, index: 0 });
    expect(linesOf(rewards([planned]), planned.workout.id).plan!.xp).toBe(XP.plan);
  });

  it('pays for each record broken, never for a first', () => {
    const first = session(MONDAY, [['bench', sets(3, 100, 5)]]);
    const better = session(addIsoDays(MONDAY, 2), [['bench', sets(3, 102.5, 5)]]);
    const result = rewards([first, better]);
    expect(linesOf(result, first.workout.id).records).toBeUndefined();
    expect(linesOf(result, better.workout.id).records).toMatchObject({ label: '1 record', xp: XP.record });
  });

  it('never lets a drop set score a record', () => {
    const { parent, children } = makeDropSet({ weight_kg: 90, reps: 5 }, [120]);
    const first = session(MONDAY, [['bench', sets(3, 100, 5)]]);
    const dropped = session(addIsoDays(MONDAY, 2), [['bench', [parent, ...children, ...sets(1, 80, 5)]]]);
    expect(rewards([first, dropped]).sessions.get(dropped.workout.id)!.records).toBe(0);
  });

  it('pays the session that hits the week’s target', () => {
    const week = [0, 2, 4].map((day) => session(addIsoDays(MONDAY, day), [['curl', sets(4)]]));
    const result = rewards(week);
    expect(week.map((one) => linesOf(result, one.workout.id).week?.xp ?? 0)).toEqual([0, 0, XP.week]);
    expect(result.sessions.get(week[2]!.workout.id)!.week).toEqual({ sessions: 3, target: 3, hit: true, hitHere: true });
  });

  it('welcomes you back after two weeks away, every time', () => {
    const before = session(MONDAY, [['curl', sets(4)]]);
    const back = session(addIsoDays(MONDAY, 16), [['curl', sets(4)]]);
    const again = session(addIsoDays(MONDAY, 40), [['curl', sets(4)]]);
    const result = rewards([before, back, again]);
    expect(linesOf(result, back.workout.id).comeback).toMatchObject({ label: 'Back after 16 days', xp: XP.comeback });
    expect(linesOf(result, again.workout.id).comeback!.xp).toBe(XP.comeback);
    // The badge, though, is once.
    const badges = (id: string) => result.sessions.get(id)!.badges.map((badge) => badge.badge.id);
    expect(badges(back.workout.id)).toContain('moments-comeback');
    expect(badges(again.workout.id)).not.toContain('moments-comeback');
  });

  it('carries the level from one session into the next', () => {
    const sessions = [0, 2, 4, 7].map((day) => session(addIsoDays(MONDAY, day), [['curl', sets(6)]]));
    const result = rewards(sessions);
    const ordered = sessions.map((one) => result.sessions.get(one.workout.id)!);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.before).toEqual(ordered[index - 1]!.after);
    }
    expect(result.xp).toBe(ordered.reduce((total, one) => total + one.xp, 0));
    expect(result.level).toEqual(ordered.at(-1)!.after);
  });
});

describe('a full block', () => {
  // One session a week, on Mondays, for two weeks.
  const block: Plan = {
    id: 'plan-1',
    name: 'Build muscle · Full body',
    goal: 'hypertrophy',
    days_per_week: 1,
    block_weeks: 2,
    current_week: 1,
    started_at: at(MONDAY, 8),
    routine_ids: ['a'],
    training_days: [1],
    phase_name: null,
    deload_week: 2,
    completed_at: null,
    user_id: null,
    created_at: at(MONDAY, 8),
    updated_at: at(MONDAY, 8),
    deleted_at: null,
  };

  it('pays the session that trains its last slot, and earns the badge', () => {
    const first = session(MONDAY, [['squat', sets(5)]], { planId: block.id, week: 1, index: 0 });
    const last = session(addIsoDays(MONDAY, 7), [['squat', sets(5)]], { planId: block.id, week: 2, index: 0 });
    const result = rewards([first, last], { plans: [block] });
    expect(linesOf(result, first.workout.id).block).toBeUndefined();
    expect(linesOf(result, last.workout.id).block!.xp).toBe(XP.block);
    expect(result.sessions.get(last.workout.id)!.badges.map((badge) => badge.badge.id)).toContain('blocks-1');
  });

  it('pays nothing for a block with a session never trained', () => {
    const only = session(MONDAY, [['squat', sets(5)]], { planId: block.id, week: 1, index: 0 });
    const result = rewards([only], { plans: [{ ...block, completed_at: at(addIsoDays(MONDAY, 9)) }] });
    expect(linesOf(result, only.workout.id).block).toBeUndefined();
  });
});

describe('badges', () => {
  const badgesOf = (result: ReturnType<typeof rewards>, workoutId: string) =>
    result.sessions.get(workoutId)!.badges.map((badge) => badge.badge.id);

  it('marks the first session and the tenth', () => {
    const sessions = Array.from({ length: 10 }, (_unused, index) => session(addIsoDays(MONDAY, index), [['curl', sets(3)]]));
    const result = rewards(sessions);
    expect(badgesOf(result, sessions[0]!.workout.id)).toContain('sessions-1');
    expect(badgesOf(result, sessions[9]!.workout.id)).toContain('sessions-10');
    expect(linesOf(result, sessions[9]!.workout.id).badges!.xp).toBeGreaterThanOrEqual(XP.badge);
  });

  it('counts plates from a barbell’s record-eligible sets only', () => {
    const { parent, children } = makeDropSet({ weight_kg: 100, reps: 5 }, [140]);
    const heavy = session(MONDAY, [
      ['bench', [parent, ...children, ...sets(2, 60, 5)], 'barbell'],
      ['press', sets(3, 150, 5), 'machine'],
    ]);
    const result = rewards([heavy]);
    const ids = badgesOf(result, heavy.workout.id);
    expect(ids).toContain('plates-60');
    expect(ids).toContain('plates-100');
    // The drop at 140 is not three plates, and a 150kg machine press is no bar.
    expect(ids).not.toContain('plates-140');
    expect(result.families.find((family) => family.family === 'plates')!.value).toBe(100);
  });

  it('counts drop sets toward the tonnes lifted', () => {
    const { parent, children } = makeDropSet({ weight_kg: 100, reps: 5 }, [80, 60]);
    // 100×5 + 80×8 + 60×8 = 1,620kg: past a tonne only with the drops in.
    const dropped = session(MONDAY, [['bench', [parent, ...children]]]);
    expect(badgesOf(rewards([dropped]), dropped.workout.id)).toContain('lifted-1000');
  });

  it('marks an early start and a late one, in local time', () => {
    const early = session(MONDAY, [['curl', sets(3)]], { hour: 6 });
    const late = session(addIsoDays(MONDAY, 1), [['curl', sets(3)]], { hour: 21 });
    const result = rewards([early, late]);
    expect(badgesOf(result, early.workout.id)).toContain('moments-early');
    expect(badgesOf(result, late.workout.id)).toContain('moments-late');
  });

  it('marks four weeks in a row on the session that hits the fourth', () => {
    const weeks = [0, 1, 2, 3].flatMap((week) =>
      [0, 2, 4].map((day) => session(addIsoDays(MONDAY, week * 7 + day), [['curl', sets(3)]])),
    );
    const result = rewards(weeks);
    expect(badgesOf(result, weeks.at(-1)!.workout.id)).toContain('streak-4');
    expect(badgesOf(result, weeks.at(-2)!.workout.id)).not.toContain('streak-4');
  });

  it('shows how far off the next badge in each family is', () => {
    const sessions = Array.from({ length: 7 }, (_unused, index) => session(addIsoDays(MONDAY, index), [['curl', sets(3)]]));
    const result = rewards(sessions);
    const tally = result.families.find((family) => family.family === 'sessions')!;
    expect(tally.value).toBe(7);
    expect(tally.next).toMatchObject({ remaining: 3, fraction: 0.7 });
    expect(tally.next!.badge.id).toBe('sessions-10');
    expect(result.next[0]!.fraction).toBeGreaterThanOrEqual(result.next.at(-1)!.fraction);
  });
});

describe('the whole history', () => {
  it('comes out the same every time', () => {
    const sessions = [0, 2, 4, 9, 30].map((day) => session(addIsoDays(MONDAY, day), [['bench', sets(4, 60 + day, 8)]]));
    expect(rewards(sessions)).toEqual(rewards([...sessions].reverse()));
  });

  it('is level 1 with nothing earned before the first session', () => {
    const result = rewards([]);
    expect(result.xp).toBe(0);
    expect(result.level.level).toBe(1);
    expect(result.families.every((family) => family.earned.length === 0)).toBe(true);
  });
});
