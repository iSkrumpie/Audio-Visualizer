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
};

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
    const tFrame = (i + 1) / fps;
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

  // ── Step 2: build the OfflineAudioContext + dual analysers ────────────
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

  // Wire source through BOTH analysers, each to destination. AnalyserNodes
  // only process audio when connected downstream, and we want both to
  // see every sample.
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(visual);
  source.connect(kick);
  visual.connect(offline.destination);
  kick.connect(offline.destination);

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

      const f: PrecomputedFrame = buildFrame(freqData, rawFreqData);

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
  };
}
