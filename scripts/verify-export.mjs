/**
 * verify-export.mjs
 *
 * E2E verification script for the AudioVisualizer export bug.
 *
 * Detects whether the exported MP4 shows weaker audio-reactive animations
 * than the live canvas preview by:
 *   1. Trimming the real test song (tmp/Ballern!.mp3) to 10 s via ffmpeg
 *   2. Spawning a Vite dev server
 *   3. Uploading the trimmed MP3 to the visualizer
 *   4. Letting the visualizer play and taking a canvas snapshot at t=3.0 s
 *   5. Stopping the rAF analysis loop (prevents race with export pipeline)
 *   6. Calling exportMP4() directly via dynamic import inside page.evaluate()
 *   7. Saving the resulting MP4 and extracting the same-timestamp frame via ffmpeg
 *   8. Computing SSIM (structural similarity) between preview and export frame
 *   9. Printing RESULT: PASS / FAIL with similarity score
 *
 * Usage:
 *   node scripts/verify-export.mjs
 *
 * Prerequisites:
 *   - ffmpeg in PATH
 *   - playwright installed (npm i)
 *   - tmp/Ballern!.mp3 exists (real test song)
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
const APP_DIR      = process.cwd();
const OUT          = join(APP_DIR, 'tmp', 'verify-export');
const SOURCE_MP3   = join(APP_DIR, 'tmp', 'Ballern!.mp3');
const TRIMMED_MP3  = join(OUT, 'ballern-trimmed.mp3');
const PREVIEW      = join(OUT, 'preview.png');
const PREV_SCALED  = join(OUT, 'preview-scaled.png');
const EXPORT_MP4   = join(OUT, 'export.mp4');
const EXP_FRAME    = join(OUT, 'export-frame.png');
const DIFF         = join(OUT, 'diff.png');

// ── Export params (small = fast test) ────────────────────────────────────────
const EXP_W   = 640;
const EXP_H   = 360;
const EXP_FPS = 30;

// ── Snapshot / comparison time ────────────────────────────────────────────────
// The trimmed file is the first 10 s of Ballern!.mp3.
// t=3.0 s is well past any intro and should show strong beats/bars.
const SNAP_TIME = 3.0; // seconds

// ── Trim parameters ───────────────────────────────────────────────────────────
const TRIM_DURATION = 10; // seconds

// ── Pass threshold ────────────────────────────────────────────────────────────
// SSIM: 1.0 = identical, 0.0 = totally different.
// Bug manifests as weaker animation → lower SSIM vs a correct export (~0.5-0.7).
const PASS_THRESHOLD = 0.80;

mkdirSync(OUT, { recursive: true });

function log(...a) { console.log('[verify-export]', ...a); }

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
    // 1. Trim real test song to 10 seconds
    log(`Trimming ${SOURCE_MP3} to ${TRIM_DURATION} s …`);
    const trimR = ffmpeg(
      '-y', '-i', SOURCE_MP3,
      '-t', String(TRIM_DURATION),
      '-c', 'copy',
      TRIMMED_MP3,
    );
    if (trimR.status !== 0) {
      throw new Error(`ffmpeg trim failed (exit ${trimR.status}):\n${trimR.stderr.slice(-400)}`);
    }
    log(`Trimmed MP3: ${TRIMMED_MP3}`);

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
    log('Uploading trimmed test audio …');
    await page.locator('input[type="file"][accept*="audio"]').setInputFiles(TRIMMED_MP3);
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

    // 9. Seek to SNAP_TIME so the live preview shows a beat frame.
    //    t=3.0 s of the trimmed file should have strong bar/particle activity.
    //    The app registers `audiovisualizer:seek` in useAudioReactive — dispatching
    //    it seeks the detached Audio element to the requested timestamp.
    log(`Seeking audio to t = ${SNAP_TIME} s (beat frame of trimmed file) …`);
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

    // 9b. Diagnostic: read audioAnalysis values at preview time
    log('Reading preview audioAnalysis diagnostics …');
    const previewDiag = await page.evaluate(async () => {
      const mod = await import('/src/hooks/useAudioReactive.ts');
      const { audioAnalysis } = mod;
      const fd = Array.from(audioAnalysis.freqData);
      const rd = Array.from(audioAnalysis.rawFreqData);
      let fdMax = 0, rdMax = 0;
      for (const v of fd) if (v > fdMax) fdMax = v;
      for (const v of rd) if (v > rdMax) rdMax = v;
      // v13: also read the new pre-analysis per-band phases + metadata
      const bundle = window.__analysisBundle;
      return {
        bass:               audioAnalysis.bass,
        loudness:           audioAnalysis.loudness,
        highs:              audioAnalysis.highs,
        energy:             audioAnalysis.energy,
        beatPhase:          audioAnalysis.beatPhase,
        // v13 pre-analysis fields
        kickPhase:          audioAnalysis.kickPhase,
        snarePhase:         audioAnalysis.snarePhase,
        vocalPhase:         audioAnalysis.vocalPhase,
        hihatPhase:         audioAnalysis.hihatPhase,
        bpm:                audioAnalysis.bpm,
        key:                audioAnalysis.key,
        scale:              audioAnalysis.scale,
        preAnalysisProgress: audioAnalysis.preAnalysisProgress,
        bundleAvailable:    !!bundle,
        bundleBpm:          bundle?.essentia?.bpm ?? null,
        bundleKey:          bundle?.essentia?.key ?? null,
        bundleScale:        bundle?.essentia?.scale ?? null,
        bundleTicksCount:   bundle?.essentia?.ticks?.length ?? 0,
        // legacy
        freqDataFirst10:    fd.slice(0, 10),
        rawFreqDataFirst10: rd.slice(0, 10),
        freqDataMax:        fdMax,
        rawFreqDataMax:     rdMax,
        sampleRate:         window.__audioCtx?.sampleRate ?? null,
      };
    });
    log('[DIAG preview] bass='      + previewDiag.bass.toFixed(4) +
        ' loudness='                 + previewDiag.loudness.toFixed(4) +
        ' highs='                    + previewDiag.highs.toFixed(4) +
        ' energy='                   + previewDiag.energy.toFixed(4) +
        ' beatPhase='                + previewDiag.beatPhase.toFixed(4));
    log('[DIAG preview] v13 pre-analysis: kick='  + previewDiag.kickPhase.toFixed(4) +
        ' snare='                                  + previewDiag.snarePhase.toFixed(4) +
        ' vocal='                                  + previewDiag.vocalPhase.toFixed(4) +
        ' hihat='                                  + previewDiag.hihatPhase.toFixed(4));
    log('[DIAG preview] v13 metadata: bpm='       + (previewDiag.bpm || '?') +
        ' key='                                    + (previewDiag.key || '?') +
        ' scale='                                  + (previewDiag.scale || '?') +
        ' progress='                               + (previewDiag.preAnalysisProgress * 100).toFixed(0) + '%');
    log('[DIAG preview] bundle: available='      + previewDiag.bundleAvailable +
        ' bundleBpm='                              + (previewDiag.bundleBpm || '?') +
        ' bundleKey='                              + (previewDiag.bundleKey || '?') +
        ' ticks='                                  + previewDiag.bundleTicksCount);
    log('[DIAG preview] freqData[0..9]='    + JSON.stringify(previewDiag.freqDataFirst10));
    log('[DIAG preview] rawFreqData[0..9]=' + JSON.stringify(previewDiag.rawFreqDataFirst10));
    log('[DIAG preview] freqData.max='      + previewDiag.freqDataMax +
        ' rawFreqData.max='                 + previewDiag.rawFreqDataMax);
    log('[DIAG preview] AudioContext.sampleRate=' + previewDiag.sampleRate);

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
      async ({ w, h, fps, snapTime }) => {
        try {
          // Dynamic-import the modules. In Vite dev mode these are served at
          // their source paths and deduplicated via the browser module registry,
          // so we get the SAME singletons (sceneRegistry, audioAnalysis) that
          // the React app uses.
          const [engineMod, storeMod, sceneMod, analyticsMod] = await Promise.all([
            import('/src/lib/exportEngine.ts'),
            import('/src/lib/audioStore.ts'),
            import('/src/components/three/AudioScene.tsx'),
            import('/src/hooks/useAudioReactive.ts'),
          ]);

          const { exportMP4 }     = engineMod;
          const { useAudioStore } = storeMod;
          const { sceneRegistry } = sceneMod;
          const { audioAnalysis } = analyticsMod;

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

          // ── Diagnostic: capture audioAnalysis at the frame closest to snapTime ──
          const targetFrame = Math.round(snapTime * fps);
          let frameCount = 0;
          window.__exportDiag = null;
          const origAdvance = sceneRegistry.advance;
          sceneRegistry.advance = function(ts) {
            if (frameCount === targetFrame && audioAnalysis) {
              const fd = Array.from(audioAnalysis.freqData);
              const rd = Array.from(audioAnalysis.rawFreqData);
              let fdMax = 0, rdMax = 0;
              for (const v of fd) if (v > fdMax) fdMax = v;
              for (const v of rd) if (v > rdMax) rdMax = v;
              window.__exportDiag = {
                frame:              frameCount,
                bass:               audioAnalysis.bass,
                loudness:           audioAnalysis.loudness,
                highs:              audioAnalysis.highs,
                energy:             audioAnalysis.energy,
                beatPhase:          audioAnalysis.beatPhase,
                // v13 pre-analysis fields
                kickPhase:          audioAnalysis.kickPhase,
                snarePhase:         audioAnalysis.snarePhase,
                vocalPhase:         audioAnalysis.vocalPhase,
                hihatPhase:         audioAnalysis.hihatPhase,
                freqDataFirst10:    fd.slice(0, 10),
                rawFreqDataFirst10: rd.slice(0, 10),
                freqDataMax:        fdMax,
                rawFreqDataMax:     rdMax,
              };
            }
            frameCount++;
            return origAdvance.call(sceneRegistry, ts);
          };

          let blob;
          try {
            // Run the export
            blob = await exportMP4(audioFile, {
              width: w, height: h, fps,
              videoBitrate: 2_000_000,
              audioBitrate: 128_000,
              onProgress: (p) => {
                console.log('[EXPORT PROGRESS]', p.phase, (p.progress * 100).toFixed(0) + '%', p.message);
              },
            });
          } finally {
            // Always restore original advance, even on error
            sceneRegistry.advance = origAdvance;
          }

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
      { w: EXP_W, h: EXP_H, fps: EXP_FPS, snapTime: actualSnapTime },
    );

    if (!exportResult.ok) {
      throw new Error(`Export failed in browser:\n${exportResult.error}\n${exportResult.stack}`);
    }

    // 11b. Diagnostic: read export audioAnalysis from window.__exportDiag
    log('Reading export audioAnalysis diagnostics …');
    const exportDiag = await page.evaluate(() => window.__exportDiag ?? null);
    if (exportDiag) {
      log('[DIAG export] frame=' + exportDiag.frame +
          ' (t≈' + (exportDiag.frame / EXP_FPS).toFixed(3) + 's)');
      log('[DIAG export] bass='      + exportDiag.bass.toFixed(4) +
          ' loudness='               + exportDiag.loudness.toFixed(4) +
          ' highs='                  + exportDiag.highs.toFixed(4) +
          ' energy='                 + exportDiag.energy.toFixed(4) +
          ' beatPhase='              + exportDiag.beatPhase.toFixed(4));
      log('[DIAG export] freqData[0..9]='    + JSON.stringify(exportDiag.freqDataFirst10));
      log('[DIAG export] rawFreqData[0..9]=' + JSON.stringify(exportDiag.rawFreqDataFirst10));
      log('[DIAG export] freqData.max='      + exportDiag.freqDataMax +
          ' rawFreqData.max='                + exportDiag.rawFreqDataMax);
    } else {
      log('[DIAG export] WARNING: window.__exportDiag is null — frame capture may have missed');
    }

    log(`Export complete — ${(exportResult.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // 12. Save MP4
    const mp4Buf = Buffer.from(exportResult.base64, 'base64');
    writeFileSync(EXPORT_MP4, mp4Buf);
    log(`MP4 saved: ${EXPORT_MP4}`);

    // 13. Extract the frame at actualSnapTime from the MP4.
    //     We use the ACTUAL live-preview time (not SNAP_TIME) so that both the
    //     preview snapshot and the export frame are taken at the same beat position.
    //     The live-preview time advances ~200-300ms past SNAP_TIME during the
    //     300ms sleep, so comparing at SNAP_TIME would compare different moments.
    const snapSecs = actualSnapTime.toFixed(3);
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

    // 19. Diagnostic comparison table
    if (previewDiag && exportDiag) {
      const fmtN = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
      const fmtDelta = (a, b) => {
        if (typeof a !== 'number' || typeof b !== 'number') return '?';
        const d = b - a;
        return (d >= 0 ? '+' : '') + d.toFixed(4);
      };
      const fmtArr = (arr) => JSON.stringify(arr);
      const col = (s, w) => String(s).padEnd(w);

      log('');
      log('═══════════════════════════════════════════════════════════════════════');
      log(`=== AUDIO ANALYSIS COMPARISON at t≈${SNAP_TIME.toFixed(1)}s ===`);
      log('Field              | Preview        | Export         | Δ');
      log('-------------------+----------------+----------------+----------------');
      const row = (label, pv, ev) =>
        log(col(label, 19) + '| ' + col(fmtN(pv), 15) + '| ' + col(fmtN(ev), 15) + '| ' + fmtDelta(pv, ev));
      row('bass',           previewDiag.bass,      exportDiag.bass);
      row('loudness',       previewDiag.loudness,  exportDiag.loudness);
      row('highs',          previewDiag.highs,     exportDiag.highs);
      row('energy',         previewDiag.energy,    exportDiag.energy);
      row('beatPhase',      previewDiag.beatPhase, exportDiag.beatPhase);
      // v13: per-band onset phases
      row('kickPhase',      previewDiag.kickPhase,  exportDiag.kickPhase);
      row('snarePhase',     previewDiag.snarePhase, exportDiag.snarePhase);
      row('vocalPhase',     previewDiag.vocalPhase, exportDiag.vocalPhase);
      row('hihatPhase',     previewDiag.hihatPhase, exportDiag.hihatPhase);
      row('freqData.max',   previewDiag.freqDataMax,    exportDiag.freqDataMax);
      row('rawFreqData.max',previewDiag.rawFreqDataMax, exportDiag.rawFreqDataMax);
      // v13: detected metadata
      log('');
      log('  Detected metadata (preview):');
      log('    bpm='      + (previewDiag.bpm || '?') +
          ' key='        + (previewDiag.key || '?') +
          ' scale='      + (previewDiag.scale || '?') +
          ' progress='   + (previewDiag.preAnalysisProgress * 100).toFixed(0) + '%');
      log('    bundleBpm='+ (previewDiag.bundleBpm || '?') +
          ' bundleKey='  + (previewDiag.bundleKey || '?') +
          ' bundleScale='+ (previewDiag.bundleScale || '?') +
          ' ticks='      + previewDiag.bundleTicksCount);
      log('freqData[0..9]     | ' + col(fmtArr(previewDiag.freqDataFirst10), 15) +
          '| ' + fmtArr(exportDiag.freqDataFirst10));
      log('rawFreqData[0..9]  | ' + col(fmtArr(previewDiag.rawFreqDataFirst10), 15) +
          '| ' + fmtArr(exportDiag.rawFreqDataFirst10));
      log('AudioContext.rate  | ' + col(String(previewDiag.sampleRate ?? 'N/A'), 15) + '| (offline ctx, same)');
      log('═══════════════════════════════════════════════════════════════════════');
      log('');
    } else {
      log('[DIAG] WARNING: One or both diagnostic snapshots are missing — table skipped.');
      log('  previewDiag: ' + (previewDiag ? 'OK' : 'NULL') + '  exportDiag: ' + (exportDiag ? 'OK' : 'NULL'));
    }

    // 20. Final report
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
