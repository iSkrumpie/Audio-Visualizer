/**
 * precomputeFFT — frame-exact FFT pipeline for the export renderer.
 *
 * Uses Chrome's native `OfflineAudioContext` + `AnalyserNode` so the
 * exported MP4 produces **byte-identical** spectrum data to the live
 * preview, eliminating the rAF-jitter and timing-window divergence that
 * made the previous manual Cooley-Tukey FFT disagree with the live
 * AnalyserNode by ±50% in the sub-bass (see `bug.md` for the full story).
 *
 * Why this is correct
 * -------------------
 * The `AnalyserNode` (in both `AudioContext` and `OfflineAudioContext`)
 * runs the same Chromium C++ pipeline (Blackman window, 1/N scaling,
 * EMA on magnitude, [-100, -30] dB→byte mapping, trailing window,
 * mono downmix via `AudioBus::SumFromByDownMixing`). So bytes produced
 * by this export pipeline are guaranteed to match bytes produced by
 * the live `useAudioReactive.ts` AnalyserNode — modulo the ±16 ms rAF
 * jitter inherent to the live preview (which is much smaller than the
 * 42 ms FFT window at 48 kHz, so the difference is musically
 * imperceptible).
 *
 * Render-quantum alignment
 * ------------------------
 * `OfflineAudioContext.suspend(t)` rounds `t` to the next render
 * quantum (128 samples at any sample rate). For a 60 fps export at
 * 48 kHz, one video frame is exactly 800 samples (6.25 × 128), so the
 * rounding nudges each capture by up to ~2.67 ms. This is well below
 * the live preview's rAF jitter (~16 ms) and is therefore strictly an
 * improvement on the previous manual-FFT approach.
 *
 * Scheduling pattern (the Session-10 trap)
 * -----------------------------------------
 * All `suspend()` calls must be scheduled **before** `startRendering()`.
 * The previous attempt at this (commit `d9da87a`) chained
 * `suspend → capture → resume → suspend` in JavaScript microtasks,
 * which raced the offline audio render thread and produced zero data
 * because the first `suspend(0)` callback fired before the audio
 * source had actually started.
 *
 * This implementation:
 *   1. Pre-computes the mapping "video frame index → render quantum"
 *   2. Groups video frames by quantum (multiple video frames can share
 *      a single quantum — typical at 30 fps where 1 video frame
 *      spans ~3 quanta)
 *   3. Schedules one `suspend(q)` per unique quantum, BEFORE
 *      `startRendering()`
 *   4. In each `suspend` callback, captures the AnalyserNode state
 *      once and assigns it to every video frame that maps to that
 *      quantum (all those frames share the same trailing-`fftSize`
 *      audio window, so this is mathematically correct)
 *
 * First-frame silence
 * -------------------
 * The AnalyserNode's circular sample buffer needs `fftSize` samples of
 * audio before it can produce a non-zero spectrum. The first
 * `fftSize / sampleRate` seconds of the export will therefore show
 * low / zero values, exactly matching the live preview's startup
 * behaviour. This is a feature, not a bug — both paths agree.
 */
export type PrecomputedFrame = {
  /** 128 bytes, 8-bit, visual analyser (fftSize=256, smoothing=0.55). */
  freqData: Uint8Array;
  /** 1024 bytes, 8-bit, kick analyser (fftSize=2048, smoothing=0). */
  rawFreqData: Uint8Array;
  /** avg of freqData[0..5] / 255 */
  bass: number;
  /** avg of all freqData / 255 */
  loudness: number;
  /** avg of freqData[60..end] / 255 */
  highs: number;
  /** min(1, bass*2 + loudness + highs*0.5) — same formula as live */
  energy: number;
  // ── v13: Per-band onset phases (0..1 each), populated by the offline
  // multi-band onset detector (precomputeMultiBandOnsets). Used by
  // components in 'precomputed' detectionMode to drive kick/snare/vocal/hihat
  // reactions independently. Each is the output of an adaptive-threshold
  // spectral-flux detector on the corresponding Hz band, smoothed with a
  // decaying envelope (similar to FreqBeatDetector.phase).
  kickPhase: number;
  snarePhase: number;
  vocalPhase: number;
  hihatPhase: number;
};

