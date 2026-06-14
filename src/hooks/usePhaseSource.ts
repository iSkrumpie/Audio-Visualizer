/**
 * usePhaseSource — runtime helper for components that need a beat/onset
 * phase that switches between live spectral-flux detection and
 * pre-analysis values, depending on audio.detectionMode.
 *
 * v13: Replaces the per-component `detector.update(rawFreqData, ...)`
 * pattern. The detector is still created (and registered for export
 * reset) so the legacy path keeps working — but in 'precomputed' mode
 * the audioAnalysis.{kick,snare,vocal,hihat}Phase field is returned
 * instead, which is populated by useAudioReactive's rAF loop and by
 * exportEngine's per-frame loop from the pre-analysis pipeline.
 *
 * The switch is automatic: each call to the returned function checks
 * settings.audio.detectionMode at call time (no React re-render
 * needed). The 'live' mode is delegated to a `liveFn` callback that
 * the component writes — the component knows its own Hz range and
 * sensitivity and is responsible for keeping them up to date.
 *
 * Usage in a component:
 *
 *   const detector = useMemo(() => new FreqBeatDetector(48000), []);
 *   useBeatDetectorRegistration(detector);
 *   const phaseSrc = usePhaseSource({
 *     detector,
 *     precomputedPhase: () => audioAnalysis.kickPhase,
 *     liveFn: () => {
 *       detector.setSensitivity(b.beatSensitivity ?? 1.0);
 *       return detector.update(audioAnalysis.rawFreqData,
 *         b.beatFreqStart ?? 60, b.beatFreqEnd ?? 250);
 *     },
 *   });
 *   // in useFrame:
 *   const beat = phaseSrc();
 *
 * The component does NOT need to know which mode is active. The
 * helper handles the switch transparently.
 */

import { useSettingsStore } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';

export type PhaseSource = {
  /**
   * The legacy FreqBeatDetector for this component (kept for export
   * reset and for the 'live' mode fallback).
   */
  detector: FreqBeatDetector;
  /**
   * Returns the precomputed phase value (0..1). Called once per frame
   * to read audioAnalysis.{kick,snare,vocal,hihat}Phase.
   */
  precomputedPhase: () => number;
  /**
   * Returns the live-mode phase value (0..1). Called once per frame
   * in 'live' mode. The component is responsible for setting the
   * detector's sensitivity and Hz range before calling update().
   */
  liveFn: () => number;
};

/**
 * Returns a function that produces the active phase (0..1) at the
 * current frame. The function reads settings.audio.detectionMode at
 * call time — no React subscription, no re-render overhead.
 */
export function usePhaseSource(src: PhaseSource): () => number {
  const store = useSettingsStore;
  return () => {
    const mode = store.getState().settings.audio.detectionMode;
    if (mode === 'precomputed') {
      return src.precomputedPhase();
    }
    return src.liveFn();
  };
}
