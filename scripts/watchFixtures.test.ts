import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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
