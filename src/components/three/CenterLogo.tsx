/**
 * CenterLogo - center logo with:
 *  - Outer glow (ShaderMaterial radial falloff plane, outward from logo edge)
 *  - Inner glow (soft falloff from logo edge inward toward center, additive)
 *  - Fire ring effect (fBm procedural fire via RingGeometry + ShaderMaterial)
 *  - Frequency-based audio reactivity via FreqBeatDetector
 *  - Beat scale driven by logo freq range
 *
 * v12: renamed glow → outerGlow, added innerGlow (soft falloff)
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAudioStore } from '@/lib/audioStore';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { useSettingsStore } from '@/lib/settingsStore';
import { useBeatDetectorRegistration } from './AudioScene';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { usePhaseSource } from '@/hooks/usePhaseSource';

const REF_VMIN = 900;

// ─── Shared vertex shader ─────────────────────────────────────────────────────

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ─── Outer Glow fragment shader ───────────────────────────────────────────────
// Alpha peaks just outside the logo edge, falls off outward.

const OUTER_GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3  uGwColor;
uniform float uGwIntensity;
uniform float uGwSize;
uniform float uGwBlur;
uniform float uGwBeat;

void main() {
  vec2  gw_center  = vUv - 0.5;
  float gw_dist    = length(gw_center) * 2.0;

  float gw_logoEdge = 1.0 / uGwSize;
  float gw_falloff  = max(0.0, gw_dist - gw_logoEdge * 0.8);
  float gw_blur     = max(0.01, uGwBlur * 0.02);
  float gw_alpha    = exp(-gw_falloff * gw_falloff / (gw_blur * gw_blur));

  // Fade to zero at geometry edge so no hard cutoff is visible
  float gw_edgeFade = 1.0 - smoothstep(0.7, 1.0, gw_dist);
  gw_alpha *= gw_edgeFade;

  gw_alpha *= uGwIntensity * (1.0 + uGwBeat * 0.5);

  if (gw_alpha < 0.005) discard;
  gl_FragColor = vec4(uGwColor, gw_alpha);
}
`;

// ─── Inner Glow fragment shader ───────────────────────────────────────────────
// Geometry is sized to the LOGO (so vUv 0..1 == full logo disc). uIgSize
// is the inner-glow REACH: 0.0 = glow only at the very edge, 1.0 = glow
// covers the entire logo. Decays from logo edge INWARD toward center.
// Soft falloff: exp(-d^2/b^2), faded to 0 at the disc center.

const INNER_GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3  uIgColor;
uniform float uIgIntensity;
uniform float uIgSize;
uniform float uIgBlur;
uniform float uIgBeat;

void main() {
  vec2  ig_center  = vUv - 0.5;
  float ig_dist    = length(ig_center) * 2.0;

  // ig_reach: 0..1 - how far from the rim the glow reaches inward
  float ig_reach   = clamp(uIgSize, 0.0, 1.0);
  // distance INTO the glow band, starting at the rim (0 at rim, grows toward center)
  float ig_into     = max(0.0, ig_reach - ig_dist);
  float ig_blur     = max(0.01, uIgBlur * 0.05);
  float ig_alpha    = exp(-ig_into * ig_into / (ig_blur * ig_blur));

  // Hard-clip anything outside the logo disc (uIgSize > 1 would otherwise leak)
  float ig_discMask = 1.0 - smoothstep(0.98, 1.0, ig_dist);
  ig_alpha *= ig_discMask;

  ig_alpha *= uIgIntensity * (1.0 + uIgBeat * 0.5);

  if (ig_alpha < 0.005) discard;
  gl_FragColor = vec4(uIgColor, ig_alpha);
}
`;

// ─── Fire ShaderMaterial sources ──────────────────────────────────────────────

const FIRE_VERT = /* glsl */ `
varying vec3 vLocalPos;
uniform float uTime;
uniform float uFrBass;

void main() {
  // Pass LOCAL position for polar UV computation in fragment shader.
  // The RingGeometry is [innerR=0.5, outerR=0.5+height] in local space,
  // so polar math stays in the [-0.5..1.5] range regardless of mesh scale.
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
precision highp float;

#define fr_PI   3.14159265358979
#define fr_TAU  6.28318530717959

// ─── Uniforms ────────────────────────────────────────
varying vec3 vLocalPos;

uniform float uTime;
uniform float uFrBass;
uniform float uFrBeat;
uniform float uFrIntensity;
uniform float uFrHeight;
uniform float uFrKick;
uniform float uFrHihat;
uniform float uFrVocal;
uniform float uFrSpeed;
uniform vec3  uFrColorInner;
uniform vec3  uFrColorMid;
uniform vec3  uFrColorOuter;

// ═══════════════════════════════════════════════════════
//  NOISE
// ═══════════════════════════════════════════════════════

float fr_h(vec2 fr_p) {
  return fract(sin(dot(fr_p, vec2(127.1, 311.7))) * 43758.5453);
}

float fr_vn(vec2 fr_p) {
  vec2 fr_i = floor(fr_p);
  vec2 fr_f = fract(fr_p);
  float fr_a = fr_h(fr_i);
  float fr_b = fr_h(fr_i + vec2(1.0, 0.0));
  float fr_c = fr_h(fr_i + vec2(0.0, 1.0));
  float fr_d = fr_h(fr_i + vec2(1.0, 1.0));
  vec2  fr_u = fr_f * fr_f * (3.0 - 2.0 * fr_f);
  return mix(mix(fr_a, fr_b, fr_u.x), mix(fr_c, fr_d, fr_u.x), fr_u.y);
}

float fr_fbm(vec2 fr_p) {
  float fr_v   = 0.0;
  float fr_amp = 0.5;
  mat2  fr_rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int fr_i = 0; fr_i < 4; fr_i++) {
    fr_v   += fr_amp * fr_vn(fr_p);
    fr_p    = fr_rot * fr_p * 2.05 + vec2(17.2, 9.4);
    fr_amp *= 0.5;
  }
  return fr_v;
}

float fr_wfbm(vec2 fr_p, float fr_t) {
  vec2 fr_q = vec2(
    fr_fbm(fr_p + vec2(0.0, -fr_t * 0.85)),
    fr_fbm(fr_p + vec2(5.2,  1.3))
  );
  return fr_fbm(fr_p + 3.2 * fr_q);
}

// ═══════════════════════════════════════════════════════
//  FLAME MASK — N teardrop tongues pointing RADIALLY OUT
// ═══════════════════════════════════════════════════════

float fr_flameMask(float fr_lx, float fr_ly, float fr_t, float fr_ah) {
  // Slot subdivision: 8 chunky flames around the ring (fewer = bigger, more flame-like)
  float fr_NUM    = 8.0;
  float fr_slot   = fr_lx * fr_NUM;
  float fr_idx    = floor(fr_slot);
  float fr_frac   = fract(fr_slot);

  // Per-flame pseudo-random seeds
  float fr_s1 = fract(sin(fr_idx * 127.1 + 311.7) * 43758.5453);
  float fr_s2 = fract(sin(fr_idx *  73.1 + 157.3) * 52948.1234);

  // Per-flame height variation (0.85-1.10×)
  float fr_hmod = 0.85 + 0.20 * fr_s1;
  fr_hmod *= 0.92 + 0.08 * sin(fr_t * (1.1 + fr_s1 * 0.9) + fr_s1 * fr_TAU);
  float fr_H = fr_ah * fr_hmod;

  // Normalized height within this flame
  float fr_ny = fr_ly / max(fr_H, 0.001);
  if (fr_ny > 1.0) return 0.0;

  // Teardrop width: W = BASE × (1 - y^2) × belly(y)
  // At y=0: width=BASE, at y=1: width=0 (pointed tip)
  // belly peaks at y≈0.5 (the "belly" of a real flame)
  //
  // With NUM=8 slots (each 0.125 wide), BASE=0.045 gives
  // half-width 0.045 at base → covers 72% of slot, 28% gap.
  // Real flame ratio: wide base, sharply pointed tip.
  float fr_BASE   = 0.045;
  float fr_taper  = 1.0 - pow(fr_ny, 1.8);
  float fr_belly  = 1.0 + 0.15 * sin(fr_PI * fr_ny);
  float fr_halfW  = fr_BASE * fr_taper * fr_belly;

  // Flame sway (different per tongue)
  float fr_sway = sin(fr_t * 1.7  + fr_s1 * fr_TAU) * 0.035
                + sin(fr_t * 3.1  + fr_s2 * fr_TAU) * 0.018;
  float fr_center = 0.5 + fr_sway;

  // Angular distance from this flame's center
  float fr_da = abs(fr_frac - fr_center);

  // Ragged edge noise
  float fr_en = fr_wfbm(
    vec2(fr_frac * 7.0 + fr_t * 0.4 + fr_s1 * 3.1,
         fr_ly   * 9.0 - fr_t * 1.3),
    fr_t
  );
  float fr_edgeShift = (fr_en - 0.5) * 0.05;

  // Soft angular edge (sharp at base, softer at tip)
  float fr_softness = 0.008 + fr_ny * 0.012;
  float fr_angMask = 1.0 - smoothstep(
    fr_halfW + fr_edgeShift - fr_softness,
    fr_halfW + fr_edgeShift + fr_softness,
    fr_da
  );

  // Base fade: small smooth transition at the logo edge
  float fr_baseFade = smoothstep(0.0, 0.03, fr_ly);

  // Tip dissolution
  float fr_tipFade = 1.0 - smoothstep(0.72, 1.0, fr_ny);
  float fr_tipNoise = fr_vn(vec2(fr_lx * 20.0 + fr_t, fr_ly * 15.0));
  fr_tipFade *= 0.6 + 0.4 * fr_tipNoise;

  return fr_angMask * fr_baseFade * fr_tipFade;
}

// ═══════════════════════════════════════════════════════
//  FIRE COLOR — 5-stop blackbody gradient (user-tinted)
// ═══════════════════════════════════════════════════════

vec3 fr_fireColor(float fr_heat) {
  vec3 fr_black  = vec3(0.00, 0.00, 0.00);
  vec3 fr_dkred  = mix(vec3(0.70, 0.04, 0.00), uFrColorOuter, 0.55);
  vec3 fr_orange = mix(vec3(1.00, 0.32, 0.00), uFrColorMid,   0.45);
  vec3 fr_yellow = vec3(1.00, 0.86, 0.14);
  vec3 fr_white  = mix(vec3(1.00, 0.96, 0.80), uFrColorInner, 0.30);

  vec3 fr_c = mix(fr_black,  fr_dkred,  smoothstep(0.00, 0.22, fr_heat));
  fr_c      = mix(fr_c,      fr_orange, smoothstep(0.18, 0.48, fr_heat));
  fr_c      = mix(fr_c,      fr_yellow, smoothstep(0.42, 0.72, fr_heat));
  fr_c      = mix(fr_c,      fr_white,  smoothstep(0.66, 0.92, fr_heat));
  return fr_c;
}

// ═══════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════

void main() {
  // Polar coordinates from LOCAL position (ring is in XY plane)
  // RingGeometry: innerR=0.5, outerR=0.5+fireHeight (local units)
  float fr_angle  = atan(vLocalPos.y, vLocalPos.x);
  float fr_radius = length(vLocalPos.xy);
  float fr_localX = fract((fr_angle + fr_PI) / fr_TAU);  // 0..1 around ring
  float fr_localY = clamp((fr_radius - 0.5) / max(uFrHeight, 0.001), 0.0, 1.0);

  // Time
  float fr_t = uTime * uFrSpeed;

  // Audio height modulation
  float fr_audioH = 1.0
                  + uFrKick  * 0.40
                  + uFrBeat  * 0.12
                  + uFrVocal * 0.08;

  // Flame mask
  float fr_mask = fr_flameMask(fr_localX, fr_localY, fr_t, fr_audioH);

  if (fr_mask < 0.004) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Internal heat texture (warped FBM streaks)
  float fr_fval = fr_wfbm(
    vec2(fr_localX * 6.0 + fr_t * 0.25,
         fr_localY * 10.0 - fr_t * 1.5),
    fr_t
  );

  // Heat: bright base, dark tip, with FBM variation
  float fr_heat = pow(1.0 - fr_localY, 1.8);
  fr_heat += (fr_fval - 0.5) * 0.28;
  fr_heat += uFrVocal * 0.12;
  // Hihat adds high-freq sparkle at tips
  fr_heat += uFrHihat * 0.10
           * fr_vn(vec2(fr_localX * 28.0 + fr_t * 2.1, fr_localY * 22.0));
  fr_heat  = clamp(fr_heat, 0.0, 1.0);

  // Color
  vec3 fr_color = fr_fireColor(fr_heat);
  fr_color += uFrKick * 0.25 * vec3(1.0, 0.8, 0.5) * fr_mask;

  // Alpha: mask × intensity, with core glow boost
  float fr_coreGlow = exp(-fr_localY * 3.5) * 0.4;
  float fr_alpha    = fr_mask * (0.65 + fr_coreGlow + fr_fval * 0.25);
  fr_alpha         *= uFrIntensity;
  fr_alpha          = clamp(fr_alpha, 0.0, 1.0);

  gl_FragColor = vec4(fr_color * fr_alpha, fr_alpha);
}
`;

