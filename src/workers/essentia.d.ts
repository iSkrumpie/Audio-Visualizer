// Local type declarations for essentia.js (v0.1.3, no upstream .d.ts).
// We only declare the surface we actually use; everything else is `any`.

declare module 'essentia.js' {
  /** Default-exported Essentia class. */
  export default class Essentia {
    constructor(wasmModule: unknown);
    /** Convert a JS Float32Array to an essentia Vector. */
    arrayToVector(arr: Float32Array | number[]): unknown;
    /** Convert an essentia Vector back to a JS Array. */
    vectorToArray(vec: unknown): number[];
    /**
     * BPM + beat-tick detection.
     * @returns { bpm, ticks, confidence, ... }
     */
    RhythmExtractor2013(
      signal: unknown,
      maxBPM?: number,
      method?: 'multifeature' | 'degara',
      minBPM?: number,
    ): { bpm: number; ticks: unknown; confidence: number };
    /**
     * Musical key detection.
     * @returns { key, scale, strength }
     */
    KeyExtractor(
      signal: unknown,
      averageDetuningCorrection?: boolean,
      frameSize?: number,
      hopSize?: number,
      hpcpSize?: number,
      maxFrequency?: number,
      maximumSpectralPeaks?: number,
      minFrequency?: number,
      pcpThreshold?: number,
      profileType?: 'bgate' | 'braw' | 'bthomp' | 'fkess',
      sampleRate?: number,
      spectralPeaksThreshold?: number,
      tuningFrequency?: number,
      weightType?: 'cosine' | 'squaredCosine',
      windowType?: 'blackmanharris62' | 'hamming' | 'hann' | 'triangular',
    ): { key: string; scale: string; strength: number };
  }
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  /** Default export is a factory function that returns a Promise of the WASM module. */
  const factory: () => Promise<unknown>;
  export default factory;
}
