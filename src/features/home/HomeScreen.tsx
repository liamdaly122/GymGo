import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useActiveWorkout,
  usePlanSchedule,
  useRepeatCandidate,
  useRoutines,
  useSessionList,
  useSessionPreview,
  useSettings,
  useWorkoutName,
} from '@/db/queries';
import { repeatWorkout, startFreestyleWorkout, startWorkoutFromRoutine } from '@/db/mutations';
import { Button, Screen, ScreenHeader, SectionLabel, Sheet } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Toast, useToast } from '@/components/Toast';
import WeekStrip from '@/components/WeekStrip';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { useToday, scheduleDay } from '@/hooks/useToday';
import { movedLabel } from '@/features/plan/blockCopy';
import { localIsoDate, type ScheduledSession } from '@/domain/schedule';
import type { SessionRow } from '@/db/queries';
import SessionListRow from '@/components/SessionListRow';
import RoutineSwap from '@/features/swap/RoutineSwap';
import LevelStrip from '@/features/rewards/LevelStrip';

/**
 * Today: what you are doing, as a poster.
 *
 * The session name is the headline, the work is a list of sets × reps, and
 * there is one button. Everything else — the week, a repeat, an empty
 * workout, what you did recently — sits underneath and stays quiet.
 */
export default function HomeScreen() {
  const navigate = useNavigate();
  const active = useActiveWorkout();
  const activeName = useWorkoutName(active?.id);
  const planned = usePlanSchedule();
  const routines = useRoutines();
  const settings = useSettings();
  const recent = useSessionList(4);
  const repeatable = useRepeatCandidate();
  const repeatName = useWorkoutName(repeatable?.workout.id);
  const today = useToday();

  const next = planned?.current ?? null;

  // What the next session actually contains, shaped by this week of the block.
  const preview = useSessionPreview(next?.routineId, planned?.week);

  // A day opened from the strip, and an exercise of it being swapped.
  const [opened, setOpened] = useState<ScheduledSession | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  // Anything finished today leads the screen, so the day's work is the first thing you see.
  const trainedToday = recent?.filter((row) => localIsoDate(new Date(row.workout.started_at)) === today) ?? [];

  const handleStartPlanned = async () => {
    if (!next?.routineId) return;
    const workoutId = await startWorkoutFromRoutine(next.routineId);
    void navigate(`/workout/${workoutId}`);
  };
  const handleStartEmpty = async () => {
    const workoutId = await startFreestyleWorkout();
    void navigate(`/workout/${workoutId}`);
  };
  const handleRepeat = async () => {
    if (!repeatable) return;
    const workoutId = await repeatWorkout(repeatable.workout.id);
    void navigate(`/workout/${workoutId}`);
  };

  const when = next
    ? next.status === 'today'
      ? 'Up next'
      : formatDayLabel(`${next.date}T12:00:00`)
    : null;
  const moved = next ? movedLabel(next) : null;

  return (
    <Screen>
      <ScreenHeader
        title="Today"
        hideTitle
        label={new Date(`${today}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        action={
          <Link to="/settings" className="icon-btn" aria-label="Settings">
            <Icon name="gear" />
          </Link>
        }
      />

      <div className="stack">
        {trainedToday.map((row) => (
          <DoneTodayRow key={row.workout.id} row={row} />
        ))}

        <LevelStrip />

        {planned && next ? (
          <section className="hero" aria-label="Next session">
            <div>
              <p className="kicker">
                {when} — week {planned.week.week} / {planned.week.totalWeeks} · {planned.week.label}
              </p>
              <h2 className="hero-title">{next.name}</h2>
            </div>
            <p className="t-meta">
              {preview ? `${preview.items.length} exercises · about ${preview.minutes} min` : ' '}
              {moved ? ` · ${moved}` : ''}
            </p>
            {preview && preview.items.length > 0 ? (
              <ul className="hero-list">
                {preview.items.map((item) => (
                  <li key={item.rowId}>
                    <span>
                      {item.name}
                      {item.badge ? <> <span className="ss">{item.badge}</span></> : null}
                    </span>
                    <span>
                      {item.sets} × {item.reps}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {active ? (
              <Button variant="primary" size="lg" block onClick={() => void navigate(`/workout/${active.id}`)}>
                Resume {activeName ?? 'workout'}
              </Button>
            ) : (
              <Button variant="primary" size="lg" block disabled={!next.routineId} onClick={() => void handleStartPlanned()}>
                {next.status === 'upcoming' ? `Start early: ${next.name}` : `Start ${next.name}`}
              </Button>
            )}
          </section>
        ) : planned ? (
          <section className="hero" aria-label="Block finished">
            <div>
              <p className="kicker">Block finished</p>
              <h2 className="hero-title">Done</h2>
            </div>
            <p className="t-meta">Every session of this block is trained. See how it went, then start the next one.</p>
            <Button
              variant="primary"
              size="lg"
              block
              onClick={() => void navigate(`/progress/blocks/${planned.plan.id}`)}
            >
              See the block report
            </Button>
          </section>
        ) : (
          <section className="hero" aria-label="No plan">
            <div>
              <p className="kicker">No plan yet</p>
              <h2 className="hero-title">Train</h2>
            </div>
            <p className="t-meta">
              Pick a goal and GymGo builds a five-week block and puts it on your calendar.
            </p>
            <Button variant="primary" size="lg" block onClick={() => void navigate('/plan/new')}>
              Build a plan
            </Button>
          </section>
        )}

        {planned ? (
          <WeekStrip
            schedule={planned.schedule}
            today={scheduleDay(today)}
            weekStartsOn={settings?.week_starts_on ?? 1}
            onSelect={(session) => {
              if (session.workoutId) void navigate(`/history/${session.workoutId}`);
              else if (session.routineId) setOpened(session);
            }}
          />
        ) : null}

        {!active ? (
          repeatable ? (
            <div className="row2">
              <Button
                onClick={() => void handleRepeat()}
                aria-label={`Repeat ${repeatName && repeatName !== 'Workout' ? repeatName : formatDayLabel(repeatable.workout.started_at)}`}
              >
                Repeat {repeatName && repeatName !== 'Workout' ? repeatName : 'last'}
              </Button>
              <Button onClick={() => void handleStartEmpty()} aria-label="Start empty workout">
                Empty workout
              </Button>
            </div>
          ) : (
            <Button block onClick={() => void handleStartEmpty()} aria-label="Start empty workout">
              Empty workout
            </Button>
          )
        ) : null}

        {!planned && routines && routines.length > 0 ? (
          <section aria-labelledby="your-routines">
            <SectionLabel id="your-routines">Your routines</SectionLabel>
            <ul className="list">
              {routines.slice(0, 4).map((routine) => (
                <li key={routine.id}>
                  <Link to={`/routines/${routine.id}`} className="list-row">
                    <span className="list-main">
                      <strong>{routine.name.split(' — ').at(-1)}</strong>
                    </span>
                    <Icon name="chev" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="recent">
          <div className="flex items-baseline justify-between">
            <SectionLabel id="recent">Recent</SectionLabel>
            <Link to="/progress" className="btn-text">
              All history
            </Link>
          </div>
          {recent && recent.length > 0 ? (
            <ul className="list">
              {recent.slice(0, 3).map((row) => (
                <li key={row.workout.id}>
                  <SessionListRow row={row} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-meta">Nothing logged yet.</p>
          )}
        </section>
      </div>

      {opened && !swapping ? (
        <DaySheet
          session={opened}
          // Only the session that is up next starts from here; the hero offers
          // the same, so nothing can be trained out of turn from the calendar.
          onStart={
            !active && next && opened.routineId === next.routineId && opened.date === next.date
              ? () => {
                  setOpened(null);
                  void handleStartPlanned();
                }
              : null
          }
          onSwap={setSwapping}
          onClose={() => setOpened(null)}
        />
      ) : null}

      {swapping ? (
        <RoutineSwap routineExerciseId={swapping} onClose={() => setSwapping(null)} onSwapped={showToast} />
      ) : null}

      <Toast message={toast} />
    </Screen>
  );
}

/**
 * A day from the calendar: what that session holds that week, with a swap on
 * every exercise. Seeing Friday's deadlifts on Monday is the time to change
 * them, not under the bar.
 */
function DaySheet({
  session,
  onStart,
  onSwap,
  onClose,
}: {
  session: ScheduledSession;
  onStart: (() => void) | null;
  onSwap: (routineExerciseId: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const preview = useSessionPreview(session.routineId, session.modifier);
  const day = new Date(`${session.date}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const moved = movedLabel(session);

  return (
    <Sheet label={`${session.name}, ${day}`} onClose={onClose}>
      <p className="t-label">
        {day} · week {session.week} · {session.modifier.label}
      </p>
      <h2>{session.name}</h2>
      <p className="sheet-note">
        {preview ? `${preview.items.length} exercises · about ${preview.minutes} min` : ' '}
        {moved ? ` · ${moved}` : ''}
      </p>
      {preview && preview.items.length > 0 ? (
        <ul className="list ex-list">
          {preview.items.map((item) => (
            <li key={item.rowId} className="items-center">
              <span className="ex-name flex-1">
                <span>
                  {item.name}
                  {item.badge ? <> <span className="ss">{item.badge}</span></> : null}
                </span>
              </span>
              <span className="ex-pres">
                {item.sets} × {item.reps}
              </span>
              <button
                type="button"
                className="icon-btn -my-2 -mr-2.5"
                aria-label={`Swap ${item.name}`}
                onClick={() => onSwap(item.rowId)}
              >
                <Icon name="swap" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onStart ? (
        <Button variant="primary" onClick={onStart}>
          Start {session.name}
        </Button>
      ) : null}
      <Button onClick={() => void navigate(`/routines/${session.routineId}`)}>Edit session</Button>
    </Sheet>
  );
}

function DoneTodayRow({ row }: { row: SessionRow }) {
  return (
    <ul className="list">
      <li>
        <Link to={`/history/${row.workout.id}`} className="list-row">
          <span className="list-main">
            <strong>{row.name} done today</strong>
            <span className="t-meta">
              {formatDuration(row.durationMs)} · {Math.round(row.tonnage).toLocaleString('en-GB')} kg · {row.sets}{' '}
              {row.sets === 1 ? 'set' : 'sets'}
              {row.records ? ` · ${row.records} PR${row.records === 1 ? '' : 's'}` : ''}
            </span>
          </span>
          <Icon name="chev" />
        </Link>
      </li>
    </ul>
  );
}
