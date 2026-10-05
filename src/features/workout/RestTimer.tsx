import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatClock } from '@/lib/dates';
import { playRestFinishedTone, vibrate } from '@/lib/feedback';
import { clearRest, readRest, writeRest } from '@/lib/restTimer';
import { useSettings } from '@/db/queries';
import { addBackOffSet, addChildSet, type ChildSetKind } from '@/db/mutations';
import { CONTINUATION_REST_SECONDS } from './setNames';

interface RestTimerState {
  /** Epoch ms the rest ends at, or null when no rest is running. */
  endsAt: number | null;
  totalMs: number;
  /** Shrunk to a bar across the top so the sets are back on screen. */
  minimised: boolean;
  /** What comes after the rest, published by the logging screen. */
  upNext: string | null;
  /** The working set the rest follows, for Pro's quick drop / rest-pause / myo. */
  afterSetId: string | null;
  start: (seconds: number, options?: { afterSetId?: string | null }) => void;
  extend: (seconds: number) => void;
  stop: () => void;
  setMinimised: (minimised: boolean) => void;
  setUpNext: (label: string | null) => void;
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
  const [minimised, setMinimised] = useState(false);
  const [upNext, setUpNext] = useState<string | null>(null);
  const [afterSetId, setAfterSetId] = useState<string | null>(null);

  const start = useCallback(
    (seconds: number, options: { afterSetId?: string | null } = {}) => {
      const ms = Math.max(1, Math.round(seconds)) * 1000;
      const target = Date.now() + ms;
      setTotalMs(ms);
      setEndsAt(target);
      setMinimised(false);
      setAfterSetId(options.afterSetId ?? null);
      writeRest({ endsAt: target, totalMs: ms, scopeId });
    },
    [scopeId],
  );

  /** Negative shortens. Never drops below five seconds left. */
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
    setMinimised(false);
    setAfterSetId(null);
    clearRest();
  }, []);

  const value = useMemo(
    () => ({ endsAt, totalMs, minimised, upNext, afterSetId, start, extend, stop, setMinimised, setUpNext }),
    [endsAt, totalMs, minimised, upNext, afterSetId, start, extend, stop],
  );

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>;
}

/**
 * Milliseconds left, re-rendered four times a second while a rest runs.
 *
 * Recomputed from the target timestamp rather than decremented, so a throttled
 * or suspended tab — the normal state of a phone in a pocket — cannot make the
 * clock drift. Capped at the rest's own length: `now` is only refreshed while a
 * rest runs, so on the first frame of a new one it can be minutes stale, and
 * uncapped that frame would read "63:00".
 */
function useRemaining(endsAt: number | null, totalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => setNow(Date.now());
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

  return endsAt === null ? 0 : Math.min(totalMs, Math.max(0, endsAt - now));
}

const ATTACH: Array<{ kind: ChildSetKind; label: string }> = [
  { kind: 'drop', label: 'Drop' },
  { kind: 'rest_pause', label: 'Rest-pause' },
  { kind: 'myo', label: 'Myo' },
  { kind: 'cluster', label: 'Cluster' },
];

/**
 * The rest: the whole screen while it runs, or a bar across the top.
 *
 * Full screen because between sets the countdown is the only thing worth
 * reading, from a bench, at arm's length. "Show sets" shrinks it to the bar
 * when you need to fix a rep you mistyped. It gets out of the way by itself
 * when it runs out — the cue says so, and the next set is waiting underneath.
 */
export function RestTimerView() {
  const { endsAt, totalMs, minimised, upNext, afterSetId, extend, stop, setMinimised, start } =
    useRestTimer();
  const settings = useSettings();
  const pro = settings?.mode === 'pro';
  const remaining = useRemaining(endsAt, totalMs);

  // The takeover is a modal: focus goes into it when it opens, or a keyboard
  // or screen reader would be left on the Done button now hidden behind it.
  const takeover = useRef<HTMLElement>(null);
  const showing = endsAt !== null && !minimised;
  useEffect(() => {
    if (showing) takeover.current?.focus({ preventScroll: true });
  }, [showing]);

  // Seeded from the restored target: a rest that expired while the app was
  // closed must not beep and buzz the moment the page comes back.
  const firedFor = useRef<number | null>(
    endsAt !== null && endsAt <= Date.now() ? endsAt : null,
  );

  // The cue fires once per rest, keyed on the target so a re-render cannot
  // repeat it, and then the rest is over.
  useEffect(() => {
    if (endsAt === null || remaining > 0) return;
    if (firedFor.current !== endsAt) {
      firedFor.current = endsAt;
      if (settings?.sound_on !== false) playRestFinishedTone();
      if (settings?.vibrate_on !== false) vibrate();
    }
    stop();
  }, [endsAt, remaining, settings?.sound_on, settings?.vibrate_on, stop]);

  if (endsAt === null || remaining <= 0) return null;

  const clock = formatClock(remaining);

  if (minimised) {
    return (
      <div className="rest-min">
        <div className="rest-min-inner">
          <p role="timer">
            Rest <span className="num">{clock}</span>
          </p>
          <button type="button" className="btn btn-sm" aria-label="Show rest" onClick={() => setMinimised(false)}>
            Show
          </button>
          <button type="button" className="btn btn-sm" aria-label="Skip rest" onClick={stop}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  const fraction = totalMs > 0 ? Math.min(1, remaining / totalMs) : 0;

  // A technique hangs off the set just done. A drop is done at once, so the
  // rest stops; the others are the technique's own short gap, so it restarts
  // at that length.
  const attach = async (kind: ChildSetKind) => {
    if (!afterSetId) return;
    await addChildSet(afterSetId, kind);
    const gap = CONTINUATION_REST_SECONDS[kind];
    if (gap) {
      start(gap);
      setMinimised(true);
    } else {
      stop();
    }
  };

  return (
    <>
      <div className="rest-b-bg" aria-hidden="true" />
      <section ref={takeover} className="rest-b" role="dialog" aria-modal="true" aria-label="Rest" tabIndex={-1}>
        <div className="rb-top">
          <span className="t-label">Rest</span>
          <button type="button" className="btn-text hot" onClick={() => setMinimised(true)}>
            Show sets
          </button>
        </div>

        <div className="rb-mid">
          {/* Tapping the number skips, as a shortcut for the button below that
              says so; the button is the accessible route. */}
          <p className="rb-time" role="timer" onClick={stop}>
            {clock}
          </p>
          <div className="rb-bar" aria-hidden="true">
            <i style={{ width: `${fraction * 100}%` }} />
          </div>
          {upNext ? (
            <p className="rb-next">
              Up next
              <strong>{upNext}</strong>
            </p>
          ) : null}
          {pro && afterSetId ? (
            <div className="rb-attach" role="group" aria-label="Add to the set just done">
              {ATTACH.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void attach(option.kind)}
                >
                  + {option.label}
                </button>
              ))}
              {/* A back-off is a set of its own after this rest, so the rest runs on. */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void addBackOffSet(afterSetId)}
              >
                + Back-off
              </button>
            </div>
          ) : null}
        </div>

        <div className="stack-sm">
          <div className="rb-btns">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={remaining <= 30_000}
              onClick={() => extend(-30)}
            >
              <span>
                −30<span className="lc">s</span>
              </span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => extend(30)}>
              <span>
                +30<span className="lc">s</span>
              </span>
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-lg" onClick={stop}>
            Skip rest
          </button>
        </div>
      </section>
    </>
  );
}
