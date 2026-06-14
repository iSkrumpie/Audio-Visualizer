/**
 * verify-export.mjs
 *
 * E2E verification script for the AudioVisualizer export bug.
 *
 * Detects whether the exported MP4 shows weaker audio-reactive animations
 * than the live canvas preview by:
 *   1. Spawning a Vite dev server
 *   2. Uploading a generated WAV with a clear 120-BPM kick beat
 *   3. Letting the visualizer play and taking a canvas snapshot at ~1.5 s
 *   4. Stopping the rAF analysis loop (prevents race with export pipeline)
 *   5. Calling exportMP4() directly via dynamic import inside page.evaluate()
 *   6. Saving the resulting MP4 and extracting the same-timestamp frame via ffmpeg
 *   7. Computing SSIM (structural similarity) between preview and export frame
 *   8. Printing RESULT: PASS / FAIL with similarity score
 *
 * Usage:
 *   node scripts/verify-export.mjs
 *
 * Prerequisites:
 *   - ffmpeg in PATH
 *   - playwright installed (npm i)
 *   - App builds / dev-server can start (no pre-existing server needed)
 *
 * Artifacts are saved in tmp/verify-export/.
 */

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

// ── Paths ─────────────────────────────────────────────────────────────────────
const APP_DIR    = process.cwd();
const OUT        = join(APP_DIR, 'tmp', 'verify-export');
const WAV_PATH   = join(OUT, 'test-beat.wav');
const PREVIEW    = join(OUT, 'preview.png');
const PREV_SCALED= join(OUT, 'preview-scaled.png');
const EXPORT_MP4 = join(OUT, 'export.mp4');
const EXP_FRAME  = join(OUT, 'export-frame.png');
const DIFF       = join(OUT, 'diff.png');

// ── Export params (small = fast test) ────────────────────────────────────────
const EXP_W   = 640;
const EXP_H   = 360;
const EXP_FPS = 30;

// ── Snapshot / comparison time ────────────────────────────────────────────────
// Beat occurs every 500 ms starting at 0.5 s → beats at 0.5, 1.0, 1.5, 2.0 …
// We snapshot at ~1.5 s (third beat) and extract the MP4 frame at the same time.
const SNAP_TIME = 1.5; // seconds

// ── Pass threshold ────────────────────────────────────────────────────────────
// SSIM: 1.0 = identical, 0.0 = totally different.
// Bug manifests as weaker animation → lower SSIM vs a correct export (~0.5-0.7).
const PASS_THRESHOLD = 0.80;

mkdirSync(OUT, { recursive: true });

function log(...a) { console.log('[verify-export]', ...a); }

