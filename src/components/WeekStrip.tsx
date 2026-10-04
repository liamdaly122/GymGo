import { localIsoDate, weekStrip, type ScheduledSession } from '@/domain/schedule';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The week at a glance: which days you train and which you have done.
 *
 * Status comes from the schedule, so a session that rolled forward shows on
 * the day it now sits on. Every day with a session goes somewhere — a done day
 * opens what you logged, any other opens its session — and a rest day is not
 * a button with a press state and no destination.
 */
export default function WeekStrip({
  schedule,
  today = new Date(),
  weekStartsOn = 1,
  onSelect,
}: {
  schedule: ScheduledSession[];
  today?: Date;
  weekStartsOn?: number;
  onSelect?: (session: ScheduledSession) => void;
}) {
  const days = weekStrip(today, weekStartsOn);
  const todayIso = localIsoDate(today);

  // One session a day is the rule, but a double is possible on a day already
  // trained; the one still to do is the one worth showing.
  const byDate = new Map<string, ScheduledSession>();
  for (const session of schedule) {
    const existing = byDate.get(session.date);
    if (!existing || (existing.status === 'done' && session.status !== 'done')) {
      byDate.set(session.date, session);
    }
  }

  return (
    <ol className="week" aria-label="This week">
      {days.map((day) => {
        const iso = localIsoDate(day);
        const session = byDate.get(iso);
        const isToday = iso === todayIso;
        const status = session
          ? session.status === 'done'
            ? 'done'
            : session.status === 'today'
              ? 'today'
              : 'planned'
          : null;
        const label = session
          ? `${WEEKDAYS[day.getDay()]} ${day.getDate()}, ${session.name}, ${status}${session.movedFrom ? ', moved' : ''}`
          : `${WEEKDAYS[day.getDay()]} ${day.getDate()}, rest day`;

        return (
          <li key={iso}>
            <button
              type="button"
              className={`day ${isToday ? 'today' : ''} ${session ? 'has' : ''} ${status === 'done' ? 'done' : ''}`}
              disabled={!session || !onSelect}
              onClick={() => session && onSelect?.(session)}
              aria-label={label}
              aria-current={isToday ? 'date' : undefined}
            >
              <span className="d1">{DAY_INITIALS[day.getDay()]}</span>
              <span className="d2">{day.getDate()}</span>
              <span className="dot" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
