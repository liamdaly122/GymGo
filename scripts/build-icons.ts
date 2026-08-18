/**
 * Rasterises the app icon into the PNG sizes a PWA install needs.
 *
 * Source art is SVG in assets/, output is committed to public/icons so a clean
 * checkout can build without running this. Re-run with `npm run icons:build`
 * after changing the artwork.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const standard = readFileSync(resolve(root, 'assets/icon.svg'));
const maskable = readFileSync(resolve(root, 'assets/icon-maskable.svg'));

const jobs: Array<{ source: Buffer; size: number; name: string }> = [
  { source: standard, size: 192, name: 'icon-192.png' },
  { source: standard, size: 512, name: 'icon-512.png' },
  { source: maskable, size: 192, name: 'icon-192-maskable.png' },
  { source: maskable, size: 512, name: 'icon-512-maskable.png' },
  // iOS ignores the manifest and uses this one for the home screen.
  { source: standard, size: 180, name: 'apple-touch-icon.png' },
  { source: standard, size: 32, name: 'favicon-32.png' },
];

for (const job of jobs) {
  const png = await sharp(job.source).resize(job.size, job.size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(resolve(outDir, job.name), png);
  console.log(`  ${job.name.padEnd(26)} ${job.size}x${job.size}  ${(png.length / 1024).toFixed(1)}KB`);
}

// A tiny SVG favicon for browsers that prefer one.
writeFileSync(resolve(root, 'public/favicon.svg'), standard);
console.log('  favicon.svg');
