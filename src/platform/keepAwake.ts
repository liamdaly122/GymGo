import { KeepAwake } from '@capacitor-community/keep-awake';
import { isNativeApp } from './native';

/**
 * Keeps the screen on during a workout, inside the app.
 *
 * On iOS the plugin only sets the idle timer flag, which holds until it is
 * cleared, so there is nothing to re-acquire when the app comes back to the
 * foreground. In a browser this returns false and `useWakeLock` uses the
 * Screen Wake Lock API as it always has.
 */
export async function keepScreenOn(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    await KeepAwake.keepAwake();
    return true;
  } catch {
    return false;
  }
}

export async function allowScreenOff(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await KeepAwake.allowSleep();
  } catch {
    // Nothing was held.
  }
}
