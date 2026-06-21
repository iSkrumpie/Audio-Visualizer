/**
 * FaultyTerminal — R3F fullscreen-quad effect.
 *
 * Renders a retro CRT terminal aesthetic with procedural digits/glyphs,
 * scanlines, glitch distortion and barrel distortion.
 * Ported from reactbits.dev/backgrounds/faulty-terminal into a Three.js ShaderMaterial.
 *
 * ANGLE note: all GLSL local variables use `ft_` prefix.
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
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform vec2  uResolution;
uniform float uScale;
uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform float uBrightness;
uniform float uBeatGlitch;
uniform float uGlitchBoost;

float ft_hash21(vec2 ft_p){
  ft_p = fract(ft_p * 234.56);
  ft_p += dot(ft_p, ft_p + 34.56);
  return fract(ft_p.x * ft_p.y);
}

float ft_noise(vec2 ft_p, float ft_time) {
  return sin(ft_p.x * 10.0) * sin(ft_p.y * (3.0 + sin(ft_time * 0.090909))) + 0.2;
}

mat2 ft_rotate(float ft_angle) {
  float ft_c = cos(ft_angle);
  float ft_s = sin(ft_angle);
  return mat2(ft_c, -ft_s, ft_s, ft_c);
}

float ft_fbm(vec2 ft_p, float ft_time) {
  ft_p *= 1.1;
  float ft_f = 0.0;
  float ft_amp = 0.5 * uNoiseAmp;
  mat2 ft_modify0 = ft_rotate(ft_time * 0.02);
  ft_f += ft_amp * ft_noise(ft_p, ft_time);
  ft_p = ft_modify0 * ft_p * 2.0;
  ft_amp *= 0.454545;
  mat2 ft_modify1 = ft_rotate(ft_time * 0.02);
  ft_f += ft_amp * ft_noise(ft_p, ft_time);
  ft_p = ft_modify1 * ft_p * 2.0;
  ft_amp *= 0.454545;
  mat2 ft_modify2 = ft_rotate(ft_time * 0.08);
  ft_f += ft_amp * ft_noise(ft_p, ft_time);
  return ft_f;
}

float ft_pattern(vec2 ft_p, out vec2 ft_q, out vec2 ft_r, float ft_time) {
  vec2 ft_offset1 = vec2(1.0);
  vec2 ft_offset0 = vec2(0.0);
  mat2 ft_rot01 = ft_rotate(0.1 * ft_time);
  mat2 ft_rot1  = ft_rotate(0.1);
  ft_q = vec2(ft_fbm(ft_p + ft_offset1, ft_time), ft_fbm(ft_rot01 * ft_p + ft_offset1, ft_time));
  ft_r = vec2(ft_fbm(ft_rot1 * ft_q + ft_offset0, ft_time), ft_fbm(ft_q + ft_offset0, ft_time));
  return ft_fbm(ft_p + ft_r, ft_time);
}

float ft_digit(vec2 ft_p, float ft_time){
  vec2 ft_grid = uGridMul * 15.0;
  vec2 ft_s = floor(ft_p * ft_grid) / ft_grid;
  ft_p = ft_p * ft_grid;
  vec2 ft_q, ft_r;
  float ft_intensity = ft_pattern(ft_s * 0.1, ft_q, ft_r, ft_time) * 1.3 - 0.03;
  ft_p = fract(ft_p);
  ft_p *= uDigitSize;
  float ft_px5 = ft_p.x * 5.0;
  float ft_py5 = (1.0 - ft_p.y) * 5.0;
  float ft_x = fract(ft_px5);
  float ft_y = fract(ft_py5);
  float ft_i = floor(ft_py5) - 2.0;
  float ft_j = floor(ft_px5) - 2.0;
  float ft_n = ft_i * ft_i + ft_j * ft_j;
  float ft_f = ft_n * 0.0625;
  float ft_isOn = step(0.1, ft_intensity - ft_f);
  float ft_brightness = ft_isOn * (0.2 + ft_y * 0.8) * (0.75 + ft_x * 0.25);
  return step(0.0, ft_p.x) * step(ft_p.x, 1.0) *
         step(0.0, ft_p.y) * step(ft_p.y, 1.0) * ft_brightness;
}

float ft_onOff(float ft_a, float ft_b, float ft_c) {
  return step(ft_c, sin(uTime + ft_a * cos(uTime * ft_b))) * uFlickerAmount;
}

float ft_displace(vec2 ft_look) {
  float ft_y = ft_look.y - mod(uTime * 0.25, 1.0);
  float ft_window = 1.0 / (1.0 + 50.0 * ft_y * ft_y);
  return sin(ft_look.y * 20.0 + uTime) * 0.0125 * ft_onOff(4.0, 2.0, 0.8) * (1.0 + cos(uTime * 60.0)) * ft_window;
}

vec3 ft_getColor(vec2 ft_p, float ft_time){
  float ft_bar = step(mod(ft_p.y + ft_time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
  float ft_scanMul = uScanlineIntensity * (1.0 + uBeatGlitch * 0.5);
  ft_bar *= ft_scanMul;
  float ft_displacement = ft_displace(ft_p) * (1.0 + uBeatGlitch * uGlitchBoost);
  ft_p.x += ft_displacement;
  if (uGlitchAmount != 1.0) {
    float ft_extra = ft_displacement * (uGlitchAmount - 1.0);
    ft_p.x += ft_extra;
  }
  float ft_middle = ft_digit(ft_p, ft_time);
  const float ft_off = 0.002;
  float ft_sum = ft_digit(ft_p + vec2(-ft_off, -ft_off), ft_time) +
                 ft_digit(ft_p + vec2(0.0,    -ft_off), ft_time) +
                 ft_digit(ft_p + vec2( ft_off, -ft_off), ft_time) +
                 ft_digit(ft_p + vec2(-ft_off,  0.0),   ft_time) +
                 ft_digit(ft_p + vec2(0.0,      0.0),   ft_time) +
                 ft_digit(ft_p + vec2( ft_off,  0.0),   ft_time) +
                 ft_digit(ft_p + vec2(-ft_off,  ft_off), ft_time) +
                 ft_digit(ft_p + vec2(0.0,      ft_off), ft_time) +
                 ft_digit(ft_p + vec2( ft_off,  ft_off), ft_time);
  vec3 ft_baseColor = vec3(0.9) * ft_middle + ft_sum * 0.1 * vec3(1.0) * ft_bar;
  return ft_baseColor;
}

vec2 ft_barrel(vec2 ft_uv){
  vec2 ft_c = ft_uv * 2.0 - 1.0;
  float ft_r2 = dot(ft_c, ft_c);
  ft_c *= 1.0 + uCurvature * ft_r2;
  return ft_c * 0.5 + 0.5;
}

void main() {
  float ft_time = uTime * 0.333333;
  vec2 ft_uv = vUv;
  if(uCurvature != 0.0){
    ft_uv = ft_barrel(ft_uv);
  }
  vec2 ft_p = ft_uv * uScale;
  vec3 ft_col = ft_getColor(ft_p, ft_time);
  if(uChromaticAberration != 0.0){
    vec2 ft_ca = vec2(uChromaticAberration) / uResolution;
    ft_col.r = ft_getColor(ft_p + ft_ca, ft_time).r;
    ft_col.b = ft_getColor(ft_p - ft_ca, ft_time).b;
  }
  ft_col *= uTint;
  ft_col *= uBrightness;
  if(uDither > 0.0){
    float ft_rnd = ft_hash21(gl_FragCoord.xy);
    ft_col += (ft_rnd - 0.5) * (uDither * 0.003922);
  }
  gl_FragColor = vec4(ft_col, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function FaultyTerminal() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef  = useRef<THREE.ShaderMaterial>(null!);
  const prevBlendRef = useRef<BlendMode | null>(null);

  const faultyTerminalDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(faultyTerminalDetector);

  const faultyTerminalPhaseSrc = usePhaseSource({
    detector: faultyTerminalDetector,
    getPrecomputedRange: () => ({
      startHz: getSettings().background.faultyTerminalBeatFreqStart,
      endHz:   getSettings().background.faultyTerminalBeatFreqEnd,
    }),
    liveFn: () => {
      faultyTerminalDetector.setSensitivity(getSettings().background.faultyTerminalBeatSensitivity);
      return faultyTerminalDetector.update(
        audioAnalysis.rawFreqData,
        getSettings().background.faultyTerminalBeatFreqStart,
        getSettings().background.faultyTerminalBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(faultyTerminalPhaseSrc);
  phaseSrcRef.current = faultyTerminalPhaseSrc;

  const timeRef = useRef(0);

  const uniforms = useMemo(() => ({
    uTime:               { value: 0 },
    uResolution:         { value: new THREE.Vector2(1920, 1080) },
    uScale:              { value: 1.0 },
    uGridMul:            { value: new THREE.Vector2(2, 1) },
    uDigitSize:          { value: 1.5 },
    uScanlineIntensity:  { value: 1.0 },
    uGlitchAmount:       { value: 1.0 },
    uFlickerAmount:      { value: 1.0 },
    uNoiseAmp:           { value: 0.5 },
    uChromaticAberration:{ value: 0.0 },
    uDither:             { value: 0.0 },
    uCurvature:          { value: 0.2 },
    uTint:               { value: new THREE.Color('#00ff41') },
    uBrightness:         { value: 0.8 },
    uBeatGlitch:         { value: 0.0 },
    uGlitchBoost:        { value: 1.5 },
  }), []);

  useFrame((state, delta) => {
    const mat  = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    const { width, height } = state.size;
    const bg = getSettings().background;

    const behindLogo = bg.faultyTerminalBehindLogo ?? DEFAULT_SETTINGS.background.faultyTerminalBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;
    mesh.position.z = 0;

    const blendMode = (bg.faultyTerminalBlendMode ?? DEFAULT_SETTINGS.background.faultyTerminalBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    if (!(bg.faultyTerminalEnabled ?? DEFAULT_SETTINGS.background.faultyTerminalEnabled)) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    const speed = bg.faultyTerminalSpeed ?? DEFAULT_SETTINGS.background.faultyTerminalSpeed;
    timeRef.current += delta * speed;

    const beat = phaseSrcRef.current();

    mesh.scale.set(width, height, 1);

    const dpr = state.gl.getPixelRatio();
    mat.uniforms.uResolution.value.set(width * dpr, height * dpr);
    mat.uniforms.uTime.value              = timeRef.current;
    mat.uniforms.uScale.value             = bg.faultyTerminalScale            ?? DEFAULT_SETTINGS.background.faultyTerminalScale;
    mat.uniforms.uScanlineIntensity.value = bg.faultyTerminalScanlineIntensity ?? DEFAULT_SETTINGS.background.faultyTerminalScanlineIntensity;
    mat.uniforms.uGlitchAmount.value      = bg.faultyTerminalGlitchAmount      ?? DEFAULT_SETTINGS.background.faultyTerminalGlitchAmount;
    mat.uniforms.uFlickerAmount.value     = bg.faultyTerminalFlickerAmount     ?? DEFAULT_SETTINGS.background.faultyTerminalFlickerAmount;
    mat.uniforms.uNoiseAmp.value          = bg.faultyTerminalNoiseAmp          ?? DEFAULT_SETTINGS.background.faultyTerminalNoiseAmp;
    mat.uniforms.uCurvature.value         = bg.faultyTerminalCurvature         ?? DEFAULT_SETTINGS.background.faultyTerminalCurvature;
    mat.uniforms.uBrightness.value        = bg.faultyTerminalBrightness        ?? DEFAULT_SETTINGS.background.faultyTerminalBrightness;
    mat.uniforms.uBeatGlitch.value        = beat;
    mat.uniforms.uGlitchBoost.value       = bg.faultyTerminalBeatGlitchBoost   ?? DEFAULT_SETTINGS.background.faultyTerminalBeatGlitchBoost;
    mat.uniforms.uTint.value.set(bg.faultyTerminalTint ?? DEFAULT_SETTINGS.background.faultyTerminalTint);
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
        uniforms={uniforms}
      />
    </mesh>
  );
}
