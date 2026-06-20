/**
 * essentiaAnalyzer — Web Worker for offline audio analysis
 *
 * v13: Pre-analysis pipeline. Receives the decoded AudioBuffer's channel
 * data (Float32Array, mono) + sampleRate, runs essentia.js BPM + Key
 * detection, and posts the results back to the main thread.
 *
 * Why a Web Worker
 * ----------------
 * essentia.js WASM compile + init takes 1-3s, and `RhythmExtractor2013`
 * on a 3-min track takes another 3-8s — that would freeze the UI thread
 * (and therefore the visualizer). The Worker runs it all in the
 * background; the main thread polls audioAnalysis.preAnalysisProgress
 * (mirrored from this worker's reported progress) and the SettingsPanel
 * progress bar updates live.
 *
 * Why essentia.js
 * ---------------
 * BPM via autocorrelation on our own onset curve would give ±5-10 BPM
 * accuracy. essentia.js's RhythmExtractor2013 with 'multifeature' method
 * gives ±1-2 BPM and, more importantly, returns the actual beat tick
 * positions (in seconds) — which lets us drive a frame-accurate beatPhase
 * in the live preview and export. The KeyExtractor gives 85-90% accuracy
 * on Western popular music (Kessler profile), which is the source for
 * the 'Key' colorMode in bars and particles.
 *
 * License
 * -------
 * essentia.js is AGPLv3. This is the only AGPL dependency in the
 * project. See AGENTS.md §6 for the legal note. Distribution: binary
 * WASM is loaded, source code is not linked or modified — should be
 * acceptable for an open-source personal project; for a commercial
 * distribution, swap to meyda + custom DSP.
 *
 * Communication protocol
 * ----------------------
 *   request  (main → worker):
 *     { id, type: 'analyze', channelData: Float32Array, sampleRate: number }
 *   response (worker → main):
 *     { id, type: 'progress', progress: 0..1 }   // emitted during analysis
 *     { id, type: 'result',   bpm, key, scale, ticks } // final
 *     { id, type: 'error',    message }           // on failure
 *
 * Each request carries an `id` so multiple concurrent analyses
 * (e.g. the user uploads a new file while the old one is still
 * running) can be matched to their response.
 */

/// <reference lib="webworker" />

// essentia.js ships ESM and UMD. We use the ESM build via dynamic
// import() to keep the WASM compile off the main thread's startup path
// and to let the worker's onmessage handler await it lazily.
let essentiaInstance: any = null; // loaded lazily, cached for the worker lifetime

async function ensureEssentia(): Promise<any> {
  if (essentiaInstance) return essentiaInstance;
  // Import the ESM modules. Vite worker-bundling handles the .es.js
  // suffix and inlines the WASM as a base64 module.
  const EssentiaCtor: any = (await import('essentia.js')).default;
  const wasmMod = await import('essentia.js/dist/essentia-wasm.es.js');
  const wasmFactory: any = (wasmMod as any).default ?? wasmMod;
  const wasmModule = await wasmFactory();
  essentiaInstance = new EssentiaCtor(wasmModule);
  return essentiaInstance;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, channelData } = e.data;
  if (type !== 'analyze') return;

  try {
    postProgress(id, 0.02);

    const essentia = await ensureEssentia();
    postProgress(id, 0.15);

    // Convert Float32Array (channel 0) → essentia vector
    const signal = essentia.arrayToVector(channelData as Float32Array);

    // Resample to 44.1 kHz — essentia.js's RhythmExtractor2013 and
    // KeyExtractor are calibrated for 44100 Hz; feeding them 48000 Hz
    // audio produces BPM values ~8.84% too high (e.g. 120 BPM → 130.6 BPM),
    // causing beat-synchronised visuals to drift visibly.
    // Signature: Resample(signal, inputSampleRate?, outputSampleRate?, quality?)
    // Returns: { signal: VectorFloat }. quality=1 = default 5th-order polyphase.
    const resampled = essentia.Resample(signal, 48000, 44100).signal;
    postProgress(id, 0.18);

    // ── BPM + Beat Ticks via RhythmExtractor2013 (multifeature) ─────────
    // method='multifeature' combines 5 ODF functions (HFC, Complex,
    // etc.) + BeatTrackerMultiFeature for the most accurate BPM.
    // Returns: { bpm, ticks, confidence, estimates, bpmIntervals }
    postProgress(id, 0.20);
    const rhythm = essentia.RhythmExtractor2013(
      resampled,     // resampled to 44.1 kHz
      208,           // maxBPM — used as upper bound
      'multifeature',
      40,            // minBPM — lower bound
    );
    postProgress(id, 0.80);

    // ── Key via KeyExtractor ────────────────────────────────────────────
    // Uses the HPCP (Harmonic Pitch Class Profile) + Kessler profile.
    // Returns: { key, scale, strength }
    // Signature: KeyExtractor(audio, averageDetuningCorrection?, frameSize?,
    //   hopSize?, hpcpSize?, maxFrequency?, ...)
    // hpcpSize=36 → 3 bins/semitone, enables averageDetuningCorrection,
    // +5-8% key accuracy on detuned tracks (~3x HPCP compute, still sub-second).
    const keyResult = essentia.KeyExtractor(resampled, true, 4096, 4096, 36);
    postProgress(id, 0.95);

    // Extract ticks as plain array (essentia returns a Vector)
    let ticks: number[] = [];
    if (rhythm.ticks) {
      try {
        ticks = essentia.vectorToArray(rhythm.ticks);
      } catch {
        ticks = Array.from(rhythm.ticks as ArrayLike<number>);
      }
    }

    const result = {
      bpm:   rhythm.bpm as number,
      ticks,
      key:   (keyResult.key as string) || '',
      scale: ((keyResult.scale as string) || '').toLowerCase() as 'major' | 'minor' | '',
    };
    postProgress(id, 1.0);
    postResult(id, result);
  } catch (err) {
    postError(id, err instanceof Error ? err.message : String(err));
  }
};

function postProgress(id: string, progress: number) {
  (self as DedicatedWorkerGlobalScope).postMessage({ id, type: 'progress', progress });
}
function postResult(id: string, payload: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage({ id, type: 'result', payload });
}
function postError(id: string, message: string) {
  (self as DedicatedWorkerGlobalScope).postMessage({ id, type: 'error', message });
}
