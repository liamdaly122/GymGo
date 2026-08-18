import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useFinishedWorkouts } from '@/db/queries';
import { Card, EmptyState, Screen, ScreenTitle } from '@/components/ui';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { totalTonnage, totalWorkingSets } from '@/domain/volume';

/**
 * Headline numbers for each finished session, loaded in one pass rather than
 * per row, so a long history does not fan out into hundreds of queries.
 */
function useHistoryTotals(workoutIds: string[]) {
  const key = workoutIds.join(',');
  return useLiveQuery(async () => {
    if (workoutIds.length === 0) return new Map<string, { sets: number; tonnage: number }>();

    const workoutExercises = (
      await db.workout_exercises.where('workout_id').anyOf(workoutIds).toArray()
    ).filter((we) => we.deleted_at === null);

    const sets = (
      await db.sets.where('workout_exercise_id').anyOf(workoutExercises.map((we) => we.id)).toArray()
    ).filter((set) => set.deleted_at === null);

    const workoutIdByExercise = new Map(workoutExercises.map((we) => [we.id, we.workout_id]));
    const grouped = new Map<string, typeof sets>();
    for (const set of sets) {
      const workoutId = workoutIdByExercise.get(set.workout_exercise_id);
      if (!workoutId) continue;
      const bucket = grouped.get(workoutId);
      if (bucket) bucket.push(set);
      else grouped.set(workoutId, [set]);
    }

    return new Map(
      [...grouped.entries()].map(([workoutId, group]) => [
        workoutId,
        { sets: totalWorkingSets(group), tonnage: totalTonnage(group) },
      ]),
    );
  }, [key]);
}

export default function HistoryScreen() {
  const workouts = useFinishedWorkouts();
  const totals = useHistoryTotals((workouts ?? []).map((workout) => workout.id));

  return (
    <Screen>
      <ScreenTitle
        action={workouts ? <span className="text-xs text-muted">{workouts.length} sessions</span> : undefined}
      >
        History
      </ScreenTitle>

      {workouts === undefined ? null : workouts.length === 0 ? (
        <EmptyState title="No finished workouts yet." hint="Sessions appear here once you finish them." />
      ) : (
        <ul className="space-y-2">
          {workouts.map((workout) => {
            const total = totals?.get(workout.id);
            const duration = workout.finished_at
              ? Date.parse(workout.finished_at) - Date.parse(workout.started_at)
              : null;
            return (
              <li key={workout.id}>
                <Link to={`/history/${workout.id}`} className="block">
                  <Card className="flex items-center justify-between gap-3 p-4 active:bg-raised">
                    <div className="min-w-0">
                      <p className="text-sm text-white">{formatDayLabel(workout.started_at)}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {new Date(workout.started_at).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {duration !== null ? ` · ${formatDuration(duration)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums text-white">
                        {Math.round(total?.tonnage ?? 0).toLocaleString('en-GB')} kg
                      </p>
                      <p className="text-xs tabular-nums text-muted">{total?.sets ?? 0} sets</p>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
