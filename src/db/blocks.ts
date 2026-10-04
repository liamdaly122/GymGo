/**
 * Reads behind the end of a block: which gym it is built against, which number
 * the next one will be, and what that one rotates.
 *
 * Shared by the mutation that starts the next block and the screens that
 * preview it, so what the preview shows is exactly what starting it does.
 * Reads only: writes stay in mutations.ts.
 */
import { db } from './db';
import { SETTINGS_ID, type Gym, type Plan } from './schema';
import { rotateAccessories, type Rotation } from '@/domain/programmes/rotation';

/** The gym plans are built against: the one settings name, else the default. */
export async function defaultGym(): Promise<Gym | null> {
  const gyms = (await db.gyms.toArray()).filter((gym) => gym.deleted_at === null);
  const settings = await db.settings.get(SETTINGS_ID);
  const preferred = settings?.default_gym_id
    ? gyms.find((gym) => gym.id === settings.default_gym_id)
    : undefined;
  return preferred ?? gyms.find((gym) => gym.is_default) ?? gyms[0] ?? null;
}

/** Strips a trailing "(block N)" so the counter does not stack up. */
export function baseBlockName(name: string): string {
  return name.replace(/\s*\(block \d+\)$/, '');
}

/** Which block of its plan this one is: 1 for the first, 2 for "(block 2)". */
export function blockNumber(plan: Pick<Plan, 'name'>): number {
  const match = /\(block (\d+)\)$/.exec(plan.name);
  return match ? Number(match[1]) : 1;
}

/** The number the block after this one will take. */
export async function nextBlockNumber(plan: Plan): Promise<number> {
  const base = baseBlockName(plan.name);
  const siblings = (await db.plans.toArray()).filter(
    (other) => other.deleted_at === null && baseBlockName(other.name) === base,
  );
  return siblings.length + 1;
}

/**
 * The accessories the next block would rotate, worked out from the plan's
 * routines as they stand and the default gym's equipment.
 */
export async function nextBlockRotation(plan: Plan): Promise<Rotation[]> {
  const routineIds = [...new Set(plan.routine_ids)];
  const rows = (await db.routine_exercises.where('routine_id').anyOf(routineIds).toArray()).filter(
    (row) => row.deleted_at === null,
  );
  const exercises = (await db.exercises.toArray()).filter((exercise) => exercise.deleted_at === null);
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const sessions = routineIds.map((routineId) =>
    rows
      .filter((row) => row.routine_id === routineId)
      .sort((a, b) => a.position - b.position)
      .flatMap((row) => {
        const exercise = byId.get(row.exercise_id);
        return exercise ? [{ ...row, exercise }] : [];
      }),
  );

  const gym = await defaultGym();
  return rotateAccessories(plan.goal, sessions, exercises, { equipment: gym?.equipment_available ?? null });
}
