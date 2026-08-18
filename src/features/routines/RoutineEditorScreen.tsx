import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoutine } from '@/db/queries';
import {
  addExerciseToRoutine,
  deleteRoutine,
  moveRoutineExercise,
  removeExerciseFromRoutine,
  startWorkoutFromRoutine,
  updateRoutine,
  updateRoutineExercise,
} from '@/db/mutations';
import { Button, Card, NumberField, Screen, ScreenTitle } from '@/components/ui';
import ExercisePicker from '@/features/exercises/ExercisePicker';

export default function RoutineEditorScreen() {
  const { routineId } = useParams<{ routineId: string }>();
  const navigate = useNavigate();
  const view = useRoutine(routineId);
  const [picking, setPicking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (view === undefined) {
    return (
      <Screen>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }
  if (!view || !routineId) {
    return (
      <Screen>
        <ScreenTitle>Not found</ScreenTitle>
        <Button onClick={() => void navigate('/routines')}>Back to routines</Button>
      </Screen>
    );
  }

  const handleStart = async () => {
    const workoutId = await startWorkoutFromRoutine(routineId);
    void navigate(`/workout/${workoutId}`);
  };

  const handleDelete = async () => {
    await deleteRoutine(routineId);
    void navigate('/routines', { replace: true });
  };

  return (
    <Screen>
      <Link to="/routines" className="mb-3 inline-block text-xs text-muted">
        ← Routines
      </Link>

      <input
        defaultValue={view.routine.name}
        onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          if (value !== '' && value !== view.routine.name) {
            void updateRoutine(routineId, { name: value });
          } else {
            event.currentTarget.value = view.routine.name;
          }
        }}
        aria-label="Routine name"
        className="mb-4 w-full bg-transparent text-2xl font-semibold tracking-tight text-white focus:outline-none"
      />

      <Button variant="primary" className="mb-4 h-14 w-full text-base" onClick={() => void handleStart()}>
        Start this workout
      </Button>

      {view.exercises.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-white">No exercises yet.</p>
          <p className="mt-1 text-xs text-muted">Add the lifts you want in this session.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {view.exercises.map((entry, index) => (
            <li key={entry.routineExercise.id}>
              <Card className="p-3">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {entry.exercise?.name ?? 'Unknown exercise'}
                    </p>
                    <p className="truncate text-xs text-muted first-letter:uppercase">
                      {entry.exercise?.primary_muscle}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => void moveRoutineExercise(routineId, entry.routineExercise.id, 'up')}
                      disabled={index === 0}
                      aria-label={`Move ${entry.exercise?.name ?? 'exercise'} up`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted disabled:opacity-25 active:bg-raised"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => void moveRoutineExercise(routineId, entry.routineExercise.id, 'down')}
                      disabled={index === view.exercises.length - 1}
                      aria-label={`Move ${entry.exercise?.name ?? 'exercise'} down`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted disabled:opacity-25 active:bg-raised"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => void removeExerciseFromRoutine(entry.routineExercise.id)}
                      aria-label={`Remove ${entry.exercise?.name ?? 'exercise'} from routine`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted active:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Field label="Sets">
                    <NumberField
                      value={entry.routineExercise.target_sets}
                      onCommit={(value) =>
                        void updateRoutineExercise(entry.routineExercise.id, {
                          target_sets: Math.max(1, Math.round(value)),
                        })
                      }
                      aria-label={`${entry.exercise?.name ?? 'Exercise'} target sets`}
                    />
                  </Field>
                  <Field label="Reps from">
                    <NumberField
                      value={entry.routineExercise.rep_range_low}
                      onCommit={(value) =>
                        void updateRoutineExercise(entry.routineExercise.id, {
                          rep_range_low: Math.max(1, Math.round(value)),
                        })
                      }
                      aria-label={`${entry.exercise?.name ?? 'Exercise'} rep range low`}
                    />
                  </Field>
                  <Field label="to">
                    <NumberField
                      value={entry.routineExercise.rep_range_high}
                      onCommit={(value) =>
                        void updateRoutineExercise(entry.routineExercise.id, {
                          rep_range_high: Math.max(1, Math.round(value)),
                        })
                      }
                      aria-label={`${entry.exercise?.name ?? 'Exercise'} rep range high`}
                    />
                  </Field>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Button className="mt-4 w-full" onClick={() => setPicking(true)}>
        Add exercise
      </Button>

      <div className="mt-8 border-t border-line pt-4">
        <label htmlFor="routine-notes" className="mb-2 block text-xs uppercase tracking-wide text-muted">
          Notes
        </label>
        <textarea
          id="routine-notes"
          defaultValue={view.routine.notes ?? ''}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim();
            void updateRoutine(routineId, { notes: value === '' ? null : value });
          }}
          rows={2}
          placeholder="Anything you want to remember about this session"
          className="w-full resize-none rounded-lg border border-line bg-raised p-3 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
        />

        {confirmingDelete ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted">
              Deleting a routine leaves every workout you did from it untouched.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" onClick={() => void handleDelete()}>
                Delete routine
              </Button>
              <Button className="flex-1" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="mt-4 text-xs text-muted">
            Delete routine
          </button>
        )}
      </div>

      {picking ? (
        <ExercisePicker
          title="Add to routine"
          onPick={(exerciseId) => {
            setPicking(false);
            void addExerciseToRoutine(routineId, exerciseId);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-center text-[10px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="flex">{children}</div>
    </div>
  );
}
