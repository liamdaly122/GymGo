/**
 * The only place that knows the app is inside an iPhone app.
 *
 * Every capability that differs between the browser and the native shell
 * lives in this folder, each with a web fallback, so the website and the
 * browser suites keep working unchanged. Nothing outside src/platform/ may
 * import @capacitor/*, and src/domain/ may not import this folder at all:
 * scripts/boundaries.test.ts holds both lines.
 */
import { Capacitor } from '@capacitor/core';

/** True inside the iPhone app; false on the website and in every test. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
