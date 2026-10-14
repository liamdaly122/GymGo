import { estimate1RMRounded } from '@/domain/epley';
import type { PersonalRecords } from '@/domain/prs';
import { formatDayLabel } from '@/lib/dates';

/**
 * A lift's records: the heaviest top set, and in Pro the best estimated max.
 * From top working sets only, through the one gate every record passes, so a
 * drop set can never stand here.
 *
 * Renders nothing for a lift with no completed working set; the caller says
 * so in its own words.
 */
export default function LiftRecords({ records, pro }: { records: PersonalRecords; pro: boolean }) {
  if (!records.heaviest) return null;
  return (
    <>
      <div className="pr-row">
        <span className="pr-badge">PR</span>
        <span className="list-main">
          <span className="font-semibold">
            Heaviest set · {records.heaviest.weight_kg}kg × {records.heaviest.reps}
          </span>
          <span className="t-meta">
            {formatDayLabel(records.heaviest.completed_at ?? records.heaviest.created_at)}
          </span>
        </span>
      </div>
      {pro && records.bestE1rm ? (
        <div className="pr-row">
          <span className="pr-badge">1RM</span>
          <span className="list-main">
            <span className="font-semibold">
              Best estimate · {estimate1RMRounded(records.bestE1rm.set.weight_kg, records.bestE1rm.set.reps)}kg
            </span>
            <span className="t-meta">
              from {records.bestE1rm.set.weight_kg}kg × {records.bestE1rm.set.reps}
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}
