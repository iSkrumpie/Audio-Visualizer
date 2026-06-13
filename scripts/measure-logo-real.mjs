/**
 * Smoke-Test: Echtes User-Logo (Auto-Cockpit, 2558×1318)
 *
 * Lädt das echte Brand-Asset (tmp/Logo.png) hoch und prüft, dass es
 * im Kreis korrekt dargestellt wird — nicht gequetscht, mit echter
 * Aspect-Ratio, geclippt auf den Kreis.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = join(process.cwd(), 'tmp', 'screenshots-logo-fit');
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[logo-real]', ...a);

const audioPath = join(OUT, '_smoke.wav');
import { writeFileSync } from 'node:fs';
function genBassWav(durationSec = 4, freq = 80) {
  const sr = 44100;
  const n = Math.floor(sr * durationSec);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = 0.4 + 0.6 * Math.abs(Math.sin(2 * Math.PI * 2 * t));
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.7;
    buf.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 0x7fff, 44 + i * 2);
  }
  return buf;
}
writeFileSync(audioPath, genBassWav());

const realLogoPath = join(process.cwd(), 'tmp', 'Logo.png');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));

log('Loading app');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await sleep(400);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

await page.locator('input[type="file"]').nth(0).setInputFiles(audioPath);
await sleep(300);
await page.locator('input[type="file"]').nth(1).setInputFiles(realLogoPath);
await sleep(800);
await page.getByRole('button', { name: /Play.*Visualize/i }).click();
await sleep(1500);
await page.screenshot({ path: join(OUT, 'fit-real-logo-cockpit.png'), fullPage: false });
log('Saved fit-real-logo-cockpit.png');
await browser.close();
