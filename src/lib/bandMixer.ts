/**
 * bandMixer — compute a weighted onset phase for an arbitrary Hz range
 * from the 4 pre-analysis bands (kick / snare / vocal / hihat).
 *
 * v13 bug fix: pre-analysis mode previously hard-coded each component
 * to ONE of the 4 bands (e.g. BackgroundPlane was always kickPhase,
 * regardless of the user's beatFxFreqStart/End settings). When the user
 * set a band like "Sub-Bass (20-80Hz)" or "Bass (20-250Hz)" that did
 * NOT fully overlap the hard-coded band, the visualisations either
 * didn't react at all (if the band was empty at the moment) or reacted
 * to the wrong frequencies (if it was the wrong band entirely).
 *
 * This helper fixes that: given the user's Hz range and the 4 band
 * phases, it returns a weighted blend where each band's contribution
 * is proportional to how much of the user's range lies inside the
 * band. So:
 *   - User "20-80 Hz"   → 100% kick
 *   - User "40-120 Hz"  → 100% kick
 *   - User "20-250 Hz"  → 100% kick (entirely inside the kick band)
 *   - User "100-200 Hz" → ~50% kick + ~50% snare
 *   - User "20-16000"   → proportional blend of all 4 bands
 *   - User "0-15 Hz"    → 0 (no band overlaps, no phase)
 *
 * The result respects the user's intent regardless of whether they
 * picked a preset button (which roughly aligns with a single band) or
 * a custom range (which can span multiple bands).
 *
 * Edge cases handled:
 *   - startHz >= endHz: returns 0 (degenerate range, no phase)
 *   - User range below 20 Hz or above 16 kHz: out of the pre-analysis
 *     coverage window; returns 0 because no band contributes
 *   - Missing band (overlap = 0): weight 0, no contribution
 *
 * Cost: O(4) per call, no allocation, suitable for the per-frame
 * useFrame call. Each component calls this once per frame.
 */

import { ONSET_BANDS } from './fft';

export type BandPhases = {
  kick: number;
  snare: number;
  vocal: number;
  hihat: number;
};

/**
 * Compute the weighted onset phase for a given Hz range.
 *
 * @param startHz  Lower bound of the user's range in Hz (20..20000)
 * @param endHz    Upper bound of the user's range in Hz (20..20000)
 * @param phases   Current values of the 4 pre-analysis band phases
 *                 (typically audioAnalysis.{kick,snare,vocal,hihat}Phase)
 * @returns        0..1 weighted onset phase for the range
 */
export function computeWeightedPhase(
  startHz: number,
  endHz: number,
  phases: BandPhases,
): number {
  // Guard: degenerate range → no phase
  if (endHz <= startHz) return 0;

  const totalRange = endHz - startHz;
  let weighted = 0;

  for (const band of ONSET_BANDS) {
    // Overlap of [startHz, endHz] with [band.startHz, band.endHz]
    const overlapStart = Math.max(startHz, band.startHz);
    const overlapEnd   = Math.min(endHz,   band.endHz);
    const overlap      = overlapEnd - overlapStart;
    if (overlap <= 0) continue; // no contribution from this band

    // Weight = fraction of the user's range that lies inside the band
    const weight = overlap / totalRange;
    const phase  = phases[band.label as keyof BandPhases] ?? 0;
    weighted += phase * weight;
  }

  // Clamp to 0..1 — defensive: weights sum to <= 1 (overlap regions
  // may be counted once if a user range crosses band boundaries, but
  // a single user's range can't overlap the same band twice). In
  // practice weighted <= max(phases) <= 1, but clamp anyway.
  return Math.max(0, Math.min(1, weighted));
}

/**
 * Diagnostic: return the per-band weights for a given Hz range. Useful
 * for the SettingsPanel's "Bin Quality" indicator (so the user can see
 * which bands contribute to the current range selection). Returns
 * weights in the same order as ONSET_BANDS.
 */
export function computeBandWeights(
  startHz: number,
  endHz: number,
): { label: string; weight: number; overlapHz: number }[] {
  if (endHz <= startHz) return [];
  const totalRange = endHz - startHz;
  return ONSET_BANDS.map((band) => {
    const overlapStart = Math.max(startHz, band.startHz);
    const overlapEnd   = Math.min(endHz,   band.endHz);
    const overlap      = Math.max(0, overlapEnd - overlapStart);
    return {
      label: band.label,
      weight: overlap / totalRange,
      overlapHz: overlap,
    };
  });
}
