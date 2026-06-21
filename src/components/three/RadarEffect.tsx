/**
 * RadarEffect — R3F fullscreen-quad effect.
 * Animated radar sweep with concentric rings and spokes.
 * Beat-reactive via brightness boost (uBeatGlow).
 *
 * ANGLE note: all GLSL local variables/functions use `rd_` prefix.
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
uniform float uScale;
uniform float uRingCount;
uniform float uSpokeCount;
uniform float uRingThickness;
uniform float uSpokeThickness;
uniform float uSweepSpeed;
uniform float uSweepWidth;
uniform float uSweepLobes;
uniform vec3  uColor;
uniform float uFalloff;
uniform float uBrightness;
uniform float uBeatGlow;
uniform float uOpacity;

varying vec2 vUv;

#define RD_TAU 6.28318530718
#define RD_PI  3.14159265359

void main() {
  vec2 st = vUv;
  st = st * 2.0 - 1.0;
  st.x *= iResolution.x / iResolution.y;
  st *= uScale;

  float dist  = length(st);
  float theta = atan(st.y, st.x);
  float t     = uTime * uSpeed;

  float ringPhase = dist * uRingCount - t;
  float ringDist  = abs(fract(ringPhase) - 0.5);
  float ringGlow  = 1.0 - smoothstep(0.0, uRingThickness, ringDist);

  float spokeAngle = abs(fract(theta * uSpokeCount / RD_TAU + 0.5) - 0.5) * RD_TAU / uSpokeCount;
  float arcDist    = spokeAngle * dist;
  float spokeGlow  = (1.0 - smoothstep(0.0, uSpokeThickness, arcDist)) * smoothstep(0.0, 0.1, dist);

  float sweepPhase = t * uSweepSpeed;
  float sweepBeam  = pow(max(0.5 * sin(uSweepLobes * theta + sweepPhase) + 0.5, 0.0), uSweepWidth);

  float fade      = smoothstep(1.05, 0.85, dist) * pow(max(1.0 - dist, 0.0), uFalloff);
  float effectiveBrightness = uBrightness * (1.0 + uBeatGlow);
  float intensity = max((ringGlow + spokeGlow + sweepBeam) * fade * effectiveBrightness, 0.0);

  vec3  col   = uColor * intensity;
  float alpha = clamp(length(col), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function RadarEffect() {
  const meshRef      = useRef<THREE.Mesh>(null!);
  const matRef       = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);
  const timeRef      = useRef(0);

  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => ({
      startHz: getSettings().background.radarBeatFreqStart,
      endHz:   getSettings().background.radarBeatFreqEnd,
    }),
    liveFn: () => {
      const bg = getSettings().background;
      detector.setSensitivity(bg.radarBeatSensitivity ?? DEFAULT_SETTINGS.background.radarBeatSensitivity);
      return detector.update(
        audioAnalysis.rawFreqData,
        bg.radarBeatFreqStart ?? DEFAULT_SETTINGS.background.radarBeatFreqStart,
        bg.radarBeatFreqEnd   ?? DEFAULT_SETTINGS.background.radarBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(phaseSrc);
  phaseSrcRef.current = phaseSrc;

  const uniforms = useMemo(() => ({
    uTime:          { value: 0 },
    iResolution:    { value: new THREE.Vector2(1, 1) },
    uSpeed:         { value: DEFAULT_SETTINGS.background.radarSpeed },
    uScale:         { value: DEFAULT_SETTINGS.background.radarScale },
    uRingCount:     { value: DEFAULT_SETTINGS.background.radarRingCount },
    uSpokeCount:    { value: DEFAULT_SETTINGS.background.radarSpokeCount },
    uRingThickness: { value: DEFAULT_SETTINGS.background.radarRingThickness },
    uSpokeThickness:{ value: DEFAULT_SETTINGS.background.radarSpokeThickness },
    uSweepSpeed:    { value: DEFAULT_SETTINGS.background.radarSweepSpeed },
    uSweepWidth:    { value: DEFAULT_SETTINGS.background.radarSweepWidth },
    uSweepLobes:    { value: DEFAULT_SETTINGS.background.radarSweepLobes },
    uColor:         { value: new THREE.Color(DEFAULT_SETTINGS.background.radarColor) },
    uFalloff:       { value: DEFAULT_SETTINGS.background.radarFalloff },
    uBrightness:    { value: DEFAULT_SETTINGS.background.radarBrightness },
    uBeatGlow:      { value: 0 },
    uOpacity:       { value: DEFAULT_SETTINGS.background.radarOpacity },
  }), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const mat  = matRef.current;
    if (!mesh || !mat) return;

    const bg = getSettings().background;
    const D  = DEFAULT_SETTINGS.background;

    const blendMode = (bg.radarBlendMode ?? D.radarBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.radarEnabled ?? D.radarEnabled)) {
      mat.visible = false;
      timeRef.current += delta;
      return;
    }
    mat.visible = true;

    const { width, height } = state.size;
    mesh.scale.set(width, height, 1);

    const beat      = phaseSrcRef.current();
    const glowBoost = (bg.radarBeatGlowBoost ?? D.radarBeatGlowBoost) * beat;

    timeRef.current += delta;
    mat.uniforms.uTime.value = timeRef.current;
    mat.uniforms.iResolution.value.set(width, height);

    mat.uniforms.uSpeed.value          = bg.radarSpeed          ?? D.radarSpeed;
    mat.uniforms.uScale.value          = bg.radarScale          ?? D.radarScale;
    mat.uniforms.uRingCount.value      = bg.radarRingCount      ?? D.radarRingCount;
    mat.uniforms.uSpokeCount.value     = bg.radarSpokeCount     ?? D.radarSpokeCount;
    mat.uniforms.uRingThickness.value  = bg.radarRingThickness  ?? D.radarRingThickness;
    mat.uniforms.uSpokeThickness.value = bg.radarSpokeThickness ?? D.radarSpokeThickness;
    mat.uniforms.uSweepSpeed.value     = bg.radarSweepSpeed     ?? D.radarSweepSpeed;
    mat.uniforms.uSweepWidth.value     = bg.radarSweepWidth     ?? D.radarSweepWidth;
    mat.uniforms.uSweepLobes.value     = bg.radarSweepLobes     ?? D.radarSweepLobes;
    mat.uniforms.uColor.value.set(bg.radarColor ?? D.radarColor);
    mat.uniforms.uFalloff.value        = bg.radarFalloff        ?? D.radarFalloff;
    mat.uniforms.uBrightness.value     = bg.radarBrightness     ?? D.radarBrightness;
    mat.uniforms.uBeatGlow.value       = glowBoost;
    mat.uniforms.uOpacity.value        = bg.radarOpacity        ?? D.radarOpacity;

    const behindLogo = bg.radarBehindLogo ?? D.radarBehindLogo;
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
