import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, EmptyState, Screen, ScreenTitle } from '@/components/ui';
import { useExerciseTrend, usePlanSchedule, useProgressOverview } from '@/db/queries';
import { formatWeekLabel } from '@/domain/programmes/block';
import {
  CHART_ACCENT,
  CHART_GRID,
  CHART_INK_MUTED,
  ChartCard,
  ChartTooltip,
  Meter,
  StatTile,
  TableView,
} from './charts';

/** 12,900 rather than 12900; 12.9K past ten thousand. */
function compact(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-GB');
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export default function ProgressScreen() {
  const overview = useProgressOverview();
  const planned = usePlanSchedule();
  const [exerciseId, setExerciseId] = useState<string | null>(null);

  const chosen = exerciseId ?? overview?.trackedExercises[0]?.id ?? null;
  const trend = useExerciseTrend(chosen ?? undefined);
  const chosenName = overview?.trackedExercises.find((entry) => entry.id === chosen)?.name;

  if (overview === undefined) {
    return (
      <Screen>
        <ScreenTitle>Progress</ScreenTitle>
        <p className="text-sm text-muted">Loading…</p>
      </Screen>
    );
  }

  if (overview.workoutCount === 0) {
    return (
      <Screen>
        <ScreenTitle>Progress</ScreenTitle>
        <EmptyState
          title="Nothing to chart yet."
          hint="Finish a workout or two and your volume and estimated maxes will appear here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenTitle>Progress</ScreenTitle>

      <Card className="mb-4 grid grid-cols-3 divide-x divide-line p-0">
        <StatTile label="Workouts" value={compact(overview.workoutCount)} />
        <StatTile label="Volume" value={compact(overview.totalVolumeKg)} hint="kg, all time" />
        <StatTile label="Sets" value={compact(overview.setsThisWeek)} hint="last 7 days" />
      </Card>

      {planned ? (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-white">This block</h2>
            <span className="text-xs text-info">{formatWeekLabel(planned.week)}</span>
          </div>
          {/* Progress THROUGH the block, which is what a bar across it means.
              Adherence is a different question and is stated separately, so a
              fresh block does not read as 7% adherence. */}
          <Meter
            value={planned.progress.done / Math.max(1, planned.progress.total)}
            label="Block progress"
            caption={`${planned.progress.done} of ${planned.progress.total} sessions done`}
          />
          {planned.progress.done + planned.progress.missed > 0 ? (
            <p className="mt-2 text-[11px] text-muted">
              {planned.progress.missed === 0
                ? 'Every session so far has been done.'
                : `${Math.round(planned.progress.adherence * 100)}% of the sessions due so far, ${planned.progress.missed} missed.`}
            </p>
          ) : null}
        </Card>
      ) : null}

      {overview.weeklyVolume.length > 0 ? (
        <div className="mb-4">
          <ChartCard
            title="Sets per muscle"
            subtitle="Last 7 days. Muscle growth wants 10 to 20 hard sets a week."
          >
            {/* Horizontal bars: muscle names are long and would be unreadable
                rotated under columns. */}
            <ResponsiveContainer width="100%" height={overview.weeklyVolume.length * 34 + 20}>
              <BarChart
                data={overview.weeklyVolume}
                layout="vertical"
                margin={{ top: 0, right: 34, bottom: 0, left: 0 }}
                barCategoryGap="22%"
              >
                <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="muscle"
                  width={86}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: CHART_INK_MUTED, fontSize: 11 }}
                  tickFormatter={(muscle: string) => muscle.charAt(0).toUpperCase() + muscle.slice(1)}
                />
                <Tooltip
                  cursor={{ fill: `${CHART_ACCENT}14` }}
                  content={({ active, label, payload }) => (
                    <ChartTooltip
                      {...(active !== undefined ? { active } : {})}
                      {...(label !== undefined ? { label: String(label) } : {})}
                      rows={(payload ?? []).map((item) => ({
                        name: 'Sets',
                        value: String(item.value),
                      }))}
                    />
                  )}
                />
                <Bar dataKey="sets" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                  {overview.weeklyVolume.map((entry) => (
                    <Cell key={entry.muscle} fill={CHART_ACCENT} />
                  ))}
                  {/* Value at the tip: bars get their number at the end, not on every gridline. */}
                  <LabelList
                    dataKey="sets"
                    position="right"
                    offset={8}
                    style={{ fill: CHART_INK_MUTED, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      ) : null}

      {overview.trackedExercises.length > 0 ? (
        <ChartCard
          title="Estimated 1RM"
          subtitle={chosenName ? `${chosenName}, from your top working sets` : undefined}
          action={
            <select
              value={chosen ?? ''}
              onChange={(event) => setExerciseId(event.target.value)}
              aria-label="Choose an exercise to chart"
              className="max-w-[9rem] shrink-0 rounded-lg border border-line bg-raised px-2 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
            >
              {overview.trackedExercises.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          }
        >
          {trend && trend.length >= 2 ? (
            <>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    {/* A wash, never a saturated block. */}
                    <linearGradient id="e1rmFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: CHART_INK_MUTED, fontSize: 10 }}
                    minTickGap={24}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: CHART_INK_MUTED, fontSize: 10 }}
                    width={52}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickFormatter={(value: number) => String(Math.round(value))}
                  />
                  <Tooltip
                    cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
                    content={({ active, label, payload }) => (
                      <ChartTooltip
                        {...(active !== undefined ? { active } : {})}
                        {...(label !== undefined ? { label: shortDate(String(label)) } : {})}
                        rows={(payload ?? []).map((item) => ({
                          name: 'Est. 1RM',
                          value: `${item.value}kg`,
                        }))}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="e1rm"
                    stroke={CHART_ACCENT}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="url(#e1rmFill)"
                    isAnimationActive={false}
                    dot={false}
                    activeDot={{ r: 4, fill: CHART_ACCENT, stroke: '#17202d', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>

              <p className="mt-1 text-xs text-muted">
                Latest{' '}
                <span className="font-medium text-white">{trend.at(-1)!.e1rm}kg</span>
                {trend.length > 1 && trend[0]!.e1rm > 0 ? (
                  <>
                    {' · '}
                    {trend.at(-1)!.e1rm >= trend[0]!.e1rm ? '+' : ''}
                    {Math.round((trend.at(-1)!.e1rm - trend[0]!.e1rm) * 10) / 10}kg since you started
                  </>
                ) : null}
              </p>

              <TableView
                columns={['Date', 'Top set', 'Est. 1RM']}
                rows={trend
                  .slice(-6)
                  .reverse()
                  .map((point) => [shortDate(point.date), `${point.topWeight}kg`, `${point.e1rm}kg`])}
              />
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted">
              Log this exercise twice and the trend will appear.
            </p>
          )}
        </ChartCard>
      ) : null}

      <p className="mt-4 text-[11px] text-muted">
        Estimated 1RM uses Epley on your best top working set. Drop sets and warm-ups are
        excluded, so the trend reflects real working weight.
      </p>
    </Screen>
  );
}
