import { afterEach, describe, expect, it, vi } from 'vitest';
import { vibratePattern } from './haptics';
import { keepScreenOn } from './keepAwake';
import { isNativeApp } from './native';

/**
 * The web fallbacks: outside the iPhone app every platform module has to
 * behave exactly as the website always did, which is what keeps the browser
 * suites valid for the app.
 */
describe('the platform layer outside the app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is not the native app in a test', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('vibrates through navigator.vibrate with the pattern as given', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vibratePattern([120, 60, 120]);
    expect(vibrate).toHaveBeenCalledWith([120, 60, 120]);
    vibratePattern(200);
    expect(vibrate).toHaveBeenCalledWith([200]);
  });

  it('is silent where there is no vibration API', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibratePattern([120, 60, 120])).not.toThrow();
  });

  it('leaves the screen to the web wake lock', async () => {
    expect(await keepScreenOn()).toBe(false);
  });
});