// ─── Shared glow color computation ───────────────────────────────────────────
// Module-level helper - computes glow color into `target` based on colorMode.
// Called for both outer and inner glows with their own hueRef instances.

function computeGlowColor(
  mode: 'solid' | 'rainbow' | 'custom' | 'random',
  hueRef: { current: number },
  scratch: THREE.Color[],
  randomColors: THREE.Color[],
  time: number,
  delta: number,
  solidColor: string,
  customColors: string[],
  cycleSpeed: number,
  themeAccent: string,
  target: THREE.Color,
): void {
  if (mode === 'solid') {
    target.set(solidColor || themeAccent);
  } else if (mode === 'rainbow') {
    hueRef.current = (hueRef.current + delta * cycleSpeed * 0.05) % 1;
    target.setHSL(hueRef.current, 0.9, 0.55);
  } else if (mode === 'custom') {
    const cols: string[] = (customColors?.length ?? 0) > 0
      ? customColors
      : ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'];
    const fi   = ((time * cycleSpeed * 0.05) % 1) * cols.length;
    const i0   = Math.floor(fi) % cols.length;
    const i1   = (i0 + 1) % cols.length;
    scratch[0].set(cols[i0]);
    scratch[1].set(cols[i1]);
    target.lerpColors(scratch[0], scratch[1], fi - Math.floor(fi));
  } else {
    // random
    const fi = ((time * cycleSpeed * 0.05) % 1) * randomColors.length;
    const i0 = Math.floor(fi) % randomColors.length;
    const i1 = (i0 + 1) % randomColors.length;
    target.lerpColors(randomColors[i0], randomColors[i1], fi - Math.floor(fi));
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CenterLogo() {
  const logoObjectUrl = useAudioStore((s) => s.logoObjectUrl);
  const logoFile      = useAudioStore((s) => s.logoFile);
  const enabled       = useSettingsStore((s) => s.settings.logo.enabled);

  if (!enabled || !logoObjectUrl || !logoFile) return null;
  return <LogoInner logoUrl={logoObjectUrl} />;
}

function LogoInner({ logoUrl }: { logoUrl: string }) {
  const meshRef         = useRef<THREE.Mesh>(null);
  const outerGlowRef    = useRef<THREE.Mesh>(null);
  const innerGlowRef    = useRef<THREE.Mesh>(null);
  const fireRef         = useRef<THREE.Mesh>(null);
  const logoMatRef      = useRef<THREE.MeshBasicMaterial>(null);
  const rotRef              = useRef(0);
  const timeRef             = useRef(0);
  const outerRainbowHueRef  = useRef(0);
  const innerRainbowHueRef  = useRef(0);

  // 4 random hues generated once at session start, for 'random' glow color mode
  // Shared between outer and inner glow.
  const glowRandomColors = useMemo(() =>
    [0, 0.25, 0.5, 0.75].map((base) =>
      new THREE.Color().setHSL((base + Math.random() * 0.2) % 1, 0.9, 0.55)
    )
  , []);
  // Scratch colors for smooth lerping in custom/random mode (avoids per-frame allocation)
  // Shared between outer and inner glow.
  const glowScratch = useMemo(() => [new THREE.Color(), new THREE.Color()], []);

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const img    = new Image();
    img.onload   = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror  = () => setImgSize({ w: 1, h: 1 });
    img.src      = logoUrl;
  }, [logoUrl]);

  // ── Logo texture with circular alpha mask ───────────────────────────────────
  const texture = useMemo(() => {
    const diameter = 1024;
    const canvas   = document.createElement('canvas');
    canvas.width   = diameter;
    canvas.height  = diameter;
    const ctx      = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, diameter, diameter);
    const tex      = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearFilter;
    tex.magFilter  = THREE.LinearFilter;

    if (imgSize) {
      const img        = new Image();
      img.crossOrigin  = 'anonymous';
      img.onload = () => {
        ctx.clearRect(0, 0, diameter, diameter);
        const drawW = (diameter * imgSize.w) / imgSize.h;
        const drawH = diameter;
        ctx.drawImage(img, (diameter - drawW) / 2, 0, drawW, drawH);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        tex.needsUpdate = true;
      };
      img.src = logoUrl;
    }
    return tex;
  }, [logoUrl, imgSize]);

  // ── Logo geometry ────────────────────────────────────────────────────────────
  const logoGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // ── Outer Glow uniforms (created once, mutated in useFrame) ─────────────────
  const outerGlowUniforms = useMemo(() => ({
    uGwColor:     { value: new THREE.Color('#6366F1') },
    uGwIntensity: { value: 0.5 },
    uGwSize:      { value: 1.15 },
    uGwBlur:      { value: 15.0 },
    uGwBeat:      { value: 0.0 },
  }), []);

  const outerGlowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   GLOW_VERT,
    fragmentShader: OUTER_GLOW_FRAG,
    uniforms:       outerGlowUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [outerGlowUniforms]);

  const outerGlowGeo = useMemo(() => new THREE.CircleGeometry(0.5, 64), []);

  // ── Inner Glow uniforms (created once, mutated in useFrame) ─────────────────
  const innerGlowUniforms = useMemo(() => ({
    uIgColor:     { value: new THREE.Color('#6366F1') },
    uIgIntensity: { value: 0.0 },
    uIgSize:      { value: 1.0 },
    uIgBlur:      { value: 15.0 },
    uIgBeat:      { value: 0.0 },
  }), []);

  const innerGlowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   GLOW_VERT,
    fragmentShader: INNER_GLOW_FRAG,
    uniforms:       innerGlowUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [innerGlowUniforms]);

  const innerGlowGeo = useMemo(() => new THREE.CircleGeometry(0.5, 64), []);

  // ── Fire uniforms (created once, mutated in useFrame) ───────────────────────
  const fireUniforms = useMemo(() => ({
    uTime:         { value: 0.0 },
    uFrBass:       { value: 0.0 },
    uFrBeat:       { value: 0.0 },
    uFrIntensity:  { value: 1.0 },
    uFrColorInner: { value: new THREE.Color('#ff2200') },
    uFrColorMid:   { value: new THREE.Color('#ff7700') },
    uFrColorOuter: { value: new THREE.Color('#ffee88') },
    // v16: new uniforms
    uFrHeight:     { value: 0.5 },
    uFrKick:       { value: 0.0 },
    uFrHihat:      { value: 0.0 },
    uFrVocal:      { value: 0.0 },
    uFrSpeed:      { value: 1.0 },  // NEW
  }), []);

  const fireMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    uniforms:       fireUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
    side:           THREE.DoubleSide,
  }), [fireUniforms]);

  // ── Fire geometry - rebuilds when fireHeight changes ─────────────────────────
  const fireHeightRef  = useRef<number>(-1);
  const fireGeoRef     = useRef<THREE.RingGeometry | null>(null);
  const logoBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  const fireBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(logoBeatDetector);
  useBeatDetectorRegistration(fireBeatDetector);

  // v13.1: phase sources for logo and fire. Both now use the user's
  // configured Hz range (beatFxFreqStart/End for logo, fireFreqStart/
  // End for fire) to weight-blend the 4 pre-analysis bands via
  // computeWeightedPhase(). The v13 hard-coded mapping (logo→kick,
  // fire→vocal) is gone — the user's intent in the HzRangePicker
  // now actually drives the result. Both stay registered for
  // export-reset compatibility.
  const logoPhaseSrc = usePhaseSource({
    detector: logoBeatDetector,
    getPrecomputedRange: () => {
      const sL = getSettings().logo;
      return { startHz: sL.beatFxFreqStart, endHz: sL.beatFxFreqEnd };
    },
    liveFn: () => {
      const sL = getSettings().logo;
      logoBeatDetector.setSensitivity(sL.beatFxSensitivity ?? 1.0);
      return logoBeatDetector.update(audioAnalysis.rawFreqData, sL.beatFxFreqStart, sL.beatFxFreqEnd);
    },
  });
  const firePhaseSrc = usePhaseSource({
    detector: fireBeatDetector,
    getPrecomputedRange: () => {
      const sF = getSettings().logo;
      return { startHz: sF.fireFreqStart, endHz: sF.fireFreqEnd };
    },
    liveFn: () => {
      const sF = getSettings().logo;
      fireBeatDetector.setSensitivity(sF.fireSensitivity ?? 1.0);
      return fireBeatDetector.update(audioAnalysis.rawFreqData, sF.fireFreqStart, sF.fireFreqEnd);
    },
  });

  // ── useFrame: update all reactive state ─────────────────────────────────────
  useFrame((state, delta) => {
    const s   = getSettings().logo;
    const { width, height } = state.size;
    const vmin  = Math.min(width, height);
    const scale = Math.min(vmin / REF_VMIN, 1);
    const theme = getSettings().theme;

    // Advance time for fire animation
    timeRef.current += delta * (s.fireSpeed > 0 ? s.fireSpeed : 1.0);

    // ── Frequency energy ──────────────────────────────────────────────────────
    const rawData    = audioAnalysis.rawFreqData;
    // v13: pull phases from the active source (precomputed or live).
    // Fire also needs the raw energy for the bass-driven fire lift -
    // we still call the live detector in 'precomputed' mode just for
    // its `.energy` field (cheap, no double-firing because the
    // detector only updates if update() is called).
    const logoBeat   = logoPhaseSrc();
    const fireBeat   = firePhaseSrc();
    if (s.fireEnabled) {
      // Keep the fire detector in sync for its .energy reading even
      // in precomputed mode (the energy drives uFrBass, the bass-
      // modulated flame height independent of the beat phase).
      fireBeatDetector.setSensitivity(s.fireSensitivity ?? 1.0);
      fireBeatDetector.update(rawData, s.fireFreqStart, s.fireFreqEnd);
    }
    const fireEnergy = fireBeatDetector.energy;

    // ── Logo mesh ─────────────────────────────────────────────────────────────
    const logoSize  = s.size * scale;
    const beatScale = 1 + logoBeat * (s.beatScaleStrength ?? 0.5) * 0.15;

    if (meshRef.current) {
      meshRef.current.position.set(0, 0, 0);
      meshRef.current.scale.set(logoSize * beatScale, logoSize * beatScale, 1);
      meshRef.current.rotation.z = rotRef.current;
    }
    if (logoMatRef.current) {
      logoMatRef.current.opacity = s.opacity;
    }

    // ── Outer Glow plane ─────────────────────────────────────────────────────
    const outerGlowEnabled = s.outerGlowEnabled ?? DEFAULT_SETTINGS.logo.outerGlowEnabled;
    if (outerGlowRef.current) {
      outerGlowRef.current.visible = outerGlowEnabled;
      if (outerGlowEnabled) {
        // beatScale multiplied in so the glow follows the logo's beat-pulse
        const outerPlaneSize = logoSize * (s.outerGlowSize ?? DEFAULT_SETTINGS.logo.outerGlowSize) * beatScale;
        outerGlowRef.current.position.set(0, 0, -0.1);
        outerGlowRef.current.scale.set(outerPlaneSize, outerPlaneSize, 1);
        outerGlowRef.current.rotation.z = rotRef.current;
      }
    }

    // ── Outer Glow color ─────────────────────────────────────────────────────
    computeGlowColor(
      (s.outerGlowColorMode ?? DEFAULT_SETTINGS.logo.outerGlowColorMode) as 'solid' | 'rainbow' | 'custom' | 'random',
      outerRainbowHueRef,
      glowScratch,
      glowRandomColors,
      timeRef.current,
      delta,
      s.outerGlowColor ?? DEFAULT_SETTINGS.logo.outerGlowColor,
      s.outerGlowCustomColors ?? DEFAULT_SETTINGS.logo.outerGlowCustomColors,
      s.outerGlowCycleSpeed ?? DEFAULT_SETTINGS.logo.outerGlowCycleSpeed,
      theme.accent,
      outerGlowUniforms.uGwColor.value,
    );
    outerGlowUniforms.uGwIntensity.value = ((s.outerGlowIntensity ?? DEFAULT_SETTINGS.logo.outerGlowIntensity) / 100) * (1 + logoBeat * 0.4);
    outerGlowUniforms.uGwSize.value      = s.outerGlowSize ?? DEFAULT_SETTINGS.logo.outerGlowSize;
    outerGlowUniforms.uGwBlur.value      = s.outerGlowBlur ?? DEFAULT_SETTINGS.logo.outerGlowBlur;
    outerGlowUniforms.uGwBeat.value      = logoBeat;

    // ── Inner Glow plane ─────────────────────────────────────────────────────
    // The plane is sized to the LOGO (uIgSize is a shader-side reach, not a
    // plane multiplier - see INNER_GLOW_FRAG). The shader fades from the rim
    // inward based on uIgSize, so a smaller plane would crop the glow ring.
    // We multiply by beatScale so the glow tracks the logo's beat-pulse.
    const innerGlowEnabled = s.innerGlowEnabled ?? DEFAULT_SETTINGS.logo.innerGlowEnabled;
    if (innerGlowRef.current) {
      innerGlowRef.current.visible = innerGlowEnabled;
      if (innerGlowEnabled) {
        const innerPlaneSize = logoSize * beatScale;
        innerGlowRef.current.position.set(0, 0, 0.05);
        innerGlowRef.current.scale.set(innerPlaneSize, innerPlaneSize, 1);
        innerGlowRef.current.rotation.z = rotRef.current;
      }
    }

    // ── Inner Glow color ─────────────────────────────────────────────────────
    computeGlowColor(
      (s.innerGlowColorMode ?? DEFAULT_SETTINGS.logo.innerGlowColorMode) as 'solid' | 'rainbow' | 'custom' | 'random',
      innerRainbowHueRef,
      glowScratch,
      glowRandomColors,
      timeRef.current,
      delta,
      s.innerGlowColor ?? DEFAULT_SETTINGS.logo.innerGlowColor,
      s.innerGlowCustomColors ?? DEFAULT_SETTINGS.logo.innerGlowCustomColors,
      s.innerGlowCycleSpeed ?? DEFAULT_SETTINGS.logo.innerGlowCycleSpeed,
      theme.accent,
      innerGlowUniforms.uIgColor.value,
    );
    innerGlowUniforms.uIgIntensity.value = ((s.innerGlowIntensity ?? DEFAULT_SETTINGS.logo.innerGlowIntensity) / 100) * (1 + logoBeat * 0.4);
    innerGlowUniforms.uIgSize.value      = s.innerGlowSize ?? DEFAULT_SETTINGS.logo.innerGlowSize;
    innerGlowUniforms.uIgBlur.value      = s.innerGlowBlur ?? DEFAULT_SETTINGS.logo.innerGlowBlur;
    innerGlowUniforms.uIgBeat.value      = logoBeat;

    // ── Fire ring ─────────────────────────────────────────────────────────────
    if (fireRef.current) {
      fireRef.current.visible = s.fireEnabled;

      if (s.fireEnabled) {
        // Rebuild geometry if fireHeight changed
        if (fireHeightRef.current !== s.fireHeight) {
          fireHeightRef.current = s.fireHeight;
          if (fireGeoRef.current) fireGeoRef.current.dispose();
          const innerR = 0.5;
          const outerR = 0.5 + s.fireHeight;
          fireGeoRef.current = new THREE.RingGeometry(innerR, outerR, 128, 32);
          fireRef.current.geometry = fireGeoRef.current;
        }

        // Scale fire ring to match logo size (same beat scale for cohesion)
        const fireScale = logoSize * beatScale;
        fireRef.current.position.set(0, 0, 0.1);
        fireRef.current.scale.set(fireScale, fireScale, 1);
        fireRef.current.rotation.z = rotRef.current;
      }
    }

    const reactiveFireEnergy = fireEnergy * s.fireReactivity;
    fireUniforms.uTime.value         = timeRef.current;
    fireUniforms.uFrBass.value       = reactiveFireEnergy;
    fireUniforms.uFrBeat.value       = fireBeat;
    fireUniforms.uFrIntensity.value  = s.fireIntensity;
    fireUniforms.uFrColorInner.value.set(s.fireColorInner);
    fireUniforms.uFrColorMid.value.set(s.fireColorMid);
    fireUniforms.uFrColorOuter.value.set(s.fireColorOuter);
    // v16: new per-band uniforms
    fireUniforms.uFrHeight.value = s.fireHeight;
    fireUniforms.uFrKick.value   = audioAnalysis.kickPhase  ?? 0;
    fireUniforms.uFrHihat.value  = audioAnalysis.hihatPhase ?? 0;
    fireUniforms.uFrVocal.value  = audioAnalysis.vocalPhase ?? 0;
    fireUniforms.uFrSpeed.value  = s.fireSpeed;
  });

  return (
    <>
      {/* Outer glow plane - smooth radial falloff, sits behind logo */}
      <mesh ref={outerGlowRef} renderOrder={5}>
        <primitive object={outerGlowGeo} attach="geometry" />
        <primitive object={outerGlowMat} attach="material" />
      </mesh>

      {/* Fire ring - procedural fBm flames around logo edge */}
      <mesh ref={fireRef} renderOrder={7}>
        {/* Initial geometry - rebuilt in useFrame when fireHeight changes */}
        <ringGeometry args={[0.5, 0.5 + 0.3, 128, 32]} />
        <primitive object={fireMat} attach="material" />
      </mesh>

      {/* Inner glow plane - additive, sits in front of logo, behind fire */}
      <mesh ref={innerGlowRef} renderOrder={8}>
        <primitive object={innerGlowGeo} attach="geometry" />
        <primitive object={innerGlowMat} attach="material" />
      </mesh>

      {/* Logo mesh - on top */}
      <mesh ref={meshRef} renderOrder={6}>
        <primitive object={logoGeo} attach="geometry" />
        <meshBasicMaterial
          ref={logoMatRef}
          map={texture}
          toneMapped={false}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}
