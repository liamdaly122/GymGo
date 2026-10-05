import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BADGES, type Badge } from '@/domain/rewards';
import BadgeArt, { artLabel, labelSize, ornamentLevel, platesOf, RING_LENGTH, type TileState } from './BadgeArt';

const STATES: TileState[] = ['earned', 'next', 'locked'];
const badge = (id: string): Badge => BADGES.find((candidate) => candidate.id === id)!;
const draw = (target: Badge, state: TileState = 'earned', extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BadgeArt, { badge: target, state, ...extra }));
const count = (markup: string, className: string) => markup.split(`${className}`).length - 1;

describe('every badge is drawn', () => {
  it('as decorative SVG on the 120 grid, in every state', () => {
    for (const target of BADGES) {
      for (const state of STATES) {
        const markup = draw(target, state, { progress: 0.5 });
        expect(markup.startsWith('<svg')).toBe(true);
        expect(markup).toContain('viewBox="0 0 120 120"');
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).toContain(`class="badge-art ${state}"`);
      }
    }
  });

  it('in the app’s colours only: none named in the art, and no plate colours', () => {
    for (const target of BADGES) {
      for (const state of STATES) {
        const markup = draw(target, state, { progress: 0.5, stamp: true, delay: 200 });
        expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(markup).not.toMatch(/rgba?\(|hsla?\(/);
        expect(markup).not.toContain('--color-p');
      }
    }
  });
});

describe('the number on a badge', () => {
  it('is the threshold, in tonnes for what was lifted and kg for the plates', () => {
    expect(draw(badge('sessions-50'))).toContain('>50</text>');
    expect(draw(badge('lifted-10000'))).toContain('>10T</text>');
    expect(draw(badge('plates-100'))).toContain('>100</text>');
    expect(artLabel(badge('lifted-1000000'))).toBe('1000T');
  });

  it('is left off a moment, which is a picture', () => {
    for (const target of BADGES.filter((candidate) => candidate.family === 'moments')) {
      expect(artLabel(target)).toBeNull();
      expect(draw(target)).not.toContain('<text');
    }
  });

  it('gets smaller as it gets longer, so 1000T still fits', () => {
    expect(labelSize('4')).toBeGreaterThan(labelSize('50'));
    expect(labelSize('50')).toBeGreaterThan(labelSize('250'));
    expect(labelSize('250')).toBeGreaterThan(labelSize('1000'));
    expect(labelSize('1000')).toBeGreaterThan(labelSize('1000T'));
  });
});

describe('the plates badges', () => {
  it('draw the plates they are named for, on each side', () => {
    for (const target of BADGES.filter((candidate) => candidate.family === 'plates')) {
      expect(count(draw(target), 'ba-plate')).toBe(2 * platesOf(target));
    }
    expect(platesOf(badge('plates-220'))).toBe(5);
  });
});

describe('ornaments climb with the tier', () => {
  const tiered = [...new Set(BADGES.filter((candidate) => candidate.family !== 'moments').map((candidate) => candidate.family))];

  it('leave the first badge in every family plain and give the top one laurels', () => {
    for (const family of tiered) {
      const members = BADGES.filter((candidate) => candidate.family === family);
      const first = draw(members[0]!);
      const top = draw(members.at(-1)!);
      expect(first).not.toContain('ba-inner');
      expect(first).not.toContain('ba-star');
      expect(first).not.toContain('ba-laurel');
      expect(top).toContain('ba-inner');
      expect(top).toContain('ba-star');
      expect(top).toContain('ba-laurel');
    }
  });

  it('add an inner ring, then a star, then laurels', () => {
    expect(['sessions-1', 'sessions-10', 'sessions-25', 'sessions-100', 'sessions-1000'].map((id) => ornamentLevel(badge(id)))).toEqual([
      0, 0, 1, 2, 3,
    ]);
    const ring = draw(badge('sessions-25'));
    expect(ring).toContain('ba-inner');
    expect(ring).not.toContain('ba-star');
    const starred = draw(badge('sessions-100'));
    expect(starred).toContain('ba-star');
    expect(starred).not.toContain('ba-laurel');
  });

  it('never dress up a moment', () => {
    for (const target of BADGES.filter((candidate) => candidate.family === 'moments')) {
      expect(ornamentLevel(target)).toBe(0);
    }
  });
});

describe('the next badge in a family', () => {
  it('wears a ring as far round as the family has got', () => {
    const markup = draw(badge('sessions-50'), 'next', { progress: 0.74 });
    const reached = Math.round(RING_LENGTH * 0.74 * 10) / 10;
    expect(markup).toContain('ba-ring');
    expect(markup).toContain(`stroke-dasharray="${reached} ${Math.round(RING_LENGTH * 10) / 10}"`);
  });

  it('is the only one with a ring', () => {
    for (const state of ['earned', 'locked'] as const) {
      const markup = draw(badge('sessions-50'), state, { progress: 0.74 });
      expect(markup).not.toContain('ba-ring');
      expect(markup).not.toContain('ba-track');
    }
  });
});

describe('a badge earned in the session just finished', () => {
  it('stamps itself in, after its delay', () => {
    const markup = draw(badge('records-1'), 'earned', { stamp: true, delay: 460 });
    expect(markup).toContain('class="badge-art earned stamp"');
    expect(markup).toContain('animation-delay:460ms');
  });
});
