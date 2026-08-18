/**
 * End-of-rest cues. Deliberately dependency-free: a synthesised tone rather
 * than an audio asset, so nothing extra has to be cached for offline use.
 */

let audioContext: AudioContext | null = null;

/**
 * A short two-tone beep.
 *
 * iOS will not start an AudioContext until a user gesture has occurred, so this
 * is a no-op on a page the user has not touched — which is fine, since the
 * timer only ever starts in response to a tap.
 */
export function playRestFinishedTone(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    for (const [index, frequency] of [880, 1174].entries()) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    }
  } catch {
    // Audio is a nicety. Never let it break the workout.
  }
}

export function vibrate(pattern: number | number[] = [120, 60, 120]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported on iOS Safari. Silent by design.
  }
}
