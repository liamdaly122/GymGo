import type { WorkoutExerciseView } from '@/db/queries';
import { Button, Sheet } from '@/components/ui';
import SessionList, { doneOf } from './SessionList';

/**
 * The whole session, in order, a tap from the header.
 *
 * From the gym: the screen shows one exercise at a time, so nothing said
 * what was coming, or which machine to go and find. Each row names the
 * exercises with their kit and their work, says how far along each one is,
 * and marks in blue where you are. Tapping one goes there.
 *
 * The list itself is `SessionList`, which the companion screen shows in the
 * open while the watch logs.
 */
export default function SessionSheet({
  stations,
  exercises,
  focused,
  onPick,
  onClose,
}: {
  /** Indices into `exercises`, one array per station. */
  stations: number[][];
  exercises: WorkoutExerciseView[];
  focused: number;
  onPick: (station: number) => void;
  onClose: () => void;
}) {
  const finished = stations.filter((station) => doneOf(station.map((index) => exercises[index]!)).complete).length;

  return (
    <Sheet label="This session" onClose={onClose}>
      <h2>This session</h2>
      <p className="sheet-note">
        {stations.length} {stations.length === 1 ? 'exercise' : 'exercises'} · {finished} done
      </p>
      <SessionList stations={stations} exercises={exercises} focused={focused} onPick={onPick} />
      <Button onClick={onClose}>Close</Button>
    </Sheet>
  );
}