/**
 * Multi-band onset detection result (v13). One Float32Array per band,
 * length = totalFrames (one value per video frame, in the same frame
 * ordering as the PrecomputedFrame[] returned by precomputeFFT).
 *
 * Each value is 0..1, a decaying envelope of the spectral flux in
 * the corresponding Hz band. Higher = a recent transient (kick hit,
 * snare hit, vocal onset, hi-hat hit). 0 = no recent transient.
 *
 * Populated by precomputeMultiBandOnsets() and aligned with the
 * precomputeFFT() output so that preAnalysisFrame[i].kickPhase matches
 * the (i/fps) second of the audio.
 */
export type MultiBandOnsets = {
  kick:  Float32Array;  // 20-150 Hz
  snare: Float32Array;  // 150-800 Hz
  vocal: Float32Array;  // 800-4000 Hz
  hihat: Float32Array;  // 4000-16000 Hz
};

/** 4 Hz bands used for onset detection. Tuned for music, not speech. */
export const ONSET_BANDS = [
  { label: 'kick',  startHz:   20, endHz:   150 },
  { label: 'snare', startHz:  150, endHz:   800 },
  { label: 'vocal', startHz:  800, endHz:  4000 },
  { label: 'hihat', startHz: 4000, endHz: 16000 },
] as const;

/**
 * Pre-compute all FFT frames for an AudioBuffer.
 *
 * @param audioBuffer  Decoded source audio (use `audioCtx.decodeAudioData`)
 * @param fps          Target video frame rate (60 or 30 are typical)
 * @param onProgress   Optional progress callback (0..1) — fires after
 *                     each captured quantum (sparse; up to one per
 *                     2.67 ms of audio)
 * @returns            Array of `totalFrames` frames, each with the
 *                     `freqData` and `rawFreqData` the live preview's
 *                     dual-AnalyserNode pipeline would produce at that
 *                     exact audio time.
 */
