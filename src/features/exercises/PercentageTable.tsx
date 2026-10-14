import { useId, useState } from 'react';
import { SectionLabel } from '@/components/ui';
import { loadablePercentageTable } from '@/domain/epley';
import type { LoadingProfile } from '@/domain/plates';
import type { Equipment } from '@/domain/types';

/**
 * The brief: "Percentage table from an estimated or entered 1RM." Every row
 * rounds DOWN through the gym's plates, so each one can be loaded and none is
 * heavier than its percentage.
 *
 * Open in Pro, folded away in Beginner, until tapped. A typed max is not
 * stored: that would need a column.
 *
 * On a lift's own screen, and in the companion screen's details while the
 * watch logs.
 */
export default function PercentageTable({
  estimatedMax,
  loading,
  equipment,
  pro,
}: {
  /** The best estimated max, to one decimal place, or null for a lift never logged. */
  estimatedMax: number | null;
  /** What the lift can be loaded with. Undefined while it loads. */
  loading: LoadingProfile | undefined;
  equipment: Equipment;
  pro: boolean;
}) {
  const id = useId();
  const [maxText, setMaxText] = useState('');
  // Null until tapped: open in Pro, folded away in Beginner.
  const [tableOpen, setTableOpen] = useState<boolean | null>(null);

  // The table works off the max you type, else your best estimate.
  const typedMax = Number.parseFloat(maxText.replace(',', '.'));
  const max = Number.isFinite(typedMax) && typedMax > 0 ? typedMax : estimatedMax;
  const percentages = max !== null && loading ? loadablePercentageTable(max, loading) : [];
  const tableShown = tableOpen ?? pro;

  return (
    <section aria-labelledby={`${id}-label`}>
      <div className="card-head">
        <SectionLabel id={`${id}-label`}>Percentage table</SectionLabel>
        <button
          type="button"
          className="btn-text"
          aria-expanded={tableShown}
          aria-controls={`${id}-rows`}
          onClick={() => setTableOpen(!tableShown)}
        >
          {tableShown ? 'Hide' : 'Show'}
        </button>
      </div>
      {tableShown ? (
        <div id={`${id}-rows`} className="stack-sm">
          <input
            type="text"
            inputMode="decimal"
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
            placeholder={estimatedMax !== null ? String(estimatedMax) : '1-rep max, kg'}
            aria-label="Your max in kilograms"
            className="field h-12 text-center"
          />
          <p className="t-meta">
            {Number.isFinite(typedMax) && typedMax > 0
              ? `From the max you typed, ${typedMax} kg.`
              : estimatedMax !== null
                ? `From your best estimated max, ${estimatedMax} kg. Type your own to use that instead.`
                : 'Type a max to see the table. Once you have logged this lift, your best estimate fills in.'}
          </p>
          {percentages.length > 0 ? (
            <div className="tbl-wrap">
              <table aria-label={`Percentages of ${max} kilograms`}>
                <thead>
                  <tr>
                    <th>Percent</th>
                    <th>Load</th>
                  </tr>
                </thead>
                <tbody>
                  {percentages.map((row) => (
                    <tr key={row.percent}>
                      <td>{row.percent}%</td>
                      <td>{row.weight_kg} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="t-meta">
            Each load is rounded down to what{' '}
            {equipment === 'barbell' || equipment === 'ez_bar' ? 'your plates make' : 'the equipment steps in'}.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** The best estimate the way the table starts from it: one decimal place, or null. */
export function tableMax(bestE1rm: { value: number } | null | undefined): number | null {
  return bestE1rm ? Math.round(bestE1rm.value * 10) / 10 : null;
}
