import { Link } from 'react-router-dom';
import type { BlockWeekView } from '@/db/queries';
import { CHART_ACCENT, CHART_DIM } from '@/features/progress/charts';

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The whole block, week by week.
 *
 * The Train card shows this week. This is the answer to "what am I actually in
 * for" — every week of the block, what each one asks for, and which sessions
 * are already behind you.
 *
 * The bars are an emphasis chart, not a decoration: one series (working sets
 * per week), the current week in the accent and the rest in the de-emphasis
 * gray. It is the fastest way to see the shape the block is supposed to have —
 * four weeks climbing, then a deload at roughly half. "Deload" as a word does
 * not tell you how much easier the week is; 14 sets against 30 does.
 */
export default function BlockOverview({ weeks }: { weeks: BlockWeekView[] }) {
  const peak = Math.max(1, ...weeks.map((week) => week.sets));

  return (
    <ol className="mt-4 space-y-4 border-t border-line pt-4">
      {weeks.map((week) => (
        <li key={week.week}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-white">
              <span className="tabular-nums">Week {week.week}</span>
              <span className="text-muted"> · {week.modifier.label}</span>
            </p>
            {week.isCurrent ? (
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                Now
              </span>
            ) : week.done > 0 && week.done === week.sessions.length ? (
              <span className="shrink-0 text-[10px] text-muted">Done</span>
            ) : null}
          </div>

          {/* Bar plus its value. A single series, so no legend: the heading
              above already says what is plotted. */}
          <div className="mt-1.5 h-2 overflow-hidden rounded-l-[1px] rounded-r bg-raised">
            <div
              className="h-full rounded-r"
              style={{
                width: `${Math.round((week.sets / peak) * 100)}%`,
                backgroundColor: week.isCurrent ? CHART_ACCENT : CHART_DIM,
              }}
            />
          </div>

          {/* The session count sits beside the total because a block started
              mid-week has a short first week. Without it the bar reads as "week
              one is trivially easy" when the sessions in it are ordinary — the
              week just holds fewer of them. Values wear the text token, never
              the colour of the mark. */}
          <p className="mt-1.5 text-[11px] tabular-nums text-muted">
            {week.sessions.length} {week.sessions.length === 1 ? 'session' : 'sessions'} ·{' '}
            {week.sets} sets
            {week.done > 0 ? ` · ${week.done} done` : ''}
          </p>

          <p className="mt-1 text-[11px] leading-snug text-muted">{week.modifier.intent}</p>

          {week.sessions.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {week.sessions.map((session) => (
                <li key={`${session.week}-${session.sessionIndex}`}>
                  <SessionChip session={session} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-muted">No sessions this week.</p>
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
      ? 'border-accent/30 bg-accent/10 text-accent'
      : session.status === 'missed'
        ? 'border-red-500/30 bg-red-500/5 text-red-300'
        : session.status === 'today'
          ? 'border-line bg-raised text-white'
          : 'border-line bg-raised text-muted';

  const label = `${session.name}, ${session.date}, ${session.status}`;
  const body = (
    <span
      className={`inline-flex max-w-[10.5rem] items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${tone}`}
    >
      <span className="shrink-0 opacity-70">{day}</span>
      <span className="truncate">{session.name}</span>
    </span>
  );

  // A trained session links to what was actually logged; a future one has
  // nothing to show yet.
  return session.workoutId ? (
    <Link to={`/history/${session.workoutId}`} aria-label={label}>
      {body}
    </Link>
  ) : (
    <span aria-label={label}>{body}</span>
  );
}
