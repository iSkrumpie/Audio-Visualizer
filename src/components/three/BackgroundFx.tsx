/**
 * BackgroundFx — 3 backdrop particle effects:
 *   1. Free-floating ambient particles (bgParticles)
 *   2. Rain streaks
 *   3. Snow flakes
 *
 * Sits at z = -9.5, renderOrder = 1 — behind NebulaPlane (z=-8) and
 * all other elements. Uses AdditiveBlending + depthWrite=false.
 *
 * Each effect has its own FreqBeatDetector registered via
 * useBeatDetectorRegistration so the export pipeline can reset them.
 *
 * Screen mapping: particle positions stored as normalized UV (0..1),
 * converted to world space in vertex shader via uResolution.
 * gl_PointSize scaled by min(w,h)/REF_VMIN for consistent apparent size.
 * Read width/height from useFrame's state.size (NOT useThree closure —
 * see AGENTS.md §6 R3F useFrame rule).
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import type { BlendMode } from '@/lib/settingsStore';
import { applyBlendMode } from '@/lib/blendMode';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

const MAX_BG_PARTICLES = 500;
const MAX_RAIN         = 1000;
const MAX_SNOW         = 600;

// ─── BG Particles shaders ─────────────────────────────────────────────────────
// Prefix: bpf_ (bg-particles fragment), bpv_ (bg-particles vertex)

const BG_PARTICLES_VERT = /* glsl */ `
attribute float aPhase;
attribute float aSpeed;
attribute vec2  aUv;

uniform float uTime;
uniform float uSize;
uniform float uBeat;
uniform vec2  uResolution;

void main() {
  float bpv_x = aUv.x + sin(uTime * aSpeed * 0.4 + aPhase) * 0.05;
  float bpv_y = aUv.y + cos(uTime * aSpeed * 0.3 + aPhase * 1.3) * 0.05;

  // Wrap around [0,1]
  bpv_x = fract(bpv_x);
  bpv_y = fract(bpv_y);

  vec2 bpv_world = (vec2(bpv_x, bpv_y) - 0.5) * uResolution;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(bpv_world, 0.0, 1.0);

  float bpv_scale = min(uResolution.x, uResolution.y) / 900.0;
  gl_PointSize = uSize * bpv_scale * (1.0 + uBeat * 0.3);
}
`;

const BG_PARTICLES_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;

void main() {
  vec2  bpf_uv   = gl_PointCoord - 0.5;
  float bpf_dist = length(bpf_uv) * 2.0;
  float bpf_alpha = 1.0 - smoothstep(0.4, 1.0, bpf_dist);
  if (bpf_alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, bpf_alpha * uOpacity);
}
`;

// ─── Rain shaders ─────────────────────────────────────────────────────────────
// Prefix: rpv_ (rain vertex), rp_ (rain fragment)
// Points are sized as the streak height (gl_PointSize = rainLength * scale).
// Fragment draws a thin vertical strip, faded at ends.

const RAIN_VERT = /* glsl */ `
attribute float aPhase;
attribute float aSpeed;
attribute vec2  aUv;

uniform float uTime;
uniform float uLength;
uniform float uWidth;
uniform float uRainSpeed;
uniform float uAngle;
uniform float uBeat;
uniform vec2  uResolution;

void main() {
  float rpv_anglerad = uAngle * 0.017453293; // deg → rad
  float rpv_dt = uTime * uRainSpeed * aSpeed * 0.5;

  float rpv_x = fract(aUv.x + sin(rpv_anglerad) * rpv_dt);
  float rpv_y = fract(aUv.y - cos(rpv_anglerad) * rpv_dt + aPhase * 0.01);

  vec2 rpv_world = (vec2(rpv_x, rpv_y) - 0.5) * uResolution;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rpv_world, 0.0, 1.0);

  float rpv_scale = min(uResolution.x, uResolution.y) / 900.0;
  // Height of the point square = streak length; width controlled in fragment
  gl_PointSize = uLength * rpv_scale * (1.0 + uBeat * 0.4);
}
`;

const RAIN_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;
uniform float uWidth;

void main() {
  vec2  rp_uv = gl_PointCoord - 0.5;   // -0.5..0.5

  // Narrow X: keep only center strip proportional to uWidth
  float rp_halfW  = clamp(uWidth * 0.08, 0.03, 0.45);
  float rp_xMask  = 1.0 - smoothstep(rp_halfW * 0.5, rp_halfW, abs(rp_uv.x));

  // Full Y height, fade at top and bottom ends
  float rp_yFade  = 1.0 - smoothstep(0.3, 0.5, abs(rp_uv.y));

  float rp_alpha  = rp_xMask * rp_yFade;
  if (rp_alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, rp_alpha * uOpacity);
}
`;

