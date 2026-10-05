import { useState, type FormEvent } from 'react';
import { useBodyMetric } from '@/db/queries';
import { logBodyMetric, removeBodyMetric } from '@/db/mutations';
import { Button, SectionLabel, Sheet } from '@/components/ui';
import { useToday } from '@/hooks/useToday';
import { formatShortDate } from '@/lib/dates';
import type { BodyMetric } from '@/db/schema';
import { LiftChart, type LiftPoint } from './charts';

/** A typed weight: a comma is a decimal point on plenty of phones. */
function parseWeight(text: string): number | null {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const kg = (value: number) => `${Math.round(value * 10) / 10} kg`;

/**
 * Body weight, entered by hand as the brief has it: today's weigh-in, the
 * seven-day average it feeds, and every entry so far.
 *
 * The chart plots the average, not the raw weigh-ins. A day's reading swings
 * by a kilo with water and salt; the average is the line that means something.
 */
export default function BodyWeight() {
  const view = useBodyMetric('bodyweight');
  const today = useToday();
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState<BodyMetric | null>(null);

  const todays = view?.series.find((point) => point.date === today) ?? null;
  const typed = parseWeight(text);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (typed === null) return;
    await logBodyMetric('bodyweight', typed, today);
    setText('');
  };

  const points: LiftPoint[] = (view?.average ?? []).map((point, index) => ({
    date: point.date,
    label: formatShortDate(point.date).replace(/^\w+ /, ''),
    value: Math.round(point.value * 10) / 10,
    detail: `${formatShortDate(point.date)} · weighed ${kg(view!.series[index]!.value)}`,
  }));

  return (
    <>
      <section className="card" aria-labelledby="todays-weight">
        <h2 className="t-section" id="todays-weight" style={{ margin: 0 }}>
          Today's weight
        </h2>
        <form className="row2" onSubmit={(event) => void handleSave(event)}>
          <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={todays ? String(todays.value) : view?.latest ? String(view.latest.value) : 'kg'}
            aria-label="Today's weight in kilograms"
            className="field h-12 text-center text-lg"
          />
          <Button type="submit" variant="primary" disabled={typed === null} aria-label="Save weight">
            Save
          </Button>
        </form>
        <p className="t-meta">
          {todays
            ? `${kg(todays.value)} logged today. Saving again replaces it.`
            : 'Same time each day, ideally first thing, for a fair comparison.'}
        </p>
      </section>

      {points.length >= 2 ? (
        <section className="card" aria-labelledby="weight-trend">
          <div className="card-head">
            <h2 className="t-section" id="weight-trend" style={{ margin: 0 }}>
              Weight, 7-day average
            </h2>
            {view?.change30 !== null && view?.change30 !== undefined ? (
              <span className="t-meta">
                {view.change30 > 0 ? '+' : ''}
                {view.change30} kg in 30 days
              </span>
            ) : null}
          </div>
          <LiftChart points={points} unit="kg" />
          <p className="t-meta">
            Each point averages that day's weigh-in with the six days before it, so one salty
            dinner does not look like a trend.
          </p>
        </section>
      ) : view && view.series.length === 1 ? (
        <p className="t-meta">Log another day and the trend starts.</p>
      ) : null}

      {view && view.entries.length > 0 ? (
        <section aria-labelledby="weigh-ins">
          <SectionLabel id="weigh-ins">Weigh-ins</SectionLabel>
          <ul className="list">
            {view.entries.slice(0, 30).map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="list-row w-full text-left"
                  onClick={() => setDeleting(entry)}
                  aria-label={`Weigh-in on ${formatShortDate(entry.date)}, ${kg(entry.value)}`}
                >
                  <span className="list-main">
                    <strong>{formatShortDate(entry.date)}</strong>
                  </span>
                  <span className="list-end">
                    <span className="num">{kg(entry.value)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {deleting ? (
        <Sheet label={`Weigh-in on ${formatShortDate(deleting.date)}`} onClose={() => setDeleting(null)}>
          <h2>{formatShortDate(deleting.date)}</h2>
          <p className="sheet-note">{kg(deleting.value)}</p>
          <Button
            variant="danger"
            aria-label={`Delete the weigh-in on ${formatShortDate(deleting.date)}`}
            onClick={() => void removeBodyMetric(deleting.id).then(() => setDeleting(null))}
          >
            Delete it
          </Button>
          <Button onClick={() => setDeleting(null)}>Keep it</Button>
        </Sheet>
      ) : null}
    </>
  );
}
