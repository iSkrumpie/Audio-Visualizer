/**
 * Smoke-Test: Logo-Cover-Fit
 *
 * Generiert 3 Logos mit unterschiedlichen Aspect-Ratios und prüft,
 * dass keines mehr "gequetscht" wird:
 *  - 1:1 (quadratisch) — wie Brand-Logo
 *  - 16:9 (Querformat, breit) — z.B. YouTube-Thumbnail
 *  - 9:16 (Hochformat, schmal) — z.B. TikTok/Stories
 *
 * Speichert Screenshots in tmp/screenshots-logo-fit/.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = join(process.cwd(), 'tmp', 'screenshots-logo-fit');
mkdirSync(OUT, { recursive: true });
function log(...a) { console.log('[logo-fit]', ...a); }

// Pre-encoded test PNGs (no need for canvas/sharp).
// 16x16 magenta square (1:1, square)
const SQUARE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
// 32x18 wide rectangle (16:9) — solid red
const WIDE_PNG = (() => {
  // 32x18 raw: encode via canvas-less approach: write a minimal PNG
  // We use a pre-encoded 32x18 red PNG (compressed by hand is impractical;
  // use the small 16x16 and just scale the mesh in the test? No — we need
  // the texture to actually have 16:9. Use Playwright's page to create a
  // data URL on the fly.)
  return null;
})();

const audioPath = join(OUT, '_smoke.wav');
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));

log('Loading app');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await sleep(400);
await page.evaluate(() => {
  localStorage.removeItem('audiovisualizer:settings:v3');
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

// Upload audio
const audioInput = page.locator('input[type="file"]').nth(0);
await audioInput.setInputFiles(audioPath);
await sleep(300);

// Helper: generate a PNG of given w/h with solid color via a data URL,
// then save to disk and use as file input.
async function uploadColoredLogo(w, h, color) {
  const dataUrl = await page.evaluate(({ w, h, color }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    // Add a marker so we can visually see the center + corners
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.min(w, h) / 4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${w}×${h}`, w / 2, h / 2);
    return c.toDataURL('image/png');
  }, { w, h, color });
  // dataUrl → base64 → buffer
  const b64 = dataUrl.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  const path = join(OUT, `_logo_${w}x${h}.png`);
  writeFileSync(path, buf);
  const logoInput = page.locator('input[type="file"]').nth(1);
  await logoInput.setInputFiles(path);
  await sleep(400);
}

async function snapshot(name) {
  await page.getByRole('button', { name: /Play.*Visualize/i }).click();
  await sleep(1500);
  await page.screenshot({ path: join(OUT, name), fullPage: false });
  log('Saved', name);
  // Go back
  await page.getByRole('button', { name: /back to uploader/i }).click();
  await sleep(400);
}

// 1:1 square (should look like the brand logo)
await uploadColoredLogo(400, 400, '#6366F1');
await snapshot('fit-1-1-square.png');

// 16:9 wide — should fill circle fully, crop sides
await uploadColoredLogo(640, 360, '#22D3EE');
await snapshot('fit-16-9-wide.png');

// 9:16 tall — should fill circle fully, crop top/bottom
await uploadColoredLogo(360, 640, '#EC4899');
await snapshot('fit-9-16-tall.png');

// 4:1 ultra-wide — extreme test
await uploadColoredLogo(800, 200, '#F97316');
await snapshot('fit-4-1-ultrawide.png');

log('Done. Files in', OUT);
await browser.close();
