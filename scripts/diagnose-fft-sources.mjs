#!/usr/bin/env node
/**
 * diagnose-fft-sources.mjs
 *
 * Diagnostic: Compare three FFT paths at the same audio timestamp to identify
 * why the live preview's sub-bass bins are louder than the export's output.
 *
 *   Path A — Live MediaElementSource → AnalyserNode (what the user sees)
 *   Path B — decodeAudioData → BufferSource → OfflineAudioContext → AnalyserNode
 *             (simulates the export's audio source, using the SAME AnalyserNode code)
 *   Path C — Manual Cooley-Tukey FFT (replica of fft.ts logic, what precomputeFFT() does)
 *
 * If A ≠ B → Chrome applies different gain/normalization to MediaElement vs decoded buffers.
 * If B ≠ C → fft.ts has a systematic error vs the real Web Audio AnalyserNode.
 * If A ≈ B ≈ C → the difference is elsewhere (timing, context state, etc.).
 *
 * Prerequisites:
 *   - tmp/Ballern!.mp3 exists (or tmp/verify-export/ballern-trimmed.mp3)
 *   - Playwright installed: npm install playwright (already in package.json)
 *   - Port 5173 free (Vite will be spawned)
 *
 * Run: node scripts/diagnose-fft-sources.mjs
 */

import { spawn }                           from 'node:child_process';
import { setTimeout as sleep }             from 'node:timers/promises';
import { existsSync }                      from 'node:fs';
import { join, dirname }                   from 'node:path';
import { fileURLToPath }                   from 'node:url';
import net                                 from 'node:net';
import { chromium }                        from 'playwright';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const APP_DIR     = join(__dirname, '..');
const TARGET_TIME = 3.0; // seconds — the audio moment to compare

// Prefer the full file; fall back to trimmed
const AUDIO_PATH  = existsSync(join(APP_DIR, 'tmp', 'Ballern!.mp3'))
  ? join(APP_DIR, 'tmp', 'Ballern!.mp3')
  : join(APP_DIR, 'tmp', 'verify-export', 'ballern-trimmed.mp3');

const log = (...a) => console.log('[diagnose-fft]', ...a);

// ─── Vite helper ─────────────────────────────────────────────────────────────

/** Returns true if something is actively listening on the given TCP port. */
function portIsOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true);  });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

