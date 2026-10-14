/** Writes fixtures/watch/ from the TypeScript rules. See scripts/watchFixtures.ts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchFixtures } from './watchFixtures';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/watch');
mkdirSync(dir, { recursive: true });
for (const [name, cases] of Object.entries(watchFixtures())) {
  writeFileSync(resolve(dir, name), JSON.stringify(cases, null, 2) + '\n');
  console.log(`  fixtures/watch/${name}  ${(cases as unknown[]).length} cases`);
}
