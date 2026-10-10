import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNativeApp } from './native';

/**
 * A buzz, from a pattern as `navigator.vibrate` takes it: on, off, on, off…
 * in milliseconds.
 *
 * Safari has no vibration API, so on the website an iPhone never buzzed and
 * the Vibrate toggle did nothing there. Inside the app each "on" becomes a
 * heavy impact at the moment the pattern puts it, and a long "on" (a record's
 * last pulse) a second one just after, so it reads as longer.
 *
 * Not `Haptics.vibrate`: on iOS (@capacitor/haptics 8.0.2) it makes its
 * CHHapticEngine a local variable, which is released when the call returns,
 * before the pattern plays. On a phone nothing was felt. The impact
 * generator has no such problem.
 */
const LONG_PULSE_MS = 200;
const SECOND_TAP_MS = 110;

export function vibratePattern(pattern: number | number[]): void {
  const steps = Array.isArray(pattern) ? pattern : [pattern];
  if (!isNativeApp()) {
    try {
      navigator.vibrate?.(steps);
    } catch {
      // Unsupported. Silent by design.
    }
    return;
  }
  let at = 0;
  steps.forEach((ms, index) => {
    if (index % 2 === 0 && ms > 0) {
      tapAt(at);
      if (ms >= LONG_PULSE_MS) tapAt(at + SECOND_TAP_MS);
    }
    at += ms;
  });
}

function tapAt(delay: number): void {
  setTimeout(() => {
    void Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  }, delay);
}
