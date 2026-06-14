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
varying vec3 vWorldPos;
uniform float uTime;
uniform float uFrBass;

void main() {
  // Pass world position for polar UV computation in fragment shader
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  // Keep the radial ripple for nice edge variation
  vec3 pos = position;
  float outerWeight = smoothstep(0.3, 1.0, length(position.xy) * 2.0);
  float wave = sin(atan(position.y, position.x) * 12.0 + uTime * 3.5) * 0.04
             + sin(atan(position.y, position.x) * 7.0  - uTime * 2.1) * 0.025;
  wave *= outerWeight * (1.0 + uFrBass * 1.5);
  vec2 radialDir = normalize(pos.xy);
  pos.xy += radialDir * wave;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec3 vWorldPos;

uniform float uTime;
uniform float uFrBass;
uniform float uFrBeat;
uniform float uFrIntensity;
uniform vec3  uFrColorInner;
uniform vec3  uFrColorMid;
uniform vec3  uFrColorOuter;
uniform float uFrHeight;
uniform float uFrKick;
uniform float uFrHihat;
uniform float uFrVocal;

// ─── Value noise + FBM (fr_ prefix for ANGLE safety) ─────────────────────────

float fr_hash(vec2 fr_p) {
  fr_p = fract(fr_p * vec2(127.1, 311.7));
  fr_p += dot(fr_p, fr_p + 18.5453);
  return fract(fr_p.x * fr_p.y);
}

float fr_vnoise(vec2 fr_p) {
  vec2 fr_i = floor(fr_p);
  vec2 fr_f = fract(fr_p);
  vec2 fr_u = fr_f * fr_f * (3.0 - 2.0 * fr_f);
  return mix(
    mix(fr_hash(fr_i),                  fr_hash(fr_i + vec2(1.0, 0.0)), fr_u.x),
    mix(fr_hash(fr_i + vec2(0.0, 1.0)), fr_hash(fr_i + vec2(1.0, 1.0)), fr_u.x),
    fr_u.y
  );
}

float fr_fbm(vec2 fr_p) {
  float fr_v = 0.0;
  float fr_a = 0.5;
  mat2  fr_m = mat2(0.8, -0.6, 0.6, 0.8);
  for (int fr_o = 0; fr_o < 4; fr_o++) {
    fr_v += fr_a * fr_vnoise(fr_p);
    fr_p  = fr_m * fr_p * 2.05 + vec2(17.2, 9.4);
    fr_a *= 0.5;
  }
  return fr_v;
}

// IQ-style domain warping (single level for performance budget)
float fr_warpedFbm(vec2 fr_p, float fr_t) {
  vec2 fr_q = vec2(
    fr_fbm(fr_p + vec2(0.0, 0.0) + fr_t * 0.30),
    fr_fbm(fr_p + vec2(5.2, 1.3) - fr_t * 0.20)
  );
  return fr_fbm(fr_p + 3.0 * fr_q + vec2(fr_t * 0.10, 0.0));
}

// ─── Blackbody color gradient (5 stops, user-tintable) ──────────────────────
// fr_heat: 0 = outer/cool/tip, 1 = inner/hot/base

vec3 fr_fireColor(float fr_heat, vec3 fr_cInner, vec3 fr_cMid, vec3 fr_cOuter) {
  vec3 fr_dark   = fr_cOuter * 0.10;
  vec3 fr_red    = fr_cOuter;
  vec3 fr_orange = fr_cMid;
  vec3 fr_yellow = mix(fr_cMid, fr_cInner, 0.5);
  vec3 fr_white  = fr_cInner;

  vec3 fr_col = mix(fr_dark,   fr_red,    smoothstep(0.00, 0.25, fr_heat));
  fr_col = mix(fr_col, fr_orange, smoothstep(0.18, 0.50, fr_heat));
  fr_col = mix(fr_col, fr_yellow, smoothstep(0.42, 0.72, fr_heat));
  fr_col = mix(fr_col, fr_white,  smoothstep(0.68, 1.00, fr_heat));
  return fr_col;
}

// ─── Flame tongue: individual wisp/lick along the ring ───────────────────────

float fr_flameTongue(float fr_localX, float fr_center, float fr_start,
                     float fr_length, float fr_width, float fr_wobble, float fr_t) {
  float fr_x = clamp((fr_localX - fr_start) / max(fr_length, 0.001), 0.0, 1.0);
  float fr_active = smoothstep(0.0, 0.08, fr_x) * (1.0 - smoothstep(0.9, 1.0, fr_x));
  float fr_curve = fr_center + sin(fr_x * 8.0 + fr_t) * fr_wobble
                             + sin(fr_x * 17.0 - fr_t * 1.3) * fr_wobble * 0.46;
  float fr_taper = fr_width * pow(1.0 - fr_x, 1.42);
  return fr_active * (1.0 - smoothstep(fr_taper, fr_taper + 0.045,
                                       abs(0.5 - fr_curve + 0.5)));
}

// ─── Main ────────────────────────────────────────────────────────────────────

void main() {
  // ── Polar coordinates from world position ─────────────────────────────
  float fr_angle  = atan(vWorldPos.y, vWorldPos.x);         // -PI..PI
  float fr_localX = fract(fr_angle / 6.28318 + 0.5);        // 0..1 around arc

  float fr_radius = length(vWorldPos.xy);
  float fr_innerR = 0.5;
  float fr_outerR = uFrHeight + 0.5;

  float fr_localY = clamp((fr_radius - fr_innerR) / max(fr_outerR - fr_innerR, 0.001), 0.0, 1.0);
  // 0 = inner rim (logo edge), 1 = outer tip

  // ── Audio-driven base lift (height surges on kick) ───────────────────
  float fr_baseLift = 1.0 + uFrKick * 0.35 + uFrBeat * 0.15;

  // ── Flame flow noise: scrolls OUTWARD (away from logo) ───────────────
  vec2  fr_noiseUv = vec2(fr_localX * 3.5, fr_localY * 4.2 - uTime * (0.9 + uFrHihat * 0.4));
  float fr_flow = fr_warpedFbm(fr_noiseUv, uTime);

  // Fine noise on top
  vec2  fr_fineUv = vec2(fr_localX * 7.6 + sin(fr_localY * 5.0 + uTime) * 0.25,
                          fr_localY * 6.3 - uTime * 0.55) * 2.15;
  float fr_fine = fr_vnoise(fr_fineUv + vec2(uTime * 0.35, 0.0));
  float fr_noise = fr_flow * 0.70 + fr_fine * 0.30;

  // ── Animated flame center line ───────────────────────────────────────
  float fr_flameCenter = 0.5 + sin(fr_localX * 11.0 - uTime * 2.2) * 0.035
                               + (fr_noise - 0.5) * 0.10;

  // ── Flame band (the "tongue" of fire at this angle) ──────────────────
  float fr_tipTaper = smoothstep(0.65, 1.0, fr_localY);
  float fr_flameWidth = mix(0.40, 0.14, fr_tipTaper);
  fr_flameWidth += (fr_noise - 0.5) * 0.10 * (1.0 - fr_tipTaper * 0.35);

  float fr_dy = abs(fr_localY - fr_flameCenter);
  float fr_flame = 1.0 - smoothstep(fr_flameWidth, fr_flameWidth + 0.10, fr_dy);

  // ── Add 3 flame tongues for individual wisps ────────────────────────
  float fr_t1 = fr_flameTongue(fr_localX, 0.36, 0.06, 0.88, 0.12, 0.035, uTime * 2.1);
  float fr_t2 = fr_flameTongue(fr_localX, 0.54, 0.00, 0.98, 0.22, 0.045, uTime * 1.7 + 1.8);
  float fr_t3 = fr_flameTongue(fr_localX, 0.66, 0.11, 0.73, 0.10, 0.035, uTime * 2.5 + 3.4);
  float fr_tongues = max(max(fr_t1, fr_t2), fr_t3);
  fr_flame = max(fr_flame, fr_tongues * 0.85);

  // ── Hard inner cut (logo is the fuel source) ────────────────────────
  float fr_innerCut = smoothstep(0.0, 0.025, fr_localY);
  fr_flame *= fr_innerCut;

  // ── Tip dissipation (ragged torn edge) ───────────────────────────────
  float fr_tipNoise = fr_noise * 0.18 - 0.09;
  float fr_dissipation = 1.0 - smoothstep(0.7 + fr_tipNoise, 0.95 + fr_tipNoise, fr_localY);
  fr_flame *= fr_dissipation;

  // ── Base lift effect (height surges on kick) ────────────────────────
  fr_flame *= fr_baseLift;

  // ── Hard cutoff for fully transparent pixels ─────────────────────────
  if (fr_flame < 0.012) discard;

  // ── Color: blackbody gradient (heat = 1 - localY, plus noise variation)
  float fr_heat = 1.0 - fr_localY;
  fr_heat += (fr_noise - 0.5) * 0.20;
  fr_heat = clamp(fr_heat, 0.0, 1.0);

  vec3 fr_col = fr_fireColor(fr_heat, uFrColorInner, uFrColorMid, uFrColorOuter);

  // Vocal boost shifts color hotter (toward white)
  fr_col = mix(fr_col, vec3(1.0, 0.97, 0.88), uFrVocal * 0.25);

  // Beat flash: brief white-hot spike
  fr_col += vec3(1.0) * uFrBeat * 0.35 * smoothstep(0.6, 1.0, fr_heat);

  // ── Final alpha: flame mask x intensity ─────────────────────────────
  float fr_alpha = fr_flame * uFrIntensity * (0.85 + uFrHihat * 0.20);

  // Pre-multiplied for additive blending
  gl_FragColor = vec4(fr_col * fr_alpha, fr_alpha);
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
