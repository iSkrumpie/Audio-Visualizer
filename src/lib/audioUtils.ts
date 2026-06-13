/**
 * Audio analysis utilities.
 *
 * - FREQ_PRESETS: named frequency-band presets (Kick, Bass, Snare, …)
 * - sliderToHz / hzToSlider: logarithmic slider ↔ Hz conversion helpers
 * - getBinCountForRange: quality indicator for beat detection
 * - getFreqRangeEnergy: raw average energy in a Hz range (continuous 0..1)
 * - FreqBeatDetector: spectral-flux onset detection with decaying phase envelope
 *   Uses RAW (unsmoothed) FFT data from the kick analyser for sharp transients.
 */

// ── Frequency band presets ──────────────────────────────────────────────────

/**
 * Named frequency-band presets for the HzRangePicker.
 * Defaults chosen to be musically meaningful: each preset covers a recognizable
 * instrument or spectral region.
 */
export const FREQ_PRESETS = [
  { key: 'kick',      label: 'Kick',      startHz:    40, endHz:   120 },
  { key: 'subBass',   label: 'Sub-Bass',  startHz:    20, endHz:    80 },
  { key: 'bass',      label: 'Bass',      startHz:    20, endHz:   250 },
  { key: 'snare',     label: 'Snare',     startHz:   150, endHz:   900 },
  { key: 'vocal',     label: 'Vocal',     startHz:   300, endHz:  3000 },
  { key: 'mids',      label: 'Mids',      startHz:   250, endHz:  4000 },
  { key: 'highMids',  label: 'High-Mids', startHz:  2000, endHz:  6000 },
  { key: 'highs',     label: 'Highs',     startHz:  4000, endHz: 20000 },
  { key: 'hihat',     label: 'Hi-Hat',    startHz:  6000, endHz: 14000 },
  { key: 'full',      label: 'Full',      startHz:    20, endHz: 16000 },
] as const;

export type FreqPresetKey = typeof FREQ_PRESETS[number]['key'];

export const MIN_HZ = 20;
export const MAX_HZ = 20000;

/** Logarithmic slider-position (0..1) → Hz */
export function sliderToHz(t: number, minHz = MIN_HZ, maxHz = MAX_HZ): number {
  const c = Math.max(0, Math.min(1, t));
  return Math.round(minHz * Math.pow(maxHz / minHz, c));
}

/** Hz → logarithmic slider-position (0..1) */
export function hzToSlider(hz: number, minHz = MIN_HZ, maxHz = MAX_HZ): number {
  const c = Math.max(minHz, Math.min(maxHz, hz));
  return Math.log(c / minHz) / Math.log(maxHz / minHz);
}

/** Number of FFT bins covered by a Hz range. For beat-detection quality assessment. */
export function getBinCountForRange(
  startHz: number,
  endHz: number,
  sampleRate = 44100,
  fftSize = 2048,
): number {
  const binHz = sampleRate / fftSize;
  return Math.max(0, Math.ceil(endHz / binHz) - Math.floor(startHz / binHz) + 1);
}

export type BeatQuality = 'poor' | 'ok' | 'good';
export function getBeatDetectionQuality(binCount: number): BeatQuality {
  if (binCount < 4) return 'poor';
  if (binCount < 12) return 'ok';
  return 'good';
}

// ── Frequency energy ────────────────────────────────────────────────────────

/**
 * Compute average energy (0..1) from FFT frequency data within a Hz range.
 */
export function getFreqRangeEnergy(
  freqData: Uint8Array,
  freqStartHz: number,
  freqEndHz: number,
  sampleRate = 44100,
  fftSize = 256,
): number {
  const binHz = sampleRate / fftSize;
  const startBin = Math.max(0, Math.floor(freqStartHz / binHz));
  const endBin = Math.min(freqData.length - 1, Math.ceil(freqEndHz / binHz));
  if (startBin > endBin) return 0;
  let sum = 0;
  for (let i = startBin; i <= endBin; i++) sum += freqData[i];
  return sum / ((endBin - startBin + 1) * 255);
}

