/**
 * MagicRings — concentric rings expanding from center, beat-reactive burst.
 *
 * Z-position: -9.0   renderOrder: 2
 * Full-screen PlaneGeometry(2,2) + ShaderMaterial (AdditiveBlending, transparent).
 *
 * ANGLE note: all GLSL local variables use `mr_` prefix for WebGL compatibility.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

// ─── Shaders ─────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */`
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */`
precision highp float;

uniform float uTime;
uniform float uAttenuation;
uniform float uLineThickness;
uniform float uBaseRadius;
uniform float uRadiusStep;
uniform float uScaleRate;
uniform float uOpacity;
uniform float uNoiseAmount;
uniform float uRotation;
uniform float uRingGap;
uniform float uFadeIn;
uniform float uFadeOut;
uniform float uBurst;
uniform vec2  uResolution;
uniform vec3  uColor;
uniform vec3  uColorTwo;
uniform int   uRingCount;

const float MR_HP    = 1.5707963;
const float MR_CYCLE = 3.45;

float mr_fade(float mr_t) {
  return mr_t < uFadeIn
    ? smoothstep(0.0, uFadeIn, mr_t)
    : 1.0 - smoothstep(uFadeOut, MR_CYCLE - 0.2, mr_t);
}

float mr_ring(vec2 mr_p, float mr_ri, float mr_cut, float mr_t0, float mr_px) {
  float mr_t  = mod(uTime + mr_t0, MR_CYCLE);
  float mr_r  = mr_ri + mr_t / MR_CYCLE * uScaleRate;
  float mr_d  = abs(length(mr_p) - mr_r);
  float mr_a  = atan(abs(mr_p.y), abs(mr_p.x)) / MR_HP;
  float mr_th = max(1.0 - mr_a, 0.5) * mr_px * uLineThickness;
  float mr_h  = (1.0 - smoothstep(mr_th, mr_th * 1.5, mr_d)) + 1.0;
  mr_d += pow(mr_cut * mr_a, 3.0) * mr_r;
  return mr_h * exp(-uAttenuation * mr_d) * mr_fade(mr_t);
}

