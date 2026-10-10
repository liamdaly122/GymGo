/**
 * The workout's cues: the end of a rest, and a record. Deliberately
 * dependency-free: synthesised tones rather than audio assets, so nothing
 * extra has to be cached for offline use.
 */

import { vibratePattern } from '@/platform/haptics';

let audioContext: AudioContext | null = null;

/**
 * Short sine notes, one after another. Each lasts 0.14s; `gap` is the time
 * from one note's start to the next.
 */
function playNotes(frequencies: readonly number[], gap: number): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    for (const [index, frequency] of frequencies.entries()) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const start = now + index * gap;
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

/**
 * A short two-tone beep.
 *
 * iOS will not start an AudioContext until a user gesture has occurred, so this
 * is a no-op on a page the user has not touched — which is fine, since the
 * timer only ever starts in response to a tap.
 */
export function playRestFinishedTone(): void {
  playNotes([880, 1174], 0.16);
}

/**
 * A record: three notes rising, quicker and brighter than the end of a rest,
 * so the two are never mistaken for each other across a gym. Played straight
 * from the Done tap, which is the gesture iOS wants before it makes a sound.
 */
export function playRecordTone(): void {
  playNotes([784, 988, 1319], 0.1);
}

/** A record's buzz: longer than the end of a rest, where the phone can buzz at all. */
export const RECORD_VIBRATION = [80, 60, 80, 60, 240];

export function vibrate(pattern: number | number[] = [120, 60, 120]): void {
  vibratePattern(pattern);
}
