import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatClock } from '@/lib/dates';
import { playRestFinishedTone, vibrate } from '@/lib/feedback';
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

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState(0);

  const start = useCallback((seconds: number) => {
    const ms = Math.max(1, Math.round(seconds)) * 1000;
    setTotalMs(ms);
    setEndsAt(Date.now() + ms);
  }, []);

  const extend = useCallback((seconds: number) => {
    setEndsAt((current) => (current === null ? null : current + seconds * 1000));
    setTotalMs((current) => current + seconds * 1000);
  }, []);

  const stop = useCallback(() => {
    setEndsAt(null);
    setTotalMs(0);
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
  const firedFor = useRef<number | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      return;
    }

    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
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
  const progress = totalMs > 0 ? Math.min(1, 1 - remaining / totalMs) : 1;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="timer"
      aria-live="off"
    >
      <div
        className={`h-0.5 origin-left transition-transform duration-200 ${done ? 'bg-accent' : 'bg-accent/60'}`}
        style={{ transform: `scaleX(${progress})` }}
      />
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {done ? 'Rest over' : 'Resting'}
          </p>
          <p
            className={`text-2xl font-semibold tabular-nums ${done ? 'text-accent' : 'text-white'}`}
            aria-label={done ? 'Rest finished' : `${Math.ceil(remaining / 1000)} seconds remaining`}
          >
            {formatClock(remaining)}
          </p>
        </div>
        <button
          onClick={() => extend(30)}
          className="h-11 rounded-xl border border-line bg-raised px-3 text-sm text-white active:bg-line"
        >
          +30s
        </button>
        <button
          onClick={stop}
          className="h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-ink active:bg-accent/80"
        >
          {done ? 'Done' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