// ─────────────────────────────────────────────────────────────────────────────
// WAV generator: 4 s mono 48 kHz PCM-16
//   0.0–0.5 s  silence intro
//   0.5–3.0 s  80 Hz kick every 500 ms (120 BPM)
//   3.0–4.0 s  silence outro
// Each kick is a short exponentially-decaying 80 Hz sinusoid with harmonics and
// a small frequency sweep to give the FFT a rich, distinct spike.
// ─────────────────────────────────────────────────────────────────────────────
function generateBeatWav() {
  const SR       = 48000;
  const DURATION = 4.0;
  const INTRO    = 0.5;
  const BPM_INT  = 0.5;   // seconds per beat
  const KICK_DUR = 0.09;  // kick transient length
  const KICK_HZ  = 80;
  const OUTRO    = 3.0;   // content ends at 3.0 s

  const N = Math.floor(SR * DURATION);
  const buf = Buffer.alloc(44 + N * 2);

  // WAV header (mono, 16-bit PCM, 48 kHz)
  buf.write('RIFF', 0);                    buf.writeUInt32LE(36 + N * 2, 4);
  buf.write('WAVE', 8);                    buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);               buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);                buf.writeUInt32LE(SR, 24);  // mono
  buf.writeUInt32LE(SR * 2, 28);           buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);               buf.write('data', 36);
  buf.writeUInt32LE(N * 2, 40);

  for (let i = 0; i < N; i++) {
    const t  = i / SR;
    let   s  = 0;

    if (t >= INTRO && t < OUTRO) {
      const phase = (t - INTRO) % BPM_INT;
      if (phase < KICK_DUR) {
        // Exponential envelope: fast attack, short decay
        const env  = Math.exp(-phase / (KICK_DUR * 0.35)) * (1 - phase / KICK_DUR);
        // Frequency sweep (pitch drops quickly — typical acoustic kick)
        const sweep = KICK_HZ * (1 + 2.5 * Math.exp(-phase / 0.018));
        const kw    = 2 * Math.PI * sweep * phase;
        // Fundamental + harmonics for a rich FFT profile
        s = Math.sin(kw)       * env * 0.80
          + Math.sin(kw * 2)   * env * 0.22
          + Math.sin(kw * 3)   * env * 0.10
          + Math.sin(kw * 0.5) * env * 0.35;   // sub-bass thump
      }
    }

    buf.writeInt16LE(
      Math.max(-32767, Math.min(32767, Math.round(s * 32767))),
      44 + i * 2,
    );
  }
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vite helper
// ─────────────────────────────────────────────────────────────────────────────
async function startVite() {
  log('Starting Vite dev server …');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });

  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) reject(new Error('Vite startup timeout (30 s)'));
    }, 30_000);

    const tryResolve = (data) => {
      const s = data.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const m = s.match(/localhost:(\d+)/);
      if (m && !done) {
        done = true;
        clearTimeout(timeout);
        log(`Vite ready on port ${m[1]}`);
        resolve({ proc, port: m[1] });
      }
    };

    proc.stdout.on('data', tryResolve);
    proc.stderr.on('data', tryResolve);
    proc.on('error', reject);
    proc.on('exit', (code) => { if (!done) reject(new Error(`Vite exited (${code})`)); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg helpers (spawnSync avoids shell-escaping issues on Windows)
// ─────────────────────────────────────────────────────────────────────────────
function ffmpeg(...args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

function parseSSIM(text) {
  // ffmpeg ssim filter prints: "SSIM Y:0.xxx ... All:0.xxx (nn.nn dB)"
  const m = text.match(/All:([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parsePSNR(text) {
  // ffmpeg psnr filter prints: "PSNR … average:nn.nn …"
  const m = text.match(/average:([\d.inf]+)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  let vite    = null;
  let browser = null;

  try {
    // 1. Generate test audio
    log('Generating test WAV (4 s, 80 Hz kick at 120 BPM) …');
    const wav = generateBeatWav();
    writeFileSync(WAV_PATH, wav);
    log(`WAV: ${WAV_PATH}  (${wav.length} bytes)`);

    // 2. Start Vite
    vite = await startVite();
    await sleep(2500); // let HMR stabilise

    // 3. Launch Chromium
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=IsolateOrigins,site-per-process', // help dynamic imports share module cache
      ],
    });

    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // Relay useful browser messages
    page.on('console', (msg) => {
      const t = msg.type();
      const s = msg.text();
      if (t === 'error')           log('[browser:error]', s);
      else if (s.includes('[EXPORT')) log('[browser]', s);
    });
    page.on('pageerror', (e) => log('[pageerror]', e.message));

    // 4. Load app
    log('Loading app …');
    await page.goto(`http://localhost:${vite.port}/`, { waitUntil: 'networkidle' });
    await sleep(500);

    // 5. Upload audio
    log('Uploading test audio …');
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(WAV_PATH);
    await sleep(600);

    // 6. Click Play → visualizer stage
    log('Clicking Play …');
    let clicked = false;
    for (const selector of [
      'button:has-text("PLAY")',
      'button:has-text("Play")',
      'button[aria-label*="play" i]',
    ]) {
      try {
        await page.locator(selector).first().click({ timeout: 3000 });
        clicked = true;
        break;
      } catch { /* try next */ }
    }
    if (!clicked) {
      // Last resort: click any button that looks like a play button
      await page.getByRole('button', { name: /play|visuali/i }).first().click({ timeout: 5000 });
    }

    // 7. Expose store + sceneRegistry to window immediately after Play click.
    // sceneRegistry is a module-level object; exposing the reference now means
    // window.__sceneRegistry.gl becomes non-null as soon as AudioScene mounts,
    // without needing another dynamic import.
    log('Exposing audioStore + sceneRegistry to window …');
    await page.evaluate(async () => {
      const [storeMod, sceneMod] = await Promise.all([
        import('/src/lib/audioStore.ts'),
        import('/src/components/three/AudioScene.tsx'),
      ]);
      window.__audioStore     = storeMod.useAudioStore;
      window.__sceneRegistry  = sceneMod.sceneRegistry;
    });

    // 8. Poll until the Three.js scene is fully mounted (sceneRegistry.gl !== null).
    log('Waiting for Three.js scene to initialise (sceneRegistry.gl) …');
    let sceneReady = false;
    for (let i = 0; i < 80; i++) {
      sceneReady = await page.evaluate(() => !!window.__sceneRegistry?.gl);
      if (sceneReady) break;
      await sleep(100);
    }
    if (!sceneReady) log('WARNING: sceneRegistry.gl is still null — snapshot may be a blank frame');
    else             log('Scene ready ✓');

    // 9. Seek to SNAP_TIME so the live preview shows a BEAT frame.
    //    The app registers `audiovisualizer:seek` in useAudioReactive — dispatching
    //    it seeks the detached Audio element to the requested timestamp.
    log(`Seeking audio to t = ${SNAP_TIME} s (beat frame) …`);
    await page.evaluate((t) => {
      window.dispatchEvent(new CustomEvent('audiovisualizer:seek', { detail: { time: t } }));
    }, SNAP_TIME);

    // Wait for a few rAF ticks so the Web Audio analyser reads data at the new
    // position and the Three.js scene re-renders with the updated FFT state.
    await sleep(300);

    // Verify audio position via store (timeupdate fires ~250 ms intervals).
    const actualSnapTime = await page.evaluate(() => window.__audioStore?.getState().currentTime ?? 0);
    log(`Audio at t = ${actualSnapTime.toFixed(3)} s (snapshot will be taken now)`);

    // 9. Canvas snapshot
    log('Capturing canvas snapshot …');
    const canvasB64 = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('No <canvas> found');
      return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    });
    writeFileSync(PREVIEW, Buffer.from(canvasB64, 'base64'));
    log(`Preview saved: ${PREVIEW}`);

    // 10. Stop the rAF loop (prevents race with export's precomputed FFT writes)
    log('Stopping rAF analysis loop …');
    await page.evaluate(async () => {
      // Override requestAnimationFrame so the running tick cannot reschedule.
      // The CURRENT pending tick will fire once, call requestAnimationFrame(tick),
      // and since the override returns a fake ID without scheduling anything,
      // the loop stops after that one final tick.
      const orig = window.requestAnimationFrame.bind(window);
      window.__origRequestAnimationFrame = orig;
      window.requestAnimationFrame = (_cb) => 999_999 + Math.floor(Math.random() * 1_000_000);

      // Pause the <audio> element so the Web Audio analyser returns silence.
      const audio = document.querySelector('audio');
      if (audio) audio.pause();

      // Give the final pending rAF tick enough time to complete and fail to reschedule.
      await new Promise((r) => setTimeout(r, 250));
    });
    log('rAF loop stopped. Starting export …');

    // 11. Run exportMP4() via dynamic import inside the page context.
    //     Dynamic imports resolve to the SAME module instances as the running app
    //     (Vite dev deduplicates by URL), so sceneRegistry / audioAnalysis are shared.
    page.setDefaultTimeout(240_000); // 4-min timeout for the export evaluate

    const exportResult = await page.evaluate(
      async ({ w, h, fps }) => {
        try {
          // Dynamic-import the modules. In Vite dev mode these are served at
          // their source paths and deduplicated via the browser module registry,
          // so we get the SAME singletons (sceneRegistry, audioAnalysis) that
          // the React app uses.
          const [engineMod, storeMod, sceneMod] = await Promise.all([
            import('/src/lib/exportEngine.ts'),
            import('/src/lib/audioStore.ts'),
            import('/src/components/three/AudioScene.tsx'),
          ]);

          const { exportMP4 }   = engineMod;
          const { useAudioStore } = storeMod;
          const { sceneRegistry } = sceneMod;

          // Sanity check: if sceneRegistry.gl is null, the dynamic import returned
          // a different module instance and the export will fail with "scene not ready".
          if (!sceneRegistry || !sceneRegistry.gl) {
            throw new Error(
              'sceneRegistry.gl is null — dynamic import returned a different module instance ' +
              'than the running app. Try pressing Play in the visualizer first and retrying.',
            );
          }

          const audioFile = useAudioStore.getState().audioFile;
          if (!audioFile) throw new Error('No audioFile in Zustand store');

          // Run the export
          const blob = await exportMP4(audioFile, {
            width: w, height: h, fps,
            videoBitrate: 2_000_000,
            audioBitrate: 128_000,
            onProgress: (p) => {
              console.log('[EXPORT PROGRESS]', p.phase, (p.progress * 100).toFixed(0) + '%', p.message);
            },
          });

          // Convert Blob → base64 via FileReader (avoids stack overflow on large arrays)
          const base64 = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload  = () => res(/** @type {string} */(reader.result).replace(/^data:[^;]+;base64,/, ''));
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          });

          return { ok: true, base64, byteLength: blob.size };
        } catch (e) {
          return { ok: false, error: String(e), stack: e?.stack ?? '' };
        }
      },
      { w: EXP_W, h: EXP_H, fps: EXP_FPS },
    );

    if (!exportResult.ok) {
      throw new Error(`Export failed in browser:\n${exportResult.error}\n${exportResult.stack}`);
    }

    log(`Export complete — ${(exportResult.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // 12. Save MP4
    const mp4Buf = Buffer.from(exportResult.base64, 'base64');
    writeFileSync(EXPORT_MP4, mp4Buf);
    log(`MP4 saved: ${EXPORT_MP4}`);

    // 13. Extract the frame at SNAP_TIME from the MP4.
    //     We always use the fixed SNAP_TIME for the MP4 side (not actualSnapTime,
    //     which may be slightly past SNAP_TIME due to the audio advancing after seek).
    //     This ensures the export frame is at a known beat position (t=1.5s = 3rd beat).
    const snapSecs = SNAP_TIME.toFixed(3);
    log(`Extracting MP4 frame at t = ${snapSecs} s …`);
    const extractR = ffmpeg('-y', '-i', EXPORT_MP4, '-ss', snapSecs, '-vframes', '1', EXP_FRAME);
    if (extractR.status !== 0 && !extractR.stderr.includes('frame=')) {
      // ffmpeg often exits 0 on success; check if the file was created
      log('ffmpeg extract stderr:', extractR.stderr.slice(-300));
    }
    log(`Export frame saved: ${EXP_FRAME}`);

    // 14. Scale preview to match export resolution
    log(`Scaling preview to ${EXP_W}×${EXP_H} …`);
    ffmpeg('-y', '-i', PREVIEW, '-vf', `scale=${EXP_W}:${EXP_H}`, PREV_SCALED);

    // 15. Generate diff image (optional, useful for visual inspection)
    log('Generating diff image …');
    const diffR = ffmpeg(
      '-y', '-i', PREV_SCALED, '-i', EXP_FRAME,
      '-lavfi', 'blend=all_mode=difference,format=yuv420p',
      DIFF,
    );
    if (diffR.status !== 0) log('(diff image generation failed — non-critical)');
    else log(`Diff saved: ${DIFF}`);

    // 16. Compute SSIM (primary metric)
    log('Computing SSIM …');
    const ssimR = ffmpeg('-y', '-i', PREV_SCALED, '-i', EXP_FRAME, '-lavfi', 'ssim', '-f', 'null', '-');
    const ssimText = ssimR.stdout + ssimR.stderr;
    const ssim = parseSSIM(ssimText);
    if (ssim !== null) log(`SSIM: ${ssim.toFixed(4)}  (1.0 = identical)`);
    else               log('SSIM parse failed. Raw output:\n' + ssimText.slice(-400));

    // 17. Compute PSNR (secondary / cross-check)
    log('Computing PSNR …');
    const psnrR = ffmpeg('-y', '-i', PREV_SCALED, '-i', EXP_FRAME, '-lavfi', 'psnr', '-f', 'null', '-');
    const psnrText = psnrR.stdout + psnrR.stderr;
    const psnr = parsePSNR(psnrText);
    if (psnr !== null) log(`PSNR: ${psnr.toFixed(2)} dB`);
    else               log('PSNR parse failed. Raw output:\n' + psnrText.slice(-400));

    // 18. Derive similarity score
    //  - SSIM is preferred (1.0–0.0 range, perceptually meaningful)
    //  - Fall back to normalised PSNR if SSIM unavailable (40 dB → 1.0)
    let similarity;
    if (ssim !== null) {
      similarity = ssim;
    } else if (psnr !== null) {
      similarity = Math.min(1, psnr / 40);
    } else {
      throw new Error('Could not compute any similarity metric — check ffmpeg output above');
    }

    // ── Mean absolute diff from diff image (best-effort, informational) ──────
    let meanAbsDiff = '?';
    {
      const statsR = spawnSync('ffmpeg', [
        '-hide_banner', '-y', '-i', DIFF,
        '-vf', 'scale=1:1:flags=area',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
      ], { encoding: 'buffer' });
      const raw = statsR.stdout;
      if (raw && raw.length >= 3) {
        meanAbsDiff = ((raw[0] + raw[1] + raw[2]) / 3).toFixed(1);
      }
    }

    // 19. Final report
    log('');
    log('══════════════════════════════════════════════');
    log('ARTIFACTS');
    log(`  preview snapshot : ${PREVIEW}`);
    log(`  preview scaled   : ${PREV_SCALED}`);
    log(`  export MP4       : ${EXPORT_MP4}`);
    log(`  export frame     : ${EXP_FRAME}`);
    log(`  diff image       : ${DIFF}`);
    log('');
    log('METRICS');
    log(`  SSIM             : ${ssim  !== null ? ssim.toFixed(4)  : 'N/A'}`);
    log(`  PSNR             : ${psnr  !== null ? psnr.toFixed(2) + ' dB' : 'N/A'}`);
    log(`  similarity score : ${similarity.toFixed(4)}`);
    log(`  mean abs diff    : ${meanAbsDiff} / 255`);
    log(`  pass threshold   : ${PASS_THRESHOLD}`);
    log('══════════════════════════════════════════════');

    if (similarity >= PASS_THRESHOLD) {
      console.log(`RESULT: PASS (similarity: ${similarity.toFixed(2)})`);
    } else {
      console.log(
        `RESULT: FAIL (similarity: ${similarity.toFixed(2)}, mean abs diff: ${meanAbsDiff}/255)`,
      );
      process.exitCode = 1;
    }

  } catch (err) {
    log('FATAL ERROR:', err.message);
    if (err.stack) log(err.stack);
    console.log(`RESULT: FAIL (error: ${err.message})`);
    process.exitCode = 1;
  } finally {
    log('Cleaning up …');
    if (browser) { await browser.close().catch(() => {}); log('Browser closed.'); }
    if (vite)    {
      vite.proc.kill('SIGTERM');
      await sleep(600);
      try { vite.proc.kill('SIGKILL'); } catch { /* already dead */ }
      log('Vite stopped.');
    }
  }
}

main();
