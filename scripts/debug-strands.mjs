/**
 * Strands Debug — prüft ob das Strands-Canvas gemounted wird und welche
 * Dimensionen / Sichtbarkeit es hat.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP_DIR = process.cwd();
const SCREENSHOT_DIR = join(APP_DIR, 'tmp', 'strands-debug');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(...args) { console.log('[Strands-Debug]', ...args); }

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
  let vite, browser;
  try {
    vite = await startVite();
    await sleep(2000);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', (msg) => log(`[browser ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => log('PAGE ERROR:', err.message));

    log('Loading app...');
    await page.goto(`http://localhost:${vite.port}/`, { waitUntil: 'networkidle' });
    await sleep(500);

    // Use the test files from test-e2e-v2 if they exist
    const wavPath = join(APP_DIR, 'tmp', 'test-bass.wav');
    if (!existsSync(wavPath)) {
      // Generate one quickly
      const { generateBassWav } = await import('./test-e2e-v2.mjs').catch(() => ({}));
      if (generateBassWav) {
        writeFileSync(wavPath, generateBassWav(4));
      } else {
        log('No wav file, can\'t proceed');
        return;
      }
    }
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(wavPath);
    await sleep(500);
    log('Clicking Play...');
    await page.locator('button:has-text("PLAY")').click();
    await sleep(1500);

    // Check if Strands div exists
    log('--- DOM-INSPECTION BEFORE STRANDS-ENABLE ---');
    const before = await page.evaluate(() => {
      const divs = document.querySelectorAll('div[style*="position: absolute"]');
      const info = [];
      divs.forEach((d) => {
        const rect = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        if (rect.width > 100 && rect.height > 100) {
          info.push({
            tag: d.tagName,
            w: rect.width,
            h: rect.height,
            position: cs.position,
            zIndex: cs.zIndex,
            children: d.children.length,
            firstChildTag: d.children[0]?.tagName,
          });
        }
      });
      return info;
    });
    log('Large absolute-positioned divs:', JSON.stringify(before, null, 2));

    // Open settings and enable strands
    await page.locator('button[aria-label="Settings"]').click();
    await sleep(500);

    // Click "Strands" accordion
    log('Clicking Strands accordion...');
    await page.locator('button:has-text("Strands")').first().click();
    await sleep(300);

    // Click "Show strands" toggle
    log('Enabling strands...');
    const showToggle = page.locator('button[role="switch"]').nth(0);  // First toggle = master
    // Actually we need to find the right one. Let's just look for "Show strands" label
    await page.locator('text="Show strands"').first().locator('..').locator('button[role="switch"]').click();
    await sleep(2000);  // wait for rAF loop + first frames

    // Check Strands canvas now
    log('--- DOM-INSPECTION AFTER STRANDS-ENABLE ---');
    const after = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const info = [];
      canvases.forEach((c) => {
        const rect = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        info.push({
          w: rect.width,
          h: rect.height,
          cssW: cs.width,
          cssH: cs.height,
          bufferW: c.width,
          bufferH: c.height,
          position: cs.position,
          zIndex: cs.zIndex,
          opacity: cs.opacity,
          display: cs.display,
          mixBlendMode: cs.mixBlendMode,
          pointerEvents: cs.pointerEvents,
          parentPosition: getComputedStyle(c.parentElement).position,
          parentZIndex: getComputedStyle(c.parentElement).zIndex,
        });
      });
      return info;
    });
    log('All canvases:', JSON.stringify(after, null, 2));

    // Check pixel content at center of strands canvas (the 2nd one = ogl canvas)
    const pixelCheck = await page.evaluate(() => {
      const canvases = document.querySelectorAll('canvas');
      const results = [];
      canvases.forEach((c, idx) => {
        if (c.width === 0 || c.height === 0) {
          results.push({ idx, error: 'zero size' });
          return;
        }
        // Read pixels via webgl context directly? Skip — just check the dimensions
        const ctx = c.getContext('2d');
        if (ctx) {
          try {
            const data = ctx.getImageData(c.width/2, c.height/2, 1, 1).data;
            results.push({ idx, w: c.width, h: c.height, centerPixel: [...data] });
          } catch (e) {
            results.push({ idx, error: 'getImageData failed: ' + e.message });
          }
        } else {
          results.push({ idx, w: c.width, h: c.height, has2d: false });
        }
      });
      return results;
    });
    log('Pixel check:', JSON.stringify(pixelCheck, null, 2));

    // Screenshot for visual verification
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'after-enable.png'), fullPage: false });

    log('=================================');
    log('Debug complete — see tmp/strands-debug/');
    log('=================================');
  } catch (err) {
    console.error('❌ Debug FAILED:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (vite) { vite.proc.kill('SIGTERM'); await sleep(300); vite.proc.kill('SIGKILL'); }
  }
}

main();
