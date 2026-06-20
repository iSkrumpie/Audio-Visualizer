/**
 * Strands — R3F fullscreen-quad effect (ported from standalone ogl overlay).
 *
 * Animated ribbon/aurora effect. Now part of the R3F scene graph so it
 * appears in exported MP4s.
 *
 * Shader prefix rule: all local GLSL variables use `str_` prefix.
 * See AGENTS.md §6 (ANGLE/Windows GLSL-Prefix-Regel).
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

// ─── Shader constants ─────────────────────────────────────────────────────────

const MAX_STRANDS = 12;
const MAX_COLORS  = 8;

// ─── Vertex shader ────────────────────────────────────────────────────────────

const VERT = /* glsl */`
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// Converted from GLSL ES 3.0 to GLSL ES 1.0 for Three.js ShaderMaterial.
// ALL local variables carry the `str_` prefix (ANGLE Windows rule).

const FRAG = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uColors[${MAX_COLORS}];
uniform int   uColorCount;
uniform int   uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

const float str_PI = 3.14159265;

// Full-spectrum rainbow fallback (no user palette)
vec3 str_spectrum(float str_t) {
  return 0.5 + 0.5 * cos(2.0 * str_PI * (str_t + vec3(0.00, 0.33, 0.67)));
}

// Smooth circular palette from user-supplied color array
vec3 str_samplePalette(float str_tp) {
  str_tp = fract(str_tp);
  float str_scaled  = str_tp * float(uColorCount);
  int   str_idx     = int(floor(str_scaled));
  float str_blend   = fract(str_scaled);
  int   str_nextIdx = str_idx + 1;
  if (str_nextIdx >= uColorCount) str_nextIdx = 0;
  return mix(uColors[str_idx], uColors[str_nextIdx], str_blend);
}

vec3 str_strandColor(float str_tc) {
  if (uColorCount > 0) return str_samplePalette(str_tc);
  return str_spectrum(str_tc);
}

void main() {
  // Map fragment coordinate to screen-centered, aspect-correct UV
  vec2  str_uv  = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  str_uv /= max(uScale, 0.0001);

  float str_e   = 0.06 + uIntensity * 0.94;

  // Aspect-ratio-aware edge envelope computed on the RAW (un-scaled) UV
  vec2  str_uvRaw = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float str_aspect = uResolution.x / max(uResolution.y, 1.0);
  float str_envArg = (str_uvRaw.x / max(str_aspect * 0.5, 0.001)) * (str_PI * 0.5);
  float str_env    = pow(max(cos(str_envArg), 0.0), max(uTaper, 0.0));

  vec3 str_col = vec3(0.0);

  for (int str_i = 0; str_i < ${MAX_STRANDS}; str_i++) {
    if (str_i >= uStrandCount) break;

    float str_fi   = float(str_i);
    float str_ph   = str_fi * 1.7 * uSpread;
    float str_freq = (2.0 + str_fi * 0.35) * uWaviness;
    float str_spd  = 1.4 + str_fi * 1.2;

    float str_tt = uTime * uSpeed;

    // Two-harmonic wave for natural, non-repeating motion
    float str_w  = sin(str_uv.x * str_freq + str_tt * str_spd + str_ph) * 0.60
                 + sin(str_uv.x * str_freq * 1.1 - str_tt * str_spd * 0.7 + str_ph * 1.7) * 0.40;

    float str_amp   = (0.1 + 0.02 * str_e) * str_env * uAmplitude;
    float str_y     = str_w * str_amp;

    float str_d     = abs(str_uv.y - str_y);
    float str_thick = (0.001 + 0.05 * str_e) * (0.35 + str_env) * uThickness;
    float str_g     = str_thick / (str_d + str_thick * 0.45);
    str_g           = str_g * str_g;

    // Per-strand hue: index offset + horizontal drift + slow time shift
    float str_h = str_fi / float(uStrandCount) + str_uv.x * 0.30 + uTime * 0.04 + uHueShift;
    str_col += str_strandColor(str_h) * str_g * str_env;
  }

  str_col *= 0.45 + 0.7 * str_e;
  // Filmic exposure / glow tone-mapping
  str_col  = 1.0 - exp(-str_col * uGlow);

  // Saturation
  float str_gray = dot(str_col, vec3(0.2126, 0.7152, 0.0722));
  str_col = max(mix(vec3(str_gray), str_col, uSaturation), 0.0);

  // Alpha driven by luminance so dark areas are transparent
  float str_lum   = max(max(str_col.r, str_col.g), str_col.b);
  float str_alpha = clamp(str_lum, 0.0, 1.0) * uOpacity;

  gl_FragColor = vec4(str_col * uOpacity, str_alpha);
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert an array of CSS hex colors to a padded THREE.Vector3[] for
 * Three.js ShaderMaterial (uniform vec3[]).
 */
function buildPalette(colors: string[]): THREE.Vector3[] {
  const filled = colors.length ? colors : ['#ffffff'];
  return Array.from({ length: MAX_COLORS }, (_, i) => {
    const hex = filled[i] ?? filled[filled.length - 1];
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Strands() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);

  const strandsBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(strandsBeatDetector);

  const prevBlendRef = useRef<BlendMode | null>(null);

  const strandsPhaseSrc = usePhaseSource({
    detector: strandsBeatDetector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.strandsBeatFreqStart ?? DEFAULT_SETTINGS.background.strandsBeatFreqStart,
        endHz:   bg.strandsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.strandsBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      strandsBeatDetector.setSensitivity(
        bg.strandsBeatSensitivity ?? DEFAULT_SETTINGS.background.strandsBeatSensitivity,
      );
      return strandsBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.strandsBeatFreqStart ?? DEFAULT_SETTINGS.background.strandsBeatFreqStart,
        bg.strandsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.strandsBeatFreqEnd,
      );
    },
  });

  const phaseSrcRef = useRef(strandsPhaseSrc);
  phaseSrcRef.current = strandsPhaseSrc;

  const startTimeRef = useRef(performance.now());

  useFrame((state) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const { width, height } = state.size;
    const bg = getSettings().background;

    mesh.scale.set(width, height, 1);

    const behindLogo = bg.strandsBehindLogo ?? DEFAULT_SETTINGS.background.strandsBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
    mesh.position.z = 0;

    const blendMode = (bg.strandsBlendMode ?? DEFAULT_SETTINGS.background.strandsBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.strandsEnabled ?? DEFAULT_SETTINGS.background.strandsEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    mat.uniforms.uTime.value = elapsed;

    // Resolution in physical pixels
    const dpr = state.gl.getPixelRatio();
    mat.uniforms.uResolution.value.set(width * dpr, height * dpr);

    // Beat reactivity
    const beat        = phaseSrcRef.current();
    const sensitivity = bg.strandsBeatSensitivity ?? DEFAULT_SETTINGS.background.strandsBeatSensitivity;
    const boost       = sensitivity > 0 ? sensitivity * beat : 0;

    const baseAmp   = bg.strandsAmplitude ?? DEFAULT_SETTINGS.background.strandsAmplitude;
    const baseGlow  = bg.strandsGlow      ?? DEFAULT_SETTINGS.background.strandsGlow;
    const glowBoost = bg.strandsGlowBoost ?? DEFAULT_SETTINGS.background.strandsGlowBoost;
    mat.uniforms.uAmplitude.value = baseAmp  * (1 + boost * 0.4);
    mat.uniforms.uGlow.value      = baseGlow * (1 + boost * glowBoost);

    // Colors — mutate existing Vector3 objects, do NOT replace the array
    const colors = bg.strandsColors ?? DEFAULT_SETTINGS.background.strandsColors;
    const palette = buildPalette(colors);
    for (let i = 0; i < MAX_COLORS; i++) {
      (mat.uniforms.uColors.value as THREE.Vector3[])[i].set(palette[i].x, palette[i].y, palette[i].z);
    }
    mat.uniforms.uColorCount.value  = Math.min(colors.length, MAX_COLORS);
    mat.uniforms.uStrandCount.value = Math.min(bg.strandsCount ?? DEFAULT_SETTINGS.background.strandsCount, MAX_STRANDS);
    mat.uniforms.uSpeed.value       = bg.strandsSpeed      ?? DEFAULT_SETTINGS.background.strandsSpeed;
    mat.uniforms.uWaviness.value    = bg.strandsWaviness   ?? DEFAULT_SETTINGS.background.strandsWaviness;
    mat.uniforms.uThickness.value   = bg.strandsThickness  ?? DEFAULT_SETTINGS.background.strandsThickness;
    mat.uniforms.uTaper.value       = bg.strandsTaper      ?? DEFAULT_SETTINGS.background.strandsTaper;
    mat.uniforms.uSpread.value      = bg.strandsSpread     ?? DEFAULT_SETTINGS.background.strandsSpread;
    mat.uniforms.uHueShift.value    = bg.strandsHueShift   ?? DEFAULT_SETTINGS.background.strandsHueShift;
    mat.uniforms.uIntensity.value   = bg.strandsIntensity  ?? DEFAULT_SETTINGS.background.strandsIntensity;
    mat.uniforms.uOpacity.value     = bg.strandsOpacity    ?? DEFAULT_SETTINGS.background.strandsOpacity;
    mat.uniforms.uScale.value       = bg.strandsScale      ?? DEFAULT_SETTINGS.background.strandsScale;
    mat.uniforms.uSaturation.value  = bg.strandsSaturation ?? DEFAULT_SETTINGS.background.strandsSaturation;
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uTime:        { value: 0 },
          uResolution:  { value: new THREE.Vector2(1, 1) },
          uColors:      { value: Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(1, 1, 1)) },
          uColorCount:  { value: DEFAULT_SETTINGS.background.strandsColors.length },
          uStrandCount: { value: DEFAULT_SETTINGS.background.strandsCount },
          uSpeed:       { value: DEFAULT_SETTINGS.background.strandsSpeed },
          uAmplitude:   { value: DEFAULT_SETTINGS.background.strandsAmplitude },
          uWaviness:    { value: DEFAULT_SETTINGS.background.strandsWaviness },
          uThickness:   { value: DEFAULT_SETTINGS.background.strandsThickness },
          uGlow:        { value: DEFAULT_SETTINGS.background.strandsGlow },
          uTaper:       { value: DEFAULT_SETTINGS.background.strandsTaper },
          uSpread:      { value: DEFAULT_SETTINGS.background.strandsSpread },
          uHueShift:    { value: DEFAULT_SETTINGS.background.strandsHueShift },
          uIntensity:   { value: DEFAULT_SETTINGS.background.strandsIntensity },
          uOpacity:     { value: DEFAULT_SETTINGS.background.strandsOpacity },
          uScale:       { value: DEFAULT_SETTINGS.background.strandsScale },
          uSaturation:  { value: DEFAULT_SETTINGS.background.strandsSaturation },
        }}
      />
    </mesh>
  );
}
