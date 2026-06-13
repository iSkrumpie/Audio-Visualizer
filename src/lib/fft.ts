/**
 * Offline audio analysis via OfflineAudioContext + AnalyserNode.
 *
 * This approach guarantees byte-identical output to the live preview's
 * AnalyserNode because it uses the exact same Chromium implementation:
 * - Blackman window (W3C spec, alpha=0.16, periodic: x = i/N)
 * - 1/N magnitude scaling
 * - EMA smoothing on linear magnitudes (before dB conversion)
 * - dB range: [-100, -30] → [0, 255]
 * - Trailing window (last fftSize samples before frame time)
 * - Mono downmix (Chromium: 0.5*(L+R) for stereo)
 * - minDecibels=-100, maxDecibels=-30 (AnalyserNode defaults)
 *
 * No custom FFT code needed — the browser engine handles everything.
 */

const VISUAL_FFT_SIZE   = 256;   // → 128 frequency bins (matches live visual analyser)
const KICK_FFT_SIZE     = 2048;  // → 1024 frequency bins (matches live kick analyser)
const VISUAL_SMOOTHING  = 0.55;  // matches useAudioReactive.ts VISUAL_SMOOTHING
const KICK_SMOOTHING    = 0.0;   // matches useAudioReactive.ts KICK_SMOOTHING
const RENDER_QUANTUM    = 128;   // Web Audio API render quantum size (samples)

/**
 * Pre-compute all FFT frames for an AudioBuffer via OfflineAudioContext.
 * Returns an array of per-frame frequency data — byte-identical to what
 * the live AnalyserNode produces for the same audio.
 *
 * The function is async because OfflineAudioContext.suspend()/resume()
 * is Promise-based.
 */
export async function precomputeFFT(
  audioBuffer: AudioBuffer,
  fps: number = 60,
): Promise<Array<{
  freqData: Uint8Array;
  rawFreqData: Uint8Array;
  bass: number;
  loudness: number;
  highs: number;
  energy: number;
}>> {
  const { sampleRate, duration, length, numberOfChannels } = audioBuffer;
  const totalFrames = Math.ceil(duration * fps);

  // --- Build OfflineAudioContext ---
  const offlineCtx = new OfflineAudioContext({
    numberOfChannels,
    length,
    sampleRate,
  });

  // Visual analyser: matches live useAudioReactive "visual" node
  const analyserVisual = offlineCtx.createAnalyser();
  analyserVisual.fftSize = VISUAL_FFT_SIZE;
  analyserVisual.smoothingTimeConstant = VISUAL_SMOOTHING;
  analyserVisual.minDecibels = -100;
  analyserVisual.maxDecibels = -30;

  // Kick analyser: matches live useAudioReactive "kick" node
  const analyserKick = offlineCtx.createAnalyser();
  analyserKick.fftSize = KICK_FFT_SIZE;
  analyserKick.smoothingTimeConstant = KICK_SMOOTHING;
  analyserKick.minDecibels = -100;
  analyserKick.maxDecibels = -30;

  // Source
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  // Graph: source → analyserVisual → destination (audible path)
  //        source → analyserKick   → silentGain(0) → destination (kick, silent)
  source.connect(analyserVisual);
  analyserVisual.connect(offlineCtx.destination);

  const silentGain = offlineCtx.createGain();
  silentGain.gain.value = 0;
  source.connect(analyserKick);
  analyserKick.connect(silentGain);
  silentGain.connect(offlineCtx.destination);

  source.start(0);

  // --- Build suspension schedule ---
  // For frame i, suspend AFTER the (i+1)-th video-frame's worth of audio.
  // The OfflineAudioContext rounds suspend times up to the nearest
  // RENDER_QUANTUM (128 sample) boundary — deduplicate same quantized times.
  const frames: Array<{
    freqData: Uint8Array; rawFreqData: Uint8Array;
    bass: number; loudness: number; highs: number; energy: number;
  } | undefined> = new Array(totalFrames);

  // Build { suspendTimeSec → [frameIndices] } map (deduplication)
  const schedule = new Map<number, number[]>();
  for (let i = 0; i < totalFrames; i++) {
    const rawSamples   = Math.round((i + 1) * sampleRate / fps);
    const qSamples     = Math.ceil(rawSamples / RENDER_QUANTUM) * RENDER_QUANTUM;
    // Must be > 0 and < total length (in seconds)
    const t = Math.min(qSamples / sampleRate, duration - RENDER_QUANTUM / sampleRate);
    if (t <= 0) continue;
    if (!schedule.has(t)) schedule.set(t, []);
    schedule.get(t)!.push(i);
  }

  // --- Pre-schedule all suspensions and collect + resolve ---
  const suspendPromises = Array.from(schedule.entries()).map(([t, indices]) =>
    offlineCtx.suspend(t).then(() => {
      // getByteFrequencyData() produces the EXACT same bytes as the live AnalyserNode
      const freqData    = new Uint8Array(analyserVisual.frequencyBinCount); // 128 bins
      const rawFreqData = new Uint8Array(analyserKick.frequencyBinCount);   // 1024 bins
      analyserVisual.getByteFrequencyData(freqData);
      analyserKick.getByteFrequencyData(rawFreqData);

      // Derived scalar values (same formulas as useAudioReactive live loop)
      let bassSum = 0;
      for (let j = 0; j < 6; j++) bassSum += freqData[j];
      const bass = bassSum / (6 * 255);

      let totalEnergy = 0;
      for (let j = 0; j < freqData.length; j++) totalEnergy += freqData[j];
      const loudness = totalEnergy / (freqData.length * 255);

      let highSum = 0;
      for (let j = 60; j < freqData.length; j++) highSum += freqData[j];
      const highs = highSum / ((freqData.length - 60) * 255);

      const energy = Math.min(1, bass * 2 + loudness + highs * 0.5);

      const frameData = { freqData, rawFreqData, bass, loudness, highs, energy };
      // Multiple frame indices can share the same quantized suspension time
      for (const idx of indices) frames[idx] = frameData;

      offlineCtx.resume();
    }),
  );

  // Kick off rendering — resolves when all audio has been rendered
  offlineCtx.startRendering();
  await Promise.all(suspendPromises);

  // Fill any gaps: frames that fell outside the schedule get their
  // nearest neighbour's data (shouldn't happen in practice)
  const fallback = {
    freqData: new Uint8Array(128), rawFreqData: new Uint8Array(1024),
    bass: 0, loudness: 0, highs: 0, energy: 0,
  };
  for (let i = 0; i < totalFrames; i++) {
    if (frames[i] === undefined) {
      frames[i] = i > 0 ? frames[i - 1]! : fallback;
    }
  }

  return frames as Array<{
    freqData: Uint8Array; rawFreqData: Uint8Array;
    bass: number; loudness: number; highs: number; energy: number;
  }>;
}
