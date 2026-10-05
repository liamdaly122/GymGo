/**
 * What training has earned: XP, the level, the weekly streak and the badges.
 *
 * Worked out from the finished workouts every time, never stored. That keeps
 * it free of the database: no column, no migration for the owner to run, and
 * nothing to sync — a restore or a new phone arrives at exactly the same
 * level, and two years of history counted the day this was added.
 *
 * What it rewards is turning up, finishing the plan and getting stronger. Set
 * XP stops at thirty sets, so padding a session with junk volume pays nothing
 * extra; rest days and the deload week cost nothing; and a banked week keeps
 * a streak through a holiday. Records come from `recordsBrokenPerSession`, so
 * a first is never a record and a drop set never scores; volume and tonnage
 * from `volume.ts`, where drop sets do count.
 *
 * Pure. One pass over the sessions, oldest first.
 */
import type { Plan, Workout, WorkoutSet } from '@/db/schema';
import type { Equipment } from '../types';
import { recordsBrokenPerSession } from '../prs';
import { buildSchedule, localIsoDate } from '../schedule';
import { isTopWorkingSet } from '../sets';
import { totalTonnage, totalWorkingSets } from '../volume';
import { BADGES, FAMILIES, FAMILY_NAMES, type Badge, type BadgeFamily } from './badges';
import { levelFor, type LevelProgress } from './levels';
import { dayOf, streakWalk, type Streak } from './streak';

/** What each thing is worth. */
export const XP = {
  /** A session that counts. */
  session: 50,
  /** Each set done, warm-ups aside, up to `setCap` of them. */
  perSet: 5,
  setCap: 30,
  /** A session from the plan. */
  plan: 25,
  /** Each record broken. */
  record: 50,
  /** The session that hits its week's target. */
  week: 100,
  /** The session that finishes a block with every session trained. */
  block: 300,
  /** Training again after `COMEBACK_DAYS` away. */
  comeback: 100,
  /** Each badge. */
  badge: 100,
} as const;

/** Sets a session needs before it counts as one — for the streak and the session XP. */
export const COUNTING_SETS = 3;
/** Days away that make the next session a comeback. */
export const COMEBACK_DAYS = 14;
/** Before this hour a session is an early one; from `LATE_HOUR` on, a late one. */
export const EARLY_HOUR = 7;
export const LATE_HOUR = 21;

export interface RewardSession {
  /** A finished workout. */
  workout: Workout;
  exercises: Array<{ exerciseId: string; equipment: Equipment; sets: WorkoutSet[] }>;
}

export interface RewardsInput {
  sessions: readonly RewardSession[];
  plans: readonly Plan[];
  /** 1 = Monday, 0 = Sunday. */
  weekStartsOn: number;
  today: Date;
}

export type XpSource = 'session' | 'sets' | 'plan' | 'records' | 'week' | 'block' | 'comeback' | 'badges';

export interface XpLine {
  source: XpSource;
  /** "18 sets", "Week hit", "Back after 16 days". */
  label: string;
  xp: number;
}

export interface EarnedBadge {
  badge: Badge;
  workoutId: string;
  /** When the session that earned it started. */
  at: string;
}

export interface SessionReward {
  workoutId: string;
  /** Three sets or more: a session, for the streak and the session XP. */
  counts: boolean;
  lines: XpLine[];
  xp: number;
  before: LevelProgress;
  after: LevelProgress;
  records: number;
  badges: EarnedBadge[];
  /** The session's week, as it stood once this session was done. */
  week: { sessions: number; target: number; hit: boolean; hitHere: boolean };
  /** The streak once this session was done. */
  streak: number;
}

export interface FamilyProgress {
  family: BadgeFamily;
  name: string;
  /** Where the family stands, in its own unit: sessions, weeks, records, kg. */
  value: number;
  earned: EarnedBadge[];
  /** The next badge to earn, and how far off it is. Null once every one is earned. */
  next: { badge: Badge; remaining: number; fraction: number } | null;
}

export interface Rewards {
  xp: number;
  level: LevelProgress;
  streak: Streak;
  sessions: Map<string, SessionReward>;
  families: FamilyProgress[];
  /** The badges nearest to being earned, nearest first. */
  next: Array<{ family: BadgeFamily; badge: Badge; remaining: number; fraction: number }>;
}

