import { useEffect, useState } from 'react';
import type { ReceivedWatchState } from '@/domain/watchProtocol';
import { Button } from '@/components/ui';
import { formatClock } from '@/lib/dates';

/**
 * The watch is logging: what it says, and the way to take logging back.
 *
 * Sits where the exercise strip sits while the phone logs. Heart rate and
 * energy come straight from the watch's last report, and "Paused" while the
 * watch says its workout is paused (a paused watch also counts for longer
 * before the phone takes over: `staleAfter`). While the watch rests, the rest
 * is one line: the watch has the clock and gives the cue, so this plays no
 * sound and buzzes nothing (one cue per rest). A rest keeps its end through a
 * pause, as on the watch.
 */
export default function WatchBar({
  report,
  onTakeBack,
}: {
  report: ReceivedWatchState;
  /** "Log on this phone". */
  onTakeBack: () => void;
}) {
  const facts = [
    report.heartRate !== null ? `${Math.round(report.heartRate)} bpm` : null,
    report.activeKcal !== null ? `${Math.round(report.activeKcal)} kcal` : null,
  ].filter((fact): fact is string => fact !== null);
  const notRecording = report.health === 'denied' || report.health === 'unavailable';

  return (
    <div className="border-b border-line px-5 pt-1 pb-3">
      <div className="flex items-center gap-3">
        <p className="m-0 min-w-0 flex-1 text-sm text-muted tabular-nums">
          <strong className="font-semibold text-hot">On your watch</strong>
          {report.paused ? (
            // A state, so blue, as the watch's own "Paused" line is.
            <span className="whitespace-nowrap">
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              <span className="font-semibold text-hot">Paused</span>
            </span>
          ) : null}
          {facts.map((fact) => (
            // Each fact wraps whole: "214 kcal", never "214" then "kcal".
            <span key={fact} className="whitespace-nowrap">
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {fact}
            </span>
          ))}
          {notRecording ? <span className="block text-xs text-faint">Not recording to Apple Health</span> : null}
        </p>
        <Button size="sm" className="shrink-0" onClick={onTakeBack}>
          Log on this phone
        </Button>
      </div>
      {report.rest ? <WatchRest endsAt={report.rest.endsAt} next={report.rest.upNext.name} /> : null}
    </div>
  );
}

/**
 * The watch's rest, counted down here from the end time it sent. Silent by
 * design, and gone when it runs out: the watch has already said so.
 */
function WatchRest({ endsAt, next }: { endsAt: string; next: string }) {
  const end = Date.parse(endsAt);
  // Read from the clock on every render; the interval only asks for one.
  const remaining = Number.isFinite(end) ? end - Date.now() : 0;
  const running = remaining > 0;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 250);
    return () => window.clearInterval(id);
  }, [running, end]);

  if (!running) return null;

  return (
    <p role="timer" aria-label="Rest on your watch" className="m-0 mt-2 truncate text-sm text-muted tabular-nums">
      Rest <span className="font-semibold text-chalk">{formatClock(remaining)}</span>
      {next ? ` · then ${next}` : ''}
    </p>
  );
}
