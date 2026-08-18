import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useExercise, useExerciseRecords } from '@/db/queries';
import { updateExercise } from '@/db/mutations';
import { Button, Card, Pill, Screen, ScreenTitle } from '@/components/ui';
import { estimate1RMRounded } from '@/domain/epley';
import { formatDayLabel } from '@/lib/dates';
import { EQUIPMENT_LABELS, PATTERN_LABELS } from './labels';

export default function ExerciseDetailScreen() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();
  const exercise = useExercise(exerciseId);
  const stats = useExerciseRecords(exerciseId);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  if (exercise === undefined) {
    return (
      <Screen>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }
  if (!exercise) {
    return (
      <Screen>
        <ScreenTitle>Not found</ScreenTitle>
        <Button onClick={() => void navigate('/exercises')}>Back to library</Button>
      </Screen>
    );
  }

  const notes = notesDraft ?? exercise.setup_notes ?? '';
  const records = stats?.records;

  return (
    <Screen>
      <Link to="/exercises" className="mb-3 inline-block text-xs text-muted">
        ← Library
      </Link>
      <ScreenTitle>{exercise.name}</ScreenTitle>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Pill tone="accent">{PATTERN_LABELS[exercise.movement_pattern]}</Pill>
        <Pill>{EQUIPMENT_LABELS[exercise.equipment]}</Pill>
        <Pill>{exercise.is_compound ? 'Compound' : 'Isolation'}</Pill>
        {exercise.is_unilateral ? <Pill>Unilateral</Pill> : null}
        {exercise.is_custom ? <Pill>Custom</Pill> : null}
      </div>

      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Muscles</h2>
        <p className="text-sm text-white first-letter:uppercase">{exercise.primary_muscle}</p>
        {exercise.secondary_muscles.length > 0 ? (
          <p className="mt-1 text-xs text-muted first-letter:uppercase">
            Also: {exercise.secondary_muscles.join(', ')}
          </p>
        ) : null}
      </Card>

      {/*
        Setup notes are the small feature that saves the most time in practice:
        seat height, pin position, which bar. Shown again during the set.
      */}
      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Setup notes</h2>
        <textarea
          value={notes}
          onChange={(event) => setNotesDraft(event.target.value)}
          onBlur={() => {
            if (notesDraft === null) return;
            const trimmed = notesDraft.trim();
            void updateExercise(exercise.id, { setup_notes: trimmed === '' ? null : trimmed });
            setNotesDraft(null);
          }}
          rows={2}
          placeholder="Seat height, pin position, grip width, which bar…"
          className="w-full resize-none rounded-lg border border-line bg-raised p-3 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-muted">Shown while you are logging this exercise.</p>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Records</h2>
        {stats === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !records?.heaviest ? (
          <p className="text-sm text-muted">No completed sets yet.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Heaviest set</dt>
              <dd className="tabular-nums text-white">
                {records.heaviest.weight_kg}kg × {records.heaviest.reps}
                <span className="ml-2 text-xs text-muted">
                  {formatDayLabel(records.heaviest.completed_at ?? records.heaviest.created_at)}
                </span>
              </dd>
            </div>
            {records.bestE1rm ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Best estimated 1RM</dt>
                <dd className="tabular-nums text-white">
                  {estimate1RMRounded(records.bestE1rm.set.weight_kg, records.bestE1rm.set.reps)}kg
                  <span className="ml-2 text-xs text-muted">
                    from {records.bestE1rm.set.weight_kg}kg × {records.bestE1rm.set.reps}
                  </span>
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Sessions</dt>
              <dd className="tabular-nums text-white">{stats?.sessionCount ?? 0}</dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Records come from top working sets only. Drop sets and rest-pause clusters count toward
          volume, never toward a record.
        </p>
      </Card>

      {exercise.demo_url ? (
        <a
          href={exercise.demo_url}
          target="_blank"
          rel="noreferrer noopener"
          className="block text-xs text-accent"
        >
          View demonstration ↗
        </a>
      ) : null}
    </Screen>
  );
}
