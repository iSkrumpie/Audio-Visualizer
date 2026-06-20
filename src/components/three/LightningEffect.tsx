/**
 * LightningEffect — R3F fullscreen-quad effect.
 *
 * Renders a procedural electric lightning bolt using FBM noise distortion.
 * Ported from reactbits.dev/backgrounds/lightning into a Three.js ShaderMaterial.
 *
 * ANGLE note: all GLSL local variables use `ltg_` prefix.
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
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform vec2  uResolution;
uniform float uHue;
uniform float uXOffset;
uniform float uSpeed;
uniform float uIntensity;
uniform float uSize;
uniform float uOpacity;

// ── Color helpers ────────────────────────────────────────────────────────────

vec3 ltg_hsv2rgb(vec3 ltg_c) {
  vec3 ltg_rgb = clamp(
    abs(mod(ltg_c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
    0.0, 1.0
  );
  return ltg_c.z * mix(vec3(1.0), ltg_rgb, ltg_c.y);
}

// ── Hash functions ───────────────────────────────────────────────────────────

float ltg_hash11(float ltg_p) {
  ltg_p = fract(ltg_p * 0.1031);
  ltg_p *= ltg_p + 33.33;
  ltg_p *= ltg_p + ltg_p;
  return fract(ltg_p);
}

float ltg_hash12(vec2 ltg_p) {
  vec3 ltg_p3 = fract(vec3(ltg_p.xyx) * 0.1031);
  ltg_p3 += dot(ltg_p3, ltg_p3.yzx + 33.33);
  return fract((ltg_p3.x + ltg_p3.y) * ltg_p3.z);
}

// ── Rotation matrix ──────────────────────────────────────────────────────────

mat2 ltg_rotate2d(float ltg_theta) {
  float ltg_c = cos(ltg_theta);
  float ltg_s = sin(ltg_theta);
  return mat2(ltg_c, -ltg_s, ltg_s, ltg_c);
}

// ── Value noise ──────────────────────────────────────────────────────────────

float ltg_noise(vec2 ltg_p) {
  vec2 ltg_ip = floor(ltg_p);
  vec2 ltg_fp = fract(ltg_p);
  float ltg_a = ltg_hash12(ltg_ip);
  float ltg_b = ltg_hash12(ltg_ip + vec2(1.0, 0.0));
  float ltg_nc = ltg_hash12(ltg_ip + vec2(0.0, 1.0));
  float ltg_d = ltg_hash12(ltg_ip + vec2(1.0, 1.0));
  vec2 ltg_t = smoothstep(0.0, 1.0, ltg_fp);
  return mix(mix(ltg_a, ltg_b, ltg_t.x), mix(ltg_nc, ltg_d, ltg_t.x), ltg_t.y);
}

// ── Fractal Brownian Motion (10 octaves) ─────────────────────────────────────

float ltg_fbm(vec2 ltg_p) {
  float ltg_value = 0.0;
  float ltg_amp = 0.5;
  for (int ltg_i = 0; ltg_i < 10; ++ltg_i) {
    ltg_value += ltg_amp * ltg_noise(ltg_p);
    ltg_p *= ltg_rotate2d(0.45);
    ltg_p *= 2.0;
    ltg_amp *= 0.5;
  }
  return ltg_value;
}

// ── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 ltg_uv = gl_FragCoord.xy / uResolution.xy;
  ltg_uv = 2.0 * ltg_uv - 1.0;
  ltg_uv.x *= uResolution.x / uResolution.y;
  ltg_uv.x += uXOffset;
  ltg_uv += 2.0 * ltg_fbm(ltg_uv * uSize + 0.8 * uTime * uSpeed) - 1.0;

  float ltg_dist = abs(ltg_uv.x);
  vec3 ltg_baseColor = ltg_hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));
  vec3 ltg_col = ltg_baseColor
    * pow(mix(0.0, 0.07, ltg_hash11(uTime * uSpeed)) / ltg_dist, 1.0)
    * uIntensity;

  float ltg_a = clamp(max(ltg_col.r, max(ltg_col.g, ltg_col.b)), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(ltg_col, ltg_a);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LightningEffect() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);

  const lightningBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(lightningBeatDetector);

  const lightningPhaseSrc = usePhaseSource({
    detector: lightningBeatDetector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.lightningBeatFreqStart ?? DEFAULT_SETTINGS.background.lightningBeatFreqStart,
        endHz:   bg.lightningBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightningBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      lightningBeatDetector.setSensitivity(
        bg.lightningBeatSensitivity ?? DEFAULT_SETTINGS.background.lightningBeatSensitivity,
      );
      return lightningBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.lightningBeatFreqStart ?? DEFAULT_SETTINGS.background.lightningBeatFreqStart,
        bg.lightningBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightningBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(lightningPhaseSrc);
  phaseSrcRef.current = lightningPhaseSrc;

  const timeRef = useRef(0);

  const uniforms = useMemo(() => ({
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uHue:        { value: 230 },
    uXOffset:    { value: 0 },
    uSpeed:      { value: 1 },
    uIntensity:  { value: 1 },
    uSize:       { value: 1 },
    uOpacity:    { value: 0.9 },
  }), []);

  useFrame((state, delta) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const { width, height } = state.size;
    const bg = getSettings().background;

    const behindLogo = bg.lightningBehindLogo ?? DEFAULT_SETTINGS.background.lightningBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
    mesh.position.z = 0;

    const blendMode = (bg.lightningBlendMode ?? DEFAULT_SETTINGS.background.lightningBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.lightningEnabled ?? DEFAULT_SETTINGS.background.lightningEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const speed = bg.lightningSpeed ?? DEFAULT_SETTINGS.background.lightningSpeed;
    timeRef.current += delta * speed;

    const beat           = phaseSrcRef.current();
    const beatIntensity  = bg.lightningBeatIntensity  ?? DEFAULT_SETTINGS.background.lightningBeatIntensity;
    const beatScale      = bg.lightningBeatScale      ?? DEFAULT_SETTINGS.background.lightningBeatScale;

    const baseIntensity = bg.lightningIntensity ?? DEFAULT_SETTINGS.background.lightningIntensity;
    const scaleFactor   = 1 + beat * beatScale * 0.2;

    mesh.scale.set(width * scaleFactor, height * scaleFactor, 1);

    const dpr = state.gl.getPixelRatio();
    mat.uniforms.uResolution.value.set(width * dpr, height * dpr);
    mat.uniforms.uTime.value      = timeRef.current;
    mat.uniforms.uHue.value       = bg.lightningHue      ?? DEFAULT_SETTINGS.background.lightningHue;
    mat.uniforms.uXOffset.value   = bg.lightningXOffset  ?? DEFAULT_SETTINGS.background.lightningXOffset;
    mat.uniforms.uSpeed.value     = speed;
    mat.uniforms.uIntensity.value = baseIntensity * (1 + beat * beatIntensity);
    mat.uniforms.uSize.value      = bg.lightningSize    ?? DEFAULT_SETTINGS.background.lightningSize;
    mat.uniforms.uOpacity.value   = bg.lightningOpacity ?? DEFAULT_SETTINGS.background.lightningOpacity;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent={true}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
      />
    </mesh>
  );
}
