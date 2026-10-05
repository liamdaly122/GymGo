import { describe, expect, it } from 'vitest';
import { levelFor, titleFor, xpAtLevel, xpForNextLevel } from './levels';

describe('levels', () => {
  it('asks 300 XP for the first level and 100 more for each after', () => {
    expect(xpForNextLevel(1)).toBe(300);
    expect(xpForNextLevel(2)).toBe(400);
    expect(xpAtLevel(1)).toBe(0);
    expect(xpAtLevel(2)).toBe(300);
    expect(xpAtLevel(3)).toBe(700);
    expect(xpAtLevel(4)).toBe(1200);
  });

  it('turns over exactly at each boundary', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, into: 0, span: 300, toNext: 300, fraction: 0 });
    expect(levelFor(299).level).toBe(1);
    expect(levelFor(300)).toMatchObject({ level: 2, into: 0, span: 400, toNext: 400 });
    expect(levelFor(500)).toMatchObject({ level: 2, into: 200, fraction: 0.5 });
    expect(levelFor(700).level).toBe(3);
  });

  it('puts level 10 at about six weeks of four sessions', () => {
    // Roughly 1,000 XP a training week: four sessions and the week's bonus.
    expect(xpAtLevel(10)).toBe(6300);
  });

  it('names the level bands', () => {
    expect(titleFor(1)).toBe('Rookie');
    expect(titleFor(4)).toBe('Rookie');
    expect(titleFor(5)).toBe('Regular');
    expect(titleFor(10)).toBe('Grinder');
    expect(titleFor(29)).toBe('Steel');
    expect(titleFor(30)).toBe('Titan');
    expect(titleFor(45)).toBe('Legend');
    expect(levelFor(xpAtLevel(15)).title).toBe('Iron');
  });

  it('never goes below level 1', () => {
    expect(levelFor(-50).level).toBe(1);
  });
});