/**
 * Spectral-flux beat detector for a configurable frequency range.
 *
 * Instead of comparing absolute energy to a threshold (which fails for wide
 * frequency ranges because the average is too stable), this uses SPECTRAL FLUX:
 * the sum of positive energy increases between consecutive frames.
 *
 * Spectral flux naturally detects onsets/transients regardless of range width
 * because it measures CHANGE, not absolute level. A bass kick that spikes 10
 * bins out of 200 still produces a clear flux spike.
 *
 * Uses audioAnalysis.rawFreqData (kick analyser, fftSize=2048, smoothing=0,
 * 1024 bins, ~21.5 Hz/bin) for sharp transients.
 *
 * Returns a decaying phase (0..1) that spikes on detected beats.
 */
export class FreqBeatDetector {
  private prevBins: Float32Array;
  private fluxHistory: number[];
  private historyIdx = 0;
  private historyFull = false;
  private phase = 0;
  private lastEnergy = 0;
  private _sensitivity = 1.0;
  private readonly historyLen: number;
  private readonly baseThresholdMul: number;
  private readonly minFlux: number;
  private readonly decay: number;
  /** Bin width in Hz — required for accurate Hz → bin mapping.
   *  Defaults to 48000/2048 (export's AudioContext). The live-preview
   *  AnalyserNode runs in a 48 kHz context too, but some browsers pick
   *  44.1 kHz — callers MUST pass the actual sampleRate for accuracy. */
  private readonly binHz: number;

  /**
   * @param sampleRate        AnalyserNode sample rate in Hz (default 48000)
   * @param historyLen        Frames for rolling flux average (default 40 ≈ 0.67s at 60fps)
   * @param baseThresholdMul  Flux must exceed avg × this to trigger (default 1.8)
   * @param minFlux           Absolute minimum flux to prevent silence triggers (default 0.005)
   * @param decay             Phase decay per frame (default 0.04 → ~25 frames full decay)
   */
  constructor(
    sampleRate = 48000,
    historyLen = 40,
    baseThresholdMul = 1.8,
    minFlux = 0.005,
    decay = 0.04,
  ) {
    this.binHz = sampleRate / 2048;
    this.historyLen = historyLen;
    this.baseThresholdMul = baseThresholdMul;
    this.minFlux = minFlux;
    this.decay = decay;
    // 1024 bins for kick analyser (fftSize=2048)
    this.prevBins = new Float32Array(1024);
    this.fluxHistory = new Array(historyLen).fill(0);
  }

  /**
   * Set detection sensitivity (0.1–5.0). Multiplies the effective threshold.
   * Lower value = more sensitive (fires more easily).
   * Higher value = stricter (fires less).
   */
  setSensitivity(mul: number): void {
    this._sensitivity = Math.max(0.1, Math.min(5.0, mul));
  }

  /** Current sensitivity multiplier. */
  get sensitivity(): number {
    return this._sensitivity;
  }

  /**
   * Reset the detector to a clean first-frame state: prevBins and the
   * rolling flux history are zeroed, and the phase envelope is cleared.
   *
   * Required when switching from a live audio stream (e.g. the live preview
   * that trained this detector) to a fresh precomputed stream (the export
   * pipeline) — without the reset, the first ~40 frames (~0.67s) of the
   * export would compare precomputed spectral flux against flux averages
   * trained on live data, producing wrong beat cadences and inconsistent
   * beat-driven animations (grid pulse, scanline beat, logo fire, etc.).
   */
  reset(): void {
    this.prevBins = new Float32Array(1024);
    this.fluxHistory = new Array(this.historyLen).fill(0);
    this.historyIdx = 0;
    this.historyFull = false;
    this.phase = 0;
    this.lastEnergy = 0;
  }

  /**
   * Export-specific reset: clears prevBins and phase like reset(), but
   * pre-fills fluxHistory with minFlux instead of zeros.
   *
   * WHY: reset() zeroes the history, so the first audio spike after silence
   * (e.g. the track intro transitioning to music) dominates all 40 history
   * slots and raises avgFlux far above the actual beat-flux level. Every
   * subsequent beat fails to exceed the inflated adaptive threshold and
   * beatPhase stays near 0 for the rest of the export.
   *
   * Pre-filling with minFlux keeps avgFlux at a stable low baseline.
   * Any early spike (flux <= ~0.7) only raises avgFlux to ~0.02, so that
   * real beats (flux >= 0.05–0.15) still comfortably exceed the threshold.
   */
  resetForExport(): void {
    this.prevBins = new Float32Array(1024);
    // Pre-fill with minFlux so a single early spike can’t dominate the history.
    this.fluxHistory = new Array(this.historyLen).fill(this.minFlux);
    this.historyIdx = 0;
    this.historyFull = true; // treat as if the history window is already filled
    this.phase = 0;
    this.lastEnergy = 0;
  }

