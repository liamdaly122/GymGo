import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStartLayout } from '../src/domain/startLayout';
import type { WatchContext, WatchEvent } from '../src/domain/watchProtocol';
import { watchFixtures } from './watchFixtures';

/**
 * The watch's Swift port is tested against fixtures/watch/. If the TypeScript
 * rules change and the files are not rebuilt, the two sides would quietly
 * disagree; this fails instead. Run `npm run fixtures:watch`.
 */
describe('the watch fixtures', () => {
  for (const [name, cases] of Object.entries(watchFixtures())) {
    it(`${name} matches what the TypeScript rules answer today`, () => {
      const onDisk = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/watch', name), 'utf8'));
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(cases)));
    });
  }
});

/** The protocol cases have to be ones the phone could really send and apply. */
describe('the protocol fixtures', () => {
  const fixtures = watchFixtures();
  const contexts = fixtures['context.json'] as Array<{ name: string; context: WatchContext }>;
  const events = fixtures['events.json'] as WatchEvent[];

  it('offer a ready session whose layout is the session its snapshot shows', () => {
    const ready = contexts.map(({ context }) => context.home.ready).filter((value) => value !== null);
    expect(ready).toHaveLength(1);
    const layout = parseStartLayout(JSON.parse(ready[0]!.layout))!;
    expect(layout).not.toBeNull();
    expect(ready[0]!.snapshot.workoutId).toBe(layout.workoutId);
    expect(ready[0]!.snapshot.sets.map((set) => set.id).sort()).toEqual(
      layout.exercises.flatMap((entry) => entry.sets.map((set) => set.id)).sort(),
    );
    expect(ready[0]!.exercises).toHaveLength(layout.exercises.length);
  });

  it('keep ready set only in the ready state, and the live workout out of it', () => {
    for (const { name, context } of contexts) {
      expect(context.home.state === 'ready', name).toBe(context.home.ready !== null);
      if (context.live) expect(context.home.ready, name).toBeNull();
      expect(context.home.week.length === 0 || context.home.week.length === 7, name).toBe(true);
    }
    expect(contexts.some(({ context }) => context.phoneClaim !== null && context.home.closed.length > 0)).toBe(true);
  });

  it('hold one event of every kind, the start echoing the ready layout and the finish carrying its sets', () => {
    expect(events.map((event) => event.kind).sort()).toEqual(['completeSet', 'discard', 'finish', 'skipRest', 'startWorkout']);
    const ready = contexts.find(({ context }) => context.home.ready)!.context.home.ready!;
    const start = events.find((event) => event.kind === 'startWorkout')!;
    expect(start.layout).toBe(ready.layout);
    expect(start.workoutId).toBe(ready.snapshot.workoutId);
    const finish = events.find((event) => event.kind === 'finish')!;
    expect(finish.sets!.length).toBeGreaterThan(0);
    expect(finish.sets!.every((set) => set.kind === 'completeSet' && set.workoutId === finish.workoutId)).toBe(true);
    for (const event of [...events, ...finish.sets!]) expect(Number.isNaN(Date.parse(event.at)), event.id).toBe(false);
  });
});
