import { useId, useState } from 'react';
import type { WorkoutExerciseView, WorkoutView } from '@/db/queries';
import { useRecordMarks } from '@/db/queries';
import { companionTargets } from '@/domain/companion';
import { recordSetIds, type RecordMarks } from '@/domain/prs';
import { restSecondsFor } from '@/domain/rest';
import { setOrdinals } from '@/domain/sets';
import { supersetLabel } from '@/domain/supersets';
import { addRound } from './addRound';
import ExerciseInfo from './ExerciseInfo';
import ExerciseSheet from './ExerciseSheet';
import SetChips from './SetChips';
import SetSheet from './SetSheet';

/**
 * One station while the watch logs: the one the watch is on, or one picked
 * from the session list.
 *
 * Everything the phone is still for during a set lives here: the exercise's
 * information, fixing a set already logged (its chip), the overflow (swap,
 * move, warm-up, superset, remove), and one more set or round. A superset
 * shows both members, the one the watch is on marked as current, because the
 * pair is performed together.
 */
export default function NowOnWatch({
  view,
  station,
  workoutId,
  pro,
  defaultRest,
  watchSetId,
  skipped,
  kicker,
  following,
  onBack,
}: {
  view: WorkoutView;
  /** Indices into `view.exercises`. */
  station: number[];
  workoutId: string;
  pro: boolean;
  defaultRest: number;
  /** The set the watch has in hand, wherever it is. */
  watchSetId: string | null;
  /** Sets the watch skipped: it will not ask for them. */
  skipped: readonly string[];
  /** "On your watch", "Coming up" or "Done". */
  kicker: string;
  /** This is the watch's station, so the heading is lit. */
  following: boolean;
  /** Back to the station the watch is on; null while already showing it. */
  onBack: (() => void) | null;
}) {
  const headingId = useId();
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [moreForId, setMoreForId] = useState<string | null>(null);

  const entries = station.map((index) => view.exercises[index]!);
  const sessionMembers = view.exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));
  const badge = (member: number) => supersetLabel(sessionMembers, station[member]!);

  // Each member's next set: the watch's set in hand where it is, else its
  // first still to do, past any the watch skipped. The current member is the
  // one the watch is on, else whoever is next in the order the work is done.
  const { watchMember, current: currentMember, targets } = companionTargets(
    entries.map((entry) => entry.sets),
    watchSetId,
    skipped,
  );

  // What each lift's records stood at before today, for the blue chips.
  const prior = useRecordMarks(entries.map((entry) => entry.exercise?.id), workoutId);
  const priorFor = (entry: WorkoutExerciseView): RecordMarks | null =>
    entry.exercise ? (prior?.get(entry.exercise.id) ?? null) : null;
  // A lift entered twice in one session is still one lift: its sets are judged together.
  const liftSets = (entry: WorkoutExerciseView) =>
    entry.exercise
      ? view.exercises.filter((other) => other.exercise?.id === entry.exercise!.id).flatMap((other) => other.sets)
      : entry.sets;
  // A rest set on the routine, else the lift's own: 2:30, 2:00 or 1:30 by its size.
  const restFor = (entry: WorkoutExerciseView) =>
    entry.workoutExercise.rest_seconds ?? (entry.exercise ? restSecondsFor(entry.exercise) : defaultRest);

  // Looked up across the whole session, so a sheet stays open when the watch
  // moves on to another station under it.
  const openSet = openSetId
    ? view.exercises
        .flatMap((entry) => entry.sets.map((set) => ({ entry, set })))
        .find(({ set }) => set.id === openSetId)
    : undefined;
  const moreFor = moreForId ? view.exercises.findIndex((entry) => entry.workoutExercise.id === moreForId) : -1;

  return (
    <section className="stack" aria-labelledby={headingId}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className={following ? 'kicker' : 't-label'}>
          {kicker}
        </h2>
        {onBack ? (
          <button type="button" className="btn-text hot text-right" onClick={onBack}>
            Back to the watch's exercise
          </button>
        ) : null}
      </div>

      {entries.length > 1 ? (
        <ol className="b-members flex-wrap" aria-label="Superset">
          {entries.map((entry, member) => (
            <li key={entry.workoutExercise.id} aria-current={member === currentMember ? 'step' : undefined}>
              {badge(member) ?? member + 1} · {entry.exercise?.name ?? 'Exercise'}
            </li>
          ))}
        </ol>
      ) : null}

      {entries.map((entry, member) => (
        <ExerciseInfo
          key={entry.workoutExercise.id}
          entry={entry}
          targetSetId={targets[member] ?? null}
          workoutId={workoutId}
          pro={pro}
          restSeconds={restFor(entry)}
          onMore={() => setMoreForId(entry.workoutExercise.id)}
          chips={
            <SetChips
              sets={entry.sets}
              ordinals={setOrdinals(entry.sets)}
              // The watch's set is the watch's to log: shown as in hand, not opened here.
              inHandId={member === watchMember ? watchSetId : null}
              exerciseName={entry.exercise?.name ?? 'Exercise'}
              recordIds={recordSetIds(liftSets(entry), priorFor(entry))}
              onOpen={setOpenSetId}
            />
          }
        />
      ))}

      <button type="button" className="add-set" onClick={() => void addRound(entries)}>
        {entries.length > 1 ? 'Add round' : 'Add set'}
      </button>

      {openSet ? (
        <SetSheet
          set={openSet.set}
          ordinal={setOrdinals(openSet.entry.sets).get(openSet.set.id) ?? 0}
          exerciseName={openSet.entry.exercise?.name ?? 'Exercise'}
          onClose={() => setOpenSetId(null)}
        />
      ) : null}

      {moreFor >= 0 ? (
        <ExerciseSheet
          entry={view.exercises[moreFor]!}
          workoutId={workoutId}
          canMoveUp={moreFor > 0}
          canMoveDown={moreFor < view.exercises.length - 1}
          canPairWithNext={moreFor < view.exercises.length - 1}
          pairedWithNext={
            view.exercises[moreFor]!.workoutExercise.superset_group !== null &&
            view.exercises[moreFor]!.workoutExercise.superset_group ===
              view.exercises[moreFor + 1]?.workoutExercise.superset_group
          }
          onClose={() => setMoreForId(null)}
        />
      ) : null}
    </section>
  );
}
