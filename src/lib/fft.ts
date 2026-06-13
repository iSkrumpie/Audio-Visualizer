/**
 * Minimal radix-2 FFT for offline audio analysis during export.
 * Computes magnitude spectrum from PCM samples.
 */

/** Compute FFT magnitude spectrum. Input length must be power of 2. Returns magnitude array of length N/2. */
export function fftMagnitude(samples: Float32Array): Float32Array {
  const N = samples.length;
  // Ensure power of 2
  if ((N & (N - 1)) !== 0) throw new Error('FFT size must be power of 2');

  // Apply Hann window
  const windowed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    windowed[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }

  // FFT (iterative Cooley-Tukey)
  const real = new Float32Array(windowed);
  const imag = new Float32Array(N);

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

  // FFT butterfly
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

  // Magnitude spectrum (first half)
  const halfN = N / 2;
  const magnitudes = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
  }
  return magnitudes;
}

/**
 * Extract FFT frame data from an AudioBuffer at a given time.
 * Returns 128-bin Uint8Array (0-255), matching Web Audio API format.
 */
export function extractFFTFrame(
  audioBuffer: AudioBuffer,
  timeSeconds: number,
  fftSize: number = 256,
): Uint8Array {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(timeSeconds * sampleRate);
  const channelData = audioBuffer.getChannelData(0); // mono or left channel

  // Extract fftSize samples centered at time
  const samples = new Float32Array(fftSize);
  const offset = startSample - Math.floor(fftSize / 2);
  for (let i = 0; i < fftSize; i++) {
    const idx = offset + i;
    samples[i] = idx >= 0 && idx < channelData.length ? channelData[idx] : 0;
  }

  const magnitudes = fftMagnitude(samples);

  // Convert to 0-255 range (matching Web Audio API getByteFrequencyData behavior)
  const bins = fftSize / 2;
  const result = new Uint8Array(bins);
  for (let i = 0; i < bins; i++) {
    // Convert to dB, scale to 0-255
    const db = 20 * Math.log10(Math.max(magnitudes[i], 1e-10));
    // Web Audio maps -100dB..0dB to 0..255
    const normalized = (db + 100) / 100;
    result[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
  }
  return result;
}

/**
 * Pre-compute all FFT frames for an AudioBuffer.
 * Returns array of { freqData, bass, loudness, highs, energy }.
 */
export function precomputeFFT(
  audioBuffer: AudioBuffer,
  fps: number = 60,
): Array<{
  freqData: Uint8Array;
  bass: number;
  loudness: number;
  highs: number;
  energy: number;
}> {
  const duration = audioBuffer.duration;
  const totalFrames = Math.ceil(duration * fps);
  const frames: Array<{
    freqData: Uint8Array;
    bass: number;
    loudness: number;
    highs: number;
    energy: number;
  }> = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;
    const freqData = extractFFTFrame(audioBuffer, time, 256);

    // Extract bands (same mapping as useAudioReactive)
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

    frames.push({ freqData, bass, loudness, highs, energy });
  }

  return frames;
}
