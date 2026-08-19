import { describe, expect, it } from 'vitest';
import { formatClock, formatDayLabel, formatDuration } from './dates';

const NOW = new Date(2026, 7, 19); // Wednesday 19 August 2026

describe('day labels', () => {
  it('names today and the day either side of it', () => {
    expect(formatDayLabel('2026-08-19T10:00:00', NOW)).toBe('Today');
    expect(formatDayLabel('2026-08-18T10:00:00', NOW)).toBe('Yesterday');
    expect(formatDayLabel('2026-08-20T10:00:00', NOW)).toBe('Tomorrow');
  });

  it('counts back over the last week', () => {
    expect(formatDayLabel('2026-08-16T10:00:00', NOW)).toBe('3 days ago');
  });

  /**
   * The calendar passes upcoming sessions through here. Before it handled the
   * future, a session two days out rendered as "-2 days ago".
   */
  it('names the weekday for something coming up', () => {
    expect(formatDayLabel('2026-08-21T10:00:00', NOW)).toBe('Friday');
    expect(formatDayLabel('2026-08-22T10:00:00', NOW)).toBe('Saturday');
  });

  it('never renders a negative day count', () => {
    for (let offset = -10; offset <= 10; offset += 1) {
      const date = new Date(NOW);
      date.setDate(date.getDate() + offset);
      expect(formatDayLabel(date.toISOString(), NOW)).not.toMatch(/-\d/);
    }
  });

  it('falls back to a full date further out', () => {
    expect(formatDayLabel('2026-09-30T10:00:00', NOW)).toMatch(/Sep/);
    expect(formatDayLabel('2026-07-01T10:00:00', NOW)).toMatch(/Jul/);
  });

  it('copes with rubbish input', () => {
    expect(formatDayLabel('not a date', NOW)).toBe('—');
  });
});

describe('durations', () => {
  it('reads as a session length', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(2_880_000)).toBe('48m');
    expect(formatDuration(35_000)).toBe('35s');
  });

  it('does not render nonsense for a bad value', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('the countdown clock', () => {
  it('is always mm:ss', () => {
    expect(formatClock(150_000)).toBe('2:30');
    expect(formatClock(5_000)).toBe('0:05');
  });

  it('never goes below zero', () => {
    expect(formatClock(-5_000)).toBe('0:00');
  });
});
