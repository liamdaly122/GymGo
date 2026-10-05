import { useEffect, useState, type ReactNode } from 'react';
import type { WorkoutExerciseView, WorkoutView } from '@/db/queries';
import { usePreviousPerformance, useSetSuggestion } from '@/db/queries';
import { addSet } from '@/db/mutations';
import { Icon } from '@/components/icons';
import { setOrdinals } from '@/domain/sets';
import { setInHand, supersetLabel } from '@/domain/supersets';
import { formatClock } from '@/lib/dates';
import ExerciseSheet from './ExerciseSheet';
import { useRestTimer } from './RestTimer';
import SetChips from './SetChips';
import SetInHand from './SetInHand';
import SetSheet from './SetSheet';

/**
 * One station: a solo exercise, or a whole superset.
 *
 * The set in hand fills the screen; everything else about the station is a
 * row of chips you can tap into. A superset shows which half you are on, and
 * the other half sits underneath with its own chips and overflow, so pairing
 * two exercises never hides one of them.
 */
export default function StationCard({
  view,
  station,
  workoutId,
  pro,
  defaultRest,
  nextStationName,
  onNext,
  onFinish,
  onToast,
}: {
  view: WorkoutView;
  /** Indices into `view.exercises`. */
  station: number[];
  workoutId: string;
  pro: boolean;
  defaultRest: number;
  /** The station after this one, for the rest screen's "up next". */
  nextStationName: string | null;
  onNext: (() => void) | null;
  onFinish: () => void;
  onToast: (message: string) => void;
}) {
  const { setUpNext } = useRestTimer();
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [moreForId, setMoreForId] = useState<string | null>(null);

  const entries = station.map((index) => view.exercises[index]!);
  const stationSets = entries.map((entry) => entry.sets);
  const inHand = setInHand(stationSets);
  const sessionMembers = view.exercises.map((entry) => ({
    id: entry.workoutExercise.id,
    superset_group: entry.workoutExercise.superset_group,
  }));
  const badge = (index: number) => supersetLabel(sessionMembers, station[index]!);

  // With nothing left in hand, the rest screen points at what comes next.
  const doneLabel = nextStationName
    ? `Next exercise · ${nextStationName}`
    : 'Last set done. Finish when ready.';
  const allDone = inHand === null;
  useEffect(() => {
    if (allDone) setUpNext(doneLabel);
  }, [allDone, doneLabel, setUpNext]);

  const openSet = openSetId
    ? entries.flatMap((entry) => entry.sets.map((set) => ({ entry, set }))).find(({ set }) => set.id === openSetId)
    : undefined;
  const moreFor = moreForId ? view.exercises.findIndex((entry) => entry.workoutExercise.id === moreForId) : -1;

  const restFor = (entry: WorkoutExerciseView) =>
    entry.workoutExercise.rest_seconds ?? entry.exercise?.default_rest_seconds ?? defaultRest;

  const header = (entry: WorkoutExerciseView, size: 'big' | 'small') => {
    const name = entry.exercise?.name ?? 'Unknown exercise';
    const meta = [
      entry.exercise?.primary_muscle,
      entry.repRange
        ? entry.repRange.low === entry.repRange.high
          ? `${entry.repRange.low} reps`
          : `${entry.repRange.low}–${entry.repRange.high} reps`
        : null,
      `rest ${formatClock(restFor(entry) * 1000)}`,
    ].filter(Boolean);
    return (
      <div className="ex-head">
        <div className="ex-headtxt">
          {size === 'big' ? <h2 className="b-title">{name}</h2> : <h3 className="b-title">{name}</h3>}
          <p className="t-meta first-letter:uppercase">{meta.join(' · ')}</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setMoreForId(entry.workoutExercise.id)}
          aria-label={`More for ${name}`}
        >
          <Icon name="more" />
        </button>
      </div>
    );
  };

  const chips = (entry: WorkoutExerciseView, inHandId: string | null) => (
    <SetChips
      sets={entry.sets}
      ordinals={setOrdinals(entry.sets)}
      inHandId={inHandId}
      exerciseName={entry.exercise?.name ?? 'Exercise'}
      onOpen={setOpenSetId}
    />
  );

  /** Another set on each member: one more round of the pair. */
  const addRound = async () => {
    for (const entry of entries) {
      const last = entry.sets.filter((set) => set.parent_set_id === null && set.type !== 'warmup').at(-1);
      await addSet(entry.workoutExercise.id, { weight_kg: last?.weight_kg ?? 0, reps: last?.reps ?? 0 });
    }
  };

  return (
    <>
      {entries.length > 1 ? (
        <ol className="b-members" aria-label="Superset">
          {entries.map((entry, member) => (
            <li key={entry.workoutExercise.id} aria-current={inHand?.member === member ? 'step' : undefined}>
              {badge(member) ?? member + 1} · {entry.exercise?.name ?? 'Exercise'}
            </li>
          ))}
        </ol>
      ) : null}

      {inHand ? (
        <>
          <InHand
            key={entries[inHand.member]!.workoutExercise.id}
            entry={entries[inHand.member]!}
            setId={inHand.setId}
            memberIndex={inHand.member}
            stationSets={stationSets}
            superset={entries.length > 1}
            workoutId={workoutId}
            pro={pro}
            restSeconds={restFor(entries[inHand.member]!)}
            header={header(entries[inHand.member]!, 'big')}
            chips={chips(entries[inHand.member]!, inHand.setId)}
            onToast={onToast}
          />
          {entries.map((entry, member) =>
            member === inHand.member ? null : (
              <section key={entry.workoutExercise.id} className="partner" aria-label={entry.exercise?.name ?? 'Exercise'}>
                <p className="t-label">
                  {badge(member) ?? ''} · {member < inHand.member ? 'Just done' : 'Next in the round'}
                </p>
                {header(entry, 'small')}
                {chips(entry, null)}
              </section>
            ),
          )}
        </>
      ) : (
        <>
          <div className="b-complete">
            <p className="b-setlabel">All sets done</p>
            {entries.map((entry) => (
              <div key={entry.workoutExercise.id} className="stack-sm">
                {header(entry, 'big')}
                {chips(entry, null)}
              </div>
            ))}
            <button type="button" className="add-set" onClick={() => void addRound()}>
              {entries.length > 1 ? 'Add round' : 'Add set'}
            </button>
          </div>
          <div className="donebar">
            {onNext ? (
              <button type="button" className="btn btn-primary" onClick={onNext}>
                Next exercise <Icon name="arrow" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={onFinish}>
                Finish workout
              </button>
            )}
          </div>
        </>
      )}

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
    </>
  );
}

