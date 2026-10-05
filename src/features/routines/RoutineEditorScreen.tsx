import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRoutine, useSettings } from '@/db/queries';
import {
  addExerciseToRoutine,
  deleteRoutine,
  moveRoutineExercise,
  removeExerciseFromRoutine,
  startWorkoutFromRoutine,
  updateRoutine,
  updateRoutineExercise,
} from '@/db/mutations';
import { BackLink, Button, NumberField, Screen, ScreenHeader, SectionLabel, Segmented, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { restSecondsFor } from '@/domain/rest';
import { estimateDurationMinutes } from '@/domain/sessionSummary';
import { isPyramid, type Scheme } from '@/domain/schemes';
import ExercisePicker from '@/features/exercises/ExercisePicker';
import RoutineSwap from '@/features/swap/RoutineSwap';
import { Toast, useToast } from '@/components/Toast';

/**
 * A routine: the template a workout is copied from.
 *
 * Starting it copies every prescription onto the session rather than pointing
 * at this screen, so nothing edited here can reach a workout already done.
 */
export default function RoutineEditorScreen() {
  const { routineId } = useParams<{ routineId: string }>();
  const navigate = useNavigate();
  const view = useRoutine(routineId);
  const settings = useSettings();
  const pro = settings?.mode === 'pro';
  const [picking, setPicking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  if (view === undefined) {
    return (
      <Screen>
        <p className="t-meta pt-6">Loading…</p>
      </Screen>
    );
  }
  if (!view || !routineId) {
    return (
      <Screen>
        <ScreenHeader title="Not found" />
        <Button onClick={() => void navigate('/plan')}>Back to Plan</Button>
      </Screen>
    );
  }

  // Generated routines are named "<plan> — <session>"; the session is the name.
  const [planPart, ...sessionParts] = view.routine.name.split(' — ');
  const shortName = sessionParts.length > 0 ? sessionParts.join(' — ') : view.routine.name;
  const minutes = estimateDurationMinutes(
    view.exercises.map((entry) => ({
      sets: entry.routineExercise.target_sets,
      restSeconds: entry.routineExercise.rest_seconds ?? (entry.exercise ? restSecondsFor(entry.exercise) : 120),
    })),
  );

  const handleStart = async () => {
    const workoutId = await startWorkoutFromRoutine(routineId);
    void navigate(`/workout/${workoutId}`);
  };

  const handleDelete = async () => {
    await deleteRoutine(routineId);
    void navigate('/plan', { replace: true });
  };

  return (
    <Screen>
      <BackLink to="/plan">Plan</BackLink>
      <header className="top">
        <div className="top-txt min-w-0 flex-1">
          <p className="t-label">
            {view.routine.generated_from_plan_id ? `${planPart} · from your plan` : 'Your routine'}
          </p>
          <h1 className="sr-only">{view.routine.name}</h1>
          <input
            key={view.routine.name}
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
            className="title-input"
          />
          <p className="t-meta">
            {view.exercises.length} {view.exercises.length === 1 ? 'exercise' : 'exercises'}
            {view.exercises.length > 0 ? ` · about ${minutes} min` : ''}
          </p>
        </div>
      </header>

      <div className="stack">
        <Button variant="primary" size="lg" block onClick={() => void handleStart()}>
          Start {shortName}
        </Button>

        <section aria-labelledby="routine-exercises">
          <SectionLabel id="routine-exercises">Exercises</SectionLabel>
          {view.exercises.length === 0 ? (
            <p className="t-meta">No exercises yet. Add the lifts you want in this session.</p>
          ) : (
            <ul className="list">
              {view.exercises.map((entry, index) => {
                const name = entry.exercise?.name ?? 'Exercise';
                return (
                  <li key={entry.routineExercise.id} className="stack-sm border-t border-line py-4 first:border-t-0">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{entry.exercise?.name ?? 'Unknown exercise'}</p>
                        <p className="t-meta first-letter:uppercase">{entry.exercise?.primary_muscle}</p>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setSwapping(entry.routineExercise.id)}
                        aria-label={`Swap ${name}`}
                      >
                        <Icon name="swap" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void moveRoutineExercise(routineId, entry.routineExercise.id, 'up')}
                        disabled={index === 0}
                        aria-label={`Move ${name} up`}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void moveRoutineExercise(routineId, entry.routineExercise.id, 'down')}
                        disabled={index === view.exercises.length - 1}
                        aria-label={`Move ${name} down`}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void removeExerciseFromRoutine(entry.routineExercise.id)}
                        aria-label={`Remove ${name} from routine`}
                      >
                        <Icon name="x" />
                      </button>
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
                          aria-label={`${name} target sets`}
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
                          aria-label={`${name} rep range low`}
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
                          aria-label={`${name} rep range high`}
                        />
                      </Field>
                    </div>

                    {/* Pro prescriptions. Every field here already exists in the
                        schema and is stored null in Beginner, so switching modes
                        never migrates anything or loses what you set. All of them
                        are copied onto the session by startWorkoutFromRoutine
                        rather than referenced, so editing them later cannot reach
                        a workout already performed. */}
                    {pro ? (
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Target RIR">
                          <NumberField
                            value={entry.routineExercise.target_rir ?? 0}
                            blankWhenZero
                            placeholder="—"
                            onCommit={(value) =>
                              void updateRoutineExercise(entry.routineExercise.id, {
                                target_rir: value <= 0 ? null : Math.min(5, Math.round(value)),
                              })
                            }
                            aria-label={`${name} target reps in reserve`}
                          />
                        </Field>
                        <Field label="Rest">
                          <NumberField
                            value={entry.routineExercise.rest_seconds ?? 0}
                            blankWhenZero
                            // Blank means the lift's own rest, which is why this
                            // is nullable rather than pre-filled.
                            placeholder={String(entry.exercise ? restSecondsFor(entry.exercise) : 120)}
                            suffix="s"
                            onCommit={(value) =>
                              void updateRoutineExercise(entry.routineExercise.id, {
                                rest_seconds: value <= 0 ? null : Math.round(value),
                              })
                            }
                            aria-label={`${name} rest seconds`}
                          />
                        </Field>
                        <Field label="Tempo">
                          <input
                            defaultValue={entry.routineExercise.tempo ?? ''}
                            placeholder="3-1-1-0"
                            onBlur={(event) => {
                              const value = event.currentTarget.value.trim();
                              void updateRoutineExercise(entry.routineExercise.id, {
                                tempo: value === '' ? null : value,
                              });
                            }}
                            aria-label={`${name} tempo`}
                            className="field h-12 text-center"
                          />
                        </Field>
                        {/* A pyramid's top set is the working set the progression
                            engine judges; the rest are back-off sets around it. */}
                        <div className="col-span-3">
                          <Segmented<Scheme>
                            label={`${name} set scheme`}
                            options={[
                              { value: 'straight', label: 'Straight' },
                              { value: 'pyramid', label: 'Pyramid' },
                              { value: 'reverse_pyramid', label: 'Reverse' },
                            ]}
                            value={isPyramid(entry.routineExercise.technique) ? entry.routineExercise.technique : 'straight'}
                            onChange={(technique) =>
                              void updateRoutineExercise(entry.routineExercise.id, { technique })
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <Button className="mt-3" block onClick={() => setPicking(true)}>
            Add exercise
          </Button>
        </section>

        <section aria-labelledby="routine-notes-label">
          <SectionLabel id="routine-notes-label">Notes</SectionLabel>
          <textarea
            id="routine-notes"
            aria-labelledby="routine-notes-label"
            defaultValue={view.routine.notes ?? ''}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              void updateRoutine(routineId, { notes: value === '' ? null : value });
            }}
            rows={2}
            placeholder="Anything you want to remember about this session"
            className="field h-auto resize-none py-3"
          />
        </section>

        <button type="button" className="btn-text text-danger" onClick={() => setConfirmingDelete(true)}>
          Delete routine
        </button>
      </div>

      {confirmingDelete ? (
        <Sheet label="Delete routine" onClose={() => setConfirmingDelete(false)}>
          <h2>Delete {shortName}?</h2>
          <p className="sheet-note">Every workout you did from it stays exactly as it was.</p>
          <Button variant="danger" onClick={() => void handleDelete()}>
            Delete routine
          </Button>
          <Button onClick={() => setConfirmingDelete(false)}>Keep</Button>
        </Sheet>
      ) : null}

      {swapping ? (
        <RoutineSwap routineExerciseId={swapping} onClose={() => setSwapping(null)} onSwapped={showToast} />
      ) : null}

      <Toast message={toast} />

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="t-label mb-1 block text-center">{label}</span>
      <div className="flex">{children}</div>
    </div>
  );
}
