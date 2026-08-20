import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatClock } from '@/lib/dates';
import { playRestFinishedTone, vibrate } from '@/lib/feedback';
import { clearRest, readRest, writeRest } from '@/lib/restTimer';
import { useSettings } from '@/db/queries';

interface RestTimerState {
  /** Epoch ms the rest ends at, or null when no rest is running. */
  endsAt: number | null;
  totalMs: number;
  start: (seconds: number) => void;
  extend: (seconds: number) => void;
  stop: () => void;
}

const RestTimerContext = createContext<RestTimerState | null>(null);

export function useRestTimer(): RestTimerState {
  const value = useContext(RestTimerContext);
  if (!value) throw new Error('useRestTimer must be used inside a RestTimerProvider');
  return value;
}

export function RestTimerProvider({
  children,
  scopeId = null,
}: {
  children: ReactNode;
  /** The workout this rest belongs to, so a stale one cannot leak into a new session. */
  scopeId?: string | null;
}) {
  // Hydrated lazily so a restored countdown is already correct on first paint
  // rather than flashing empty and then filling in.
  const restored = useState(() => readRest(scopeId))[0];
  const [endsAt, setEndsAt] = useState<number | null>(restored?.endsAt ?? null);
  const [totalMs, setTotalMs] = useState(restored?.totalMs ?? 0);

  const start = useCallback(
    (seconds: number) => {
      const ms = Math.max(1, Math.round(seconds)) * 1000;
      const target = Date.now() + ms;
      setTotalMs(ms);
      setEndsAt(target);
      writeRest({ endsAt: target, totalMs: ms, scopeId });
    },
    [scopeId],
  );

  /** Negative shortens. Never drops below five seconds left, or below the ring. */
  const extend = useCallback(
    (seconds: number) => {
      setEndsAt((current) => {
        if (current === null) return null;
        const target = Math.max(Date.now() + 5_000, current + seconds * 1000);
        setTotalMs((total) => {
          const next = Math.max(5_000, total + seconds * 1000);
          writeRest({ endsAt: target, totalMs: next, scopeId });
          return next;
        });
        return target;
      });
    },
    [scopeId],
  );

  const stop = useCallback(() => {
    setEndsAt(null);
    setTotalMs(0);
    clearRest();
  }, []);

  const value = useMemo(
    () => ({ endsAt, totalMs, start, extend, stop }),
    [endsAt, totalMs, start, extend, stop],
  );

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}

/**
 * The rest countdown.
 *
 * Remaining time is recomputed from the target timestamp on every tick rather
 * than decremented, so a throttled or suspended tab — which is the normal state
 * of a phone in a pocket — cannot make the clock drift. When the tab comes
 * back, the number is simply correct.
 */
export function RestTimerBar() {
  const { endsAt, totalMs, extend, stop } = useRestTimer();
  const settings = useSettings();
  const [remaining, setRemaining] = useState(0);
  // Seeded from the restored target: a rest that expired while the app was
  // closed must not beep and buzz the moment the page comes back.
  const firedFor = useRef<number | null>(
    endsAt !== null && endsAt <= Date.now() ? endsAt : null,
  );

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      return;
    }

    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
    // Quarter-second ticks so the ring moves smoothly without burning battery.
    const id = window.setInterval(tick, 250);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endsAt]);

  // Fire the cue once per rest, keyed on the target so a re-render cannot repeat it.
  useEffect(() => {
    if (endsAt === null || remaining > 0 || firedFor.current === endsAt) return;
    firedFor.current = endsAt;
    if (settings?.sound_on !== false) playRestFinishedTone();
    if (settings?.vibrate_on !== false) vibrate();
  }, [endsAt, remaining, settings?.sound_on, settings?.vibrate_on]);

  if (endsAt === null) return null;

  const done = remaining <= 0;
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remaining / totalMs)) : 0;

  // A ring drawn with stroke-dashoffset: no library, no layout thrash, and it
  // reads at a glance from arm's length on a bench.
  const RADIUS = 46;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="timer"
      aria-live="off"
    >
      <div className="mx-auto flex max-w-lg items-center gap-4 px-4 py-3">
        <button
          onClick={stop}
          aria-label={done ? 'Dismiss the rest timer' : 'Skip the rest'}
          className="relative grid h-24 w-24 shrink-0 place-items-center"
        >
          <svg viewBox="0 0 108 108" className="h-24 w-24 -rotate-90">
            <circle
              cx="54"
              cy="54"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              className="text-line"
            />
            <circle
              cx="54"
              cy="54"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
              className={done ? 'text-accent' : 'text-accent/80'}
              style={{ transition: 'stroke-dashoffset 250ms linear' }}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center">
            <span
              className={`text-xl font-semibold tabular-nums ${done ? 'text-accent' : 'text-white'}`}
            >
              {formatClock(remaining)}
            </span>
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="eyebrow">{done ? 'Rest over' : 'Resting'}</p>
          <p className="mt-0.5 text-sm text-white">
            {done ? 'Back to it.' : 'Tap the dial to skip.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => extend(-30)}
              disabled={remaining <= 30_000}
              className="h-9 flex-1 rounded-lg border border-line bg-raised text-xs text-white disabled:opacity-30 active:bg-line"
            >
              −30s
            </button>
            <button
              onClick={() => extend(30)}
              className="h-9 flex-1 rounded-lg border border-line bg-raised text-xs text-white active:bg-line"
            >
              +30s
            </button>
            <button
              onClick={stop}
              className="h-9 flex-1 rounded-lg bg-accent text-xs font-semibold text-ink active:bg-accent/80"
            >
              {done ? 'Done' : 'Skip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