export async function precomputeFFT(
  audioBuffer: AudioBuffer,
  fps: number = 60,
  onProgress?: (p: number) => void,
): Promise<PrecomputedFrame[]> {
  const sampleRate    = audioBuffer.sampleRate;
  const numChannels   = audioBuffer.numberOfChannels;
  const totalDuration = audioBuffer.duration;
  const totalFrames   = Math.ceil(totalDuration * fps);

  if (totalFrames === 0) return [];

  // ── Step 1: map each video frame → its target render quantum ──────────
  // The render quantum is 128 samples. We want the AnalyserNode state
  // to reflect the trailing-fftSize audio window ending at the LATEST
  // possible moment that is still ≤ the video frame's wall-clock time.
  // Rounding UP to the next quantum boundary gives us this: the
  // AnalyserNode at quantum Q has seen samples [Q*128 - fftSize, Q*128],
  // which is the most recent fftSize-window at or before video frame i.
  const RENDER_QUANTUM = 128;
  type Quantum = { quantumSample: number; frameIndices: number[] };
  const quantumMap = new Map<number, Quantum>();

  for (let i = 0; i < totalFrames; i++) {
    // Sample the FFT at the MIDPOINT of each video frame rather than the
    // end. This better matches the moment a rAF tick in the live preview
    // captures the canvas (which fires somewhere mid-frame, ~8 ms after
    // the start at 60 fps), and halves the worst-case audio-window offset
    // between preview and export. The AnalyserNode's trailing-window
    // behavior still gives us a fftSize-wide spectrum ending at the
    // quantum boundary — we're just choosing which quantum the frame's
    // sample point rounds to.
    const tFrame = (i + 0.5) / fps;
    const sample = Math.round(tFrame * sampleRate);
    if (sample >= audioBuffer.length) break;
    const quantumSample = Math.ceil(sample / RENDER_QUANTUM) * RENDER_QUANTUM;
    if (quantumSample >= audioBuffer.length) break;

    let entry = quantumMap.get(quantumSample);
    if (!entry) {
      entry = { quantumSample, frameIndices: [] };
      quantumMap.set(quantumSample, entry);
    }
    entry.frameIndices.push(i);
  }

  // Sort by quantum time for deterministic capture order
  const quanta = Array.from(quantumMap.values()).sort(
    (a, b) => a.quantumSample - b.quantumSample,
  );

  if (quanta.length === 0) {
    return Array.from({ length: totalFrames }, () => silentFrame());
  }

  // ── Step 2: build the OfflineAudioContext + analysers (v13: 6 total) ──
  // v13: 2 legacy analysers (visual + kick) + 4 band-pass analysers
  // (kick/snare/vocal/hihat) for multi-band onset detection. Each band
  // analyser is fed by a BiquadFilter Highpass→Lowpass chain on a
  // parallel source branch. All 6 are connected to destination so they
  // process every sample (AnalyserNodes only run when connected downstream).
  const offline = new OfflineAudioContext(
    numChannels,
    audioBuffer.length,
    sampleRate,
  );

  const visual = offline.createAnalyser();
  visual.fftSize               = 256;
  visual.smoothingTimeConstant = 0.55;
  visual.minDecibels           = -100;
  visual.maxDecibels           = -30;

  const kick = offline.createAnalyser();
  kick.fftSize               = 2048;
  kick.smoothingTimeConstant = 0.0;
  kick.minDecibels           = -100;
  kick.maxDecibels           = -30;

  // Band analysers — fftSize=1024 is the sweet spot for onset detection:
  // enough frequency resolution to localise band energy, small enough to
  // not blow up the per-frame flux computation. smoothing=0 for raw
  // transients (EMA would smear the onsets we want to detect).
  const bandAnalysers = ONSET_BANDS.map((band) => {
    const analyser = offline.createAnalyser();
    analyser.fftSize               = 1024;
    analyser.smoothingTimeConstant = 0.0;
    analyser.minDecibels           = -100;
    analyser.maxDecibels           = -30;
    return { band, analyser };
  });

  // Wire source through both legacy analysers + 4 band chains, each
  // connected to destination. Each band branch has its own
  // Highpass→Lowpass biquad pair so the analyser sees only the band's
  // energy. The filtered branch is NOT routed to destination (no
  // audible artefact, no double-counting) but the analyser still
  // processes every sample because the biquad is in series with the
  // analyser node.
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(visual);
  source.connect(kick);
  visual.connect(offline.destination);
  kick.connect(offline.destination);

  for (const { band, analyser } of bandAnalysers) {
    const hp = offline.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = band.startHz;
    hp.Q.value = 0.7071; // Butterworth Q

    const lp = offline.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = band.endHz;
    lp.Q.value = 0.7071;

    source.connect(hp);
    hp.connect(lp);
    lp.connect(analyser);
    analyser.connect(offline.destination);
  }

  // Per-band state for spectral-flux onset detection. Allocated once
  // outside the suspend-callback so we can mutate them every quantum
  // without re-allocating. prevMagnitudes holds the previous frame's
  // band magnitudes (normalised to 0..1). phase is the decaying
  // envelope (similar to FreqBeatDetector.phase). fluxHistory is a
  // 10-frame rolling average for adaptive threshold.
  const bandState = bandAnalysers.map(() => ({
    prevMagnitudes: new Float32Array(512) as Float32Array, // 1024/2 = 512 bins
    phase: 0,
    fluxHistory: new Array(10).fill(0) as number[],
    historyIdx: 0,
  }));

  // Pre-allocate the result buffer
  const frames: Array<PrecomputedFrame | null> = new Array(totalFrames).fill(null);

  // ── Step 3: schedule ALL suspensions upfront, before startRendering ──
  // Spec: each `suspend(t)` returns a Promise that resolves when the
  // context reaches time t and pauses. Multiple `suspend(t)` calls at
  // different times can be queued BEFORE startRendering, and they will
  // fire in order as the render progresses.
  const capturePromises: Promise<void>[] = quanta.map((q) => {
    const suspendTime = q.quantumSample / sampleRate;
    return offline.suspend(suspendTime).then(() => {
      const freqData    = new Uint8Array(visual.frequencyBinCount);
      const rawFreqData = new Uint8Array(kick.frequencyBinCount);
      visual.getByteFrequencyData(freqData);
      kick.getByteFrequencyData(rawFreqData);

      // ── v13: multi-band onset detection (spectral-flux per band) ─────
      // For each band: read current magnitudes, compute positive flux
      // vs. previous frame, fire phase=1 on flux > avg*threshold,
      // decay phase at 0.04/frame (matches FreqBeatDetector cadence).
      const onsetValues: { kick: number; snare: number; vocal: number; hihat: number } = {
        kick: 0, snare: 0, vocal: 0, hihat: 0,
      };
      const bands: Array<'kick' | 'snare' | 'vocal' | 'hihat'> =
        ['kick', 'snare', 'vocal', 'hihat'];

      for (let b = 0; b < bandAnalysers.length; b++) {
        const { analyser } = bandAnalysers[b];
        const state = bandState[b];

        const magnitudes = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(magnitudes);
        const magLen = magnitudes.length;

        // Positive spectral flux (sum of curr - prev where curr > prev)
        let flux = 0;
        for (let i = 0; i < magLen; i++) {
          const curr = magnitudes[i] / 255;
          const prev = state.prevMagnitudes[i];
          const diff = curr - prev;
          if (diff > 0) flux += diff;
          state.prevMagnitudes[i] = curr;
        }
        // Normalise by band width (kick=130 Hz, snare=650 Hz, etc.) so
        // the flux values are comparable across bands.
        const bandWidth = ONSET_BANDS[b].endHz - ONSET_BANDS[b].startHz;
        flux /= Math.max(1, bandWidth / 100);

        // Rolling 10-frame average for adaptive threshold
        state.fluxHistory[state.historyIdx] = flux;
        state.historyIdx = (state.historyIdx + 1) % state.fluxHistory.length;
        let sum = 0;
        for (let i = 0; i < state.fluxHistory.length; i++) sum += state.fluxHistory[i];
        const avgFlux = sum / state.fluxHistory.length;

        // Fire beat if flux > avg*1.8 AND flux > 0.005
        if (flux > avgFlux * 1.8 && flux > 0.005) {
          state.phase = 1.0;
        }
        // Decay (matches FreqBeatDetector default decay=0.04)
        state.phase = Math.max(0, state.phase - 0.04);
        onsetValues[bands[b]] = state.phase;
      }

      const f: PrecomputedFrame = buildFrame(freqData, rawFreqData, onsetValues);

      // Assign this capture to every video frame in this quantum
      for (const frameIdx of q.frameIndices) {
        frames[frameIdx] = f;
      }

      // Resume so the next suspend can fire
      void offline.resume();
    });
  });

  // ── Step 4: render and wait for all captures ──────────────────────────
  source.start(0);
  await offline.startRendering();
  await Promise.all(capturePromises);

  // ── Step 5: backfill any missing frames ───────────────────────────────
  // Frames at the very tail (after the last quantum that fit) reuse
  // the last valid capture, which is what the live preview's AnalyserNode
  // would also show once playback has ended. Any leading missing frames
  // (e.g. if a quanta's `suspend()` was coalesced) are filled with the
  // first non-silent frame, or with a silent frame if we never got any
  // non-silent data.
  const out: PrecomputedFrame[] = new Array(totalFrames);
  let lastCaptured: PrecomputedFrame | null = null;
  for (let i = 0; i < totalFrames; i++) {
    const f: PrecomputedFrame = frames[i] ?? lastCaptured ?? silentFrame();
    out[i] = f;
    if (frames[i]) lastCaptured = f;
  }

  onProgress?.(1);
  return out;
}

