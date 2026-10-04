import { Link } from 'react-router-dom';
import type { SessionRow } from '@/db/queries';
import { formatDayLabel, formatDuration } from '@/lib/dates';
import { Icon } from './icons';

/** One finished session as a list row. Shared with Progress → Sessions. */
export default function SessionListRow({ row }: { row: SessionRow }) {
  return (
    <Link to={`/history/${row.workout.id}`} className="list-row">
      <span className="list-main">
        <strong>{row.name}</strong>
        <span className="t-meta">
          {formatDayLabel(row.workout.started_at)} · {formatDuration(row.durationMs)}
        </span>
      </span>
      <span className="list-end">
        <span className="num">{Math.round(row.tonnage).toLocaleString('en-GB')} kg</span>
        <span className="t-meta">
          {row.sets} {row.sets === 1 ? 'set' : 'sets'}
          {row.records ? ` · ${row.records} PR${row.records === 1 ? '' : 's'}` : ''}
        </span>
      </span>
      <Icon name="chev" />
    </Link>
  );
}
