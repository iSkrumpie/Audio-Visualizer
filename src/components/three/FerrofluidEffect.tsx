/**
 * FerrofluidEffect — R3F fullscreen-quad effect.
 *
 * Renders an animated liquid-metal ferrofluid spike effect using
 * domain-distorted value noise merged with smooth-min blending.
 * Three-colour palette, beat-reactive glow and speed burst.
 *
 * ANGLE note: all GLSL local variables use `ff_` prefix.
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

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform vec3  iResolution;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform int   uColorCount;
uniform vec2  uFlow;

uniform float uSpeed;
uniform float uScale;
uniform float uTurbulence;
uniform float uFluidity;
uniform float uRimWidth;
uniform float uSharpness;
uniform float uShimmer;
uniform float uGlow;
uniform float uOpacity;

varying vec2 vUv;

#define PI 3.14159265

vec3 ff_palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  return uColor2;
}

float ff_hash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float ff_smin(float a, float b, float k) {
  float r = exp2(-a / k) + exp2(-b / k);
  return -k * log2(r);
}

float ff_sinlerp(float a, float b, float w) {
  return mix(a, b, (sin(w * PI - PI / 2.0) + 1.0) / 2.0);
}

float ff_vn(vec2 p, float s, float seed) {
  vec2 cellp = floor(p / s);
  vec2 relp  = mod(p, s);
  float g1 = ff_hash(vec3(cellp, seed));
  float g2 = ff_hash(vec3(cellp.x + 1.0, cellp.y, seed));
  float g3 = ff_hash(vec3(cellp.x + 1.0, cellp.y + 1.0, seed));
  float g4 = ff_hash(vec3(cellp.x, cellp.y + 1.0, seed));
  float bx = ff_sinlerp(g1, g2, relp.x / s);
  float tx = ff_sinlerp(g4, g3, relp.x / s);
  return ff_sinlerp(bx, tx, relp.y / s);
}

float ff_dbn(vec2 p, float s, float seed) {
  float o  = s / 2.0;
  float n0 = ff_vn(p,                s, seed);
  float n1 = ff_vn(p + vec2( o,  o), s, seed + 0.1);
  float n2 = ff_vn(p + vec2(-o,  o), s, seed + 0.2);
  float n3 = ff_vn(p + vec2( o, -o), s, seed + 0.3);
  float n4 = ff_vn(p + vec2(-o, -o), s, seed + 0.4);
  return (2.0*n0 + 1.5*n1 + 1.25*n2 + 1.125*n3 + n4) / 7.0;
}

void ff_mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float ref  = 700.0 / max(uScale, 0.05);
  vec2  p    = fragCoord / iResolution.y * ref;
  float spd  = 200.0 * uSpeed;
  vec2  dir  = uFlow;
  vec2  perp = vec2(-dir.y, dir.x);

  float distort1 = ff_vn(p + perp * (iTime * spd), 60.0, 10.0) * 50.0 * uTurbulence;
  float distort2 = ff_vn(p - perp * (iTime * spd), 120.0, 15.0) * 100.0 * uTurbulence;

  float peaks  = ff_dbn(p + distort1 + dir * (iTime * spd * 0.5), 40.0, 1.0);
  float peaks2 = ff_dbn(p + distort2 - dir * (iTime * spd * 0.5), 40.0, 0.0);

  float mapeaks = ff_smin(peaks, peaks2, max(uFluidity, 0.001));

  float band = (uRimWidth - abs((mapeaks - 0.4) * 2.0)) * 5.0;
  float ltn  = clamp(band - ff_vn(p + dir * (iTime * spd * 0.5), 60.0, 12.0) * uShimmer, 0.0, 1.0);
  ltn = pow(ltn, uSharpness) * uGlow;

  float h   = clamp(0.5 + (peaks - peaks2) * 0.8, 0.0, 1.0);
  vec3  col = ff_palette(h);
  vec3  outc = col * ltn;

  float a = clamp(max(outc.r, max(outc.g, outc.b)), 0.0, 1.0);
  fragColor = vec4(outc, a * uOpacity);
}

void main() {
  vec4 color;
  ff_mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const FLOW_MAP: Record<string, [number, number]> = {
  up:    [0,  1],
  down:  [0, -1],
  left:  [-1, 0],
  right: [1,  0],
};

export function FerrofluidEffect() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);
  const timeRef = useRef(0);

  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => ({
      startHz: getSettings().background.ferrofluidBeatFreqStart,
      endHz:   getSettings().background.ferrofluidBeatFreqEnd,
    }),
    liveFn: () => {
      detector.setSensitivity(getSettings().background.ferrofluidBeatSensitivity);
      return detector.update(
        audioAnalysis.rawFreqData,
        getSettings().background.ferrofluidBeatFreqStart,
        getSettings().background.ferrofluidBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(phaseSrc);
  phaseSrcRef.current = phaseSrc;

  const uniforms = useMemo(() => ({
    iResolution: { value: new THREE.Vector3(1, 1, 1) },
    iTime:       { value: 0 },
    uColor0:     { value: new THREE.Color(DEFAULT_SETTINGS.background.ferrofluidColor0) },
    uColor1:     { value: new THREE.Color(DEFAULT_SETTINGS.background.ferrofluidColor1) },
    uColor2:     { value: new THREE.Color(DEFAULT_SETTINGS.background.ferrofluidColor2) },
    uColorCount: { value: 3 },
    uFlow:       { value: new THREE.Vector2(0, -1) },
    uSpeed:      { value: DEFAULT_SETTINGS.background.ferrofluidSpeed },
    uScale:      { value: DEFAULT_SETTINGS.background.ferrofluidScale },
    uTurbulence: { value: DEFAULT_SETTINGS.background.ferrofluidTurbulence },
    uFluidity:   { value: DEFAULT_SETTINGS.background.ferrofluidFluidity },
    uRimWidth:   { value: DEFAULT_SETTINGS.background.ferrofluidRimWidth },
    uSharpness:  { value: DEFAULT_SETTINGS.background.ferrofluidSharpness },
    uShimmer:    { value: DEFAULT_SETTINGS.background.ferrofluidShimmer },
    uGlow:       { value: DEFAULT_SETTINGS.background.ferrofluidGlow },
    uOpacity:    { value: DEFAULT_SETTINGS.background.ferrofluidOpacity },
  }), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const mat  = matRef.current;
    if (!mesh || !mat) return;

    const bg = getSettings().background;

    const blendMode = (bg.ferrofluidBlendMode ?? DEFAULT_SETTINGS.background.ferrofluidBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.ferrofluidEnabled ?? DEFAULT_SETTINGS.background.ferrofluidEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const { width, height } = state.size;
    mesh.scale.set(width, height, 1);

    const beat      = phaseSrcRef.current();
    const boost     = bg.ferrofluidGlowBoost     ?? DEFAULT_SETTINGS.background.ferrofluidGlowBoost;
    const baseGlow  = bg.ferrofluidGlow           ?? DEFAULT_SETTINGS.background.ferrofluidGlow;
    const baseSpeed = bg.ferrofluidSpeed          ?? DEFAULT_SETTINGS.background.ferrofluidSpeed;

    timeRef.current += delta;
    mat.uniforms.iTime.value = timeRef.current;
    mat.uniforms.iResolution.value.set(width, height, 1);

    mat.uniforms.uColor0.value.set(bg.ferrofluidColor0 ?? DEFAULT_SETTINGS.background.ferrofluidColor0);
    mat.uniforms.uColor1.value.set(bg.ferrofluidColor1 ?? DEFAULT_SETTINGS.background.ferrofluidColor1);
    mat.uniforms.uColor2.value.set(bg.ferrofluidColor2 ?? DEFAULT_SETTINGS.background.ferrofluidColor2);

    const flowDir = bg.ferrofluidFlowDirection ?? DEFAULT_SETTINGS.background.ferrofluidFlowDirection;
    const [fx, fy] = FLOW_MAP[flowDir] ?? [0, -1];
    mat.uniforms.uFlow.value.set(fx, fy);

    mat.uniforms.uGlow.value       = baseGlow  * (1 + beat * boost);
    mat.uniforms.uSpeed.value      = baseSpeed * (1 + beat * 0.5);
    mat.uniforms.uScale.value      = bg.ferrofluidScale       ?? DEFAULT_SETTINGS.background.ferrofluidScale;
    mat.uniforms.uTurbulence.value = bg.ferrofluidTurbulence  ?? DEFAULT_SETTINGS.background.ferrofluidTurbulence;
    mat.uniforms.uFluidity.value   = bg.ferrofluidFluidity    ?? DEFAULT_SETTINGS.background.ferrofluidFluidity;
    mat.uniforms.uRimWidth.value   = bg.ferrofluidRimWidth    ?? DEFAULT_SETTINGS.background.ferrofluidRimWidth;
    mat.uniforms.uSharpness.value  = bg.ferrofluidSharpness   ?? DEFAULT_SETTINGS.background.ferrofluidSharpness;
    mat.uniforms.uShimmer.value    = bg.ferrofluidShimmer     ?? DEFAULT_SETTINGS.background.ferrofluidShimmer;
    mat.uniforms.uOpacity.value    = bg.ferrofluidOpacity     ?? DEFAULT_SETTINGS.background.ferrofluidOpacity;

    // Behind logo / renderOrder — set only in useFrame, never in JSX
    const behindLogo = bg.ferrofluidBehindLogo ?? DEFAULT_SETTINGS.background.ferrofluidBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}