/**
 * The exercise whose set is in hand. Its own component so the suggestion and
 * last-time lookups are keyed to the exercise, and the fields reset per set.
 */
function InHand({
  entry,
  setId,
  memberIndex,
  stationSets,
  superset,
  workoutId,
  pro,
  restSeconds,
  header,
  chips,
  onToast,
}: {
  entry: WorkoutExerciseView;
  setId: string;
  memberIndex: number;
  stationSets: WorkoutExerciseView['sets'][];
  superset: boolean;
  workoutId: string;
  pro: boolean;
  restSeconds: number;
  header: ReactNode;
  chips: ReactNode;
  onToast: (message: string) => void;
}) {
  const suggestion = useSetSuggestion(workoutId, entry.exercise?.id);
  const previous = usePreviousPerformance(entry.exercise?.id, workoutId);
  const set = entry.sets.find((candidate) => candidate.id === setId);
  if (!set) return null;
  const ordinal = setOrdinals(entry.sets).get(set.id) ?? 0;

  return (
    <section className="b-ex" aria-label={entry.exercise?.name ?? 'Exercise'}>
      {header}
      {chips}
      <SetInHand
        key={set.id}
        entry={entry}
        set={set}
        ordinal={ordinal}
        memberIndex={memberIndex}
        stationSets={stationSets}
        superset={superset}
        pro={pro}
        restSeconds={restSeconds}
        suggestion={suggestion}
        previous={previous}
        onToast={onToast}
      />
    </section>
  );
}