function startVite() {
  return new Promise((resolve, reject) => {
    // Use shell:true for cross-platform compatibility (matches test-e2e-v2.mjs).
    const proc = spawn('npm', ['run', 'dev'], {
      cwd:   APP_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.on('error', reject);
    let resolved = false;
    const onData = (chunk) => {
      // Strip ANSI escape codes before matching (Vite uses bold around the port number)
      const text = chunk.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const m = text.match(/localhost:(\d+)/);
      if (m && !resolved) {
        resolved = true;
        resolve({ proc, port: parseInt(m[1], 10) });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    setTimeout(() => {
      if (!resolved) reject(new Error('Vite did not print a port within 30s'));
    }, 30_000);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let viteProc = null;
let browser  = null;

try {
  log(`Audio file: ${AUDIO_PATH}`);
  if (!existsSync(AUDIO_PATH)) {
    throw new Error(`Audio file not found: ${AUDIO_PATH}`);
  }

  // Try port 5173 first (already-running dev server from the user's terminal)
  const PREFERRED_PORT = 5173;
  let port;
  if (await portIsOpen(PREFERRED_PORT)) {
    log(`Port ${PREFERRED_PORT} already open — using existing Vite server.`);
    port = PREFERRED_PORT;
  } else {
    log('Starting Vite dev server...');
    const started = await startVite();
    viteProc = started.proc;
    port     = started.port;
    await sleep(2500);
    log(`Vite on port ${port}`);
  }

  log('Launching Chromium (headless)...');
  browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => log(`[PAGE ERROR] ${e.message}`));
  page.on('console',   (m) => { if (m.type() === 'error') log(`[CONSOLE ERR] ${m.text()}`); });

  await page.goto(`http://localhost:${port}`);
  await page.waitForLoadState('networkidle');
  log('App loaded');

  // ── Upload audio ────────────────────────────────────────────────────────────
  log('Uploading audio...');
  const audioInput = page.locator('input[type="file"][accept*="audio"]').first();
  await audioInput.setInputFiles(AUDIO_PATH);
  await sleep(1500);
  log('Audio uploaded — waiting for Step 4 / Play button...');

  // ── Advance to Visualize stage ──────────────────────────────────────────────
  // Try multiple possible button labels to enter the 3-D visualizer stage.
  {
    let clicked = false;
    const candidates = [
      'button:has-text("Play Visualize")',
      'button:has-text("Visualize")',
      'button:has-text("Play & Visualize")',
      'button:has-text("Play")',
    ];
    for (const sel of candidates) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        log(`Clicking: ${sel}`);
        await el.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log('WARN: no play/visualize button found — listing all buttons:');
      const all = page.locator('button');
      const n = await all.count();
      for (let i = 0; i < n; i++) {
        const t = await all.nth(i).textContent().catch(() => '(empty)');
        log(`  [${i}] "${t?.trim()}"`);
      }
    }
  }
  await sleep(1500);

  // Poll for window.__kickAnalyser (created when AudioContext first connects)
  log('Waiting for AudioContext setup (window.__kickAnalyser)...');
  for (let i = 0; i < 20; i++) {
    const ready = await page.evaluate(() => !!(window.__kickAnalyser));
    if (ready) { log('AudioContext ready.'); break; }
    await sleep(400);
    if (i === 19) log('WARN: __kickAnalyser not yet set after 8s — proceeding.');
  }

  // ─── Run the full comparison inside the browser ─────────────────────────────
  log(`Running comparison at t=${TARGET_TIME}s...`);

  const results = await page.evaluate(async ({ targetTime }) => {
    /* ──────────────────────────────────────────────────────────────────────────
     * Helper: wait until audio.currentTime >= threshold
     * ──────────────────────────────────────────────────────────────────────── */
    function waitForTime(audioEl, threshold, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        if (audioEl.currentTime >= threshold) { resolve(); return; }
        const start = Date.now();
        const id = setInterval(() => {
          if (audioEl.currentTime >= threshold) { clearInterval(id); resolve(); }
          else if (Date.now() - start > timeoutMs) { clearInterval(id); reject(new Error('Timeout waiting for audio time')); }
        }, 5);
      });
    }

    /* ──────────────────────────────────────────────────────────────────────────
     * Verify window globals
     * ──────────────────────────────────────────────────────────────────────── */
    const kickAnalyser   = window.__kickAnalyser;
    const visualAnalyser = window.__visualAnalyser;
    const audioCtx       = window.__audioCtx;
    // Audio element is created via new Audio() (not in DOM), exposed on window.__audioEl
    const audioEl        = window.__audioEl || document.querySelector('audio');

    if (!kickAnalyser)   return { error: 'window.__kickAnalyser not found — AudioContext not yet connected. Ensure the audio file loaded and the visualizer stage was entered.' };
    if (!visualAnalyser) return { error: 'window.__visualAnalyser not found.' };
    if (!audioCtx)       return { error: 'window.__audioCtx not found.' };
    if (!audioEl)        return { error: 'No audio element found (checked window.__audioEl and DOM).' };

    /* ──────────────────────────────────────────────────────────────────────────
     * PATH A — Live MediaElementSource → AnalyserNode
     * Seek to just before targetTime, start playback, wait, then capture.
     * ──────────────────────────────────────────────────────────────────────── */
    // Resume AudioContext if suspended
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // Seek to 200ms before target so the window fills with real audio
    audioEl.currentTime = Math.max(0, targetTime - 0.2);
    try { await audioEl.play(); } catch (e) { /* autoplay may be fine */ }

    // Wait until audio reaches targetTime (±50ms)
    try {
      await waitForTime(audioEl, targetTime, 3000);
    } catch {
      // If audio is very short, capture what we have
    }

    const liveTime = audioEl.currentTime;

    // Capture IMMEDIATELY after crossing targetTime
    const liveKickBytes = new Uint8Array(kickAnalyser.frequencyBinCount);
    kickAnalyser.getByteFrequencyData(liveKickBytes);

    const liveKickFloat = new Float32Array(kickAnalyser.frequencyBinCount);
    kickAnalyser.getFloatFrequencyData(liveKickFloat);

    const liveVisBytes = new Uint8Array(visualAnalyser.frequencyBinCount);
    visualAnalyser.getByteFrequencyData(liveVisBytes);

    /* ──────────────────────────────────────────────────────────────────────────
     * Fetch the audio file bytes from the blob URL
     * ──────────────────────────────────────────────────────────────────────── */
    const blobUrl   = audioEl.src;
    const response  = await fetch(blobUrl);
    const arrayBuf  = await response.arrayBuffer();

    /* ──────────────────────────────────────────────────────────────────────────
     * Decode audio — using the SAME AudioContext (48 kHz) so the sample rate
     * matches the live path exactly. decodeAudioData resamples to ctx.sampleRate.
     * ──────────────────────────────────────────────────────────────────────── */
    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    } catch (e) {
      return { error: `decodeAudioData failed: ${e.message}` };
    }

    const decodedSR   = audioBuffer.sampleRate;   // should equal audioCtx.sampleRate (48000)
    const numChannels = audioBuffer.numberOfChannels;
    const duration    = audioBuffer.duration;

    /* ──────────────────────────────────────────────────────────────────────────
     * PATH B — OfflineAudioContext → AnalyserNode
     * Suspend just before captureTime so we can read the AnalyserNode's state.
     * The AnalyserNode sees the same decoded audio as the export pipeline,
     * without any MediaElement-specific processing.
     * ──────────────────────────────────────────────────────────────────────── */
    const captureTime = Math.min(targetTime, duration - 0.01);

    // Suspend time must be a multiple of 128 samples (render quantum)
    const suspendSamples = Math.floor(captureTime * decodedSR / 128) * 128;
    const suspendTime    = suspendSamples / decodedSR;

    // Context length: just enough to reach the suspend point
    const offlineLength = suspendSamples + 128; // one extra quantum

    const offCtx = new OfflineAudioContext({
      numberOfChannels: numChannels,
      length:           offlineLength,
      sampleRate:       decodedSR,
    });

    const offAnalyser                   = offCtx.createAnalyser();
    offAnalyser.fftSize                 = 2048;
    offAnalyser.smoothingTimeConstant   = 0.0;  // matches kick analyser
    offAnalyser.minDecibels             = -100; // same as live (Chrome default)
    offAnalyser.maxDecibels             = -30;  // same as live (Chrome default)

    const offSource  = offCtx.createBufferSource();
    offSource.buffer = audioBuffer;
    offSource.connect(offAnalyser);
    offAnalyser.connect(offCtx.destination);
    offSource.start(0);

    // MUST schedule suspend BEFORE startRendering
    const suspendPromise = offCtx.suspend(suspendTime);
    const renderPromise  = offCtx.startRendering();

    // Wait for the context to pause at suspendTime
    await suspendPromise;

    const offKickBytes = new Uint8Array(offAnalyser.frequencyBinCount);
    offAnalyser.getByteFrequencyData(offKickBytes);

    const offKickFloat = new Float32Array(offAnalyser.frequencyBinCount);
    offAnalyser.getFloatFrequencyData(offKickFloat);

    // Resume so the renderPromise can settle cleanly
    await offCtx.resume();
    await renderPromise.catch(() => {}); // ignore "cancelled" errors

    /* ──────────────────────────────────────────────────────────────────────────
     * PATH C — Manual Cooley-Tukey FFT (fft.ts replica)
     * This is EXACTLY the logic in src/lib/fft.ts — a direct JS port.
     * ──────────────────────────────────────────────────────────────────────── */

    function applyBlackmanWindow(buf) {
      const n = buf.length;
      const a0 = 0.42, a1 = 0.5, a2 = 0.08;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const w = a0 - a1 * Math.cos(2 * Math.PI * x) + a2 * Math.cos(4 * Math.PI * x);
        buf[i] *= w;
      }
    }

    function fftInPlace(real, imag) {
      const N = real.length;
      // Bit-reversal permutation
      for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          [real[i], real[j]] = [real[j], real[i]];
          [imag[i], imag[j]] = [imag[j], imag[i]];
        }
      }
      // Butterfly stages
      for (let len = 2; len <= N; len *= 2) {
        const ang   = (-2 * Math.PI) / len;
        const wReal = Math.cos(ang);
        const wImag = Math.sin(ang);
        for (let i = 0; i < N; i += len) {
          let curReal = 1, curImag = 0;
          for (let j = 0; j < len / 2; j++) {
            const u  = i + j;
            const v  = u + len / 2;
            const tR = curReal * real[v] - curImag * imag[v];
            const tI = curReal * imag[v] + curImag * real[v];
            real[v]  = real[u] - tR;
            imag[v]  = imag[u] - tI;
            real[u] += tR;
            imag[u] += tI;
            const nR = curReal * wReal - curImag * wImag;
            curImag  = curReal * wImag  + curImag * wReal;
            curReal  = nR;
          }
        }
      }
    }

    function magnitudeToByte(linear) {
      if (linear <= 0) return 0;
      const db = 20 * Math.log10(linear);
      const clamped = Math.max(-100, Math.min(-30, db));
      return Math.max(0, Math.min(255, Math.round(((clamped + 100) / 70) * 255)));
    }

    function manualFFT(audioBuffer, timeSeconds, fftSize) {
      const sr     = audioBuffer.sampleRate;
      const numCh  = audioBuffer.numberOfChannels;
      const endIdx = Math.round(timeSeconds * sr);
      const start  = endIdx - fftSize;

      // Build channel data references upfront (avoids repeated getChannelData calls)
      const chans = [];
      for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c));
      const totalSamples = chans[0].length;

      // TRAILING window: samples[0] = audio at (time - fftSize/sr), ..., samples[N-1] = audio at time
      const samples = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        if (idx < 0 || idx >= totalSamples) { samples[i] = 0; continue; }
        let sum = 0;
        for (let c = 0; c < numCh; c++) sum += chans[c][idx];
        samples[i] = sum / numCh;
      }

      const real = new Float32Array(samples);
      const imag = new Float32Array(fftSize);
      applyBlackmanWindow(real);
      fftInPlace(real, imag);

      const halfN      = fftSize / 2;
      const magnitudes = new Float32Array(halfN);
      for (let i = 0; i < halfN; i++) {
        magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / fftSize;
      }

      const bytes = new Uint8Array(halfN);
      for (let i = 0; i < halfN; i++) bytes[i] = magnitudeToByte(magnitudes[i]);

      return {
        bytes:      Array.from(bytes),
        magnitudes: Array.from(magnitudes),
      };
    }

    const manualKick = manualFFT(audioBuffer, captureTime, 2048);

    /* ──────────────────────────────────────────────────────────────────────────
     * EXTRA: Raw time-domain RMS at captureTime
     * Tells us the actual signal amplitude — independent of FFT choices.
     * ──────────────────────────────────────────────────────────────────────── */
    function trailingRMS(audioBuffer, timeSeconds, windowSize) {
      const sr     = audioBuffer.sampleRate;
      const numCh  = audioBuffer.numberOfChannels;
      const endIdx = Math.round(timeSeconds * sr);
      const start  = Math.max(0, endIdx - windowSize);
      const chans  = [];
      for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c));
      let sumSq = 0, count = 0;
      for (let i = start; i < endIdx; i++) {
        let sum = 0;
        for (let c = 0; c < numCh; c++) sum += chans[c][i];
        const mono = sum / numCh;
        sumSq += mono * mono;
        count++;
      }
      return count > 0 ? Math.sqrt(sumSq / count) : 0;
    }

    const rms2048 = trailingRMS(audioBuffer, captureTime, 2048);

    /* ──────────────────────────────────────────────────────────────────────────
     * EXTRA: Measure the OfflineAudioContext vs Manual FFT magnitude ratio
     * to pinpoint whether it's the FFT itself or the dB→byte mapping.
     * ──────────────────────────────────────────────────────────────────────── */
    // Float magnitudes from the OfflineAudioContext (via getFloatFrequencyData → dB)
    // Convert dB back to linear magnitude for ratio comparison
    function dbToLinear(db) {
      return Math.pow(10, db / 20);
    }

    // Peak bin in first 20 bins (wherever the signal is strongest)
    let peakBin = 0, peakLive = -Infinity;
    for (let i = 0; i < 20; i++) {
      if (liveKickFloat[i] > peakLive) { peakLive = liveKickFloat[i]; peakBin = i; }
    }

    const offlinePeakDb  = offKickFloat[peakBin];
    const livePeakDb     = liveKickFloat[peakBin];
    const manualPeakMag  = manualKick.magnitudes[peakBin];
    const offlinePeakMag = dbToLinear(offlinePeakDb); // approx (only valid if not -Infinity)
    const livePeakMag    = dbToLinear(livePeakDb);

    /* ──────────────────────────────────────────────────────────────────────────
     * Return all data to Node.js for reporting
     * ──────────────────────────────────────────────────────────────────────── */
    return {
      // Timing
      liveTime,
      captureTime,
      suspendTime,
      // Audio metadata
      audioCtxSR:      audioCtx.sampleRate,
      decodedSR,
      numChannels,
      duration,
      // Raw time-domain
      rms2048,
      // Analyser configs
      liveKickConfig: {
        fftSize:    kickAnalyser.fftSize,
        smoothing:  kickAnalyser.smoothingTimeConstant,
        minDb:      kickAnalyser.minDecibels,
        maxDb:      kickAnalyser.maxDecibels,
      },
      offlineConfig: {
        fftSize:    offAnalyser.fftSize,
        smoothing:  offAnalyser.smoothingTimeConstant,
        minDb:      offAnalyser.minDecibels,
        maxDb:      offAnalyser.maxDecibels,
      },
      // Byte values — first 20 kick bins
      liveKickBytes:  Array.from(liveKickBytes.slice(0, 20)),
      offKickBytes:   Array.from(offKickBytes.slice(0, 20)),
      manualKickBytes: manualKick.bytes.slice(0, 20),
      // Float (dB) values — first 20 kick bins
      liveKickFloat:  Array.from(liveKickFloat.slice(0, 20)),
      offKickFloat:   Array.from(offKickFloat.slice(0, 20)),
      manualKickMags: manualKick.magnitudes.slice(0, 20),
      // Visual (visual analyser, smaller FFT) first 20 bins
      liveVisBytes:   Array.from(liveVisBytes.slice(0, 20)),
      // Peak analysis
      peakBin,
      livePeakDb,    livePeakMag,
      offlinePeakDb, offlinePeakMag,
      manualPeakMag,
    };
  }, { targetTime: TARGET_TIME });

  /* ─── Reporting ─────────────────────────────────────────────────────────── */

  if (results.error) {
    log(`\n❌ ERROR: ${results.error}\n`);
    process.exit(1);
  }

  const W = 76;
  const LINE   = '═'.repeat(W);
  const DLINE  = '─'.repeat(W);
  const BINS   = 20;

  console.log('\n' + LINE);
  console.log('  FFT SOURCE DIAGNOSTIC — REPORT');
  console.log(LINE);
  console.log(`  Audio:              ${AUDIO_PATH}`);
  console.log(`  Target time:        ${TARGET_TIME}s  |  Live capture: ${results.liveTime?.toFixed(3)}s  |  Offline suspend: ${results.suspendTime?.toFixed(3)}s`);
  console.log(`  AudioContext SR:    ${results.audioCtxSR} Hz  |  Decoded buffer SR: ${results.decodedSR} Hz  |  Channels: ${results.numChannels}`);
  console.log(`  Audio duration:     ${results.duration?.toFixed(2)}s`);
  console.log(`  Time-domain RMS (trailing 2048 at t=${results.captureTime?.toFixed(3)}s): ${results.rms2048?.toFixed(6)}`);
  console.log();
  console.log('  Live kick AnalyserNode config:');
  console.log(`    fftSize=${results.liveKickConfig?.fftSize}, smoothing=${results.liveKickConfig?.smoothing}, minDb=${results.liveKickConfig?.minDb}, maxDb=${results.liveKickConfig?.maxDb}`);
  console.log('  Offline AnalyserNode config:');
  console.log(`    fftSize=${results.offlineConfig?.fftSize}, smoothing=${results.offlineConfig?.smoothing}, minDb=${results.offlineConfig?.minDb}, maxDb=${results.offlineConfig?.maxDb}`);
  console.log(DLINE);

  /* ── Byte table ─────────────────────────────────────────────────────────── */
  const binHz = (i) => ((i + 0.5) * (results.decodedSR ?? 48000) / 2048).toFixed(0);

  console.log(`\n  BYTE VALUES — first ${BINS} bins  (kick analyser: fftSize=2048, smoothing=0.0)\n`);
  console.log('  Bin │ ~Hz   │  A-Live │ B-Offline │ C-ManFFT │ A-B  │ B-C  │ Note');
  console.log('  ────┼───────┼─────────┼───────────┼──────────┼──────┼──────┼─────────────────');

  for (let i = 0; i < BINS; i++) {
    const hz   = String(binHz(i)).padStart(5);
    const live = results.liveKickBytes?.[i]   ?? '?';
    const off  = results.offKickBytes?.[i]    ?? '?';
    const man  = results.manualKickBytes?.[i] ?? '?';
    const ab   = (typeof live === 'number' && typeof off === 'number')  ? String(live - off).padStart(4)  : '  ??';
    const bc   = (typeof off  === 'number' && typeof man === 'number')  ? String(off  - man).padStart(4)  : '  ??';

    let note = '';
    if (typeof live === 'number' && typeof off === 'number' && off > 0) {
      const ratio = live / off;
      if (ratio > 1.15)       note = `A is ${ratio.toFixed(2)}× louder`;
      else if (ratio < 0.87)  note = `B is ${(1/ratio).toFixed(2)}× louder`;
    }

    console.log(
      `  ${String(i).padStart(3)} │ ${hz} │ ${String(live).padStart(7)} │ ${String(off).padStart(9)} │ ${String(man).padStart(8)} │ ${ab} │ ${bc} │ ${note}`
    );
  }

  /* ── Float (dB) table ───────────────────────────────────────────────────── */
  console.log(`\n  FLOAT (dB) VALUES — first ${BINS} bins\n`);
  console.log('  Bin │ ~Hz   │ A-Live (dB) │ B-Offline (dB) │ C-Manual (mag→dB)');
  console.log('  ────┼───────┼─────────────┼────────────────┼──────────────────────');

  for (let i = 0; i < BINS; i++) {
    const hz      = String(binHz(i)).padStart(5);
    const liveDb  = results.liveKickFloat?.[i];
    const offDb   = results.offKickFloat?.[i];
    const manMag  = results.manualKickMags?.[i];
    const manDb   = (manMag > 0) ? (20 * Math.log10(manMag)).toFixed(1) : '-∞    ';
    const liveStr = typeof liveDb === 'number' ? liveDb.toFixed(1) : '??';
    const offStr  = typeof offDb  === 'number' ? offDb.toFixed(1)  : '??';
    console.log(`  ${String(i).padStart(3)} │ ${hz} │ ${String(liveStr).padStart(11)} │ ${String(offStr).padStart(14)} │ ${manDb}`);
  }

  /* ── Visual analyser (smaller FFT, reference) ──────────────────────────── */
  console.log(`\n  VISUAL ANALYSER BYTES — first ${BINS} bins  (fftSize=256, smoothing=0.55)\n`);
  const visRow = (results.liveVisBytes ?? []).slice(0, BINS).map(v => String(v).padStart(3)).join(' ');
  console.log(`  Live: ${visRow}`);

  /* ── Peak bin analysis ──────────────────────────────────────────────────── */
  console.log('\n' + DLINE);
  console.log('  PEAK BIN ANALYSIS (bin with highest live dB in first 20)\n');
  const pb = results.peakBin ?? 0;
  console.log(`  Peak bin: ${pb}  (~${binHz(pb)} Hz)`);
  console.log(`    Path A  live      : ${results.livePeakDb?.toFixed(2)} dB → linear mag ${results.livePeakMag?.toFixed(6)}`);
  console.log(`    Path B  offline   : ${results.offlinePeakDb?.toFixed(2)} dB → linear mag ${results.offlinePeakMag?.toFixed(6)}`);
  console.log(`    Path C  manual    : linear mag ${results.manualPeakMag?.toFixed(6)}`);

  const liveMag = results.livePeakMag;
  const offMag  = results.offlinePeakMag;
  const manMag  = results.manualPeakMag;
  if (liveMag && offMag && offMag > 0) {
    console.log(`    A/B ratio: ${(liveMag / offMag).toFixed(3)}  (1.0 = identical, >1 = live louder)`);
  }
  if (manMag && offMag && offMag > 0) {
    console.log(`    C/B ratio: ${(manMag / offMag).toFixed(3)}  (1.0 = identical, >1 = manual louder)`);
  }

  /* ── Conclusion ─────────────────────────────────────────────────────────── */
  console.log('\n' + DLINE);
  console.log('  CONCLUSION\n');

  const live0 = results.liveKickBytes?.[0];
  const off0  = results.offKickBytes?.[0];
  const man0  = results.manualKickBytes?.[0];

  const abDiff = (typeof live0 === 'number' && typeof off0 === 'number') ? Math.abs(live0 - off0) : null;
  const bcDiff = (typeof off0  === 'number' && typeof man0 === 'number') ? Math.abs(off0  - man0) : null;

  if (abDiff !== null) {
    if (abDiff > 10) {
      console.log('  ▶ HYPOTHESIS A CONFIRMED — MediaElement ≠ OfflineAudioContext');
      console.log(`     Bin 0: live=${live0}, offline=${off0}, diff=${abDiff} bytes`);
      console.log('     Chrome applies different gain/normalization to MediaElementSource');
      console.log('     vs. decodeAudioData + BufferSource paths.');
    } else {
      console.log('  ✅ Hypothesis A rejected — MediaElement ≈ OfflineAudioContext');
      console.log(`     Bin 0: live=${live0}, offline=${off0}, diff=${abDiff} bytes (≤10)`);
    }
  }

  if (bcDiff !== null) {
    if (bcDiff > 10) {
      console.log('  ▶ HYPOTHESIS B CONFIRMED — OfflineAudioContext ≠ Manual FFT');
      console.log(`     Bin 0: offline=${off0}, manual=${man0}, diff=${bcDiff} bytes`);
      console.log('     fft.ts Cooley-Tukey implementation has a systematic error');
      console.log('     relative to the real Web Audio AnalyserNode.');
    } else {
      console.log('  ✅ Hypothesis B rejected — OfflineAudioContext ≈ Manual FFT');
      console.log(`     Bin 0: offline=${off0}, manual=${man0}, diff=${bcDiff} bytes (≤10)`);
    }
  }

  if (abDiff !== null && bcDiff !== null && abDiff <= 10 && bcDiff <= 10) {
    console.log('  ✅ All three paths are consistent — sub-bass difference may be');
    console.log('     a timing issue (live vs export frame alignment) not visible here.');
  }

  console.log('\n' + LINE + '\n');

} catch (err) {
  log(`Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
} finally {
  if (browser)  await browser.close().catch(() => {});
  if (viteProc) {
    viteProc.kill('SIGTERM');
    await sleep(800);
    try { viteProc.kill('SIGKILL'); } catch {}
  }
}