// ─── Snow shaders ─────────────────────────────────────────────────────────────
// Prefix: snv_ (snow vertex), sn_ (snow fragment)

const SNOW_VERT = /* glsl */ `
attribute float aPhase;
attribute float aSpeed;
attribute vec2  aUv;

uniform float uTime;
uniform float uSize;
uniform float uSnowSpeed;
uniform float uSway;
uniform float uBeat;
uniform vec2  uResolution;

void main() {
  float snv_dt = uTime * uSnowSpeed * aSpeed * 0.5;

  float snv_x = fract(aUv.x + sin(aUv.y * 8.0 + uTime * 0.5 + aPhase) * uSway * 0.05);
  float snv_y = fract(aUv.y - snv_dt);

  vec2 snv_world = (vec2(snv_x, snv_y) - 0.5) * uResolution;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(snv_world, 0.0, 1.0);

  float snv_scale = min(uResolution.x, uResolution.y) / 900.0;
  gl_PointSize = uSize * snv_scale * (1.0 + uBeat * 0.4);
}
`;

const SNOW_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uOpacity;

void main() {
  vec2  sn_uv   = gl_PointCoord - 0.5;
  float sn_dist = length(sn_uv) * 2.0;
  float sn_alpha = 1.0 - smoothstep(0.3, 0.5, sn_dist * 0.5);
  // Soft highlight at center
  sn_alpha += pow(max(0.0, 1.0 - sn_dist), 3.0) * 0.4;
  sn_alpha = clamp(sn_alpha, 0.0, 1.0);
  if (sn_alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, sn_alpha * uOpacity);
}
`;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function buildParticleGeometry(count: number): THREE.BufferGeometry {
  const phase  = new Float32Array(count);
  const speed  = new Float32Array(count);
  const uv     = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    phase[i]       = Math.random() * Math.PI * 2;
    speed[i]       = 0.5 + Math.random();
    uv[i * 2]      = Math.random();
    uv[i * 2 + 1]  = Math.random();
  }

  // Dummy positions — actual world positions computed in vertex shader from aUv
  const positions = new Float32Array(count * 3); // all zeros

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aUv',      new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BackgroundFx() {
  // ── Geometries (rebuilt when max count changes — fixed at MAX_* for perf) ──
  const bgParticlesGeo = useMemo(() => buildParticleGeometry(MAX_BG_PARTICLES), []);
  const rainGeo        = useMemo(() => buildParticleGeometry(MAX_RAIN), []);
  const snowGeo        = useMemo(() => buildParticleGeometry(MAX_SNOW), []);

  // ── BG Particles material + uniforms ────────────────────────────────────────
  const bgParticlesUniforms = useMemo(() => ({
    uTime:       { value: 0.0 },
    uSize:       { value: 2.0 },
    uBeat:       { value: 0.0 },
    uColor:      { value: new THREE.Color('#FFFFFF') },
    uOpacity:    { value: 0.6 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  }), []);

  const bgParticlesMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   BG_PARTICLES_VERT,
    fragmentShader: BG_PARTICLES_FRAG,
    uniforms:       bgParticlesUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [bgParticlesUniforms]);

  // ── Rain material + uniforms ────────────────────────────────────────────────
  const rainUniforms = useMemo(() => ({
    uTime:       { value: 0.0 },
    uLength:     { value: 1.5 },
    uWidth:      { value: 0.6 },
    uRainSpeed:  { value: 1.5 },
    uAngle:      { value: 8.0 },
    uBeat:       { value: 0.0 },
    uColor:      { value: new THREE.Color('#A8C8FF') },
    uOpacity:    { value: 0.5 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  }), []);

  const rainMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms:       rainUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [rainUniforms]);

  // ── Snow material + uniforms ────────────────────────────────────────────────
  const snowUniforms = useMemo(() => ({
    uTime:       { value: 0.0 },
    uSize:       { value: 2.0 },
    uSnowSpeed:  { value: 0.4 },
    uSway:       { value: 0.5 },
    uBeat:       { value: 0.0 },
    uColor:      { value: new THREE.Color('#FFFFFF') },
    uOpacity:    { value: 0.85 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  }), []);

  const snowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    uniforms:       snowUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [snowUniforms]);

  // ── Points mesh refs ─────────────────────────────────────────────────────────
  const bgParticlesRef = useRef<THREE.Points>(null);
  const rainRef        = useRef<THREE.Points>(null);
  const snowRef        = useRef<THREE.Points>(null);

  // ── Blend mode tracking refs ────────────────────────────────────────
  const prevBgBlendRef   = useRef<BlendMode | null>(null);
  const prevRainBlendRef = useRef<BlendMode | null>(null);
  const prevSnowBlendRef = useRef<BlendMode | null>(null);

  // ── Time accumulator ─────────────────────────────────────────────────────────
  const timeRef = useRef(0);

  // ── Beat detectors — one per effect ─────────────────────────────────────────
  const bgParticlesBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  const rainBeatDetector        = useMemo(() => new FreqBeatDetector(48000), []);
  const snowBeatDetector        = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(bgParticlesBeatDetector);
  useBeatDetectorRegistration(rainBeatDetector);
  useBeatDetectorRegistration(snowBeatDetector);

  // v13.1: phase sources for the 3 weather effects. Each now reads
  // the user's configured Hz range (bgParticlesBeatFreq* / rainBeatFreq*
  // / snowBeatFreq*) and uses computeWeightedPhase() to weight-blend
  // the 4 pre-analysis bands. v13 had these hard-coded (bgParticles->
  // kick, rain->snare, snow->hihat), which meant selecting a different
  // band on any of the 3 weather effects' Hz sliders would not
  // trigger the corresponding weather pulse even when the audio had
  // energy in that band.
  const bgParticlesPhaseSrc = usePhaseSource({
    detector: bgParticlesBeatDetector,
    getPrecomputedRange: () => {
      const bgL = getSettings().background;
      return {
        startHz: bgL.bgParticlesBeatFreqStart ?? DEFAULT_SETTINGS.background.bgParticlesBeatFreqStart,
        endHz:   bgL.bgParticlesBeatFreqEnd   ?? DEFAULT_SETTINGS.background.bgParticlesBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bgL = getSettings().background;
      bgParticlesBeatDetector.setSensitivity(
        bgL.bgParticlesBeatSensitivity ?? DEFAULT_SETTINGS.background.bgParticlesBeatSensitivity,
      );
      return bgParticlesBeatDetector.update(
        audioAnalysis.rawFreqData,
        bgL.bgParticlesBeatFreqStart ?? DEFAULT_SETTINGS.background.bgParticlesBeatFreqStart,
        bgL.bgParticlesBeatFreqEnd   ?? DEFAULT_SETTINGS.background.bgParticlesBeatFreqEnd,
      );
    },
  });
  const rainPhaseSrc = usePhaseSource({
    detector: rainBeatDetector,
    getPrecomputedRange: () => {
      const bgL = getSettings().background;
      return {
        startHz: bgL.rainBeatFreqStart ?? DEFAULT_SETTINGS.background.rainBeatFreqStart,
        endHz:   bgL.rainBeatFreqEnd   ?? DEFAULT_SETTINGS.background.rainBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bgL = getSettings().background;
      rainBeatDetector.setSensitivity(
        bgL.rainBeatSensitivity ?? DEFAULT_SETTINGS.background.rainBeatSensitivity,
      );
      return rainBeatDetector.update(
        audioAnalysis.rawFreqData,
        bgL.rainBeatFreqStart ?? DEFAULT_SETTINGS.background.rainBeatFreqStart,
        bgL.rainBeatFreqEnd   ?? DEFAULT_SETTINGS.background.rainBeatFreqEnd,
      );
    },
  });
  const snowPhaseSrc = usePhaseSource({
    detector: snowBeatDetector,
    getPrecomputedRange: () => {
      const bgL = getSettings().background;
      return {
        startHz: bgL.snowBeatFreqStart ?? DEFAULT_SETTINGS.background.snowBeatFreqStart,
        endHz:   bgL.snowBeatFreqEnd   ?? DEFAULT_SETTINGS.background.snowBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bgL = getSettings().background;
      snowBeatDetector.setSensitivity(
        bgL.snowBeatSensitivity ?? DEFAULT_SETTINGS.background.snowBeatSensitivity,
      );
      return snowBeatDetector.update(
        audioAnalysis.rawFreqData,
        bgL.snowBeatFreqStart ?? DEFAULT_SETTINGS.background.snowBeatFreqStart,
        bgL.snowBeatFreqEnd   ?? DEFAULT_SETTINGS.background.snowBeatFreqEnd,
      );
    },
  });

  // ── useFrame ─────────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const bg = getSettings().background;
    const { width, height } = state.size;   // MUST read from state.size — NOT closure

    timeRef.current += delta;

    // ── BG Particles ──────────────────────────────────────────────────────────
    const bgEnabled = bg.bgParticlesEnabled ?? DEFAULT_SETTINGS.background.bgParticlesEnabled;
    const bgBehindLogo = bg.bgParticlesBehindLogo ?? DEFAULT_SETTINGS.background.bgParticlesBehindLogo;
    if (bgParticlesRef.current) {
      bgParticlesRef.current.visible = bgEnabled;
      bgParticlesRef.current.renderOrder = bgBehindLogo ? 4 : 9;
    }
    const bgBlend = (bg.bgParticlesBlendMode ?? DEFAULT_SETTINGS.background.bgParticlesBlendMode) as BlendMode;
    if (bgBlend !== prevBgBlendRef.current) {
      applyBlendMode(bgParticlesMat, bgBlend);
      prevBgBlendRef.current = bgBlend;
    }
    if (bgEnabled) {
      const bgBeat = bgParticlesPhaseSrc();

      const bgCount = Math.min(
        bg.bgParticlesCount ?? DEFAULT_SETTINGS.background.bgParticlesCount,
        MAX_BG_PARTICLES,
      );
      bgParticlesGeo.setDrawRange(0, bgCount);

      bgParticlesUniforms.uTime.value          = timeRef.current * (bg.bgParticlesSpeed ?? DEFAULT_SETTINGS.background.bgParticlesSpeed);
      bgParticlesUniforms.uSize.value          = bg.bgParticlesSize ?? DEFAULT_SETTINGS.background.bgParticlesSize;
      bgParticlesUniforms.uBeat.value          = bgBeat;
      bgParticlesUniforms.uOpacity.value       = bg.bgParticlesOpacity ?? DEFAULT_SETTINGS.background.bgParticlesOpacity;
      bgParticlesUniforms.uColor.value.set(bg.bgParticlesColor ?? DEFAULT_SETTINGS.background.bgParticlesColor);
      bgParticlesUniforms.uResolution.value.set(width, height);
    }

    // ── Rain ──────────────────────────────────────────────────────────────────
    const rainEnabled = bg.rainEnabled ?? DEFAULT_SETTINGS.background.rainEnabled;
    const rainBehindLogo = bg.rainBehindLogo ?? DEFAULT_SETTINGS.background.rainBehindLogo;
    if (rainRef.current) {
      rainRef.current.visible = rainEnabled;
      rainRef.current.renderOrder = rainBehindLogo ? 4 : 9;
    }
    const rainBlend = (bg.rainBlendMode ?? DEFAULT_SETTINGS.background.rainBlendMode) as BlendMode;
    if (rainBlend !== prevRainBlendRef.current) {
      applyBlendMode(rainMat, rainBlend);
      prevRainBlendRef.current = rainBlend;
    }
    if (rainEnabled) {
      const rainBeat = rainPhaseSrc();

      const rainCount = Math.min(
        bg.rainCount ?? DEFAULT_SETTINGS.background.rainCount,
        MAX_RAIN,
      );
      rainGeo.setDrawRange(0, rainCount);

      rainUniforms.uTime.value         = timeRef.current;
      rainUniforms.uLength.value       = bg.rainLength  ?? DEFAULT_SETTINGS.background.rainLength;
      rainUniforms.uWidth.value        = bg.rainWidth   ?? DEFAULT_SETTINGS.background.rainWidth;
      rainUniforms.uRainSpeed.value    = bg.rainSpeed   ?? DEFAULT_SETTINGS.background.rainSpeed;
      rainUniforms.uAngle.value        = bg.rainAngle   ?? DEFAULT_SETTINGS.background.rainAngle;
      rainUniforms.uBeat.value         = rainBeat;
      rainUniforms.uOpacity.value      = bg.rainOpacity ?? DEFAULT_SETTINGS.background.rainOpacity;
      rainUniforms.uColor.value.set(bg.rainColor ?? DEFAULT_SETTINGS.background.rainColor);
      rainUniforms.uResolution.value.set(width, height);
    }

    // ── Snow ──────────────────────────────────────────────────────────────────
    const snowEnabled = bg.snowEnabled ?? DEFAULT_SETTINGS.background.snowEnabled;
    const snowBehindLogo = bg.snowBehindLogo ?? DEFAULT_SETTINGS.background.snowBehindLogo;
    if (snowRef.current) {
      snowRef.current.visible = snowEnabled;
      snowRef.current.renderOrder = snowBehindLogo ? 4 : 9;
    }
    const snowBlend = (bg.snowBlendMode ?? DEFAULT_SETTINGS.background.snowBlendMode) as BlendMode;
    if (snowBlend !== prevSnowBlendRef.current) {
      applyBlendMode(snowMat, snowBlend);
      prevSnowBlendRef.current = snowBlend;
    }
    if (snowEnabled) {
      const snowBeat = snowPhaseSrc();

      const snowCount = Math.min(
        bg.snowCount ?? DEFAULT_SETTINGS.background.snowCount,
        MAX_SNOW,
      );
      snowGeo.setDrawRange(0, snowCount);

      snowUniforms.uTime.value         = timeRef.current;
      snowUniforms.uSize.value         = bg.snowSize  ?? DEFAULT_SETTINGS.background.snowSize;
      snowUniforms.uSnowSpeed.value    = bg.snowSpeed ?? DEFAULT_SETTINGS.background.snowSpeed;
      snowUniforms.uSway.value         = bg.snowSway  ?? DEFAULT_SETTINGS.background.snowSway;
      snowUniforms.uBeat.value         = snowBeat;
      snowUniforms.uOpacity.value      = bg.snowOpacity ?? DEFAULT_SETTINGS.background.snowOpacity;
      snowUniforms.uColor.value.set(bg.snowColor ?? DEFAULT_SETTINGS.background.snowColor);
      snowUniforms.uResolution.value.set(width, height);
    }
  });

  return (
    <group position={[0, 0, -9.5]}>
      <points ref={bgParticlesRef} renderOrder={1}>
        <primitive object={bgParticlesGeo} attach="geometry" />
        <primitive object={bgParticlesMat} attach="material" />
      </points>
      <points ref={rainRef} renderOrder={1}>
        <primitive object={rainGeo} attach="geometry" />
        <primitive object={rainMat} attach="material" />
      </points>
      <points ref={snowRef} renderOrder={1}>
        <primitive object={snowGeo} attach="geometry" />
        <primitive object={snowMat} attach="material" />
      </points>
    </group>
  );
}
