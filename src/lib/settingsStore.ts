/**
 * Settings Store (Zustand + localStorage persist)
 *
 * v15: Sparks rework — replaced sparksEnabled + sparksStyle enum with 3 independent
 *       toggle fields: sparksWeldEnabled, sparksVolcanicEnabled, sparksAmbientEnabled.
 *       Removed sparksSpawnMix. Per-style spawn geometry is baked into each pool.
 *       Old settings are wiped on first load (migrate → DEFAULT_SETTINGS).
 *
 * v14: Added sparks/embers system under logo.fire (12 new fields).
 *       sparksEnabled, sparksStyle, sparksCount, sparksSize, sparksSpeed,
 *       sparksBurstCount, sparksLifetime, sparksGravity, sparksDrag,
 *       sparksSpread, sparksSpawnMix, sparksOpacity.
 *       Old settings are wiped on first load (migrate → DEFAULT_SETTINGS).
 *
 * v13: Audio detection overhaul. Added:
 *      - audio.detectionMode: 'live' (legacy spectral-flux on raw FFT) |
 *        'precomputed' (multi-band onsets + essentia.js BPM/Ticks/Key, pre-analysed)
 *      - audio.bandSensitivity: per-band gain (kick/snare/vocal/hihat) 0..2
 *      - audio.preAnalysisProgress: 0..1 progress bar shown while analysis runs
 *      - bars/particles colorMode extended with 'key-derived' which uses
 *        the detected key from pre-analysis as the hue basis
 *      - bars.particles colorMode extended with 'band-driven' which uses
 *        the kick/snare/vocal/hihat pre-analysis phases for color shifts
 *
 * v12: Split glow → outerGlow + innerGlow, added 3 weather FX groups
 *      (bgParticles/rain/snow) on background.outerGlow stays the primary
 *      light source, innerGlow adds inward-rim accent.
 *
 * v11: Audio-Reactivity Refactor. Added `audio` group, settingsStore v11.
 *
 * v10: Added per-component sensitivity multipliers (beatFxSensitivity, fireSensitivity,
 *      reactiveSensitivity), bars beat detection fields (beatFreqStart/End/Sensitivity),
 *      and nebula pulse mode (nebulaBeatMode/FreqStart/End/Sensitivity).
 *
 * v9: Added `audio` group with globalBeatFreqStart/End/Sensitivity for
 *     configurable global beat detection (replaces hardcoded 60-120 Hz kick).
 *
 * v8: Beat FX source replaced with Hz range (beatFxFreqStart/End).
 *     Stylize effects (noise, scanlines, glitch, pixelation, dot screen, grid)
 *     gained animation / reactivity sub-parameters.
 *     Logo simplified: removed shape/cornerRadius/rotation/ring fields,
 *     added glowBlur, beatFxFreqStart/End, and fire effect settings.
 *     Bars: removed mirror, new colorMode ('solid'|'rainbow'|'custom'|'random'),
 *     added customColors + customFreqBoundaries.
 *     Particles: colorMode simplified, removed monoColor/reactiveAxis,
 *     added solidColor, customColors, customFreqBoundaries, reactiveFreqStart/End.
 *
 * Structure:
 *   theme      — global palette (accent, secondary, mode)
 *   audio      — detection pipeline (mode, per-band sensitivity, key, tempo)
 *   background — everything visual about the background layer + postfx
 *   logo       — center logo settings
 *   bars       — FFT radial bars
 *   particles  — orbit particle system
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light';

export type Settings = {
  theme: {
    mode: ThemeMode;
    /** Primary palette color — bars (solid), particles, logo glow fallback */
    accent: string;
    /** Secondary palette color — particles secondary hue */
    secondary: string;
    /** Show the Audio tab in SettingsPanel (power-user / advanced toggle).
     *  Default false — hidden from casual users. Detection pipeline still runs. */
    showAdvancedAudio: boolean;
  };

  background: {
    // ── Image adjustments ──────────────────────────────────────────────
    blur: number;           // 0..40 px (Gaussian glassmorphism)
    brightness: number;     // 0.2..2.0  (1.0 = unchanged)
    saturation: number;     // 0.0..2.0  (1.0 = unchanged)
    contrast: number;       // 0.2..2.0  (1.0 = unchanged)
    hueShift: number;       // 0..360 degrees
    sharpen: number;        // 0..2 (unsharp mask)
    // ── Tint overlay ───────────────────────────────────────────────────
    tintColor: string;
    tintOpacity: number;    // 0..1
    tintMode: 'multiply' | 'overlay' | 'soft-light' | 'screen';
    // ── Beat reactivity ────────────────────────────────────────────────
    scaleOnBeat: number;    // 0..0.5
    beatFxFreqStart: number;      // 20..20000 Hz
    beatFxFreqEnd: number;        // 20..20000 Hz
    beatFxSensitivity: number;    // 0.1..5.0 detector sensitivity multiplier
    // ── Shader vignette ────────────────────────────────────────────────
    vignetteEnabled: boolean;
    vignetteStrength: number; // 0..1
    // ── Nebula fog ─────────────────────────────────────────────────────
    nebulaEnabled: boolean;
    nebulaIntensity: number;   // 0..1
    nebulaColor1: string;
    nebulaColor2: string;
    nebulaDriftSpeed: number;  // 0..3
    nebulaReactivity: number;  // 0..3
    nebulaScale: number;       // 0.1..3.0 (relative to screen, 1=fill)
    nebulaOffsetX: number;     // -1..1 (fraction of half-width)
    nebulaOffsetY: number;     // -1..1 (fraction of half-height)
    // ── Nebula beat pulse ──────────────────────────────────────────────
    nebulaBeatMode: boolean;       // false = continuous (bass+loudness), true = beat pulse
    nebulaBeatFreqStart: number;   // 20..20000 Hz
    nebulaBeatFreqEnd: number;     // 20..20000 Hz
    nebulaBeatSensitivity: number; // 0.1..5.0
    // ── PostFX ─────────────────────────────────────────────────────────
    bloomEnabled: boolean;
    bloomIntensity: number;
    bloomThreshold: number;
    caEnabled: boolean;         // chromatic aberration
    caOffset: number;
    // ── Noise ──────────────────────────────────────────────────────────
    noiseEnabled: boolean;
    noiseIntensity: number;
    noiseSpeed: number;         // 0..10, animation speed
    noiseScale: number;         // 0.5..5.0, spatial scale
    noiseColorMode: boolean;    // false = mono, true = color
    noiseBeatBoost: number;     // 0..3, intensity boost on beat
    // ── Scanlines ──────────────────────────────────────────────────────
    scanlineEnabled: boolean;
    scanlineDensity: number;
    scanScrollSpeed: number;    // -5..5, vertical scroll speed
    scanThickness: number;      // 0.1..0.9, line fill fraction
    scanBeatOpacity: number;    // 0..2, opacity boost on beat
    scanBeatDensity: number;    // 0..3, density boost on beat
    // ── Glitch ─────────────────────────────────────────────────────────
    glitchEnabled: boolean;
    glitchDelay: number;        // 0.5..10 min seconds between glitches
    glitchStrength: number;     // 0.01..0.5 displacement strength
    glitchRGBSplit: number;     // 0..0.05, RGB channel separation
    glitchBlockSize: number;    // 4..64, block artifact size
    glitchBlockProb: number;    // 0..1, probability of block artifacts per frame
    glitchVertical: number;     // 0..1, vertical displacement mix
    glitchBeatSync: boolean;    // trigger glitch on beat
    glitchDecay: number;        // 0.5..8, glitch fade-out speed
    // ── Sepia ──────────────────────────────────────────────────────────
    sepiaEnabled: boolean;
    sepiaIntensity: number;
    // ── Pixelation ─────────────────────────────────────────────────────
    pixelationEnabled: boolean;
    pixelGranularity: number;
    pixelBeatSize: number;      // 0..200, granularity boost on beat
    pixelWave: number;          // 0..1, wavy pixel-boundary distortion
    pixelWaveSpeed: number;     // 0..3, wave animation speed
    // ── Dot screen ─────────────────────────────────────────────────────
    dotScreenEnabled: boolean;
    dotScale: number;
    dotRotation: number;        // 0..45 degrees, dot grid rotation
    dotRotSpeed: number;        // 0..2, rotation animation speed
    dotBeatScale: number;       // 0..2, scale boost on beat
    dotColorSep: number;        // 0..1, RGB channel separation on dots
    // ── Grid ───────────────────────────────────────────────────────────
    gridEnabled: boolean;
    gridScale: number;
    gridPulseStrength: number;  // 0..3, line brightness pulse on beat
    gridWave: number;           // 0..1, wavy grid distortion
    gridWaveSpeed: number;      // 0..5, wave animation speed
    gridMovement: number;       // 0..2, grid scroll speed
    gridColor: string;          // line color
    // ── Color average ──────────────────────────────────────────────────
    colorAverageEnabled: boolean;
    // ── Background Particles ──────────────────────────────────────────
    bgParticlesEnabled: boolean;
    bgParticlesCount: number;       // 0..500
    bgParticlesSpeed: number;       // 0..3
    bgParticlesSize: number;        // 0.5..10
    bgParticlesOpacity: number;     // 0..1
    bgParticlesColor: string;
    bgParticlesBeatFreqStart: number;   // 20..20000 Hz
    bgParticlesBeatFreqEnd: number;     // 20..20000 Hz
    bgParticlesBeatSensitivity: number; // 0.1..5.0
    // ── Rain ────────────────────────────────────────────────────────────
    rainEnabled: boolean;
    rainCount: number;              // 0..1200
    rainSpeed: number;              // 0..5
    rainAngle: number;              // -45..45 degrees (positive = lean right)
    rainLength: number;             // 0.5..8 (streak length in px at REF_VMIN)
    rainWidth: number;              // 0.1..3 (streak width factor)
    rainColor: string;
    rainOpacity: number;            // 0..1
    rainBeatFreqStart: number;      // 20..20000 Hz
    rainBeatFreqEnd: number;        // 20..20000 Hz
    rainBeatSensitivity: number;    // 0.1..5.0
    // ── Snow ────────────────────────────────────────────────────────────
    snowEnabled: boolean;
    snowCount: number;              // 0..600
    snowSpeed: number;              // 0..3
    snowSize: number;               // 0.5..8
    snowColor: string;
    snowOpacity: number;            // 0..1
    snowSway: number;               // 0..3
    snowBeatFreqStart: number;      // 20..20000 Hz
    snowBeatFreqEnd: number;        // 20..20000 Hz
    snowBeatSensitivity: number;    // 0.1..5.0
    // ── Strands (v15) — ribbon/aurora light trails ──────────────────────
    strandsEnabled: boolean;            // master toggle
    strandsColors: string[];            // 1..8 hex colors
    strandsCount: number;               // 1..12
    strandsSpeed: number;               // 0..3
    strandsAmplitude: number;           // 0..3
    strandsWaviness: number;            // 0..3
    strandsThickness: number;           // 0..3
    strandsGlow: number;                // 0..6
    strandsTaper: number;               // 0..10
    strandsSpread: number;              // 0..3
    strandsHueShift: number;            // 0..2
    strandsIntensity: number;           // 0..1
    strandsSaturation: number;          // 0..3
    strandsOpacity: number;             // 0..1
    strandsScale: number;               // 0.1..5
    strandsBeatFreqStart: number;       // 20..20000 Hz
    strandsBeatFreqEnd: number;         // 20..20000 Hz
    strandsBeatSensitivity: number;     // 0..5  (0 = no audio reactivity)
    strandsBehindLogo: boolean;         // true = behind logo, false = over everything
  };

  logo: {
    enabled: boolean;
    size: number;               // 80..1600 px
    opacity: number;            // 0..1
    // ── Beat scale ─────────────────────────────────────────────────────
    beatScaleStrength: number;  // 0..1
    beatFxFreqStart: number;      // 20..20000 Hz
    beatFxFreqEnd: number;        // 20..20000 Hz
    beatFxSensitivity: number;    // 0.1..5.0 detector sensitivity multiplier
    // ── Outer Glow ─────────────────────────────────────────────────────
    outerGlowEnabled: boolean;
    outerGlowIntensity: number;      // 0..100
    outerGlowColor: string;
    outerGlowSize: number;           // 1.0..5.0 (relative to logo)
    outerGlowBlur: number;           // 0..50, softness of glow spread
    outerGlowColorMode: 'solid' | 'rainbow' | 'custom' | 'random';
    outerGlowCycleSpeed: number;     // 0..2 (rainbow/custom/random cycle speed)
    outerGlowCustomColors: string[]; // custom mode: list of colors to cycle through
    // ── Inner Glow ─────────────────────────────────────────────────────
    innerGlowEnabled: boolean;
    innerGlowIntensity: number;      // 0..100
    innerGlowColor: string;
    innerGlowSize: number;           // 0.0..1.0 (reach: fraction of logo radius)
    innerGlowBlur: number;           // 0..50, softness of glow spread
    innerGlowColorMode: 'solid' | 'rainbow' | 'custom' | 'random';
    innerGlowCycleSpeed: number;     // 0..2 (rainbow/custom/random cycle speed)
    innerGlowCustomColors: string[]; // custom mode: list of colors to cycle through
    // ── Fire effect ────────────────────────────────────────────────────
    fireEnabled: boolean;
    fireIntensity: number;      // 0..2
    fireHeight: number;         // 0..2
    fireSpeed: number;          // 0..3
    fireColorInner: string;
    fireColorMid: string;
    fireColorOuter: string;
    fireReactivity: number;     // 0..3
    fireFreqStart: number;      // 20..20000 Hz
    fireFreqEnd: number;        // 20..20000 Hz
    fireSensitivity: number;    // 0.1..5.0 fire beat detector sensitivity
    // ── Sparks / Embers (v16) — single pool, single toggle ─────────────
    sparksEnabled:    boolean;       // master toggle
    sparksCount:      number;        // particles in pool: 30..300
    sparksSize:       number;        // base size multiplier: 0.3..3.0
    sparksSpeed:      number;        // initial velocity multiplier: 0.3..3.0
    sparksBurstCount: number;        // particles per kick burst: 0..100
    sparksLifetime:   number;        // max lifetime in seconds: 0.3..3.0
    sparksGravity:    number;        // downward acceleration: 0..8
    sparksDrag:       number;        // drag coefficient: 0.5..4.0
    sparksSpread:     number;        // radial spread angle (radians): 0..1.5
    sparksOpacity:    number;        // overall opacity multiplier: 0..1
    sparksColorHot:   string;        // hot color (freshly spawned, top of gradient)
    sparksColorMid:   string;        // mid color (cooling, middle of gradient)
    sparksColorCool:  string;        // cool color (about to die, bottom of gradient)
  };

  bars: {
    enabled: boolean;
    count: number;              // 8..256
    thickness: number;          // 1..12
    lengthScale: number;        // 0.2..3.0
    innerRadius: number;        // 60..400
    rotationSpeed: number;      // 0..2
    rotationOnBeat: number;     // 0..5
    colorMode: 'solid' | 'rainbow' | 'custom' | 'random' | 'key-derived' | 'band-driven';
    solidColor: string;
    /** Per-zone colors used in 'custom' colorMode */
    customColors: string[];
    /** Hz boundaries between custom color zones (length = customColors.length - 1) */
    customFreqBoundaries: number[];
    reactivity: number;         // 0.1..3.0
    // ── Frequency range ────────────────────────────────────────────────
    freqStart: number;          // 0..120 (FFT bin)
    freqEnd: number;            // 8..128 (FFT bin)
    // ── Appearance ─────────────────────────────────────────────────────
    opacity: number;            // 0..1
    minHeight: number;          // 0..10 px
    gapSize: number;            // 0..0.9 (width reduction factor)
    // ── Physics ────────────────────────────────────────────────────────
    smoothing: number;          // 0.05..0.5
    // ── Peak indicators ────────────────────────────────────────────────
    peakEnabled: boolean;
    peakDecay: number;          // 0.980..0.999
    // ── Beat boost ─────────────────────────────────────────────────────
    beatFreqStart: number;      // 20..20000 Hz — beat detection range for height boost
    beatFreqEnd: number;        // 20..20000 Hz
    beatSensitivity: number;    // 0.1..5.0
  };

  audio: {
    /** Global beat detector low Hz bound (20..20000, default 40) */
    globalBeatFreqStart: number;
    /** Global beat detector high Hz bound (20..20000, default 120) */
    globalBeatFreqEnd: number;
    /** Global beat detector sensitivity multiplier (0.1..5.0, default 1.0) */
    globalBeatSensitivity: number;
    // ── v13: Pre-analysis pipeline (essentia.js + multi-band onsets) ────────
    /**
     * Detection mode. Default 'precomputed' (essentia.js BPM/Ticks/Key +
     * multi-band onset arrays) — produces frame-accurate beat-sync and
     * cleaner Kick/Snare/Vocal/HiHat separation. 'live' falls back to
     * the legacy spectral-flux FreqBeatDetector path.
     */
    detectionMode: 'live' | 'precomputed';
    /** Per-band gain multipliers for the 4 onset bands (kick/snare/vocal/hihat).
     *  Each band 0..2 — values above 1 amplify the corresponding phase,
     *  values below 1 dampen it. Applied to audioAnalysis.{kick,snare,vocal,hihat}Phase. */
    bandSensitivity: {
      kick: number;
      snare: number;
      vocal: number;
      hihat: number;
    };
    /** 0..1 — 0 = analysis not started, 1 = complete. Drives UI progress bar
     *  on the audio tab in SettingsPanel. Live-mirrored from useAudioReactive. */
    preAnalysisProgress: number;
    /** Detected BPM (0 = not analysed yet, otherwise 30..300). */
    bpm: number;
    /** Detected musical key (e.g. 'C#', 'F') — empty string = not analysed. */
    key: string;
    /** Detected scale ('major' | 'minor' | ''). */
    scale: 'major' | 'minor' | '';
    /** How much detected key/bpm influence the colorMode='key-derived'/'band-driven' variants. */
    keyInfluence: number; // 0..1
  };

  particles: {
    enabled: boolean;
    count: number;              // 0..400
    size: number;               // 0.5..8
    orbitRadius: number;        // 80..500
    speed: number;              // 0..3
    spread: number;             // 0..3
    kickBurstStrength: number;  // 0..3
    opacity: number;            // 0..1
    sizeOnBeat: number;         // 0..3
    // ── Color ──────────────────────────────────────────────────────────
    colorMode: 'solid' | 'rainbow' | 'custom' | 'random' | 'key-derived' | 'band-driven';
    solidColor: string;
    /** Per-zone colors used in 'custom' colorMode */
    customColors: string[];
    /** Hz boundaries between custom color zones (length = customColors.length - 1) */
    customFreqBoundaries: number[];
    // ── Reactive frequency range ───────────────────────────────────────
    reactiveFreqStart: number;    // 20..20000 Hz
    reactiveFreqEnd: number;      // 20..20000 Hz
    reactiveSensitivity: number;  // 0.1..5.0 detector sensitivity multiplier
    // ── Orbit ──────────────────────────────────────────────────────────
    orbitMode: 'circular' | 'elliptical' | 'scatter';
    ellipseRatio: number;       // 0.3..1.0
    // ── Shape ──────────────────────────────────────────────────────────
    particleShape: 'circle' | 'star' | 'diamond';
    blendMode: 'additive' | 'normal';
    // ── Connection lines ───────────────────────────────────────────────
    connectionLines: boolean;
    connectionDistance: number; // 20..200
    connectionOpacity: number;  // 0..1
    // ── Twinkle ────────────────────────────────────────────────────────
    twinkle: boolean;
    twinkleSpeed: number;       // 0.5..3
  };
};

