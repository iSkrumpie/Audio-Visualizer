/**
 * LineWavesEffect — R3F fullscreen-quad effect.
 * Animated warped line pattern that fills the background.
 * Beat-reactive via brightness boost (uBeatGlow).
 *
 * ANGLE note: all GLSL local variables/functions use `lw_` prefix.
 */

import { useRef, useMemo } from 'react';
import { useFrame }        from '@react-three/fiber';
import * as THREE          from 'three';
import { audioAnalysis }   from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import type { BlendMode }  from '@/lib/settingsStore';
import { applyBlendMode }  from '@/lib/blendMode';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource }  from '@/hooks/usePhaseSource';

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

uniform float uTime;
uniform vec2  iResolution;
uniform float uSpeed;
uniform float uInnerLines;
uniform float uOuterLines;
uniform float uWarpIntensity;
uniform float uRotation;
uniform float uEdgeFadeWidth;
uniform float uColorCycleSpeed;
uniform float uBrightness;
uniform float uBeatGlow;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform float uOpacity;

varying vec2 vUv;

#define LW_HALF_PI 1.5707963

float lw_hashF(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float lw_smoothNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(lw_hashF(i), lw_hashF(i + 1.0), u);
}

float lw_displaceA(float coord, float t) {
  float result = sin(coord * 2.123) * 0.2;
  result += sin(coord * 3.234 + t * 4.345) * 0.1;
  result += sin(coord * 0.589 + t * 0.934) * 0.5;
  return result;
}

float lw_displaceB(float coord, float t) {
  float result = sin(coord * 1.345) * 0.3;
  result += sin(coord * 2.734 + t * 3.345) * 0.2;
  result += sin(coord * 0.189 + t * 0.934) * 0.3;
  return result;
}

