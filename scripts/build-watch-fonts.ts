/**
 * The watch's fonts: Big Shoulders Display and Barlow, the same faces as the
 * app (SIL Open Font License 1.1, from @fontsource), as TrueType files watchOS
 * can load. @fontsource ships web formats only. A WOFF file is the font's
 * tables compressed one by one, so unpacking it rebuilds the original font
 * byte for byte. Re-run with `npm run fonts:watch` after a font update.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'ios/GymGoKit/Sources/GymGoWatchUI/Fonts');

const FONTS: Array<[string, string]> = [
  ['@fontsource/big-shoulders-display/files/big-shoulders-display-latin-700-normal.woff', 'BigShouldersDisplay-Bold.ttf'],
  ['@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff', 'BigShouldersDisplay-ExtraBold.ttf'],
  ['@fontsource/barlow/files/barlow-latin-500-normal.woff', 'Barlow-Medium.ttf'],
  ['@fontsource/barlow/files/barlow-latin-600-normal.woff', 'Barlow-SemiBold.ttf'],
];

export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20;
    const tag = woff.subarray(at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const checksum = woff.readUInt32BE(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`table ${tag} did not unpack to its length`);
    return { tag, checksum, data };
  });

  const pad = (n: number) => (n + 3) & ~3;
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector += 1;
  const searchRange = 2 ** entrySelector * 16;

  const header = Buffer.alloc(12 + 16 * numTables);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);

  const bodies: Buffer[] = [];
  let offset = header.length;
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    table.tag.copy(header, at);
    header.writeUInt32BE(table.checksum, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(table.data.length, at + 12);
    const padded = Buffer.alloc(pad(table.data.length));
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mkdirSync(out, { recursive: true });
  for (const [source, name] of FONTS) {
    const ttf = woffToSfnt(readFileSync(resolve(root, 'node_modules', source)));
    writeFileSync(resolve(out, name), ttf);
    console.log(`  ${name.padEnd(36)} ${(ttf.length / 1024).toFixed(1)}KB`);
  }
}
