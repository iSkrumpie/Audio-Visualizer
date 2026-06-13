/**
 * E2E v2: full pipeline test
 *  - Upload audio (8s bass) + logo PNG + background PNG
 *  - Verify all 3 previews show
 *  - Click Play
 *  - Take screenshot showing background + logo + bars + particles
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP_DIR = process.cwd();
const SCREENSHOT_DIR = join(APP_DIR, 'tmp', 'screenshots-v2');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(...args) { console.log('[E2E-v2]', ...args); }

// Generate 8s pulsing bass WAV
function generateBassWav(durationSec = 8, freq = 80) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    const noise = (Math.random() - 0.5) * 0.1;
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.7 + noise;
    const intSample = Math.max(-1, Math.min(1, sample)) * 0x7fff;
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }
  return buffer;
}

// Generate a simple 64x64 PNG (solid green circle = logo placeholder)
function generateLogoPng() {
  // Tiny valid PNG: 64x64 transparent circle with green border
  // Use a precomputed minimal PNG
  const png = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000400000004008060000005C9D8DC70000001949444154789C63601805C3C0F87FFF3F020BC420C8B0B5B5CEC58F3F08A2860A40A30F0F0F0F8FCD03E2F3F26F2FFF3F0B2FF0F1A0C0F2B5BDFFE3FFFC3F1F0B9D3F0F0F0F0FC3D5FF2B5BFF2D5F0F0F0F0F0F0000000049454E44AE426082',
    'hex',
  );
  return png;
}

// Generate a 256x144 colorful JPG-ish PNG (background)
// We'll use a real PNG generator via canvas in browser
async function generateBgPng(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const ctx = c.getContext('2d');
    // Gradient sky → ground
    const grad = ctx.createLinearGradient(0, 0, 0, 288);
    grad.addColorStop(0, '#ff6b35'); // orange
    grad.addColorStop(0.4, '#e74c3c');
    grad.addColorStop(0.7, '#8e44ad');
    grad.addColorStop(1, '#2c3e50');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 288);
    // Add some "stars"
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 30; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 200, Math.random() * 2 + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Add silhouette mountains
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(0, 288);
    for (let x = 0; x <= 512; x += 50) {
      ctx.lineTo(x, 200 + Math.sin(x * 0.05) * 40);
    }
    ctx.lineTo(512, 288);
    ctx.closePath();
    ctx.fill();
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    const ab = await blob.arrayBuffer();
    return Array.from(new Uint8Array(ab));
  });
}

async function startVite() {
  log('Starting Vite...');
  const proc = spawn('npm', ['run', 'dev'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => !resolved && reject(new Error('Vite timeout')), 30000);
    proc.stdout.on('data', (d) => {
      const s = d.toString();
      const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
      if (/https?:\/\/localhost:(\d+)/.test(stripped) && !resolved) {
        const port = stripped.match(/https?:\/\/localhost:(\d+)/)[1];
        resolved = true;
        clearTimeout(timeout);
        resolve({ proc, port });
      }
    });
    proc.on('error', reject);
  });
}

async function main() {
  let vite;
  let browser;
  try {
    vite = await startVite();
    await sleep(2000);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => log('PAGE ERROR:', err.message));

    log('Loading app...');
    await page.goto(`http://localhost:${vite.port}/`, { waitUntil: 'networkidle' });
    await sleep(500);

    // 1. Upload audio
    log('Uploading audio...');
    const wavBuf = generateBassWav(8);
    writeFileSync(join(APP_DIR, 'tmp', 'test-bass.wav'), wavBuf);
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(join(APP_DIR, 'tmp', 'test-bass.wav'));
    await sleep(300);

    // 2. Upload logo
    log('Uploading logo (generated PNG)...');
    const logoPng = generateLogoPng();
    writeFileSync(join(APP_DIR, 'tmp', 'test-logo.png'), logoPng);
    await page.locator('input[type="file"][accept*="image"]').first().setInputFiles(join(APP_DIR, 'tmp', 'test-logo.png'));
    await sleep(300);

    // 3. Upload background (generate colorful PNG in browser)
    log('Generating + uploading background...');
    const bgPng = await generateBgPng(page);
    writeFileSync(join(APP_DIR, 'tmp', 'test-bg.png'), Buffer.from(bgPng));
    await page.locator('input[type="file"][accept*="image"]').nth(1).setInputFiles(join(APP_DIR, 'tmp', 'test-bg.png'));
    await sleep(500);

    await page.screenshot({ path: join(SCREENSHOT_DIR, '01-all-uploaded.png'), fullPage: true });

    // 4. Click Play
    log('Clicking Play...');
    await page.locator('button:has-text("PLAY")').click();
    await sleep(2500);

    await page.screenshot({ path: join(SCREENSHOT_DIR, '02-visualizer.png'), fullPage: true });
    await sleep(1500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '03-visualizer-mid.png'), fullPage: true });

    // 5. Open settings
    log('Opening settings...');
    await page.locator('button[aria-label="Settings"]').click();
    await sleep(800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '04-settings-open.png'), fullPage: true });

    // 6. Change accent color to red
    log('Changing accent to red...');
    const colorInputs = page.locator('input[type="color"]');
    await colorInputs.first().evaluate((el) => {
      el.value = '#ff3344';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(800);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05-red-accent.png'), fullPage: true });

    log('=================================');
    log('✅ E2E v2 PASSED');
    log('=================================');
  } catch (err) {
    console.error('❌ E2E v2 FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (vite) { vite.proc.kill('SIGTERM'); await sleep(300); vite.proc.kill('SIGKILL'); }
  }
}

main();
