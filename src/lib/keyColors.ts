/**
 * keyColors — map detected musical key to a base hue + palette.
 *
 * Used by:
 *   - InstancedBars / GPUParticles when colorMode === 'key-derived'
 *   - CenterLogo glow color hinting
 *   - The SettingsPanel "Detected Key" display in the Audio tab
 *
 * Mapping rationale
 * -----------------
 * The 12 chromatic notes map to hues around the colour wheel in fifths
 * (C=0°, G=~210°, D=~60°, etc.) — the "circle of fifths" is the same
 * rotation as the colour wheel. This means a major-scale key in C maps
 * to a red-leaning hue, a key in G maps to a cyan-leaning hue, and so
 * on. The result is that bars/particles automatically colour-shift with
 * the song's emotional centre: minor keys cool down (lower saturation
 * + slight blue shift), major keys warm up (higher saturation + slight
 * gold shift).
 *
 * Accurateness note
 * -----------------
 * essentia.js KeyExtractor reports key with 85-90% accuracy on
 * Western popular music (Kessler profile). Errors are typically
 * between relative major/minor (e.g. C major ↔ A minor) or fifth
 * transpositions (e.g. C major ↔ G major) — the colour difference
 * for those is small enough to be musically acceptable.
 *
 * Key is matched case-insensitively and tolerates a trailing 'b' or
 * '♭' (flat) vs '#' or '♯' (sharp) — e.g. 'Db' and 'C#' both map
 * to the same hue because they're enharmonically equivalent.
 */

export type KeyName =
  | 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'F'
  | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B';

export const KEY_HUE_MAP: Record<string, number> = {
  // Major hues — anchored to C=red (0°) and rotated in fifths.
  'C': 0,    'G': 210,  'D': 60,   'A': 270,  'E': 120,  'B': 330,
  'F#': 180, 'Gb': 180, 'C#': 30,  'Db': 30,  'G#': 240, 'Ab': 240,
  'D#': 90,  'Eb': 90,  'A#': 300, 'Bb': 300, 'F': 150,
};

/**
 * Map a key string + scale to a base HSL hue.
 *
 * @param key   e.g. 'C#' or 'Bb' — case-insensitive, flats/sharps both OK
 * @param scale 'major' | 'minor' | '' — minor shifts hue by -20°
 * @returns     hue 0..360, or null if key is empty/unknown
 */
export function keyToHue(key: string, scale: 'major' | 'minor' | '' = ''): number | null {
  if (!key) return null;
  const norm = normaliseKey(key);
  if (!norm) return null;
  const base = KEY_HUE_MAP[norm];
  if (base === undefined) return null;
  // Minor scale pulls the hue ~20° toward blue (cooler, sadder)
  const shift = scale === 'minor' ? -20 : 0;
  return ((base + shift) % 360 + 360) % 360;
}

/**
 * Map key + scale to a 4-colour palette (primary, secondary, accent, deep).
 * Used for 'key-derived' colorMode in bars and particles.
 *
 * The 4 colours form a tight harmony (analogous + complementary) on the
 * colour wheel: primary at baseHue, secondary at baseHue+25°, accent at
 * baseHue+180° (complement), deep at baseHue-30°. Major scales saturate
 * more (0.85), minor scales desaturate (0.55) for the cooler feel.
 */
export function keyToPalette(
  key: string,
  scale: 'major' | 'minor' | '' = '',
): { primary: string; secondary: string; accent: string; deep: string } | null {
  const hue = keyToHue(key, scale);
  if (hue === null) return null;
  const sat = scale === 'minor' ? 0.55 : 0.85;
  return {
    primary:   hslToHex(hue,            sat, 0.55),
    secondary: hslToHex((hue + 25)  % 360, sat, 0.60),
    accent:    hslToHex((hue + 180) % 360, sat * 0.9, 0.50),
    deep:      hslToHex((hue - 30 + 360) % 360, sat, 0.30),
  };
}

/**
 * Map current band-phases (kick/snare/vocal/hihat) to a single RGB
 * colour blend. Used by 'band-driven' colorMode.
 *
 * Each band has a base hue (kick=red-orange, snare=yellow, vocal=blue,
 * hihat=cyan) — current band phase acts as a gain on that hue. The
 * result is mixed in HSL space so the dominant band at any moment
 * pushes the colour toward its base hue, with smoother transitions
 * than a naive RGB mix.
 */
export function bandPhasesToColor(
  kick: number, snare: number, vocal: number, hihat: number,
): string {
  // Base hues: kick=12 (red-orange), snare=48 (yellow),
  //            vocal=220 (blue), hihat=180 (cyan)
  const hues: [number, number][] = [
    [12, kick], [48, snare], [220, vocal], [180, hihat],
  ];
  // Weighted-average hue (handle wraparound by accumulating in
  // sin/cos space, then arctan2 to recover the angle).
  let xSum = 0, ySum = 0, wSum = 0;
  for (const [h, w] of hues) {
    if (w <= 0.001) continue;
    const a = (h * Math.PI) / 180;
    xSum += Math.cos(a) * w;
    ySum += Math.sin(a) * w;
    wSum += w;
  }
  if (wSum < 0.001) return '#888888';
  const blendedHue = ((Math.atan2(ySum, xSum) * 180) / Math.PI + 360) % 360;
  // Saturation/lightness scale with overall energy of the four bands
  const sat = 0.55 + Math.min(0.4, wSum * 0.15);
  const lig = 0.45 + Math.min(0.2, wSum * 0.08);
  return hslToHex(blendedHue, sat, lig);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise key string: 'db' / 'DB' / 'd♭' → 'Db', 'c#' → 'C#'. */
function normaliseKey(key: string): KeyName | null {
  const k = key.trim();
  if (!k) return null;
  // Replace flat sign variants
  const flatNorm = k.replace(/♭/g, 'b').replace(/_b$/i, 'b');
  // Uppercase the letter, lowercase the accidental
  const letter = flatNorm[0].toUpperCase();
  const accidental = flatNorm.slice(1).toLowerCase();
  const candidate = (letter + accidental) as KeyName;
  if (KEY_HUE_MAP[candidate] !== undefined) return candidate;
  return null;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if      (hp >= 0 && hp < 1) { r = c; g = x; }
  else if (hp >= 1 && hp < 2) { r = x; g = c; }
  else if (hp >= 2 && hp < 3) { g = c; b = x; }
  else if (hp >= 3 && hp < 4) { g = x; b = c; }
  else if (hp >= 4 && hp < 5) { r = x; b = c; }
  else if (hp >= 5 && hp < 6) { r = c; b = x; }
  const m = l - c / 2;
  const toHex = (v: number) => {
    const n = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
    return n.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
