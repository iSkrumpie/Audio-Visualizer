/**
 * LightRays — R3F fullscreen-quad effect (ported from standalone ogl overlay).
 *
 * Animated god-rays / crepuscular rays. Now part of the R3F scene graph
 * so it appears in exported MP4s.
 *
 * Shader prefix rule: all local GLSL variables use `lr_` prefix.
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

// ─── Vertex shader ────────────────────────────────────────────────────────────

const VERT = /* glsl */`
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// Converted from GLSL ES 3.0 to GLSL ES 1.0 for Three.js ShaderMaterial.
// ALL local variables carry the `lr_` prefix (ANGLE Windows rule).

const FRAG = /* glsl */`
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uRayPos;
uniform vec2  uRayDir;
uniform vec3  uRaysColor;
uniform float uRaysSpeed;
uniform float uLightSpread;
uniform float uRayLength;
uniform float uPulsating;
uniform float uFadeDistance;
uniform float uOpacity;
uniform float uIntensityBoost;

float lr_noise(vec2 lr_st) {
  return fract(sin(dot(lr_st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float lr_rayStrength(vec2 lr_raySource, vec2 lr_rayRefDir, vec2 lr_coord,
                     float lr_seedA, float lr_seedB, float lr_speed) {
  vec2  lr_toCoord    = lr_coord - lr_raySource;
  vec2  lr_dirNorm    = normalize(lr_toCoord);
  float lr_cosAngle   = dot(lr_dirNorm, lr_rayRefDir);
  float lr_spreadFac  = pow(max(lr_cosAngle, 0.0), 1.0 / max(uLightSpread, 0.001));
  float lr_dist       = length(lr_toCoord);
  float lr_maxDist    = uResolution.x * uRayLength;
  float lr_lenFall    = clamp((lr_maxDist - lr_dist) / lr_maxDist, 0.0, 1.0);
  float lr_fadeFall   = clamp(
    (uResolution.x * uFadeDistance - lr_dist) / (uResolution.x * uFadeDistance),
    0.5, 1.0);
  float lr_pulse = uPulsating > 0.5
    ? (0.8 + 0.2 * sin(uTime * lr_speed * 3.0))
    : 1.0;
  float lr_base  = clamp(
    (0.45 + 0.15 * sin(lr_cosAngle * lr_seedA + uTime * lr_speed))
    + (0.3 + 0.2 * cos(-lr_cosAngle * lr_seedB + uTime * lr_speed)),
    0.0, 1.0);
  return lr_base * lr_lenFall * lr_fadeFall * lr_spreadFac * lr_pulse;
}

void main() {
  vec2 lr_coord = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  float lr_r1 = lr_rayStrength(uRayPos, uRayDir, lr_coord, 36.2214, 21.11349, 1.5 * uRaysSpeed);
  float lr_r2 = lr_rayStrength(uRayPos, uRayDir, lr_coord, 22.3991, 18.0234, 1.1 * uRaysSpeed);
  vec4  lr_rays = vec4(1.0) * (lr_r1 * 0.5 + lr_r2 * 0.4);

  // Apply color
  lr_rays.rgb *= uRaysColor;

  // Intensity boost (beat reactivity — primary)
  lr_rays.rgb *= uIntensityBoost;

  // Alpha = luminance-based (same as Strands pattern)
  float lr_lum   = max(max(lr_rays.r, lr_rays.g), lr_rays.b);
  float lr_alpha = clamp(lr_lum, 0.0, 1.0) * uOpacity;

  gl_FragColor = vec4(lr_rays.rgb * uOpacity, lr_alpha);
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLightRaysAnchorAndDir(
  origin: string,
  w: number,
  h: number,
): { anchor: [number, number]; dir: [number, number] } {
  const outside = 0.2;
  switch (origin) {
    case 'top-left':       return { anchor: [0, -outside * h],              dir: [0, 1] };
    case 'top-right':      return { anchor: [w, -outside * h],              dir: [0, 1] };
    case 'left':           return { anchor: [-outside * w, 0.5 * h],        dir: [1, 0] };
    case 'right':          return { anchor: [(1 + outside) * w, 0.5 * h],   dir: [-1, 0] };
    case 'bottom-left':    return { anchor: [0, (1 + outside) * h],         dir: [0, -1] };
    case 'bottom-center':  return { anchor: [0.5 * w, (1 + outside) * h],   dir: [0, -1] };
    case 'bottom-right':   return { anchor: [w, (1 + outside) * h],         dir: [0, -1] };
    default:               return { anchor: [0.5 * w, -outside * h],        dir: [0, 1] }; // top-center
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LightRays() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);

  const lightRaysBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(lightRaysBeatDetector);

  const lightRaysPhaseSrc = usePhaseSource({
    detector: lightRaysBeatDetector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.lightRaysBeatFreqStart ?? DEFAULT_SETTINGS.background.lightRaysBeatFreqStart,
        endHz:   bg.lightRaysBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightRaysBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      lightRaysBeatDetector.setSensitivity(
        bg.lightRaysBeatSensitivity ?? DEFAULT_SETTINGS.background.lightRaysBeatSensitivity,
      );
      return lightRaysBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.lightRaysBeatFreqStart ?? DEFAULT_SETTINGS.background.lightRaysBeatFreqStart,
        bg.lightRaysBeatFreqEnd   ?? DEFAULT_SETTINGS.background.lightRaysBeatFreqEnd,
      );
    },
  });

  const phaseSrcRef = useRef(lightRaysPhaseSrc);
  phaseSrcRef.current = lightRaysPhaseSrc;

  const startTimeRef = useRef(performance.now());

  useFrame((state) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const { width, height } = state.size;
    const bg = getSettings().background;

    mesh.scale.set(width, height, 1);

    const behindLogo = bg.lightRaysBehindLogo ?? DEFAULT_SETTINGS.background.lightRaysBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
    mesh.position.z = 0;

    const blendMode = (bg.lightRaysBlendMode ?? DEFAULT_SETTINGS.background.lightRaysBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.lightRaysEnabled ?? DEFAULT_SETTINGS.background.lightRaysEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    mat.uniforms.uTime.value = elapsed;

    // Resolution in physical pixels
    const dpr = state.gl.getPixelRatio();
    const pw = width  * dpr;
    const ph = height * dpr;
    mat.uniforms.uResolution.value.set(pw, ph);

    // Beat reactivity
    const beat      = phaseSrcRef.current();
    const intensity = bg.lightRaysBeatIntensity ?? DEFAULT_SETTINGS.background.lightRaysBeatIntensity;
    const boost     = intensity * beat;
    mat.uniforms.uIntensityBoost.value = 1.0 + boost;
    mat.uniforms.uPulsating.value      = beat > 0.3 ? 1.0 : 0.0;

    // Anchor/dir from origin setting (use physical pixel dimensions)
    const origin = bg.lightRaysOrigin ?? DEFAULT_SETTINGS.background.lightRaysOrigin;
    const { anchor, dir } = getLightRaysAnchorAndDir(origin, pw, ph);
    mat.uniforms.uRayPos.value.set(anchor[0], anchor[1]);
    mat.uniforms.uRayDir.value.set(dir[0], dir[1]);

    // Color
    const hex = bg.lightRaysColor ?? DEFAULT_SETTINGS.background.lightRaysColor;
    const c = new THREE.Color(hex);
    mat.uniforms.uRaysColor.value.set(c.r, c.g, c.b);

    mat.uniforms.uRaysSpeed.value    = bg.lightRaysSpeed        ?? DEFAULT_SETTINGS.background.lightRaysSpeed;
    mat.uniforms.uLightSpread.value  = bg.lightRaysSpread       ?? DEFAULT_SETTINGS.background.lightRaysSpread;
    mat.uniforms.uRayLength.value    = bg.lightRaysLength       ?? DEFAULT_SETTINGS.background.lightRaysLength;
    mat.uniforms.uOpacity.value      = bg.lightRaysOpacity      ?? DEFAULT_SETTINGS.background.lightRaysOpacity;
    mat.uniforms.uFadeDistance.value = bg.lightRaysFadeDistance ?? DEFAULT_SETTINGS.background.lightRaysFadeDistance;
  });

  return (
    <mesh ref={meshRef} renderOrder={9}>
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
          uTime:           { value: 0 },
          uResolution:     { value: new THREE.Vector2(1, 1) },
          uRayPos:         { value: new THREE.Vector2(0.5, 0) },
          uRayDir:         { value: new THREE.Vector2(0, 1) },
          uRaysColor:      { value: new THREE.Vector3(1, 1, 1) },
          uRaysSpeed:      { value: DEFAULT_SETTINGS.background.lightRaysSpeed },
          uLightSpread:    { value: DEFAULT_SETTINGS.background.lightRaysSpread },
          uRayLength:      { value: DEFAULT_SETTINGS.background.lightRaysLength },
          uPulsating:      { value: 0 },
          uFadeDistance:   { value: DEFAULT_SETTINGS.background.lightRaysFadeDistance },
          uOpacity:        { value: DEFAULT_SETTINGS.background.lightRaysOpacity },
          uIntensityBoost: { value: 1.0 },
        }}
      />
    </mesh>
  );
}
