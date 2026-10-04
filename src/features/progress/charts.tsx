import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Chart furniture, in one place so every chart is built from the same parts.
 *
 * Marks carry the colour and text never does: labels and axes wear the muted
 * ink, identity comes from the mark beside them. Values are labelled
 * selectively — the end of a line, the tip of a bar — and the tooltip and the
 * table carry the rest. One hue, the design's blue, for every magnitude.
 */
export const CHART_ACCENT = '#5b84ff';
export const CHART_SURFACE = '#0c0c0b';
export const CHART_GRID = '#232320';
export const CHART_INK = '#f3f1ea';
export const CHART_INK_MUTED = '#a29f96';

/**
 * Sets per muscle as horizontal bars, with marks at the ends of the weekly
 * target — 10 and 20 unless a goal says otherwise — so "enough" reads without
 * a second series. Each bar carries its value at the tip and a tooltip on
 * hover or focus.
 */
export function MuscleBars({
  data,
  idPrefix,
  target = { low: 10, high: 20 },
  targetName = 'the usual weekly target',
}: {
  data: Array<{ muscle: string; sets: number }>;
  idPrefix: string;
  target?: { low: number; high: number };
  /** What the lines are, for the legend: "the usual weekly target". */
  targetName?: string;
}) {
  const max = Math.max(target.high, ...data.map((entry) => entry.sets));
  return (
    <>
      <div className="bars">
        {data.map((entry) => {
          const label = entry.muscle.charAt(0).toUpperCase() + entry.muscle.slice(1);
          const value = Math.round(entry.sets * 10) / 10;
          return (
            <div
              key={entry.muscle}
              id={`${idPrefix}-${entry.muscle.replace(/\s+/g, '-')}`}
              className="bar-row"
              tabIndex={0}
              aria-label={`${label}: ${value} sets. Target ${target.low} to ${target.high}.`}
            >
              <span className="bar-lbl">{label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(entry.sets / max) * 100}%` }} />
                <span className="bar-mark" style={{ left: `${(target.low / max) * 100}%` }} />
                <span className="bar-mark" style={{ left: `${(target.high / max) * 100}%` }} />
              </span>
              <span className="bar-val">{value}</span>
              <span className="bar-tip" aria-hidden="true">
                <strong>{value} sets</strong> · target {target.low}–{target.high}
              </span>
            </div>
          );
        })}
      </div>
      <p className="chart-legend mt-3">
        <i />
        <i />
        Lines at {target.low} and {target.high} sets: {targetName}
      </p>
    </>
  );
}

/** The shape of a lift over time, de-emphasised, with the latest point lit. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 72;
  const height = 28;
  const pad = 4;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (index: number) => pad + (index * (width - 2 * pad)) / (values.length - 1);
  const y = (value: number) => (hi === lo ? height / 2 : height - pad - ((value - lo) / (hi - lo)) * (height - 2 * pad));
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline className="sl" points={points} />
      <circle className="sd" cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="4" />
    </svg>
  );
}

export interface LiftPoint {
  date: string;
  label: string;
  value: number;
  detail: string;
}

/**
 * One lift over time: a 2px line over a faint wash, a crosshair tooltip, and
 * the latest value labelled at the end of the line. A single series, so no
 * legend — the heading above says what is plotted.
 */
export function LiftChart({ points, unit }: { points: LiftPoint[]; unit: string }) {
  const last = points.length - 1;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={points} margin={{ top: 12, right: 40, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
          interval="preserveStartEnd"
          minTickGap={60}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
          width={40}
          domain={['dataMin - 5', 'dataMax + 5']}
          allowDecimals={false}
          tickFormatter={(value: number) => String(Math.round(value))}
        />
        <Tooltip
          cursor={{ stroke: CHART_INK_MUTED, strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as LiftPoint | undefined;
            if (!active || !point) return null;
            return (
              <div className="rounded-md bg-chalk px-2.5 py-1.5 text-xs text-ink">
                <strong className="block text-sm">
                  {point.value}
                  {unit}
                </strong>
                <span>{point.detail}</span>
              </div>
            );
          }}
        />
        <Area
          type="linear"
          dataKey="value"
          stroke={CHART_ACCENT}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={CHART_ACCENT}
          fillOpacity={0.1}
          isAnimationActive={false}
          dot={(props: { cx?: number; cy?: number; index?: number }) =>
            props.index === last && props.cx !== undefined && props.cy !== undefined ? (
              <g key="end">
                <circle cx={props.cx} cy={props.cy} r={5} fill={CHART_ACCENT} stroke={CHART_SURFACE} strokeWidth={2} />
                <text x={props.cx + 9} y={props.cy + 4} fill={CHART_INK} fontSize={12} fontWeight={600}>
                  {points[last]!.value}
                </text>
              </g>
            ) : (
              <g key={`dot-${props.index}`} />
            )
          }
          activeDot={{ r: 5, fill: CHART_ACCENT, stroke: CHART_SURFACE, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
