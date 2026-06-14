/**
 * usePhaseSource — runtime helper for components that need a beat/onset
 * phase that switches between live spectral-flux detection and
 * pre-analysis values, depending on audio.detectionMode.
 *
 * v13.1: Replaces the per-component `detector.update(rawFreqData, ...)`
 * pattern. The detector is still created (and registered for export
 * reset) so the legacy path keeps working — but in 'precomputed' mode
 * a weighted blend of audioAnalysis.{kick,snare,vocal,hihat}Phase is
 * returned, computed from the component's user-configured Hz range.
 * This means a user setting "Sub-Bass (20-80 Hz)" actually triggers
 * off the kick band, not off an unrelated band's hard-coded phase.
 *
 * v13 bug fix: pre-analysis mode previously hard-coded each component
 * to ONE of the 4 bands (e.g. BackgroundPlane was always kickPhase,
 * regardless of the user's beatFxFreqStart/End settings). When the
 * user set a band that did NOT fully overlap the hard-coded band, the
 * visualisations either didn't react at all or reacted to the wrong
 * frequencies. The new weighted approach respects the user's intent.
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
 *     getPrecomputedRange: () => ({
 *       startHz:  b.beatFxFreqStart,
 *       endHz:    b.beatFxFreqEnd,
 *     }),
 *     liveFn: () => {
 *       detector.setSensitivity(b.beatFxSensitivity ?? 1.0);
 *       return detector.update(audioAnalysis.rawFreqData,
 *         b.beatFxFreqStart, b.beatFxFreqEnd);
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
import { computeWeightedPhase } from '@/lib/bandMixer';
import { audioAnalysis } from '@/hooks/useAudioReactive';

export type PhaseSource = {
  /**
   * The legacy FreqBeatDetector for this component (kept for export
   * reset and for the 'live' mode fallback).
   */
  detector: FreqBeatDetector;
  /**
   * Returns the user's Hz range for the current frame. Called once
   * per frame ONLY in 'precomputed' mode. The component reads its
   * settings (e.g. `b.beatFxFreqStart`/`b.beatFxFreqEnd`) here and
   * returns them as a `{ startHz, endHz }` pair. The returned range
   * is then used to weight-blend the 4 pre-analysis band phases
   * via computeWeightedPhase().
   */
  getPrecomputedRange: () => { startHz: number; endHz: number };
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
      const { startHz, endHz } = src.getPrecomputedRange();
      return computeWeightedPhase(startHz, endHz, {
        kick:  audioAnalysis.kickPhase,
        snare: audioAnalysis.snarePhase,
        vocal: audioAnalysis.vocalPhase,
        hihat: audioAnalysis.hihatPhase,
      });
    }
    return src.liveFn();
  };
}