const DEFAULT_SETTINGS: Settings = {
  theme: {
    mode: 'dark',
    accent: '#6366F1',
    secondary: '#22D3EE',
    showAdvancedAudio: false,
  },

  background: {
    blur: 0,
    brightness: 1.0,
    saturation: 1.0,
    contrast: 1.0,
    hueShift: 0,
    sharpen: 0,
    tintColor: '#0B0D10',
    tintOpacity: 0.3,
    tintMode: 'multiply',
    scaleOnBeat: 0,
    beatFxFreqStart: 20,
    beatFxFreqEnd: 200,
    beatFxSensitivity: 1.0,
    vignetteEnabled: false,
    vignetteStrength: 0.5,
    nebulaEnabled: false,
    nebulaIntensity: 0.3,
    nebulaColor1: '#6366F1',
    nebulaColor2: '#22D3EE',
    nebulaDriftSpeed: 1.0,
    nebulaReactivity: 1.0,
    nebulaScale: 1.0,
    nebulaOffsetX: 0,
    nebulaOffsetY: 0,
    nebulaBeatMode: false,
    nebulaBeatFreqStart: 40,
    nebulaBeatFreqEnd: 120,
    nebulaBeatSensitivity: 1.0,
    bloomEnabled: false,
    bloomIntensity: 1.2,
    bloomThreshold: 0.25,
    caEnabled: false,
    caOffset: 0.002,
    noiseEnabled: false,
    noiseIntensity: 0.3,
    noiseSpeed: 3.0,
    noiseScale: 1.0,
    noiseColorMode: false,
    noiseBeatBoost: 0,
    scanlineEnabled: false,
    scanlineDensity: 1.5,
    scanScrollSpeed: 0,
    scanThickness: 0.5,
    scanBeatOpacity: 0,
    scanBeatDensity: 0,
    glitchEnabled: false,
    glitchDelay: 3.0,
    glitchStrength: 0.1,
    glitchRGBSplit: 0,
    glitchBlockSize: 16,
    glitchBlockProb: 0.3,
    glitchVertical: 0,
    glitchBeatSync: true,
    glitchDecay: 4.0,
    sepiaEnabled: false,
    sepiaIntensity: 0.5,
    pixelationEnabled: false,
    pixelGranularity: 5,
    pixelBeatSize: 0,
    pixelWave: 0,
    pixelWaveSpeed: 1.5,
    dotScreenEnabled: false,
    dotScale: 1.0,
    dotRotation: 0,
    dotRotSpeed: 0,
    dotBeatScale: 0,
    dotColorSep: 0,
    gridEnabled: false,
    gridScale: 1.0,
    gridPulseStrength: 0,
    gridWave: 0,
    gridWaveSpeed: 2.0,
    gridMovement: 0,
    gridColor: '#6366F1',
    colorAverageEnabled: false,
    bgParticlesEnabled: false,
    bgParticlesCount: 150,
    bgParticlesSpeed: 0.3,
    bgParticlesSize: 2.0,
    bgParticlesOpacity: 0.6,
    bgParticlesColor: '#FFFFFF',
    bgParticlesBeatFreqStart: 20,
    bgParticlesBeatFreqEnd: 200,
    bgParticlesBeatSensitivity: 1.0,
    rainEnabled: false,
    rainCount: 600,
    rainSpeed: 1.5,
    rainAngle: 8,
    rainLength: 1.5,
    rainWidth: 0.6,
    rainColor: '#A8C8FF',
    rainOpacity: 0.5,
    rainBeatFreqStart: 2000,
    rainBeatFreqEnd: 8000,
    rainBeatSensitivity: 1.0,
    snowEnabled: false,
    snowCount: 250,
    snowSpeed: 0.4,
    snowSize: 2.0,
    snowColor: '#FFFFFF',
    snowOpacity: 0.85,
    snowSway: 0.5,
    snowBeatFreqStart: 3000,
    snowBeatFreqEnd: 12000,
    snowBeatSensitivity: 1.0,
    // ── Strands (v15) ─────────────────────────────────────────────────
    strandsEnabled: false,
    strandsColors: ['#FF4242', '#7C3AED', '#06B6D4', '#EAB308'],
    strandsCount: 3,
    strandsSpeed: 0.5,
    strandsAmplitude: 1,
    strandsWaviness: 1,
    strandsThickness: 0.7,
    strandsGlow: 2.6,
    strandsTaper: 0,
    strandsSpread: 1,
    strandsHueShift: 0,
    strandsIntensity: 0.6,
    strandsSaturation: 1.5,
    strandsOpacity: 1,
    strandsScale: 1.0,
    strandsBeatFreqStart: 20,
    strandsBeatFreqEnd: 200,
    strandsBeatSensitivity: 0,
    strandsBehindLogo: true,
  },

  logo: {
    enabled: true,
    size: 240,
    opacity: 1.0,
    beatScaleStrength: 0.5,
    beatFxFreqStart: 20,
    beatFxFreqEnd: 200,
    beatFxSensitivity: 1.0,
    outerGlowEnabled: true,
    outerGlowIntensity: 50,
    outerGlowColor: '#6366F1',
    outerGlowSize: 1.15,
    outerGlowBlur: 15,
    outerGlowColorMode: 'solid',
    outerGlowCycleSpeed: 0.3,
    outerGlowCustomColors: ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'],
    innerGlowEnabled: false,
    innerGlowIntensity: 0,
    innerGlowColor: '#6366F1',
    // Inner glow reach: 0..1 (fraction of logo radius the glow covers
    // inward from the rim). 0.5 = glow fills the outer half of the logo.
    innerGlowSize: 0.5,
    innerGlowBlur: 15,
    innerGlowColorMode: 'solid',
    innerGlowCycleSpeed: 0.3,
    innerGlowCustomColors: ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'],
    fireEnabled: false,
    fireIntensity: 1.0,
    fireHeight: 0.8,
    fireSpeed: 1.0,
    fireColorInner: '#ff2200',
    fireColorMid: '#ff7700',
    fireColorOuter: '#ffee88',
    fireReactivity: 1.0,
    fireFreqStart: 20,
    fireFreqEnd: 200,
    fireSensitivity: 1.0,
    // Sparks / Embers (v16) — single pool, default OFF
    sparksEnabled:    false,
    sparksCount:      150,
    sparksSize:       1.0,
    sparksSpeed:      1.0,
    sparksBurstCount: 40,
    sparksLifetime:   1.0,
    sparksGravity:    2.5,
    sparksDrag:       2.0,
    sparksSpread:     0.4,
    sparksOpacity:    0.9,
    sparksColorHot:   '#fff5d8',   // near-white
    sparksColorMid:   '#ff7700',   // orange
    sparksColorCool:  '#aa0000',   // dark red
  },

  bars: {
    enabled: true,
    count: 128,
    thickness: 3,
    lengthScale: 1.0,
    innerRadius: 180,
    rotationSpeed: 0.3,
    rotationOnBeat: 0,
    colorMode: 'rainbow',
    solidColor: '#6366F1',
    customColors: ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'],
    customFreqBoundaries: [200, 2000, 8000],
    reactivity: 1.0,
    freqStart: 0,
    freqEnd: 128,
    opacity: 0.85,
    minHeight: 2,
    gapSize: 0,
    smoothing: 0.18,
    peakEnabled: false,
    peakDecay: 0.987,
    beatFreqStart: 60,
    beatFreqEnd: 250,
    beatSensitivity: 1.0,
  },

  audio: {
    globalBeatFreqStart: 30,
    globalBeatFreqEnd: 160,
    globalBeatSensitivity: 1.2,
    // v13: pre-analysis pipeline
    detectionMode: 'precomputed',
    bandSensitivity: {
      kick: 1.0,
      snare: 1.2,
      vocal: 0.8,
      hihat: 1.4,
    },
    preAnalysisProgress: 0,
    bpm: 0,
    key: '',
    scale: '',
    keyInfluence: 0.5,
  },

  particles: {
    enabled: true,
    count: 120,
    size: 2.0,
    orbitRadius: 220,
    speed: 1.0,
    spread: 1.0,
    kickBurstStrength: 1.0,
    opacity: 1.0,
    sizeOnBeat: 0,
    colorMode: 'solid',
    solidColor: '#6366F1',
    customColors: ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'],
    customFreqBoundaries: [200, 2000, 8000],
    reactiveFreqStart: 20,
    reactiveFreqEnd: 200,
    reactiveSensitivity: 1.0,
    orbitMode: 'circular',
    ellipseRatio: 0.6,
    particleShape: 'circle',
    blendMode: 'additive',
    connectionLines: false,
    connectionDistance: 80,
    connectionOpacity: 0.3,
    twinkle: true,
    twinkleSpeed: 1.0,
  },
};

