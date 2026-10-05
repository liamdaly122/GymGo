/**
 * Rotating the accessories when a block ends.
 *
 * The brief: "At the end of a block, keep the main lifts and rotate the
 * accessories." The main lifts stay because they are what the block was
 * measuring, and their history is what the next block's suggestions start
 * from. The accessories are the isolation and core work hung off the end of
 * each session, and they are what goes stale.
 *
 * Which rows are accessories is read off their prescription
 * (`roleForPrescription`), since no column records it. Anything the lifter
 * added or re-prescribed by hand reads as no role at all, and stays.
 *
 * A replacement is another version of the same lift where the gym has one: a
 * lateral raise on a cable instead of dumbbells, a seated leg curl instead of
 * a lying one. The family keeps the job — the dataset files lateral, front and
 * rear delt raises all under "shoulders", and a leg extension and a hip
 * adduction both under "quadriceps", so the muscle alone would rotate a rear
 * delt fly into a front raise. Only a lift with no family, and core work, may
 * become a different exercise. A lift with nothing to rotate to stays put
 * rather than becoming the wrong thing.
 *
 * Ranked as a swap is (`exerciseAlternatives`): staples first, then the
 * closest match in kit and muscles. Last block's accessories are kept out
 * wherever the gym allows, and so is anything already rotated in elsewhere
 * that week, so the week genuinely changes rather than trading the same lifts
 * between sessions.
 *
 * Pure. The database layer supplies the rows and applies the result, and the
 * replacement takes each row over, prescription and all, as a swap does.
 */
import type { Exercise } from '@/db/schema';
import type { Equipment, Goal } from '../types';
import { exerciseAlternatives, liftFamily } from '../search';
import { roleForPrescription } from './prescribe';

/** One routine row, with the exercise in it. */
export interface RotationRow {
  id: string;
  exercise: Exercise;
  rep_range_low: number;
  rep_range_high: number;
  target_rir: number | null;
}

export interface Rotation {
  rowId: string;
  /** Which of the plan's sessions the row belongs to. */
  sessionIndex: number;
  from: Exercise;
  to: Exercise;
}

/** Deep enough that a few exclusions cannot empty the list. */
const CANDIDATES = 60;

/**
 * The accessories to change for the next block, session by session.
 *
 * `sessions` holds each of the plan's routines as its rows in session order.
 * `equipment` is the gym's: null or empty means "assume everything", as when
 * a plan is built. `avoidFamilies` are lifts the lifter ruled out in the
 * builder, which a rotation must not bring in. An accessory missing from the
 * result stays as it is.
 */
export function rotateAccessories(
  profile: Goal,
  sessions: readonly (readonly RotationRow[])[],
  exercises: Exercise[],
  options: { equipment?: Equipment[] | null; avoidFamilies?: readonly string[] } = {},
): Rotation[] {
  const isAccessory = (row: RotationRow) => roleForPrescription(profile, row) === 'accessory';
  const avoided = new Set(options.avoidFamilies ?? []);
  const allowed = avoided.size === 0
    ? exercises
    : exercises.filter((exercise) => !avoided.has(liftFamily(exercise.name) ?? ''));

  // Last block's accessories, the whole week of them.
  const outgoing = new Set(
    sessions.flatMap((rows) => rows.filter(isAccessory).map((row) => row.exercise.id)),
  );
  const rotatedIn = new Set<string>();
  const rotations: Rotation[] = [];

  sessions.forEach((rows, sessionIndex) => {
    const accessories = rows.filter(isAccessory);
    // Never the same lift twice in one session: what stays, and what has come in.
    const inSession = new Set(rows.filter((row) => !isAccessory(row)).map((row) => row.exercise.id));

    accessories.forEach((row, index) => {
      const current = row.exercise;
      const alternatives = exerciseAlternatives(current, allowed, {
        availableEquipment: options.equipment ?? null,
        limit: CANDIDATES,
      });
      const looseJob = liftFamily(current.name) === null || current.movement_pattern === 'core';

      // Lifts this session still holds, so two accessories do not just trade places.
      const stillHere = new Set(accessories.slice(index + 1).map((later) => later.exercise.id));
      const fresh = (candidate: Exercise) =>
        !inSession.has(candidate.id) && !outgoing.has(candidate.id) && !rotatedIn.has(candidate.id);
      // A thin gym: anything but this lift, even one from last week.
      const thin = (candidate: Exercise) =>
        !inSession.has(candidate.id) && !stillHere.has(candidate.id) && candidate.id !== current.id;

      const next =
        alternatives.variations.find(fresh) ??
        alternatives.variations.find(thin) ??
        (looseJob ? (alternatives.different.find(fresh) ?? alternatives.different.find(thin)) : undefined) ??
        current;

      inSession.add(next.id);
      if (next.id === current.id) return;
      rotatedIn.add(next.id);
      rotations.push({ rowId: row.id, sessionIndex, from: current, to: next });
    });
  });

  return rotations;
}
