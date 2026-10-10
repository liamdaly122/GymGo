import { Haptics } from '@capacitor/haptics';
import { isNativeApp } from './native';

/**
 * A buzz, from a pattern as `navigator.vibrate` takes it: on, off, on, off…
 * in milliseconds.
 *
 * Safari has no vibration API, so on the website an iPhone never buzzed and
 * the Vibrate toggle did nothing there. Inside the app each "on" becomes a
 * haptic of that length, at the moment the pattern puts it.
 */
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
      const delay = at;
      setTimeout(() => {
        void Haptics.vibrate({ duration: ms }).catch(() => {});
      }, delay);
    }
    at += ms;
  });
}
