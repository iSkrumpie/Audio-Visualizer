/**
 * Smoke-Test: VisualizerStage nach Studio-Redesign
 *
 * Lädt die App, lädt ein Audio + Logo + BG hoch, klickt Play,
 * wartet 2s, und screenshotet:
 *  - 01-stage-default.png    : Stage direkt nach Play (default Bars-Color)
 *  - 02-stage-workflow.png   : Stage mit workflow-gradient Bars (default)
 *  - 03-stage-spectrum.png   : Stage mit spectrum Bars
 *  - 04-stage-solid.png      : Stage mit solid Bars
 *  - 05-stage-settings.png   : Settings-Panel offen, Bars-Sektion sichtbar
 *  - 06-stage-light.png      : Gleiche Stage im Light-Theme
 *  - 07-stage-noaudio.png    : Stage ohne Audio (Fallback-Hintergrund sichtbar)
 *
 * Voraussetzung: `npm run dev` läuft auf :5173
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP_URL = 'http://localhost:5173';
const OUT = join(process.cwd(), 'tmp', 'screenshots-stage-redesign');
mkdirSync(OUT, { recursive: true });
function log(...a) { console.log('[smoke-stage]', ...a); }

// 4s 80Hz pulsing bass WAV
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

// 1x1 rotes PNG (für Background)
const RED_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C63F8CFC0F01F000005000100B0B8182D0000000049454E44AE426082',
  'hex',
);
// 1x1 grünes PNG (für Logo)
const GREEN_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108020000009077532DE00000000C49444154789C63A8EFFFDF000500015A6F0E890000000049454E44AE426082',
  'hex',
);

// Use the real brand assets for a proper final-stage screenshot
import { readFileSync } from 'node:fs';
const realLogoPath = join(process.cwd(), 'tmp', 'Logo.png');
const realLogoBuf = readFileSync(realLogoPath);

const audioPath = join(OUT, '_smoke.wav');
const bgPath = join(OUT, '_bg.png');
const logoPath = join(OUT, '_logo.png');
writeFileSync(audioPath, genBassWav());
writeFileSync(bgPath, RED_PNG);
writeFileSync(logoPath, GREEN_PNG);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') log('console.error:', msg.text());
  if (msg.text().includes('BG-Plane')) log('CONSOLE:', msg.text());
});

log('Loading', APP_URL);
await page.goto(APP_URL, { waitUntil: 'networkidle' });
await sleep(400);

// Clear localStorage v3 (Settings) to make sure we start with NEW defaults (workflow-gradient).
// But DO NOT clear the entire localStorage — we want theme mode to persist if user had set it.
await page.evaluate(() => {
  const KEY = 'audiovisualizer:settings:v3';
  if (localStorage.getItem(KEY)) localStorage.removeItem(KEY);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

// Upload 2 files (audio + logo). NO background — we want to see the studio fallback.
log('Uploading 2 files (audio + logo, NO bg to test studio fallback)…');
const audioInput = page.locator('input[type="file"]').nth(0);
const logoInput = page.locator('input[type="file"]').nth(1);
await audioInput.setInputFiles(audioPath);
await sleep(150);
await logoInput.setInputFiles(logoPath);
// Actually use the real brand logo
await logoInput.setInputFiles(realLogoPath);
void realLogoBuf; // keep reference so import isn't tree-shaken
await sleep(400);

log('Clicking Play & Visualize');
await page.getByRole('button', { name: /Play.*Visualize/i }).click();
await sleep(1500); // wait for canvas + bars to render

// 00a - WITHOUT background image: studio fallback should be visible
await page.screenshot({ path: join(OUT, '00a-stage-no-bg-dark.png'), fullPage: false });
log('Saved 00a-stage-no-bg-dark.png');

// Toggle to spectrum via settings panel
log('Opening settings panel');
await page.getByRole('button', { name: 'Settings' }).click();
await sleep(300);
// Bars tab
await page.locator('button').filter({ hasText: /^Bars$/ }).click();
await sleep(200);
await page.screenshot({ path: join(OUT, '01-stage-default.png'), fullPage: false });
log('Saved 01-stage-default.png (workflow-gradient, settings open)');
// Click "Spectrum" chip
await page.locator('button').filter({ hasText: /^Spectrum$/ }).first().click();
await sleep(800);
await page.screenshot({ path: join(OUT, '02-stage-spectrum.png'), fullPage: false });
log('Saved 02-stage-spectrum.png');

// Click "Solid" chip
await page.locator('button').filter({ hasText: /^Solid$/ }).first().click();
await sleep(800);
await page.screenshot({ path: join(OUT, '03-stage-solid.png'), fullPage: false });
log('Saved 03-stage-solid.png');

// Back to Workflow
await page.locator('button').filter({ hasText: /^Workflow$/ }).first().click();
await sleep(500);
await page.screenshot({ path: join(OUT, '04-stage-settings-open.png'), fullPage: false });
log('Saved 04-stage-settings-open.png');

// Close settings
await page.getByRole('button', { name: 'Settings' }).click();
await sleep(300);

// 05 - light theme (WITH bg image)
log('Switching to light theme');
await page.locator('button[aria-label*="theme" i], button[aria-label*="ight" i]').first().click().catch(() => {});
// Use the ThemeToggle's exact aria-labels
const lightBtn = page.getByRole('button', { name: /switch to light/i });
if (await lightBtn.count()) await lightBtn.first().click();
await sleep(800);
// Read current html data-theme attribute
const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
log('After click, data-theme =', themeAttr);
await page.screenshot({ path: join(OUT, '05-stage-light.png'), fullPage: false });
log('Saved 05-stage-light.png');

// 06 - Go back to uploader, switch to LIGHT theme, play to see
//      the studio workflow-gradient fallback in light mode.
log('Going back to uploader, switching to light theme, re-entering stage');
await page.getByRole('button', { name: /back to uploader/i }).click();
await sleep(400);
const lightBtn2 = page.getByRole('button', { name: /switch to light/i });
if (await lightBtn2.count()) await lightBtn2.first().click();
await sleep(500);
await page.getByRole('button', { name: /Play.*Visualize/i }).click();
await sleep(1500);
await page.screenshot({ path: join(OUT, '06-stage-no-bg-light.png'), fullPage: false });
log('Saved 06-stage-no-bg-light.png');

// 07 - Dark + real logo + studio fallback, final hero shot
log('Final hero: dark theme + real logo + no bg');
// Switch back to dark
const darkBtn = page.getByRole('button', { name: /switch to dark/i });
if (await darkBtn.count()) await darkBtn.first().click();
await sleep(500);
await page.screenshot({ path: join(OUT, '07-stage-real-logo-dark.png'), fullPage: false });
log('Saved 07-stage-real-logo-dark.png');

log('Done. Files in', OUT);
await browser.close();
