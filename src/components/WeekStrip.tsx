import { useRef, useState } from 'react';
import { localIsoDate, weekRange, weekStrip, type ScheduledSession } from '@/domain/schedule';
import { Icon } from './icons';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A swipe has to travel this far, and mostly sideways, to turn the page. */
const SWIPE_PX = 40;

/**
 * The block a week at a time: which days you train, what, and which are done.
 *
 * It opens on this week and pages through the rest of the block — swipe, or
 * the arrows — so you can see what is coming and change it before it comes.
 * Status comes from the schedule, so a session that rolled forward shows on
 * the day it now sits on. Every day with a session goes somewhere — a done
 * day opens what you logged, any other opens its session — and a rest day is
 * not a button with a press state and no destination.
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
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<'next' | 'previous' | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const range = weekRange(schedule, today, weekStartsOn);
  const shown = Math.min(range.last, Math.max(range.first, offset));
  const page = (step: 1 | -1) => {
    const target = shown + step;
    if (target < range.first || target > range.last) return;
    setDirection(step > 0 ? 'next' : 'previous');
    setOffset(target);
  };

  const anchor = new Date(today);
  anchor.setDate(anchor.getDate() + shown * 7);
  const days = weekStrip(anchor, weekStartsOn);
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

  const title =
    shown === 0 ? 'This week' : shown === 1 ? 'Next week' : shown === -1 ? 'Last week' : spanLabel(days);
  const listLabel = shown === 0 || Math.abs(shown) === 1 ? title : `Week of ${longDate(days[0]!)}`;
  const blockWeek = days.map((day) => byDate.get(localIsoDate(day))).find(Boolean)?.modifier;

  return (
    <section className="cal" aria-label="Calendar">
      <div className="cal-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous week"
          disabled={shown <= range.first}
          onClick={() => page(-1)}
        >
          <Icon name="back" />
        </button>
        <p className="cal-title" aria-live="polite">
          <strong>{title}</strong>
          {blockWeek ? (
            <span>
              Week {blockWeek.week} of {blockWeek.totalWeeks} · {blockWeek.label}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next week"
          disabled={shown >= range.last}
          onClick={() => page(1)}
        >
          <Icon name="chev" />
        </button>
      </div>

      <div
        className="cal-swipe"
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY };
          swiped.current = false;
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          swiped.current = true;
          page(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        // A swipe that starts on a day must not also open it.
        onClickCapture={(event) => {
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <ol key={shown} className={`week ${direction ? `from-${direction}` : ''}`} aria-label={listLabel}>
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
                  <span className="dn">{session ? stripName(session.name) : ''}</span>
                  <span className="dot" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/**
 * A session name short enough for one day of the strip: "Full A" for "Full
 * body A", "Full A2" for its second run in the week, "Delts" for a shoulder
 * day. The whole name is in the day's accessible label and on the preview it
 * opens; anything still too long is cut short by CSS.
 */
function stripName(name: string): string {
  return name
    .replace(/^Full body\b/i, 'Full')
    .replace(/^Shoulders\b/i, 'Delts')
    .replace(/\s*\((\d+)\)$/, '$1');
}

/** "12–18 Oct", or "28 Sep – 4 Oct" across a month end. */
function spanLabel(days: Date[]): string {
  const first = days[0]!;
  const last = days.at(-1)!;
  const month = (date: Date) => date.toLocaleDateString('en-GB', { month: 'short' });
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()}–${last.getDate()} ${month(last)}`
    : `${first.getDate()} ${month(first)} – ${last.getDate()} ${month(last)}`;
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
