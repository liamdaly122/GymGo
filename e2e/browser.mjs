/**
 * The Chromium the browser suites run in.
 *
 * In order: `CHROMIUM_PATH` if set; the build the cloud environment keeps at
 * /opt/pw-browsers when it is there; otherwise Playwright's own download
 * (`npx playwright install chromium`, once per machine). Before this, every
 * suite hard-coded the cloud path and none of them could launch on a Mac.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function launchChromium(options = {}) {
  const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);
  return chromium.launch(executablePath ? { ...options, executablePath } : options);
}