vec2 lw_rotate2D(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 coords = vUv;
  coords = coords * 2.0 - 1.0;
  coords.x *= iResolution.x / iResolution.y;
  coords = lw_rotate2D(coords, uRotation);

  float halfT = uTime * uSpeed * 0.5;
  float fullT = uTime * uSpeed;

  float warpAx = coords.x + lw_displaceA(coords.y, halfT) * uWarpIntensity;
  float warpAy = coords.y - lw_displaceA(coords.x * cos(fullT) * 1.235, halfT) * uWarpIntensity;
  float warpBx = coords.x + lw_displaceB(coords.y, halfT) * uWarpIntensity;
  float warpBy = coords.y - lw_displaceB(coords.x * sin(fullT) * 1.235, halfT) * uWarpIntensity;

  vec2 fieldA  = vec2(warpAx, warpAy);
  vec2 fieldB  = vec2(warpBx, warpBy);
  vec2 blended = mix(fieldA, fieldB, 0.5);

  float fadeTop    = smoothstep(uEdgeFadeWidth, uEdgeFadeWidth + 0.4, blended.y);
  float fadeBottom = smoothstep(-uEdgeFadeWidth, -(uEdgeFadeWidth + 0.4), blended.y);
  float vMask      = 1.0 - max(fadeTop, fadeBottom);

  float tileCount = mix(uOuterLines, uInnerLines, vMask);
  float scaledY   = blended.y * tileCount;
  float nY        = lw_smoothNoise(abs(scaledY));
  float ridge     = pow(
    step(abs(nY - blended.x) * 2.0, LW_HALF_PI) * cos(2.0 * (nY - blended.x)),
    5.0
  );

  float lines = 0.0;
  for (float i = 1.0; i < 3.0; i += 1.0) {
    lines += pow(max(fract(scaledY), fract(-scaledY)), i * 2.0);
  }

  float pattern = vMask * lines;
  float cycleT  = fullT * uColorCycleSpeed;
  float rCh = (pattern + lines * ridge) * (cos(blended.y + cycleT * 0.234) * 0.5 + 1.0);
  float gCh = (pattern + vMask  * ridge) * (sin(blended.x + cycleT * 1.745) * 0.5 + 1.0);
  float bCh = (pattern + lines * ridge) * (cos(blended.x + cycleT * 0.534) * 0.5 + 1.0);

  float effectiveBrightness = uBrightness * (1.0 + uBeatGlow);
  vec3 col   = (rCh * uColor1 + gCh * uColor2 + bCh * uColor3) * effectiveBrightness;
  float alpha = clamp(length(col), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LineWavesEffect() {
  const meshRef      = useRef<THREE.Mesh>(null!);
  const matRef       = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);
  const timeRef      = useRef(0);

  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => ({
      startHz: getSettings().background.lineWavesBeatFreqStart,
      endHz:   getSettings().background.lineWavesBeatFreqEnd,
    }),
    liveFn: () => {
      const bg = getSettings().background;
      detector.setSensitivity(bg.lineWavesBeatSensitivity ?? DEFAULT_SETTINGS.background.lineWavesBeatSensitivity);
      return detector.update(
        audioAnalysis.rawFreqData,
        bg.lineWavesBeatFreqStart ?? DEFAULT_SETTINGS.background.lineWavesBeatFreqStart,
        bg.lineWavesBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lineWavesBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(phaseSrc);
  phaseSrcRef.current = phaseSrc;

  const uniforms = useMemo(() => ({
    uTime:            { value: 0 },
    iResolution:      { value: new THREE.Vector2(1, 1) },
    uSpeed:           { value: DEFAULT_SETTINGS.background.lineWavesSpeed },
    uInnerLines:      { value: DEFAULT_SETTINGS.background.lineWavesInnerLines },
    uOuterLines:      { value: DEFAULT_SETTINGS.background.lineWavesOuterLines },
    uWarpIntensity:   { value: DEFAULT_SETTINGS.background.lineWavesWarpIntensity },
    uRotation:        { value: (DEFAULT_SETTINGS.background.lineWavesRotation * Math.PI) / 180 },
    uEdgeFadeWidth:   { value: DEFAULT_SETTINGS.background.lineWavesEdgeFadeWidth },
    uColorCycleSpeed: { value: DEFAULT_SETTINGS.background.lineWavesColorCycleSpeed },
    uBrightness:      { value: DEFAULT_SETTINGS.background.lineWavesBrightness },
    uBeatGlow:        { value: 0 },
    uColor1:          { value: new THREE.Color(DEFAULT_SETTINGS.background.lineWavesColor1) },
    uColor2:          { value: new THREE.Color(DEFAULT_SETTINGS.background.lineWavesColor2) },
    uColor3:          { value: new THREE.Color(DEFAULT_SETTINGS.background.lineWavesColor3) },
    uOpacity:         { value: DEFAULT_SETTINGS.background.lineWavesOpacity },
  }), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const mat  = matRef.current;
    if (!mesh || !mat) return;

    const bg = getSettings().background;
    const D  = DEFAULT_SETTINGS.background;

    const blendMode = (bg.lineWavesBlendMode ?? D.lineWavesBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.lineWavesEnabled ?? D.lineWavesEnabled)) {
      mat.visible = false;
      timeRef.current += delta; // keep time running so no jump on re-enable
      return;
    }
    mat.visible = true;

    const { width, height } = state.size;
    mesh.scale.set(width, height, 1);

    const beat      = phaseSrcRef.current();
    const glowBoost = (bg.lineWavesBeatGlowBoost ?? D.lineWavesBeatGlowBoost) * beat;

    timeRef.current += delta;
    mat.uniforms.uTime.value = timeRef.current;
    mat.uniforms.iResolution.value.set(width, height);

    mat.uniforms.uSpeed.value          = bg.lineWavesSpeed          ?? D.lineWavesSpeed;
    mat.uniforms.uInnerLines.value     = bg.lineWavesInnerLines      ?? D.lineWavesInnerLines;
    mat.uniforms.uOuterLines.value     = bg.lineWavesOuterLines      ?? D.lineWavesOuterLines;
    mat.uniforms.uWarpIntensity.value  = bg.lineWavesWarpIntensity   ?? D.lineWavesWarpIntensity;
    mat.uniforms.uRotation.value       = ((bg.lineWavesRotation      ?? D.lineWavesRotation) * Math.PI) / 180;
    mat.uniforms.uEdgeFadeWidth.value  = bg.lineWavesEdgeFadeWidth   ?? D.lineWavesEdgeFadeWidth;
    mat.uniforms.uColorCycleSpeed.value = bg.lineWavesColorCycleSpeed ?? D.lineWavesColorCycleSpeed;
    mat.uniforms.uBrightness.value     = bg.lineWavesBrightness      ?? D.lineWavesBrightness;
    mat.uniforms.uBeatGlow.value       = glowBoost;
    mat.uniforms.uColor1.value.set(bg.lineWavesColor1 ?? D.lineWavesColor1);
    mat.uniforms.uColor2.value.set(bg.lineWavesColor2 ?? D.lineWavesColor2);
    mat.uniforms.uColor3.value.set(bg.lineWavesColor3 ?? D.lineWavesColor3);
    mat.uniforms.uOpacity.value        = bg.lineWavesOpacity         ?? D.lineWavesOpacity;

    const behindLogo = bg.lineWavesBehindLogo ?? D.lineWavesBehindLogo;
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
