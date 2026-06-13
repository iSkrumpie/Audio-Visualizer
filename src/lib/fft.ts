/**
 * Minimal radix-2 FFT for offline audio analysis during export.
 *
 * This implementation is a from-scratch port of the Web Audio API
 * AnalyserNode pipeline (Chromium's third_party/blink/realtime_analyser.cc)
 * so the export produces numerically identical spectra to the live preview.
 *
 * Critical equivalences with the live AnalyserNode:
 *   - Blackman window (alpha=0.16), NOT Hann.
 *   - Magnitude scaling: abs(complex) / N — an input sine wave at 0 dBFS
 *     registers as 0 dBFS in the magnitude buffer.
 *   - dB-to-byte mapping: [-100 dB, -30 dB] -> [0, 255] (the AnalyserNode
 *     defaults), NOT [-100 dB, 0 dB].
 *   - Smoothing is an inter-frame exponential moving average over the
 *     magnitude buffer (k * prev + (1-k) * current), applied before the
 *     dB->byte conversion. Only meaningful when smoothing > 0.
 *   - Window placement: TRAILING — the analysed window is the fftSize
 *     samples immediately before timeSeconds, not centred on it. This
 *     matches the live AnalyserNode, which always presents the spectrum
 *     of the audio that was just heard, not the audio 21 ms in the
 *     future.
 *
 * Any drift from these choices would make the export's FreqBeatDetector
 * (and all the spectrum-derived bar/particle brightness) trigger at
 * different cadences than the live preview.
 */

/** Apply the Blackman window in-place. Matches Chromium's ApplyWindow. */
function applyBlackmanWindow(buf: Float32Array): void {
  const n = buf.length;
  // alpha=0.16 Blackman
  const a0 = 0.5 * (1 - 0.16);  // = 0.42
  const a1 = 0.5;
  const a2 = 0.5 * 0.16;        // = 0.08
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const w = a0 - a1 * Math.cos(2 * Math.PI * x) + a2 * Math.cos(2 * Math.PI * 2 * x);
    buf[i] *= w;
  }
}

/** In-place iterative Cooley-Tukey FFT. Replaces `buf` with the real part
 *  of the spectrum; writes the imaginary part into `imag`. */
function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const N = real.length;
  if ((N & (N - 1)) !== 0) throw new Error('FFT size must be power of 2');

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

  // Butterfly
  for (let len = 2; len <= N; len *= 2) {
    const ang = (-2 * Math.PI) / len;
    const wReal = Math.cos(ang);
    const wImag = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curReal = 1, curImag = 0;
      for (let j = 0; j < len / 2; j++) {
        const tReal = curReal * real[i + j + len / 2] - curImag * imag[i + j + len / 2];
        const tImag = curReal * imag[i + j + len / 2] + curImag * real[i + j + len / 2];
        real[i + j + len / 2] = real[i + j] - tReal;
        imag[i + j + len / 2] = imag[i + j] - tImag;
        real[i + j] += tReal;
        imag[i + j] += tImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

/** Compute FFT magnitude spectrum from time-domain samples.
 *  Returns N/2 magnitudes matching the Web Audio AnalyserNode's
 *  internal `magnitude_buffer` (after 1/N scaling, before dB mapping). */
export function fftMagnitude(samples: Float32Array): Float32Array {
  const N = samples.length;
  // Window + FFT in-place
  const real = new Float32Array(samples);
  const imag = new Float32Array(N);
  applyBlackmanWindow(real);
  fftInPlace(real, imag);

  // Magnitude spectrum, scaled by 1/N (so 0 dBFS sine wave -> magnitude 1.0).
  // This MUST match the live AnalyserNode's magnitude_buffer scale — the
  // dB->byte conversion that follows assumes magnitudes in [0, 1].
  const halfN = N / 2;
  const magnitudes = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
  }
  return magnitudes;
}

/** Web Audio AnalyserNode defaults — must match exactly. */
const MIN_DECIBELS = -100;
const MAX_DECIBELS = -30;

/** Convert a linear magnitude to a byte in [0, 255] using the AnalyserNode's
 *  [-100, -30] dB range. */
function magnitudeToByte(linear: number): number {
  if (linear <= 0) return 0;
  const db = 20 * Math.log10(linear);
  // Clamp to [MIN_DECIBELS, MAX_DECIBELS], then map to [0, 255].
  const clamped = Math.max(MIN_DECIBELS, Math.min(MAX_DECIBELS, db));
  const normalized = (clamped - MIN_DECIBELS) / (MAX_DECIBELS - MIN_DECIBELS);
  return Math.max(0, Math.min(255, Math.round(normalized * 255)));
}

/**
 * Extract a single FFT frame from an AudioBuffer at a given time, returning
 * the byte array that matches the Web Audio API getByteFrequencyData output.
 *
 * @param audioBuffer       Source audio
 * @param timeSeconds       Time of the frame (the spectrum covers the
 *                          trailing fftSize samples BEFORE this time)
 * @param fftSize           FFT size in samples (must be power of 2)
 * @param smoothing         0..1 inter-frame smoothing factor. 0 = no
 *                          smoothing. Applied to the magnitude buffer
 *                          before dB->byte conversion.
 * @param prevMagnitudes    Previous frame's smoothed magnitudes (for
 *                          smoothing), or null on the first frame.
 * @returns                 { bytes, magnitudes } — the byte output for
 *                          AudioStore-style consumers, plus the float
 *                          magnitude buffer to pass as prevMagnitudes on
 *                          the next call.
 */
function extractFFTFrameInternal(
  audioBuffer: AudioBuffer,
  timeSeconds: number,
  fftSize: number,
  smoothing: number,
  prevMagnitudes: Float32Array | null,
): { bytes: Uint8Array; magnitudes: Float32Array } {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  // Downmix to mono with equal gain per channel (gain 1/N), exactly as
  // Chromium's AnalyserNode does in WriteInput(): down_mix_bus_->SumFrom.
  // Using just channel 0 here would make stereo tracks ~3 dB quieter in
  // the bass where L/R often differ, weakening the kick detection.
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  // TRAILING window: samples[0] is the audio at (timeSeconds - fftSize/sampleRate),
  // samples[fftSize-1] is at timeSeconds. This matches the live AnalyserNode,
  // which always presents the spectrum of the audio that was just heard.
  const endSample = Math.round(timeSeconds * sampleRate);
  const startSample = endSample - fftSize;
  const samples = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= channelData[0].length) {
      samples[i] = 0;
      continue;
    }
    let sum = 0;
    for (let c = 0; c < numChannels; c++) {
      sum += channelData[c][idx];
    }
    samples[i] = sum / numChannels;
  }

  const magnitudes = fftMagnitude(samples);

  // Inter-frame smoothing on the magnitude buffer (matches the live
  // AnalyserNode's smoothingTimeConstant applied to magnitude_buffer
  // *before* the dB->byte conversion).
  if (smoothing > 0 && prevMagnitudes) {
    const k = Math.max(0, Math.min(1, smoothing));
    for (let i = 0; i < magnitudes.length; i++) {
      magnitudes[i] = k * prevMagnitudes[i] + (1 - k) * magnitudes[i];
    }
  }

  // dB -> byte, matching the live AnalyserNode's [-100, -30] dB range.
  const bytes = new Uint8Array(magnitudes.length);
  for (let i = 0; i < magnitudes.length; i++) {
    bytes[i] = magnitudeToByte(magnitudes[i]);
  }
  return { bytes, magnitudes };
}