  /**
   * Soft reset: clears phase and prevBins but keeps the calibrated
   * fluxHistory.
   *
   * Used after the export pre-warm pass: the pre-warm runs representative
   * frames through the detector to calibrate avgFlux to the song’s typical
   * beat-flux level. After pre-warm, only phase (to avoid a false-beat
   * spike at the start of the render) and prevBins (to match the actual
   * first frame of the export) need to be cleared. Resetting fluxHistory
   * too would throw away the calibration.
   */
  resetPhaseAndPrevBins(): void {
    this.prevBins = new Float32Array(1024);
    this.phase = 0;
    this.lastEnergy = 0;
    // fluxHistory intentionally kept — holds the pre-warm calibration
  }

  /**
   * Call once per frame with the RAW (unsmoothed) FFT data and Hz range.
   *
   * @param rawFreqData  audioAnalysis.rawFreqData (1024 bins, kick analyser)
   * @param freqStartHz  Low frequency bound in Hz
   * @param freqEndHz    High frequency bound in Hz
   * @returns Current beat phase (0..1, decaying pulse)
   */
  update(rawFreqData: Uint8Array, freqStartHz: number, freqEndHz: number): number {
    // Kick analyser: fftSize=2048 → 1024 bins. Use the actual sample rate
    // (constructor-injected) for Hz→bin mapping — hardcoding 44100 here
    // would mis-target bins when the AudioContext runs at 48 kHz, which
    // silently weakens beat detection in the background-shader
    // animations (grid pulse, scanline beat, noise boost, etc.).
    const startBin = Math.max(0, Math.floor(freqStartHz / this.binHz));
    const endBin = Math.min(rawFreqData.length - 1, Math.ceil(freqEndHz / this.binHz));
    const binCount = Math.max(1, endBin - startBin + 1);

    // ── Adaptive threshold: narrow bands need stricter thresholds ─────
    let adaptiveMul: number;
    if (binCount < 4) adaptiveMul = this.baseThresholdMul * 1.4;       // very narrow → stricter
    else if (binCount < 12) adaptiveMul = this.baseThresholdMul * 1.0; // medium
    else adaptiveMul = this.baseThresholdMul * 0.85;                    // wide → looser
    const effectiveMul = adaptiveMul * this._sensitivity;

    // ── Spectral flux: sum of positive energy increases ───────────────
    let flux = 0;
    let energySum = 0;
    for (let i = startBin; i <= endBin; i++) {
      const curr = rawFreqData[i] / 255;
      const prev = this.prevBins[i];
      const diff = curr - prev;
      if (diff > 0) flux += diff;
      energySum += curr;
      this.prevBins[i] = curr;
    }
    // Normalize flux by bin count so it's comparable across range widths
    flux /= binCount;
    this.lastEnergy = energySum / binCount;

    // ── Rolling average of flux ───────────────────────────────────────
    this.fluxHistory[this.historyIdx] = flux;
    this.historyIdx = (this.historyIdx + 1) % this.historyLen;
    if (this.historyIdx === 0) this.historyFull = true;

    const count = this.historyFull ? this.historyLen : Math.max(1, this.historyIdx);
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.fluxHistory[i];
    const avgFlux = sum / count;

    // ── Beat detection: flux spike above rolling average ──────────────
    if (flux > avgFlux * effectiveMul && flux > this.minFlux) {
      this.phase = 1.0;
    }

    // ── Smooth decay ──────────────────────────────────────────────────
    this.phase = Math.max(0, this.phase - this.decay);

    return this.phase;
  }

  /** Current average energy in the range (0..1). For smooth/continuous effects. */
  get energy(): number {
    return this.lastEnergy;
  }
}
