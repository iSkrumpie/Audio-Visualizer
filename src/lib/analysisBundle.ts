/**
 * analysisBundle — combined pre-analysis result.
 *
 * v13: Wraps the two heavy pre-analysis steps (essentia.js metadata +
 * fft.ts precomputeFFT) into a single Promise. The result is consumed
 * by:
 *   - useAudioReactive: feeds frames into the rAF loop (live preview)
 *   - exportEngine: feeds frames into the per-frame loop (MP4 export)
 *
 * Centralising the pipeline here means both call-sites get the same
 * data, the same byte-identical kick/snare/vocal/hihat onset phases,
 * the same BPM, the same beat ticks, the same key — which is exactly
 * what AGENTS.md §6.1 requires for SSIM ≥ 0.80 between preview and
 * export.
 *
 * The essentia analysis runs in a Web Worker (src/workers/essentia
 * Analyzer.worker.ts) so the main thread stays free for the visualizer.
 * The fft precompute runs on the main thread (OfflineAudioContext is
 * main-thread-only by spec) but completes in 2-4s.
 *
 * Total wall-clock for a 3-min track on a modern desktop: ~8-15s
 * (essentia is the bottleneck; fft is fast).
 */

import { precomputeFFT, type PrecomputedFrame, type MultiBandOnsets } from '@/lib/fft';
import { runEssentiaAnalysis, type EssentiaResult } from '@/lib/preAnalysis';
import { useSettingsStore } from '@/lib/settingsStore';

export type AnalysisBundle = {
  /** Per-frame analysis (one entry per video frame at `fps`). */
  frames: PrecomputedFrame[];
  /** Detected song metadata from essentia.js. */
  essentia: EssentiaResult;
  /** Source sample rate (matches the decoded AudioBuffer's sampleRate). */
  sampleRate: number;
  /** Source duration in seconds. */
  duration: number;
};

/**
 * Run the full pre-analysis pipeline: decode the file, run essentia.js
 * (BPM, key, ticks) + precomputeFFT (frames + multi-band onsets).
 *
 * @param file           The audio File to analyze
 * @param fps            Target frame rate for the per-frame data (60 or 30)
 * @param onProgress     Optional progress callback. Progress is 0..1
 *                       covering both stages proportionally:
 *                       0.00..0.20 = decode
 *                       0.20..0.80 = essentia (BPM + key)
 *                       0.80..1.00 = precomputeFFT
 * @returns              The combined analysis bundle
 */
export async function analyzeAudioFile(
  file: File,
  fps: number = 60,
  onProgress?: (progress: number, label: string) => void,
): Promise<AnalysisBundle> {
  // ── Stage 1: Decode (always 48 kHz to match the rest of the pipeline) ──
  onProgress?.(0.02, 'Decoding audio…');
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  onProgress?.(0.10, 'Decoded.');

  // Channel data for the essentia worker (mono: take channel 0).
  // We have to copy because AudioBuffer's channel data is a view onto
  // a buffer that will be invalidated when audioCtx is closed.
  const channelData = audioBuffer.getChannelData(0).slice();

  // ── Stage 2: essentia (BPM + key + ticks) in a Worker ──────────────
  let essentiaResult!: EssentiaResult;
  try {
    essentiaResult = await runEssentiaAnalysis(channelData, (p) => {
      // Map essentia progress 0..1 to overall 0.20..0.80. The 'error'
      // and 'done' phases have no progress field.
      if (p.phase === 'error') {
        onProgress?.(0.80, `Essentia: error — ${p.message}`);
        return;
      }
      if (p.phase === 'done') {
        onProgress?.(0.80, 'Essentia done.');
        return;
      }
      onProgress?.(0.20 + p.progress * 0.60, `Essentia: ${p.phase}`);
    });
  } catch (err) {
    console.warn('[analysisBundle] essentia failed, using fallback:', err);
    essentiaResult = { bpm: 0, ticks: [], key: '', scale: '' };
  }
  onProgress?.(0.80, 'Essentia done.');

  // ── Stage 3: precomputeFFT (frames + multi-band onsets) ────────────
  onProgress?.(0.82, 'Pre-computing FFT…');
  const frames = await precomputeFFT(audioBuffer, fps, (p) => {
    onProgress?.(0.82 + p * 0.18, `Pre-computing FFT: ${Math.round(p * 100)}%`);
  });
  onProgress?.(1.0, 'Done.');

  audioCtx.close();

  // ── Stage 4: write detected metadata into the settings store so the
  //    SettingsPanel and components can read it without re-decoding. ──
  const store = useSettingsStore.getState();
  store.setSettings((prev) => ({
    ...prev,
    audio: {
      ...prev.audio,
      bpm: essentiaResult.bpm,
      key: essentiaResult.key,
      scale: essentiaResult.scale,
    },
  }));

  return {
    frames,
    essentia: essentiaResult,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
  };
}

/**
 * Helper: look up the per-frame data at a given audio time.
 *
 * @param frames   The per-frame array (length = totalFrames)
 * @param fps      The fps used to compute the frames
 * @param t        The time in seconds
 * @param out      Optional output object to mutate (avoids allocation)
 * @returns        The PrecomputedFrame closest to t, or the last frame
 *                 if t is past the end, or the first frame if t < 0.
 */
export function frameAt(
  frames: PrecomputedFrame[],
  fps: number,
  t: number,
  out?: PrecomputedFrame,
): PrecomputedFrame {
  if (frames.length === 0) {
    return out ?? ({} as PrecomputedFrame);
  }
  const i = Math.max(0, Math.min(frames.length - 1, Math.round(t * fps)));
  return frames[i];
}

/**
 * Helper: extract MultiBandOnsets from a per-frame array as Float32Arrays
 * of length = totalFrames. Useful for live preview that needs indexed
 * access (vs. the per-frame object look-up in frameAt).
 */
export function extractMultiBandOnsets(frames: PrecomputedFrame[]): MultiBandOnsets {
  const kick  = new Float32Array(frames.length);
  const snare = new Float32Array(frames.length);
  const vocal = new Float32Array(frames.length);
  const hihat = new Float32Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    kick[i]  = frames[i].kickPhase;
    snare[i] = frames[i].snarePhase;
    vocal[i] = frames[i].vocalPhase;
    hihat[i] = frames[i].hihatPhase;
  }
  return { kick, snare, vocal, hihat };
}

// Re-export for convenience
export type { PrecomputedFrame, MultiBandOnsets } from '@/lib/fft';
export type { EssentiaResult, PreAnalysisProgress } from '@/lib/preAnalysis';
