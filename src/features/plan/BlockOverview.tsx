import { Link } from 'react-router-dom';
import type { BlockWeekView } from '@/db/queries';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The whole block, week by week: what each week asks for, and which sessions
 * are behind you.
 *
 * The bars are an emphasis chart, not decoration: one series (working sets per
 * week), the current week in the highlight and the rest de-emphasised. It is
 * the fastest way to see the shape a block is meant to have — four weeks
 * climbing, then a deload at roughly half. "Deload" as a word does not say how
 * much easier the week is; 14 sets against 30 does.
 */
export default function BlockOverview({ weeks, id }: { weeks: BlockWeekView[]; id?: string }) {
  const peak = Math.max(1, ...weeks.map((week) => week.sets));

  return (
    <ol id={id} className="flex flex-col gap-4 border-t border-line pt-4">
      {weeks.map((week) => (
        <li key={week.week}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate font-display text-xl font-extrabold uppercase">
              <span className="tabular-nums">Week {week.week}</span>
              <span className="text-muted"> · {week.modifier.label}</span>
            </p>
            {week.isCurrent ? (
              <span className="chip chip-hot shrink-0">Now</span>
            ) : week.done > 0 && week.done === week.sessions.length ? (
              <span className="shrink-0 text-xs text-muted">Done</span>
            ) : null}
          </div>

          {/* A single series, so no legend: the heading already says what is
              plotted. Rounded at the data end, square at the baseline. */}
          <div className="mt-1.5 h-2.5 bg-raised">
            <div
              className={`h-full rounded-r ${week.isCurrent ? 'bg-hot' : 'bg-faint'}`}
              style={{ width: `${Math.round((week.sets / peak) * 100)}%` }}
            />
          </div>

          {/* The session count sits beside the total because a block started
              mid-week has a short first week; without it the bar reads as "week
              one is easy" when it just holds fewer sessions. */}
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {week.sessions.length} {week.sessions.length === 1 ? 'session' : 'sessions'} ·{' '}
            {week.sets} sets
          </p>

          {week.sessions.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {week.sessions.map((session) => (
                <li key={`${session.week}-${session.sessionIndex}`}>
                  <SessionChip session={session} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">No sessions this week.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function SessionChip({ session }: { session: BlockWeekView['sessions'][number] }) {
  const day = DAY_INITIALS[new Date(`${session.date}T12:00:00`).getDay()];
  const tone =
    session.status === 'done'
      ? 'bg-chalk text-ink'
      : session.status === 'today'
        ? 'bg-raised text-chalk shadow-[inset_0_0_0_2px_var(--color-hot)]'
        : 'bg-raised text-muted';

  const label = `${session.name}, ${session.date}, ${session.status}${
    session.movedFrom ? `, moved from ${session.movedFrom}` : ''
  }`;
  const body = (
    <span className={`inline-flex max-w-[10.5rem] items-center gap-1 rounded px-2 py-1 text-xs ${tone}`}>
      <span className="shrink-0 opacity-70">{day}</span>
      <span className="truncate">{session.name}</span>
    </span>
  );

  // A trained session opens what was logged; one still to do opens its routine.
  if (session.workoutId) {
    return (
      <Link to={`/history/${session.workoutId}`} aria-label={label}>
        {body}
      </Link>
    );
  }
  return session.routineId ? (
    <Link to={`/routines/${session.routineId}`} aria-label={label}>
      {body}
    </Link>
  ) : (
    <span aria-label={label}>{body}</span>
  );
}
