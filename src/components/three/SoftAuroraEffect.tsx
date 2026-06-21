/**
 * SoftAuroraEffect — R3F fullscreen-quad effect.
 * Smooth, flowing aurora borealis effect across the screen.
 * Two layered Perlin-noise bands with cosine-gradient colour mixing.
 * Beat-reactive via brightness boost (uBeatGlow).
 *
 * ANGLE note: all GLSL local variables/functions use `sa_` prefix.
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
uniform float uBrightness;
uniform float uBeatGlow;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uBandHeight;
uniform float uBandSpread;
uniform float uOctaveDecay;
uniform float uLayerOffset;
uniform float uColorSpeed;
uniform float uOpacity;

varying vec2 vUv;

#define SA_TAU 6.28318

vec3 sa_gradientHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 234.6)),
    dot(p, vec3(269.5, 183.3, 198.3)),
    dot(p, vec3(169.5, 283.3, 156.9))
  );
  vec3 h   = fract(sin(p) * 43758.5453123);
  float phi   = acos(2.0 * h.x - 1.0);
  float theta = SA_TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float sa_quinticSmooth(float t) {
  float t2 = t * t;
  float t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 sa_cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(SA_TAU * (c * t + d));
}

float sa_perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x  = px * frequency;
  float y  = py * frequency;
  float fx = floor(x);
  float fy = floor(y);
  float fz = floor(pz);
  float cx = ceil(x);
  float cy = ceil(y);
  float cz = ceil(pz);

  vec3 g000 = sa_gradientHash(vec3(fx, fy, fz));
  vec3 g100 = sa_gradientHash(vec3(cx, fy, fz));
  vec3 g010 = sa_gradientHash(vec3(fx, cy, fz));
  vec3 g110 = sa_gradientHash(vec3(cx, cy, fz));
  vec3 g001 = sa_gradientHash(vec3(fx, fy, cz));
  vec3 g101 = sa_gradientHash(vec3(cx, fy, cz));
  vec3 g011 = sa_gradientHash(vec3(fx, cy, cz));
  vec3 g111 = sa_gradientHash(vec3(cx, cy, cz));

  float d000 = dot(g000, vec3(x-fx, y-fy, pz-fz));
  float d100 = dot(g100, vec3(x-cx, y-fy, pz-fz));
  float d010 = dot(g010, vec3(x-fx, y-cy, pz-fz));
  float d110 = dot(g110, vec3(x-cx, y-cy, pz-fz));
  float d001 = dot(g001, vec3(x-fx, y-fy, pz-cz));
  float d101 = dot(g101, vec3(x-cx, y-fy, pz-cz));
  float d011 = dot(g011, vec3(x-fx, y-cy, pz-cz));
  float d111 = dot(g111, vec3(x-cx, y-cy, pz-cz));

  float sx = sa_quinticSmooth(x - fx);
  float sy = sa_quinticSmooth(y - fy);
  float sz = sa_quinticSmooth(pz - fz);

  float lx00 = mix(d000, d100, sx);
  float lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx);
  float lx11 = mix(d011, d111, sx);
  float ly0  = mix(lx00, lx10, sy);
  float ly1  = mix(lx01, lx11, sy);
  return amplitude * mix(ly0, ly1, sz);
}

float sa_auroraGlow(float t, vec2 shift) {
  vec2 uv = vUv * vec2(iResolution.x / iResolution.y, 1.0);
  uv += shift;

  float noiseVal  = 0.0;
  float freq      = uNoiseFreq;
  float amp       = uNoiseAmp;
  vec2 samplePos  = uv * uScale;

  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += sa_perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp  *= uOctaveDecay;
    freq *= 2.0;
  }

  float yBand = uv.y * 10.0 - uBandHeight * 10.0;
  return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

void main() {
  vec2 uv = vUv;
  float t = uSpeed * 0.4 * uTime;

  float effectiveBrightness = uBrightness * (1.0 + uBeatGlow);

  vec3 col = vec3(0.0);
  col += 0.99 * sa_auroraGlow(t, vec2(0.0)) *
         sa_cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed,
           vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * uColor1;
  col += 0.99 * sa_auroraGlow(t + uLayerOffset, vec2(0.0)) *
         sa_cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed,
           vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * uColor2;
  col *= effectiveBrightness;

  float alpha = clamp(length(col), 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function SoftAuroraEffect() {
  const meshRef      = useRef<THREE.Mesh>(null!);
  const matRef       = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);
  const timeRef      = useRef(0);

  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => ({
      startHz: getSettings().background.softAuroraBeatFreqStart,
      endHz:   getSettings().background.softAuroraBeatFreqEnd,
    }),
    liveFn: () => {
      const bg = getSettings().background;
      detector.setSensitivity(bg.softAuroraBeatSensitivity ?? DEFAULT_SETTINGS.background.softAuroraBeatSensitivity);
      return detector.update(
        audioAnalysis.rawFreqData,
        bg.softAuroraBeatFreqStart ?? DEFAULT_SETTINGS.background.softAuroraBeatFreqStart,
        bg.softAuroraBeatFreqEnd   ?? DEFAULT_SETTINGS.background.softAuroraBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(phaseSrc);
  phaseSrcRef.current = phaseSrc;

  const uniforms = useMemo(() => ({
    uTime:        { value: 0 },
    iResolution:  { value: new THREE.Vector2(1, 1) },
    uSpeed:       { value: DEFAULT_SETTINGS.background.softAuroraSpeed },
    uScale:       { value: DEFAULT_SETTINGS.background.softAuroraScale },
    uBrightness:  { value: DEFAULT_SETTINGS.background.softAuroraBrightness },
    uBeatGlow:    { value: 0 },
    uColor1:      { value: new THREE.Color(DEFAULT_SETTINGS.background.softAuroraColor1) },
    uColor2:      { value: new THREE.Color(DEFAULT_SETTINGS.background.softAuroraColor2) },
    uNoiseFreq:   { value: DEFAULT_SETTINGS.background.softAuroraNoiseFreq },
    uNoiseAmp:    { value: DEFAULT_SETTINGS.background.softAuroraNoiseAmp },
    uBandHeight:  { value: DEFAULT_SETTINGS.background.softAuroraBandHeight },
    uBandSpread:  { value: DEFAULT_SETTINGS.background.softAuroraBandSpread },
    uOctaveDecay: { value: DEFAULT_SETTINGS.background.softAuroraOctaveDecay },
    uLayerOffset: { value: DEFAULT_SETTINGS.background.softAuroraLayerOffset },
    uColorSpeed:  { value: DEFAULT_SETTINGS.background.softAuroraColorSpeed },
    uOpacity:     { value: DEFAULT_SETTINGS.background.softAuroraOpacity },
  }), []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const mat  = matRef.current;
    if (!mesh || !mat) return;

    const bg = getSettings().background;
    const D  = DEFAULT_SETTINGS.background;

    const blendMode = (bg.softAuroraBlendMode ?? D.softAuroraBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.softAuroraEnabled ?? D.softAuroraEnabled)) {
      mat.visible = false;
      timeRef.current += delta;
      return;
    }
    mat.visible = true;

    const { width, height } = state.size;
    mesh.scale.set(width, height, 1);

    const beat      = phaseSrcRef.current();
    const glowBoost = (bg.softAuroraBeatGlowBoost ?? D.softAuroraBeatGlowBoost) * beat;

    timeRef.current += delta;
    mat.uniforms.uTime.value = timeRef.current;
    mat.uniforms.iResolution.value.set(width, height);

    mat.uniforms.uSpeed.value       = bg.softAuroraSpeed       ?? D.softAuroraSpeed;
    mat.uniforms.uScale.value       = bg.softAuroraScale       ?? D.softAuroraScale;
    mat.uniforms.uBrightness.value  = bg.softAuroraBrightness  ?? D.softAuroraBrightness;
    mat.uniforms.uBeatGlow.value    = glowBoost;
    mat.uniforms.uColor1.value.set(bg.softAuroraColor1 ?? D.softAuroraColor1);
    mat.uniforms.uColor2.value.set(bg.softAuroraColor2 ?? D.softAuroraColor2);
    mat.uniforms.uNoiseFreq.value   = bg.softAuroraNoiseFreq   ?? D.softAuroraNoiseFreq;
    mat.uniforms.uNoiseAmp.value    = bg.softAuroraNoiseAmp    ?? D.softAuroraNoiseAmp;
    mat.uniforms.uBandHeight.value  = bg.softAuroraBandHeight  ?? D.softAuroraBandHeight;
    mat.uniforms.uBandSpread.value  = bg.softAuroraBandSpread  ?? D.softAuroraBandSpread;
    mat.uniforms.uOctaveDecay.value = bg.softAuroraOctaveDecay ?? D.softAuroraOctaveDecay;
    mat.uniforms.uLayerOffset.value = bg.softAuroraLayerOffset ?? D.softAuroraLayerOffset;
    mat.uniforms.uColorSpeed.value  = bg.softAuroraColorSpeed  ?? D.softAuroraColorSpeed;
    mat.uniforms.uOpacity.value     = bg.softAuroraOpacity     ?? D.softAuroraOpacity;

    const behindLogo = bg.softAuroraBehindLogo ?? D.softAuroraBehindLogo;
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