/**
 * Pre-compute all FFT frames for an AudioBuffer.
 * Returns array of { freqData (128 bins), rawFreqData (1024 bins), bass, loudness, highs, energy }.
 *
 * freqData mirrors the live visual AnalyserNode (fftSize=256, 128 bins,
 * smoothing=0.55).
 * rawFreqData mirrors the live kick AnalyserNode (fftSize=2048, 1024 bins,
 * no smoothing) — required for Hz-configurable beat detection in the
 * export pipeline.
 */
export function precomputeFFT(
  audioBuffer: AudioBuffer,
  fps: number = 60,
): Array<{
  freqData: Uint8Array;
  rawFreqData: Uint8Array;
  bass: number;
  loudness: number;
  highs: number;
  energy: number;
}> {
  const duration = audioBuffer.duration;
  const totalFrames = Math.ceil(duration * fps);
  const frames: Array<{
    freqData: Uint8Array;
    rawFreqData: Uint8Array;
    bass: number;
    loudness: number;
    highs: number;
    energy: number;
  }> = [];

  const VISUAL_FFT = 256;  // → 128 bins
  const KICK_FFT   = 2048; // → 1024 bins
  const VISUAL_SMOOTHING = 0.55; // matches useAudioReactive.ts
  const KICK_SMOOTHING   = 0.0;  // matches useAudioReactive.ts

  let prevVisualMags: Float32Array | null = null;
  let prevKickMags: Float32Array | null = null;

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;

    // Visual bins (matches live visual analyser, with smoothing)
    const visual = extractFFTFrameInternal(
      audioBuffer, time, VISUAL_FFT, VISUAL_SMOOTHING, prevVisualMags,
    );
    prevVisualMags = visual.magnitudes;

    // Raw bins (matches live kick analyser, no smoothing)
    const kick = extractFFTFrameInternal(
      audioBuffer, time, KICK_FFT, KICK_SMOOTHING, prevKickMags,
    );
    prevKickMags = kick.magnitudes;

    // Visual bands (same mapping as useAudioReactive)
    const freqData = visual.bytes;
    const rawFreqData = kick.bytes;

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

    frames.push({ freqData, rawFreqData, bass, loudness, highs, energy });
  }

  return frames;
}
