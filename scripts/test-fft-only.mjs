/**
 * test-fft-only.mjs
 *
 * Standalone test for src/lib/fft.ts precomputeFFT().
 * Loads the trimmed test audio, runs the new OfflineAudioContext-based
 * precomputeFFT, and prints the FFT values at a known timestamp so we
 * can compare with the live preview's AnalyserNode values.
 *
 * If the bytes are non-zero and match the magnitude profile of a real
 * music track, the FFT pipeline is working.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP_DIR = process.cwd();
const OUT     = join(APP_DIR, 'tmp', 'fft-only-test');
mkdirSync(OUT, { recursive: true });
const SOURCE_MP3   = join(APP_DIR, 'tmp', 'Ballern!.mp3');
const TRIMMED_MP3  = join(OUT, 'ballern-trimmed.mp3');

function log(...a) { console.log('[fft-only]', ...a); }

async function trimMp3() {
  log('Trimming MP3 to 10s ...');
  const { spawnSync } = await import('node:child_process');
  spawnSync('ffmpeg', ['-y', '-i', SOURCE_MP3, '-t', '10', '-c', 'copy', TRIMMED_MP3], { stdio: 'inherit' });
}

async function startVite() {
  log('Starting Vite ...');
  const proc = spawn('npm', ['run', 'dev'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => !resolved && reject(new Error('Vite timeout')), 30000);
    proc.stdout.on('data', (d) => {
      const s = d.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const m = s.match(/https?:\/\/localhost:(\d+)/);
      if (m && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ proc, port: m[1] });
      }
    });
    proc.on('error', reject);
  });
}

async function main() {
  await trimMp3();

  const vite = await startVite();
  await sleep(2000);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => log('PAGE ERROR:', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.text().includes('FFT') || msg.text().includes('precompute')) {
        log('[browser]', msg.type(), msg.text());
      }
    });

    await page.goto(`http://localhost:${vite.port}/`, { waitUntil: 'networkidle' });
    await sleep(500);

    // Upload audio
    log('Uploading audio ...');
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(TRIMMED_MP3);
    await sleep(500);

    // Click Play
    log('Clicking Play ...');
    await page.locator('button:has-text("PLAY")').click();
    await sleep(3000);

    // Now run precomputeFFT directly and capture the result
    log('Calling precomputeFFT from page context ...');
    const fftResult = await page.evaluate(async () => {
      // @ts-ignore
      const fftMod = await import('/src/lib/fft.ts');
      const { precomputeFFT } = fftMod;

      // We need a decoded AudioBuffer. Get it from the live audio element.
      // @ts-ignore
      const audioEl = window.__audioEl;
      if (!audioEl) return { error: 'no __audioEl' };

      const response = await fetch(audioEl.src);
      const arrayBuf = await response.arrayBuffer();
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuf);

      const frames = await precomputeFFT(audioBuffer, 30, (p) => {
        if (Math.abs(p - Math.round(p * 10) / 10) < 0.01) {
          console.log(`[FFT] precompute progress ${(p * 100).toFixed(0)}%`);
        }
      });

      audioCtx.close();

      return {
        totalFrames: frames.length,
        // Sample 5 timestamps: 0.1s, 1s, 2s, 3s, 5s
        samples: [3, 30, 60, 90, 150].map((i) => {
          const f = frames[i];
          return {
            i,
            t: (i / 30).toFixed(3),
            bass:     f.bass.toFixed(3),
            loudness: f.loudness.toFixed(3),
            highs:    f.highs.toFixed(3),
            energy:   f.energy.toFixed(3),
            freqMax:  Math.max(...f.freqData),
            rawMax:   Math.max(...f.rawFreqData),
            freq0to9: Array.from(f.freqData.slice(0, 10)),
            raw0to9:  Array.from(f.rawFreqData.slice(0, 10)),
          };
        }),
      };
    });

    if (fftResult.error) {
      console.error('FAIL:', fftResult.error);
      process.exitCode = 1;
      return;
    }

    console.log('\n=== precomputeFFT result ===');
    console.log('totalFrames:', fftResult.totalFrames);
    console.log('samples:');
    for (const s of fftResult.samples) {
      console.log(`  t=${s.t}s  bass=${s.bass} loud=${s.loudness} highs=${s.highs} energy=${s.energy} freqMax=${s.freqMax} rawMax=${s.rawMax}`);
      console.log(`    freq[0..9]=${s.freq0to9.join(',')}`);
      console.log(`    raw [0..9]=${s.raw0to9.join(',')}`);
    }

    // Sanity check
    const t3 = fftResult.samples.find((s) => s.i === 90);
    if (t3 && t3.rawMax < 50) {
      console.error(`\n❌ FAIL: t=3.0s has rawMax=${t3.rawMax} (expected > 100 for music)`);
      process.exitCode = 1;
    } else if (t3 && t3.bass === '0.000') {
      console.error(`\n❌ FAIL: t=3.0s has bass=0 (expected > 0 for music)`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ PASS: t=3.0s has rawMax=${t3.rawMax} and bass=${t3.bass} — FFT pipeline is producing data`);
    }
  } finally {
    await browser.close().catch(() => {});
    vite.proc.kill('SIGTERM');
    await sleep(300);
    vite.proc.kill('SIGKILL');
  }
}

main();
