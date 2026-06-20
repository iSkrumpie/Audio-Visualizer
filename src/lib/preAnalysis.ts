/**
 * preAnalysis — orchestrator for the offline audio analysis pipeline.
 *
 * v13: Spawns the essentia.js Web Worker, posts the decoded audio's
 * channel data, and returns a typed Promise with the detected metadata
 * (BPM, beat ticks, key, scale) plus the per-band onset arrays (computed
 * in precomputeFFT — this file is only the essentia part).
 *
 * Why split this from useAudioReactive
 * ------------------------------------
 * The essentia worker is heavy (2 MB WASM, ~5-12s for 3-min tracks).
 * Keeping the orchestration in a small lib file makes the worker
 * lifecycle easy to test in isolation, and lets multiple call-sites
 * (the initial live-preview, the export pipeline, the E2E scripts) all
 * use the same Promise-based API.
 *
 * The per-band onset arrays are NOT computed here — they're computed
 * in fft.ts (precomputeFFT) which is already integrated with the
 * export pipeline's OfflineAudioContext setup. The two are joined
 * downstream in useAudioReactive, where the per-frame precomputed
 * arrays are sliced and fed to the audioAnalysis mutable.
 */

import EssentiaAnalyzerWorker from '@/workers/essentiaAnalyzer.worker?worker';

export type EssentiaResult = {
  bpm: number;
  /** Beat tick positions in seconds (sorted ascending). */
  ticks: number[];
  /** Detected musical key (e.g. 'C#') — '' if unknown. */
  key: string;
  /** Detected scale ('major' | 'minor' | ''). */
  scale: 'major' | 'minor' | '';
};

export type PreAnalysisProgress =
  | { phase: 'init';    progress: number }
  | { phase: 'bpm';     progress: number }
  | { phase: 'key';     progress: number }
  | { phase: 'done';    progress: 1.0 }
  | { phase: 'error';   message: string };

/**
 * Run essentia.js analysis in a Web Worker.
 *
 * @param channelData  Mono Float32Array (channel 0 of the AudioBuffer)
 * @param onProgress   Optional progress callback (called multiple times)
 * @returns            The detected song metadata
 */
export async function runEssentiaAnalysis(
  channelData: Float32Array,
  onProgress?: (p: PreAnalysisProgress) => void,
): Promise<EssentiaResult> {
  const worker = new EssentiaAnalyzerWorker();
  const id     = cryptoRandomId();

  return new Promise<EssentiaResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { id: string; type: 'progress'; progress: number }
        | { id: string; type: 'result';   payload: EssentiaResult }
        | { id: string; type: 'error';    message: string };
      if (msg.id !== id) return; // ignore messages from stale requests

      switch (msg.type) {
        case 'progress':
          onProgress?.(mapProgressPhase(msg.progress));
          break;
        case 'result':
          worker.terminate();
          onProgress?.({ phase: 'done', progress: 1.0 });
          resolve(msg.payload);
          break;
        case 'error':
          worker.terminate();
          onProgress?.({ phase: 'error', message: msg.message });
          reject(new Error(msg.message));
          break;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      onProgress?.({ phase: 'error', message: e.message });
      reject(new Error(e.message));
    };

    // Send the audio. We transfer the buffer to avoid a copy.
    worker.postMessage(
      { id, type: 'analyze', channelData },
      [channelData.buffer],
    );
  });
}

/**
 * Map raw progress 0..1 from the worker to a labelled phase.
 *  - 0.00..0.15 = init (WASM load)
 *  - 0.15..0.80 = BPM detection
 *  - 0.80..0.95 = Key detection
 *  - 0.95..1.00 = done
 */
function mapProgressPhase(raw: number): PreAnalysisProgress {
  if (raw < 0.15) return { phase: 'init', progress: raw };
  if (raw < 0.80) return { phase: 'bpm',  progress: raw };
  if (raw < 0.95) return { phase: 'key',  progress: raw };
  return { phase: 'done', progress: 1.0 };
}

/** Cryptographically random ID. Falls back to Math.random if crypto is unavailable. */
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
