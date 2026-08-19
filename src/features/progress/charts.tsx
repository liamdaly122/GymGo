import type { ReactNode } from 'react';

/**
 * Chart furniture, kept in one place so every chart in the app is built from the
 * same parts.
 *
 * Two rules do most of the work here. Marks carry the colour and text never
 * does — a light hue is illegible as body text, so labels and axes wear the
 * muted ink token and identity comes from the mark beside them. And values are
 * labelled selectively: a number on every point is chaos and goes unread, so the
 * axis and the tooltip carry the rest.
 */

/** One hue for magnitude. Nominal bars all take it — colouring them by value
 *  would spend the identity channel re-encoding what bar length already shows. */
export const CHART_ACCENT = '#4ade80';
export const CHART_SURFACE = '#17202d';
export const CHART_GRID = '#2a3746';
export const CHART_INK_MUTED = '#8b9aad';

export function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-white">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * A headline number. Proportional figures, not tabular: tabular-nums gives every
 * digit the width of a zero, which reads loose at display sizes. Tabular is for
 * columns that must align.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="px-3 py-3 text-center">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A single ratio against a limit — a meter, not a pie of two slices.
 * The unfilled track is a lighter step of the same ramp so state reads across
 * the whole bar.
 */
export function Meter({
  value,
  label,
  caption,
}: {
  /** 0 to 1. */
  value: number;
  label: string;
  caption?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-sm font-semibold text-white">{percent}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: `${CHART_ACCENT}22` }}
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${percent}%`, background: CHART_ACCENT }}
        />
      </div>
      {caption ? <p className="mt-1.5 text-[11px] text-muted">{caption}</p> : null}
    </div>
  );
}

/** Shared tooltip. Values in ink, identity from the swatch beside them. */
export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: Array<{ name: string; value: string }>;
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 shadow-lg">
      {label ? <p className="mb-1 text-[11px] text-muted">{label}</p> : null}
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 text-xs text-white">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: CHART_ACCENT }}
          />
          <span className="text-muted">{row.name}</span>
          <span className="ml-auto font-medium tabular-nums">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Every chart ships a table view, so nothing is gated behind colour. */
export function TableView({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th key={column} className="py-1.5 pr-3 font-normal text-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line/50 last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-1.5 pr-3 ${cellIndex === 0 ? 'text-white' : 'tabular-nums text-muted'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
