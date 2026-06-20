/**
 * LightPillar — R3F fullscreen-quad effect (ported from standalone overlay).
 *
 * Renders an animated 3D light pillar using ray marching in GLSL.
 * Now part of the R3F scene graph so it appears in exported MP4s.
 *
 * ANGLE note: all GLSL local variables use `lp_` prefix.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
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

// NOTE: precision set via material's precision="highp" prop.
const FRAG = /* glsl */`
uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uTopColor;
uniform vec3  uBottomColor;
uniform float uIntensity;
uniform float uGlowAmount;
uniform float uPillarWidth;
uniform float uPillarHeight;
uniform float uNoiseIntensity;
uniform float uRotCos;
uniform float uRotSin;
uniform float uPillarRotCos;
uniform float uPillarRotSin;
uniform float uWaveSin;
uniform float uWaveCos;

varying vec2 vUv;

const float STEP_MULT = 1.0;
const int   MAX_ITER  = 80;
const int   WAVE_ITER = 4;

void main() {
  vec2 lp_uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
  lp_uv = vec2(
    uPillarRotCos * lp_uv.x - uPillarRotSin * lp_uv.y,
    uPillarRotSin * lp_uv.x + uPillarRotCos * lp_uv.y
  );

  vec3  lp_ro  = vec3(0.0, 0.0, -10.0);
  vec3  lp_rd  = normalize(vec3(lp_uv, 1.0));
  float lp_rotC = uRotCos;
  float lp_rotS = uRotSin;

  vec3  lp_col = vec3(0.0);
  float lp_t   = 0.1;

  for (int lp_i = 0; lp_i < MAX_ITER; lp_i++) {
    vec3 lp_p = lp_ro + lp_rd * lp_t;
    lp_p.xz = vec2(
      lp_rotC * lp_p.x - lp_rotS * lp_p.z,
      lp_rotS * lp_p.x + lp_rotC * lp_p.z
    );

    vec3  lp_q    = lp_p;
    lp_q.y        = lp_p.y * uPillarHeight + uTime;
    float lp_freq = 1.0;
    float lp_amp  = 1.0;

    for (int lp_j = 0; lp_j < WAVE_ITER; lp_j++) {
      lp_q.xz = vec2(
        uWaveCos * lp_q.x - uWaveSin * lp_q.z,
        uWaveSin * lp_q.x + uWaveCos * lp_q.z
      );
      lp_q += cos(lp_q.zxy * lp_freq - uTime * float(lp_j) * 2.0) * lp_amp;
      lp_freq *= 2.0;
      lp_amp  *= 0.5;
    }

    float lp_d     = length(cos(lp_q.xz)) - 0.2;
    float lp_bound = length(lp_p.xz) - uPillarWidth;
    float lp_k     = 4.0;
    float lp_h     = max(lp_k - abs(lp_d - lp_bound), 0.0);
    lp_d = max(lp_d, lp_bound) + lp_h * lp_h * 0.0625 / lp_k;
    lp_d = abs(lp_d) * 0.15 + 0.01;

    float lp_grad = clamp((15.0 - lp_p.y) / 30.0, 0.0, 1.0);
    lp_col += mix(uBottomColor, uTopColor, lp_grad) / lp_d;
    lp_t   += lp_d * STEP_MULT;
    if (lp_t > 50.0) break;
  }

  float lp_widthNorm = uPillarWidth / 3.0;
  lp_col = tanh(lp_col * uGlowAmount / lp_widthNorm);
  lp_col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;
  lp_col = max(lp_col, vec3(0.0));

  // Luminance-based alpha for transparent overlay (instead of always-opaque alpha=1)
  float lp_lum = max(max(lp_col.r, lp_col.g), lp_col.b);
  gl_FragColor = vec4(lp_col * uIntensity, clamp(lp_lum * 2.0, 0.0, 1.0));
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function parseColor(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LightPillar() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);

  const waveSin = useMemo(() => Math.sin(0.4), []);
  const waveCos = useMemo(() => Math.cos(0.4), []);

  const lightPillarBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(lightPillarBeatDetector);
  const lightPillarPhaseSrc = usePhaseSource({
    detector: lightPillarBeatDetector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.lightPillarBeatFreqStart ?? DEFAULT_SETTINGS.background.lightPillarBeatFreqStart,
        endHz:   bg.lightPillarBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightPillarBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      lightPillarBeatDetector.setSensitivity(
        bg.lightPillarBeatSensitivity ?? DEFAULT_SETTINGS.background.lightPillarBeatSensitivity,
      );
      return lightPillarBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.lightPillarBeatFreqStart ?? DEFAULT_SETTINGS.background.lightPillarBeatFreqStart,
        bg.lightPillarBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightPillarBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(lightPillarPhaseSrc);
  phaseSrcRef.current = lightPillarPhaseSrc;

  const timeRef = useRef(0);

  useFrame((state, delta) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const { width, height } = state.size;
    const bg = getSettings().background;

    mesh.scale.set(width, height, 1);

    const behindLogo = bg.lightPillarBehindLogo ?? DEFAULT_SETTINGS.background.lightPillarBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
    mesh.position.z = 0;

    if (!(bg.lightPillarEnabled ?? DEFAULT_SETTINGS.background.lightPillarEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const rotSpeed = bg.lightPillarRotationSpeed ?? DEFAULT_SETTINGS.background.lightPillarRotationSpeed;
    timeRef.current += delta * rotSpeed;
    const t = timeRef.current;

    mat.uniforms.uTime.value   = t;
    mat.uniforms.uRotCos.value = Math.cos(t * 0.3);
    mat.uniforms.uRotSin.value = Math.sin(t * 0.3);

    const pillarRot = ((bg.lightPillarRotation ?? DEFAULT_SETTINGS.background.lightPillarRotation) * Math.PI) / 180;
    mat.uniforms.uPillarRotCos.value = Math.cos(pillarRot);
    mat.uniforms.uPillarRotSin.value = Math.sin(pillarRot);

    const dpr = state.gl.getPixelRatio();
    mat.uniforms.uResolution.value.set(width * dpr, height * dpr);

    const beat           = phaseSrcRef.current();
    const intensityBoost = bg.lightPillarBeatIntensity  ?? DEFAULT_SETTINGS.background.lightPillarBeatIntensity;
    const widthBoost     = bg.lightPillarBeatWidthBoost ?? DEFAULT_SETTINGS.background.lightPillarBeatWidthBoost;
    const boost          = beat;

    const baseIntensity = bg.lightPillarIntensity ?? DEFAULT_SETTINGS.background.lightPillarIntensity;
    const baseWidth     = bg.lightPillarWidth     ?? DEFAULT_SETTINGS.background.lightPillarWidth;
    mat.uniforms.uIntensity.value   = baseIntensity * (1 + boost * intensityBoost);
    mat.uniforms.uPillarWidth.value = baseWidth     * (1 + boost * widthBoost);

    (mat.uniforms.uTopColor.value    as THREE.Vector3).copy(parseColor(bg.lightPillarTopColor    ?? DEFAULT_SETTINGS.background.lightPillarTopColor));
    (mat.uniforms.uBottomColor.value as THREE.Vector3).copy(parseColor(bg.lightPillarBottomColor ?? DEFAULT_SETTINGS.background.lightPillarBottomColor));
    mat.uniforms.uGlowAmount.value     = bg.lightPillarGlowAmount     ?? DEFAULT_SETTINGS.background.lightPillarGlowAmount;
    mat.uniforms.uPillarHeight.value   = bg.lightPillarHeight         ?? DEFAULT_SETTINGS.background.lightPillarHeight;
    mat.uniforms.uNoiseIntensity.value = bg.lightPillarNoiseIntensity ?? DEFAULT_SETTINGS.background.lightPillarNoiseIntensity;
  });

  return (
    <mesh ref={meshRef} renderOrder={9}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        precision="highp"
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uTime:           { value: 0 },
          uResolution:     { value: new THREE.Vector2(1, 1) },
          uTopColor:       { value: new THREE.Vector3(1, 1, 1) },
          uBottomColor:    { value: new THREE.Vector3(1, 1, 1) },
          uIntensity:      { value: DEFAULT_SETTINGS.background.lightPillarIntensity },
          uGlowAmount:     { value: DEFAULT_SETTINGS.background.lightPillarGlowAmount },
          uPillarWidth:    { value: DEFAULT_SETTINGS.background.lightPillarWidth },
          uPillarHeight:   { value: DEFAULT_SETTINGS.background.lightPillarHeight },
          uNoiseIntensity: { value: DEFAULT_SETTINGS.background.lightPillarNoiseIntensity },
          uRotCos:         { value: 1.0 },
          uRotSin:         { value: 0.0 },
          uPillarRotCos:   { value: 1.0 },
          uPillarRotSin:   { value: 0.0 },
          uWaveSin:        { value: waveSin },
          uWaveCos:        { value: waveCos },
        }}
      />
    </mesh>
  );
}