export { DEFAULT_SETTINGS };

type SettingsStore = {
  settings: Settings;
  setSettings: (updater: (prev: Settings) => Settings) => void;
  setThemeMode: (mode: ThemeMode) => void;
  resetToDefault: () => void;
};

export const THEME_STORAGE_KEY = 'audiovisualizer:theme';

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (updater) => set((s) => ({ settings: updater(s.settings) })),
      setThemeMode: (mode) =>
        set((s) => ({ settings: { ...s.settings, theme: { ...s.settings.theme, mode } } })),
      resetToDefault: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'audiovisualizer:settings:v15',
      storage: createJSONStorage(() => localStorage),
      version: 15,
      migrate: (persistedState: unknown, version: number): { settings: Settings } => {
        // Safety: no persisted data → start fresh
        const ps = persistedState as Record<string, unknown> | null | undefined;
        if (!ps || typeof ps !== 'object' || !ps['settings']) {
          return { settings: DEFAULT_SETTINGS };
        }
        const s = ps['settings'] as Record<string, unknown>;
        if (version < 15) {
          // Deep-merge background: keep old user values, fill in new strands* fields
          const oldBg = (s['background'] as Record<string, unknown>) ?? {};
          s['background'] = { ...DEFAULT_SETTINGS.background, ...oldBg };
        }
        return ps as { settings: Settings };
      },
    },
  ),
);

export const getSettings = (): Settings => useSettingsStore.getState().settings;