void main() {
  float mr_px  = 1.0 / min(uResolution.x, uResolution.y);
  vec2  mr_p   = (gl_FragCoord.xy - 0.5 * uResolution.xy) * mr_px;
  float mr_cr  = cos(uRotation);
  float mr_sr  = sin(uRotation);
  mr_p = mat2(mr_cr, -mr_sr, mr_sr, mr_cr) * mr_p;

  float mr_sc = 1.0 + uBurst * 0.3;
  mr_p /= mr_sc;

  vec3  mr_c   = vec3(0.0);
  float mr_rcf = max(float(uRingCount) - 1.0, 1.0);

  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float mr_fi = float(i);
    vec3  mr_rc = mix(uColor, uColorTwo, mr_fi / mr_rcf);
    mr_c = mix(mr_c, mr_rc, vec3(
      mr_ring(mr_p, uBaseRadius + mr_fi * uRadiusStep,
              pow(uRingGap, mr_fi),
              mr_fi == 0.0 ? 0.0 : 2.95 * mr_fi,
              mr_px)
    ));
  }

  mr_c *= 1.0 + uBurst * 2.0;

  float mr_n = fract(
    sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453
  );
  mr_c += (mr_n - 0.5) * uNoiseAmount;

  gl_FragColor = vec4(mr_c, max(mr_c.r, max(mr_c.g, mr_c.b)) * uOpacity);
}
`;

// ─── Component ───────────────────────────────────────────────────────────────

export function MagicRings() {
  const matRef  = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef<number>(0);

  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.magicRingsBeatFreqStart ?? DEFAULT_SETTINGS.background.magicRingsBeatFreqStart,
        endHz:   bg.magicRingsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.magicRingsBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      detector.setSensitivity(bg.magicRingsBeatSensitivity ?? DEFAULT_SETTINGS.background.magicRingsBeatSensitivity);
      return detector.update(
        audioAnalysis.rawFreqData,
        bg.magicRingsBeatFreqStart ?? DEFAULT_SETTINGS.background.magicRingsBeatFreqStart,
        bg.magicRingsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.magicRingsBeatFreqEnd,
      );
    },
  });

  const uniforms = useMemo(() => ({
    uTime:          { value: 0 },
    uAttenuation:   { value: 10 },
    uLineThickness: { value: 2.0 },
    uBaseRadius:    { value: 0.35 },
    uRadiusStep:    { value: 0.1 },
    uScaleRate:     { value: 0.1 },
    uOpacity:       { value: 1.0 },
    uNoiseAmount:   { value: 0.08 },
    uRotation:      { value: 0 },
    uRingGap:       { value: 1.5 },
    uFadeIn:        { value: 0.2 },
    uFadeOut:       { value: 2.0 },
    uBurst:         { value: 0 },
    uResolution:    { value: new THREE.Vector2(1, 1) },
    uColor:         { value: new THREE.Color('#fc42ff') },
    uColorTwo:      { value: new THREE.Color('#42fcff') },
    uRingCount:     { value: 6 },
  }), []);

  useFrame((state, delta) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const bg = getSettings().background;

    if (!bg.magicRingsEnabled) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Resolution from live state (critical for export pipeline correctness)
    const { width, height } = state.size;
    const dpr = state.gl.getPixelRatio();

    // Scale plane to fill the orthographic viewport (1 world unit = 1 CSS pixel)
    mesh.scale.set(width, height, 1);

    // Accumulate time
    timeRef.current += delta * (bg.magicRingsSpeed ?? DEFAULT_SETTINGS.background.magicRingsSpeed);
    uniforms.uResolution.value.set(width * dpr, height * dpr);

    // Uniforms
    uniforms.uTime.value          = timeRef.current;
    uniforms.uAttenuation.value   = bg.magicRingsAttenuation   ?? DEFAULT_SETTINGS.background.magicRingsAttenuation;
    uniforms.uLineThickness.value = bg.magicRingsThickness      ?? DEFAULT_SETTINGS.background.magicRingsThickness;
    uniforms.uBaseRadius.value    = bg.magicRingsBaseRadius     ?? DEFAULT_SETTINGS.background.magicRingsBaseRadius;
    uniforms.uRadiusStep.value    = bg.magicRingsRadiusStep     ?? DEFAULT_SETTINGS.background.magicRingsRadiusStep;
    uniforms.uScaleRate.value     = bg.magicRingsScaleRate      ?? DEFAULT_SETTINGS.background.magicRingsScaleRate;
    uniforms.uOpacity.value       = bg.magicRingsOpacity        ?? DEFAULT_SETTINGS.background.magicRingsOpacity;
    uniforms.uNoiseAmount.value   = bg.magicRingsNoiseAmount    ?? DEFAULT_SETTINGS.background.magicRingsNoiseAmount;
    uniforms.uRotation.value      = ((bg.magicRingsRotation     ?? DEFAULT_SETTINGS.background.magicRingsRotation) * Math.PI) / 180;
    uniforms.uRingGap.value       = bg.magicRingsRingGap        ?? DEFAULT_SETTINGS.background.magicRingsRingGap;
    uniforms.uRingCount.value     = Math.round(bg.magicRingsCount ?? DEFAULT_SETTINGS.background.magicRingsCount);
    uniforms.uColor.value.set(bg.magicRingsColor       ?? DEFAULT_SETTINGS.background.magicRingsColor);
    uniforms.uColorTwo.value.set(bg.magicRingsColorTwo ?? DEFAULT_SETTINGS.background.magicRingsColorTwo);

    // Beat burst
    const beat = phaseSrc();
    uniforms.uBurst.value = beat * (bg.magicRingsBurstStrength ?? DEFAULT_SETTINGS.background.magicRingsBurstStrength);
  });

  return (
    <mesh ref={meshRef} renderOrder={2} position={[0, 0, -9.0]}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
