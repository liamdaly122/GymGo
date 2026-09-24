import { localIsoDate, weekStrip, type ScheduledSession } from '@/domain/schedule';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The week at a glance: which days you train, which you have done, which you
 * missed.
 *
 * Status comes from the schedule rather than from dates alone, so a session
 * trained a day late still shows as done on the day it was planned.
 */
export default function WeekStrip({
  schedule,
  today = new Date(),
  weekStartsOn = 1,
  onSelect,
  selectedDate,
}: {
  schedule: ScheduledSession[];
  today?: Date;
  weekStartsOn?: number;
  onSelect?: (session: ScheduledSession) => void;
  selectedDate?: string;
}) {
  const days = weekStrip(today, weekStartsOn);
  const byDate = new Map(schedule.map((session) => [session.date, session]));
  const todayIso = localIsoDate(today);

  return (
    <ul className="flex gap-1">
      {days.map((day) => {
        const iso = localIsoDate(day);
        const session = byDate.get(iso);
        const isToday = iso === todayIso;
        const isSelected = selectedDate === iso;

        return (
          <li key={iso} className="flex-1">
            <button
              // Only a trained day goes anywhere. Enabling the rest would give
              // every day a press state and no destination, which is what the
              // strip did before it was wired up at all.
              disabled={!session || !onSelect || !session.workoutId}
              onClick={() => session && onSelect?.(session)}
              aria-label={
                session
                  ? `${session.name} on ${iso}, ${session.status}`
                  : `${iso}, rest day`
              }
              aria-current={isToday ? 'date' : undefined}
              className={`flex w-full flex-col items-center gap-1.5 rounded-xl py-2 transition-colors ${
                isSelected ? 'bg-raised' : ''
              } ${session?.workoutId && onSelect ? 'active:bg-raised' : 'cursor-default'}`}
            >
              <span className={`text-[10px] ${isToday ? 'text-accent' : 'text-muted'}`}>
                {DAY_INITIALS[day.getDay()]}
              </span>
              <span
                className={`text-sm tabular-nums ${
                  isToday ? 'font-semibold text-white' : 'text-muted'
                }`}
              >
                {day.getDate()}
              </span>
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  !session
                    ? 'bg-transparent'
                    : session.status === 'done'
                      ? 'bg-accent'
                      : session.status === 'missed'
                        ? 'bg-red-500/60'
                        : session.status === 'today'
                          ? 'bg-white'
                          : 'bg-line'
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