function buildFrame(
  freqData: Uint8Array,
  rawFreqData: Uint8Array,
  onsets: { kick: number; snare: number; vocal: number; hihat: number } = {
    kick: 0, snare: 0, vocal: 0, hihat: 0,
  },
): PrecomputedFrame {
  // Mirror `useAudioReactive.ts:124-139` exactly.
  let bassSum = 0;
  for (let j = 0; j < 6; j++) bassSum += freqData[j];
  const bass = bassSum / (6 * 255);

  let total = 0;
  for (let j = 0; j < freqData.length; j++) total += freqData[j];
  const loudness = total / (freqData.length * 255);

  let highSum = 0;
  for (let j = 60; j < freqData.length; j++) highSum += freqData[j];
  const highs = highSum / ((freqData.length - 60) * 255);

  const energy = Math.min(1, bass * 2 + loudness + highs * 0.5);

  // Defensive copy: every frame in a quantum gets its own Uint8Arrays
  // so callers can mutate without aliasing.
  return {
    freqData:    new Uint8Array(freqData),
    rawFreqData: new Uint8Array(rawFreqData),
    bass,
    loudness,
    highs,
    energy,
    kickPhase:  onsets.kick,
    snarePhase: onsets.snare,
    vocalPhase: onsets.vocal,
    hihatPhase: onsets.hihat,
  };
}

function silentFrame(): PrecomputedFrame {
  return {
    freqData:    new Uint8Array(128),
    rawFreqData: new Uint8Array(1024),
    bass: 0,
    loudness: 0,
    highs: 0,
    energy: 0,
    kickPhase: 0,
    snarePhase: 0,
    vocalPhase: 0,
    hihatPhase: 0,
  };
}
