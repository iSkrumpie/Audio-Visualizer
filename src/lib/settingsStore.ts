/**
 * Settings Store (Zustand + localStorage persist)
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
    // ── Glow ───────────────────────────────────────────────────────────
    glowEnabled: boolean;
    glowIntensity: number;      // 0..100
    glowColor: string;
    glowSize: number;           // 1.0..5.0 (relative to logo)
    glowBlur: number;           // 0..50, softness of glow spread
    glowColorMode: 'solid' | 'rainbow' | 'custom' | 'random';
    glowCycleSpeed: number;     // 0..2 (rainbow/custom/random cycle speed)
    glowCustomColors: string[]; // custom mode: list of colors to cycle through
    // ── Fire effect ────────────────────────────────────────────────────
    fireEnabled: boolean;
    fireIntensity: number;      // 0..2
    fireHeight: number;         // 0..1
    fireSpeed: number;          // 0..3
    fireColorInner: string;
    fireColorMid: string;
    fireColorOuter: string;
    fireReactivity: number;     // 0..3
    fireFreqStart: number;      // 20..20000 Hz
    fireFreqEnd: number;        // 20..20000 Hz
    fireSensitivity: number;    // 0.1..5.0 fire beat detector sensitivity
  };

  bars: {
    enabled: boolean;
    count: number;              // 8..256
    thickness: number;          // 1..12
    lengthScale: number;        // 0.2..3.0
    innerRadius: number;        // 60..400
    rotationSpeed: number;      // 0..2
    rotationOnBeat: number;     // 0..5
    colorMode: 'solid' | 'rainbow' | 'custom' | 'random';
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
    colorMode: 'solid' | 'rainbow' | 'custom' | 'random';
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
  },

  logo: {
    enabled: true,
    size: 240,
    opacity: 1.0,
    beatScaleStrength: 0.5,
    beatFxFreqStart: 20,
    beatFxFreqEnd: 200,
    beatFxSensitivity: 1.0,
    glowEnabled: true,
    glowIntensity: 50,
    glowColor: '#6366F1',
    glowSize: 1.15,
    glowBlur: 15,
    glowColorMode: 'solid',
    glowCycleSpeed: 0.3,
    glowCustomColors: ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'],
    fireEnabled: false,
    fireIntensity: 1.0,
    fireHeight: 0.3,
    fireSpeed: 1.0,
    fireColorInner: '#ff2200',
    fireColorMid: '#ff7700',
    fireColorOuter: '#ffee88',
    fireReactivity: 1.0,
    fireFreqStart: 20,
    fireFreqEnd: 200,
    fireSensitivity: 1.0,
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
    globalBeatFreqStart: 40,
    globalBeatFreqEnd: 120,
    globalBeatSensitivity: 1.0,
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
      name: 'audiovisualizer:settings:v11',
      storage: createJSONStorage(() => localStorage),
      version: 11,
      migrate: () => ({ settings: DEFAULT_SETTINGS }),
    },
  ),
);

export const getSettings = (): Settings => useSettingsStore.getState().settings;
