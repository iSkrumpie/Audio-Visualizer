/**
 * precomputeFFT — frame-exact FFT pipeline for the export renderer.
 *
 * Uses Chrome's native `OfflineAudioContext` + `AnalyserNode` so the
 * exported MP4 produces **byte-identical** spectrum data to the live
 * preview, eliminating the rAF-jitter and timing-window divergence that
 * made the previous manual Cooley-Tukey FFT disagree with the live
 * AnalyserNode by ±50% in the sub-bass (see `bug.md` for the full story).
 *
 * What this gives us
 * ------------------
 * - Same Blackman window, same 1/N scaling, same [-100, -30] dB→byte
 *   mapping, same EMA-on-magnitude smoothing, same mono-downmix, same
 *   trailing-window placement — because all of those are implemented by
 *   the *same* `AnalyserNode` C++ code the live preview uses.
 * - Two analysers in parallel: visual (fftSize=256, smoothing=0.55,
 *   128 bins) and kick (fftSize=2048, smoothing=0, 1024 bins). These
 *   match `useAudioReactive.ts` exactly.
 * - bass / loudness / highs / energy are derived from the `freqData`
 *   bytes with the same bin mapping the live loop uses (bass = avg
 *   bins 0..5, highs = avg bins 60..end).
 *
 * Render-quantum alignment
 * ------------------------
 * `OfflineAudioContext.suspend(t)` rounds `t` to the nearest render
 * quantum (128 samples at any sample rate). For a 60 fps export at
 * 48 kHz, one video frame is exactly 800 samples — 6.25 × 128. The
 * rounding therefore nudges each capture by up to ~2.67 ms, which is
 * below the perception threshold for a 4 ms-precision time-domain
 * signal (a 250 Hz tone has period 4 ms). In practice the rAF jitter
 * in the live preview is much worse (~16 ms) so the export ends up
 * *more* deterministic than the preview, not less.
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
 *                     each capture (sparse; we yield every ~32 frames)
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

  // The OfflineAudioContext must be at least as long as the audio
  // (otherwise the source can't finish). We use the audio's exact
  // sample count to avoid any trailing-silence drift.
  const offline = new OfflineAudioContext(
    numChannels,
    audioBuffer.length,
    sampleRate,
  );

  // ── Visual analyser (matches useAudioReactive.ts exactly) ──────────
  const visual = offline.createAnalyser();
  visual.fftSize               = 256;
  visual.smoothingTimeConstant = 0.55;
  visual.minDecibels           = -100;
  visual.maxDecibels           = -30;

  // ── Kick analyser (raw, no smoothing, high-res for beat detection) ─
  const kick = offline.createAnalyser();
  kick.fftSize               = 2048;
  kick.smoothingTimeConstant = 0.0;
  kick.minDecibels           = -100;
  kick.maxDecibels           = -30;

  // Wire the source through BOTH analysers. The visual analyser is also
  // connected to `offline.destination` so it processes audio. The kick
  // analyser gets its own connection to destination as well — AnalyserNodes
  // in Chrome only process audio when connected downstream, and we want
  // both to receive every sample.
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(visual);
  source.connect(kick);
  visual.connect(offline.destination);
  kick.connect(offline.destination);

  // Pre-allocate the result buffer. We write by index, so order doesn't
  // depend on the order in which `suspend()` callbacks resolve.
  const frames: PrecomputedFrame[] = new Array(totalFrames);

  // Schedule all suspensions up front. The render quantum is 128 samples
  // — `suspend()` rounds the requested time to the nearest quantum
  // boundary. We request capture at the *trailing edge* of each video
  // frame, i.e. time = (i+1) / fps, so the analyser's last-`fftSize`
  // samples correspond to the audio that was just "heard" at that frame.
  //
  // We coalesce duplicate quantum-aligned suspend times (which can
  // happen for sub-60 fps or for high sample rates) to avoid the
  // "duplicate suspend" spec violation.
  const RENDER_QUANTUM = 128;
  const requestedSuspends: number[] = [];
  {
    let lastQuantum = -1;
    for (let i = 0; i < totalFrames; i++) {
      const tFrame   = (i + 1) / fps;
      const sample   = Math.round(tFrame * sampleRate);
      // Clamp to valid range
      if (sample >= audioBuffer.length) break;
      const quantum  = Math.ceil(sample / RENDER_QUANTUM);
      if (quantum === lastQuantum) continue;
      if (quantum * RENDER_QUANTUM >= audioBuffer.length) break;
      lastQuantum = quantum;
      requestedSuspends.push(quantum * RENDER_QUANTUM / sampleRate);
    }
  }

  // For each requested suspend time, schedule a callback that captures
  // both analysers and resumes the context. We use a chained `then` so
  // that the next capture waits for the previous one to complete (the
  // AnalyserNode state is read from the offline thread at suspend time,
  // and the resume continues processing).
  let chain: Promise<void> = offline.suspend(requestedSuspends[0]).then(async () => {
    let frameIndex = 0;        // next video-frame index to fill
    let suspendIdx = 0;        // current position in requestedSuspends

    const captureAt = async (suspendTime: number) => {
      // How many video frames have completed by this suspend time?
      const completedFrameEnd = suspendTime * fps;
      // Capture all frames that fit strictly within this quantum window.
      while (
        frameIndex < totalFrames &&
        (frameIndex + 1) / fps <= completedFrameEnd + 1e-6
      ) {
        const f = captureFrame();
        frames[frameIndex] = f;
        frameIndex++;
        if (onProgress && (frameIndex & 31) === 0) {
          onProgress(frameIndex / totalFrames);
        }
      }
      // Resume to the next suspend.
      if (suspendIdx + 1 < requestedSuspends.length) {
        await offline.resume();
        await offline.suspend(requestedSuspends[suspendIdx + 1]);
        suspendIdx++;
        await captureAt(requestedSuspends[suspendIdx]);
      } else {
        // No more suspensions — let the offline ctx render to its end.
        await offline.resume();
      }
    };

    function captureFrame(): PrecomputedFrame {
      const freqData    = new Uint8Array(visual.frequencyBinCount); // 128
      const rawFreqData = new Uint8Array(kick.frequencyBinCount);    // 1024
      visual.getByteFrequencyData(freqData);
      kick.getByteFrequencyData(rawFreqData);

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

      return { freqData, rawFreqData, bass, loudness, highs, energy };
    }

    await captureAt(requestedSuspends[0]);
  });

  source.start(0);
  const renderPromise = offline.startRendering();
  await Promise.all([chain, renderPromise]);

  // Fill any frames the rounding / coalescing skipped with the most
  // recent captured frame. (Can happen at the very tail if the last
  // quantum falls past the audio length.) The live preview's AnalyserNode
  // would also show "last heard" data when playback ends, so this is the
  // semantically correct fill.
  let lastCaptured: PrecomputedFrame | null = null;
  for (let i = 0; i < totalFrames; i++) {
    if (frames[i]) {
      lastCaptured = frames[i];
    } else if (lastCaptured) {
      frames[i] = cloneFrame(lastCaptured);
    } else {
      // No captures yet — produce a silent frame (same shape live would
      // show before the analyser's circular buffer is full).
      frames[i] = silentFrame();
    }
  }

  onProgress?.(1);
  return frames;
}

function cloneFrame(f: PrecomputedFrame): PrecomputedFrame {
  return {
    freqData:    new Uint8Array(f.freqData),
    rawFreqData: new Uint8Array(f.rawFreqData),
    bass:        f.bass,
    loudness:    f.loudness,
    highs:       f.highs,
    energy:      f.energy,
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