/** The sessions that finished a block with every session trained, by workout id. */
function fullBlocks(sessions: readonly RewardSession[], plans: readonly Plan[], today: Date): Set<string> {
  const finishing = new Set<string>();
  for (const plan of plans) {
    if (plan.deleted_at !== null) continue;
    const workouts = sessions.map((session) => session.workout).filter((workout) => workout.plan_id === plan.id);
    if (workouts.length === 0) continue;
    // The schedule's own rule, as `isBlockComplete` reads it: every slot trained.
    const schedule = buildSchedule({ plan, routineNames: new Map(), workouts, today });
    if (schedule.length === 0 || schedule.some((slot) => slot.status !== 'done')) continue;
    const trained = workouts.filter((workout) => schedule.some((slot) => slot.workoutId === workout.id));
    const last = trained.reduce((a, b) => (b.started_at > a.started_at ? b : a));
    finishing.add(last.id);
  }
  return finishing;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function computeRewards(input: RewardsInput): Rewards {
  const sessions = [...input.sessions].sort((a, b) => a.workout.started_at.localeCompare(b.workout.started_at));
  const records = recordsBrokenPerSession(
    sessions.map((session) => ({ id: session.workout.id, exercises: session.exercises })),
  );
  const finishesBlock = fullBlocks(sessions, input.plans, input.today);
  const streak = streakWalk(input.plans, input.weekStartsOn);

  const earned = new Map<string, EarnedBadge>();
  const rewards = new Map<string, SessionReward>();
  let xp = 0;
  let sessionCount = 0;
  let recordCount = 0;
  let tonnage = 0;
  let blocks = 0;
  let heaviestBarbell = 0;
  let lastCountingDay: string | null = null;

  for (const session of sessions) {
    const { workout } = session;
    const sets = session.exercises.flatMap((entry) => entry.sets);
    const setCount = totalWorkingSets(sets);
    const counts = setCount >= COUNTING_SETS;
    const day = dayOf(workout.started_at);
    const broken = records.get(workout.id) ?? 0;
    const lines: XpLine[] = [];

    if (counts) lines.push({ source: 'session', label: 'Session', xp: XP.session });
    if (setCount > 0) {
      const paid = Math.min(setCount, XP.setCap);
      lines.push({ source: 'sets', label: plural(setCount, 'set', 'sets'), xp: paid * XP.perSet });
    }
    if (counts && workout.plan_id !== null) lines.push({ source: 'plan', label: 'On plan', xp: XP.plan });
    if (broken > 0) lines.push({ source: 'records', label: plural(broken, 'record', 'records'), xp: broken * XP.record });

    let week: SessionReward['week'] = { sessions: 0, target: 0, hit: false, hitHere: false };
    let run = 0;
    let comeback = false;
    if (counts) {
      const counted = streak.count(day);
      week = { sessions: counted.week.sessions, target: counted.week.target, hit: counted.week.status === 'hit', hitHere: counted.hit };
      run = counted.streak;
      if (counted.hit) lines.push({ source: 'week', label: 'Week hit', xp: XP.week });

      const away = lastCountingDay ? Math.round((Date.parse(`${day}T12:00:00`) - Date.parse(`${lastCountingDay}T12:00:00`)) / 86_400_000) : 0;
      if (away >= COMEBACK_DAYS) {
        comeback = true;
        lines.push({ source: 'comeback', label: `Back after ${away} days`, xp: XP.comeback });
      }
      sessionCount += 1;
      lastCountingDay = day;
    }
    if (finishesBlock.has(workout.id)) {
      blocks += 1;
      lines.push({ source: 'block', label: 'Block finished', xp: XP.block });
    }

    recordCount += broken;
    tonnage += totalTonnage(sets);
    for (const entry of session.exercises) {
      if (entry.equipment !== 'barbell') continue;
      for (const set of entry.sets) {
        if (isTopWorkingSet(set)) heaviestBarbell = Math.max(heaviestBarbell, set.weight_kg);
      }
    }

    // Badges, against where everything stands once this session is in.
    const hour = new Date(workout.started_at).getHours();
    const reached: Record<BadgeFamily, number> = {
      sessions: sessionCount,
      streak: streak.best(),
      records: recordCount,
      lifted: tonnage,
      blocks,
      plates: heaviestBarbell,
      moments: 0,
    };
    const moments = new Set<string>([
      ...(comeback ? ['moments-comeback'] : []),
      ...(counts && hour < EARLY_HOUR ? ['moments-early'] : []),
      ...(counts && hour >= LATE_HOUR ? ['moments-late'] : []),
    ]);
    const badges: EarnedBadge[] = [];
    for (const badge of BADGES) {
      if (earned.has(badge.id)) continue;
      const won = badge.family === 'moments' ? moments.has(badge.id) : reached[badge.family] >= badge.threshold;
      if (!won) continue;
      const entry = { badge, workoutId: workout.id, at: workout.started_at };
      earned.set(badge.id, entry);
      badges.push(entry);
    }
    if (badges.length > 0) {
      lines.push({ source: 'badges', label: plural(badges.length, 'badge', 'badges'), xp: badges.length * XP.badge });
    }

    const gained = lines.reduce((total, line) => total + line.xp, 0);
    rewards.set(workout.id, {
      workoutId: workout.id,
      counts,
      lines,
      xp: gained,
      before: levelFor(xp),
      after: levelFor(xp + gained),
      records: broken,
      badges,
      week,
      streak: run,
    });
    xp += gained;
  }

  const final = streak.finish(localIsoDate(input.today));
  const values: Record<BadgeFamily, number> = {
    sessions: sessionCount,
    streak: final.best,
    records: recordCount,
    lifted: tonnage,
    blocks,
    plates: heaviestBarbell,
    moments: BADGES.filter((badge) => badge.family === 'moments' && earned.has(badge.id)).length,
  };

  const families: FamilyProgress[] = FAMILIES.map((family) => {
    const own = BADGES.filter((badge) => badge.family === family);
    const upcoming = family === 'moments' ? undefined : own.find((badge) => !earned.has(badge.id));
    return {
      family,
      name: FAMILY_NAMES[family],
      value: values[family],
      earned: own.flatMap((badge) => earned.get(badge.id) ?? []),
      next: upcoming
        ? {
            badge: upcoming,
            remaining: Math.max(0, upcoming.threshold - values[family]),
            fraction: Math.min(1, values[family] / upcoming.threshold),
          }
        : null,
    };
  });

  const next = families
    .flatMap((family) => (family.next ? [{ family: family.family, ...family.next }] : []))
    .sort((a, b) => b.fraction - a.fraction || a.remaining - b.remaining);

  return { xp, level: levelFor(xp), streak: final, sessions: rewards, families, next };
}
