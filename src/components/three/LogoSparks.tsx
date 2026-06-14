/**
 * LogoSparks — audio-reactive sparks / embers / weld particle system
 * rendered around the logo.
 *
 * Two layers:
 *   1. Ambient GPU pool (AMBIENT_COUNT particles) — self-respawning via
 *      mod(uTime + aOffset, aLifetime). Constant flow.
 *   2. CPU burst pool (BURST_COUNT particles) — fired on kick/snare/hihat
 *      rising edges.
 *
 * Styles:
 *   weld     — short, fast, white-hot → orange → dark
 *   volcanic — slow, rising, orange → red → dark
 *   ambient  — mixed (in between)
 *
 * z=0.15, renderOrder=9 (in front of fire ring z=0.1 / renderOrder=7
 * and inner glow z=0.05 / renderOrder=8).
 *
 * ANGLE-safety: ALL local vars inside GLSL blocks use the fr_ prefix.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

const AMBIENT_COUNT       = 150;
const BURST_COUNT         = 60;
const LOGO_RADIUS_DEFAULT = 0.5;  // matches CenterLogo fire ring innerR

// ─── GLSL: Ambient layer ───────────────────────────────────────────────────────

const SPARKS_AMBIENT_VERT = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uDrag;
uniform float uBaseSize;
uniform float uBeatPulse;
uniform float uVocalBoost;
uniform float uKick;
uniform float uHihat;
uniform float uLoudness;
uniform float uStyle;

attribute vec3  aStart;
attribute vec3  aVelocity;
attribute float aLifetime;
attribute float aOffset;

varying vec3  vColor;
varying float vAlpha;
varying float vSize;

// fr_ prefix on all locals for ANGLE safety
vec3 fr_sparkColor(float fr_t) {
  fr_t = clamp(fr_t, 0.0, 1.0);
  vec3 fr_c0 = vec3(1.00, 0.97, 0.88);
  vec3 fr_c1 = vec3(1.00, 0.93, 0.31);
  vec3 fr_c2 = vec3(1.00, 0.48, 0.00);
  vec3 fr_c3 = vec3(0.80, 0.13, 0.00);
  vec3 fr_c4 = vec3(0.33, 0.00, 0.00);
  float fr_s = fr_t * 4.0;
  vec3 fr_col = mix(fr_c0, fr_c1, clamp(fr_s,         0.0, 1.0));
  fr_col = mix(fr_col, fr_c2, clamp(fr_s - 1.0, 0.0, 1.0));
  fr_col = mix(fr_col, fr_c3, clamp(fr_s - 2.0, 0.0, 1.0));
  fr_col = mix(fr_col, fr_c4, clamp(fr_s - 3.0, 0.0, 1.0));
  return fr_col;
}

void main() {
  // Self-respawn: age wraps at lifetime
  float fr_age = mod(uTime + aOffset, aLifetime);
  float fr_t   = fr_age / aLifetime;  // 0=fresh, 1=dying

  // Style-based lifetime scaling (welds are fast, volcanos are slow)
  float fr_lifetimeMul = mix(1.0, 2.8, clamp(uStyle, 0.0, 2.0) / 2.0);

  // Velocity with vocal boost
  float fr_boost = 1.0 + uVocalBoost * 1.5;
  vec3  fr_vel   = aVelocity * fr_boost;

  // Ballistic position: integrated drag
  float fr_k   = uDrag;
  vec3  fr_pos = aStart + fr_vel / fr_k * (1.0 - exp(-fr_k * fr_age * fr_lifetimeMul));
  fr_pos.y -= 0.5 * uGravity * fr_age * fr_age * fr_lifetimeMul;

  // Color
  vColor = fr_sparkColor(fr_t);

  // Alpha: bright early, exponential dropoff
  vAlpha = pow(1.0 - smoothstep(0.4, 1.0, fr_t), 2.0);

  // Size: shrinks over life, hihat pulse boost
  float fr_sz = uBaseSize * (1.0 - fr_t * 0.7) * (1.0 + uBeatPulse * 0.5)
              * (1.0 + uKick * 0.3);
  vSize = fr_sz;

  // Perspective point size
  vec4 fr_mvPos  = modelViewMatrix * vec4(fr_pos, 1.0);
  gl_PointSize   = fr_sz * (300.0 / -fr_mvPos.z);
  gl_Position    = projectionMatrix * fr_mvPos;
}
`;

const SPARKS_AMBIENT_FRAG = /* glsl */ `
varying vec3  vColor;
varying float vAlpha;
varying float vSize;

void main() {
  float fr_dist = distance(gl_PointCoord, vec2(0.5));

  // Tight core + wide halo
  float fr_core  = 1.0 - smoothstep(0.0, 0.20, fr_dist);
  float fr_halo  = 1.0 - smoothstep(0.0, 0.50, fr_dist);
  float fr_glow  = pow(fr_core, 2.0) * 0.85 + fr_halo * 0.25;

  float fr_finalAlpha = fr_glow * vAlpha;

  // Additive blending: output pre-multiplied
  gl_FragColor = vec4(vColor * fr_finalAlpha, fr_finalAlpha);
}
`;

// ─── GLSL: Burst layer ────────────────────────────────────────────────────────

const SPARKS_BURST_VERT = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uDrag;
uniform float uBaseSize;

attribute vec3  aStart;
attribute vec3  aVelocity;
attribute float aSpawnTime;
attribute float aLifetime;

varying vec3  vColor;
varying float vAlpha;

vec3 fr_sparkColor(float fr_t) {
  fr_t = clamp(fr_t, 0.0, 1.0);
  vec3 fr_c0 = vec3(1.00, 0.97, 0.88);
  vec3 fr_c1 = vec3(1.00, 0.93, 0.31);
  vec3 fr_c2 = vec3(1.00, 0.48, 0.00);
  vec3 fr_c3 = vec3(0.80, 0.13, 0.00);
  vec3 fr_c4 = vec3(0.33, 0.00, 0.00);
  float fr_s = fr_t * 4.0;
  vec3 fr_col = mix(fr_c0, fr_c1, clamp(fr_s,         0.0, 1.0));
  fr_col = mix(fr_col, fr_c2, clamp(fr_s - 1.0, 0.0, 1.0));
  fr_col = mix(fr_col, fr_c3, clamp(fr_s - 2.0, 0.0, 1.0));
  fr_col = mix(fr_col, fr_c4, clamp(fr_s - 3.0, 0.0, 1.0));
  return fr_col;
}

void main() {
  float fr_age = uTime - aSpawnTime;

  // Particle not yet spawned or already dead — hide off-screen
  if (fr_age < 0.0 || fr_age > aLifetime) {
    gl_Position  = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor       = vec3(0.0);
    vAlpha       = 0.0;
    return;
  }

  float fr_t   = fr_age / aLifetime;

  // Ballistic with drag
  float fr_k   = uDrag;
  vec3  fr_pos = aStart + aVelocity / fr_k * (1.0 - exp(-fr_k * fr_age));
  fr_pos.y    -= 0.5 * uGravity * fr_age * fr_age;

  vColor = fr_sparkColor(fr_t);
  vAlpha = pow(1.0 - smoothstep(0.3, 1.0, fr_t), 2.0);

  float fr_sz    = uBaseSize * (1.0 - fr_t * 0.75);
  vec4  fr_mvPos = modelViewMatrix * vec4(fr_pos, 1.0);
  gl_PointSize   = fr_sz * (320.0 / -fr_mvPos.z);
  gl_Position    = projectionMatrix * fr_mvPos;
}
`;

// Burst layer reuses the same fragment shader as the ambient layer.

// ─── Component ────────────────────────────────────────────────────────────────

export function LogoSparks() {
  const ambientRef    = useRef<THREE.Points>(null);
  const burstRef      = useRef<THREE.Points>(null);

  // ── Beat detector ────────────────────────────────────────────────────────
  const sparksBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(sparksBeatDetector);

  // Phase source: switches live ↔ precomputed based on detectionMode
  const sparksPhaseSrc = usePhaseSource({
    detector: sparksBeatDetector,
    getPrecomputedRange: () => {
      const sL = getSettings().logo;
      return {
        startHz: sL.fireFreqStart ?? 40,
        endHz:   sL.fireFreqEnd   ?? 160,
      };
    },
    liveFn: () => {
      const sL = getSettings().logo;
      sparksBeatDetector.setSensitivity(sL.fireSensitivity ?? 1.0);
      return sparksBeatDetector.update(
        audioAnalysis.rawFreqData,
        sL.fireFreqStart ?? 40,
        sL.fireFreqEnd   ?? 160,
      );
    },
  });

  // ── Ambient geometry ─────────────────────────────────────────────────────
  const ambientGeo = useMemo(() => {
    const geo        = new THREE.BufferGeometry();
    const positions  = new Float32Array(AMBIENT_COUNT * 3);
    const aStarts    = new Float32Array(AMBIENT_COUNT * 3);
    const aVelocities = new Float32Array(AMBIENT_COUNT * 3);
    const aLifetimes = new Float32Array(AMBIENT_COUNT);
    const aOffsets   = new Float32Array(AMBIENT_COUNT);

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const fr_angle = Math.random() * Math.PI * 2;
      const fr_r     = LOGO_RADIUS_DEFAULT * (1.0 + Math.random() * 0.15);
      aStarts[i * 3 + 0] = Math.cos(fr_angle) * fr_r;
      aStarts[i * 3 + 1] = Math.sin(fr_angle) * fr_r;
      aStarts[i * 3 + 2] = 0;

      const fr_speed  = 0.4 + Math.random() * 1.5;
      const fr_upBias = Math.random() * 0.6;
      aVelocities[i * 3 + 0] = Math.cos(fr_angle) * fr_speed + (Math.random() - 0.5) * 0.3;
      aVelocities[i * 3 + 1] = Math.sin(fr_angle) * fr_speed + fr_upBias;
      aVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

      aLifetimes[i] = 0.4 + Math.random() * 1.6;
      aOffsets[i]   = Math.random() * aLifetimes[i];
    }

    geo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aStart',    new THREE.BufferAttribute(aStarts, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(aVelocities, 3));
    geo.setAttribute('aLifetime', new THREE.BufferAttribute(aLifetimes, 1));
    geo.setAttribute('aOffset',   new THREE.BufferAttribute(aOffsets, 1));
    return geo;
  }, []);

  // ── Ambient material ──────────────────────────────────────────────────────
  const ambientMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SPARKS_AMBIENT_VERT,
    fragmentShader: SPARKS_AMBIENT_FRAG,
    uniforms: {
      uTime:       { value: 0 },
      uGravity:    { value: 2.5 },
      uDrag:       { value: 2.0 },
      uBaseSize:   { value: 4.0 },
      uBeatPulse:  { value: 0 },
      uVocalBoost: { value: 0 },
      uKick:       { value: 0 },
      uHihat:      { value: 0 },
      uLoudness:   { value: 0 },
      uStyle:      { value: 0 },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  }), []);

  // ── Burst geometry ────────────────────────────────────────────────────────
  const burstGeo = useMemo(() => {
    const geo         = new THREE.BufferGeometry();
    const positions   = new Float32Array(BURST_COUNT * 3);
    const aStarts     = new Float32Array(BURST_COUNT * 3);
    const aVelocities = new Float32Array(BURST_COUNT * 3);
    const aSpawnTimes = new Float32Array(BURST_COUNT);
    const aLifetimes  = new Float32Array(BURST_COUNT);

    for (let i = 0; i < BURST_COUNT; i++) {
      aSpawnTimes[i] = -1000.0;
      aLifetimes[i]  = 0.0;
    }

    geo.setAttribute('position',   new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aStart',     new THREE.BufferAttribute(aStarts, 3));
    geo.setAttribute('aVelocity',  new THREE.BufferAttribute(aVelocities, 3));
    geo.setAttribute('aSpawnTime', new THREE.BufferAttribute(aSpawnTimes, 1));
    geo.setAttribute('aLifetime',  new THREE.BufferAttribute(aLifetimes, 1));
    return geo;
  }, []);

  // ── Burst material ────────────────────────────────────────────────────────
  const burstMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SPARKS_BURST_VERT,
    fragmentShader: SPARKS_AMBIENT_FRAG,   // reuse ambient frag
    uniforms: {
      uTime:     { value: 0 },
      uGravity:  { value: 2.5 },
      uDrag:     { value: 2.0 },
      uBaseSize: { value: 4.0 },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  }), []);

  // ── CPU burst state ───────────────────────────────────────────────────────
  const prevKickRef  = useRef(0);
  const prevSnareRef = useRef(0);

  // ── Per-frame ─────────────────────────────────────────────────────────────
  useFrame((state) => {
    const settings = getSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sF = settings.logo as any;

    const sparksEnabled = sF.sparksEnabled ?? false;

    if (!sparksEnabled) {
      if (ambientRef.current) ambientRef.current.visible = false;
      if (burstRef.current)   burstRef.current.visible   = false;
      return;
    }

    if (ambientRef.current) ambientRef.current.visible = true;
    if (burstRef.current)   burstRef.current.visible   = true;

    const fr_time = state.clock.elapsedTime;

    // Style mapping
    const fr_styleStr = sF.sparksStyle ?? 'weld';
    const fr_styleMap: Record<string, number> = { weld: 0, volcanic: 1, ambient: 2 };
    const fr_styleVal = fr_styleMap[fr_styleStr] ?? 0;

    // Per-style physics
    let fr_gravity = 2.5;
    let fr_drag    = 2.0;
    if (fr_styleVal === 0) {
      fr_gravity = 3.0; fr_drag = 2.5;
    } else if (fr_styleVal === 1) {
      fr_gravity = 0.5; fr_drag = 1.0;
    } else {
      fr_gravity = 1.5; fr_drag = 1.5;
    }

    // Read phase (live or precomputed)
    const fr_beatPulse = sparksPhaseSrc();

    // Update ambient uniforms
    const fr_aU       = ambientMat.uniforms;
    fr_aU.uTime.value       = fr_time;
    fr_aU.uGravity.value    = fr_gravity;
    fr_aU.uDrag.value       = fr_drag;
    fr_aU.uBaseSize.value   = (sF.sparksSize ?? 1.0) * 4.0;
    fr_aU.uBeatPulse.value  = audioAnalysis.beatPhase  ?? 0;
    fr_aU.uVocalBoost.value = audioAnalysis.vocalPhase ?? 0;
    fr_aU.uKick.value       = audioAnalysis.kickPhase  ?? 0;
    fr_aU.uHihat.value      = audioAnalysis.hihatPhase ?? 0;
    fr_aU.uLoudness.value   = audioAnalysis.loudness   ?? 0;
    fr_aU.uStyle.value      = fr_styleVal;

    // Update burst uniforms
    const fr_bU       = burstMat.uniforms;
    fr_bU.uTime.value     = fr_time;
    fr_bU.uGravity.value  = fr_gravity;
    fr_bU.uDrag.value     = fr_drag;
    fr_bU.uBaseSize.value = (sF.sparksSize ?? 1.0) * 5.0;

    // Rising-edge beat detection → CPU burst spawning
    const fr_kick       = audioAnalysis.kickPhase  ?? 0;
    const fr_snare      = audioAnalysis.snarePhase ?? 0;
    const fr_hihat      = audioAnalysis.hihatPhase ?? 0;
    const fr_burstCount = sF.sparksBurstCount ?? 30;

    if (fr_kick > 0.5 && prevKickRef.current <= 0.5) {
      spawnBurst(burstGeo, fr_burstCount, fr_styleVal, fr_time);
    }
    prevKickRef.current = fr_kick;

    if (fr_snare > 0.5 && prevSnareRef.current <= 0.5) {
      spawnBurst(burstGeo, Math.round(fr_burstCount * 0.4), fr_styleVal, fr_time);
    }
    prevSnareRef.current = fr_snare;

    // Hihat: probabilistic micro-spawn (no rising edge needed)
    const fr_hihatChance = fr_hihat * 0.5 * 0.016;  // ~1 frame delta
    if (Math.random() < fr_hihatChance) {
      spawnBurst(burstGeo, 1, fr_styleVal, fr_time);
    }

    // Scale both layers with beat pulse
    const fr_scale = 1.0 + fr_beatPulse * 0.15;
    if (ambientRef.current) ambientRef.current.scale.set(fr_scale, fr_scale, 1);
    if (burstRef.current)   burstRef.current.scale.set(fr_scale, fr_scale, 1);
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <points
        ref={ambientRef}
        position={[0, 0, 0.15]}
        renderOrder={9}
        frustumCulled={false}
      >
        <primitive object={ambientGeo} attach="geometry" />
        <primitive object={ambientMat} attach="material" />
      </points>
      <points
        ref={burstRef}
        position={[0, 0, 0.15]}
        renderOrder={9}
        frustumCulled={false}
      >
        <primitive object={burstGeo} attach="geometry" />
        <primitive object={burstMat} attach="material" />
      </points>
    </>
  );
}

// ─── CPU burst helper ──────────────────────────────────────────────────────────

// Round-robin cursor (module-level; resets on file reload / hot-reload)
let burstCursor = 0;

function spawnBurst(
  geo: THREE.BufferGeometry,
  count: number,
  styleVal: number,
  currentTime: number,
): void {
  const fr_aStarts     = geo.attributes['aStart']     as THREE.BufferAttribute;
  const fr_aVelocities = geo.attributes['aVelocity']  as THREE.BufferAttribute;
  const fr_aSpawnTimes = geo.attributes['aSpawnTime'] as THREE.BufferAttribute;
  const fr_aLifetimes  = geo.attributes['aLifetime']  as THREE.BufferAttribute;

  for (let n = 0; n < count; n++) {
    const fr_i     = burstCursor++ % BURST_COUNT;
    const fr_angle = Math.random() * Math.PI * 2;
    const fr_r     = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.15);

    let fr_speed: number;
    let fr_lifetime: number;

    if (styleVal === 0) {               // weld
      fr_speed    = 3.0 + Math.random() * 5.0;
      fr_lifetime = 0.3 + Math.random() * 0.5;
    } else if (styleVal === 1) {        // volcanic
      fr_speed    = 0.4 + Math.random() * 1.2;
      fr_lifetime = 1.0 + Math.random() * 2.5;
    } else {                            // ambient
      fr_speed    = 0.6 + Math.random() * 1.8;
      fr_lifetime = 0.6 + Math.random() * 1.4;
    }

    const fr_upBias = styleVal === 1 ? 0.8 : 0.3;

    fr_aStarts.setXYZ(
      fr_i,
      Math.cos(fr_angle) * fr_r,
      Math.sin(fr_angle) * fr_r,
      0,
    );
    fr_aVelocities.setXYZ(
      fr_i,
      Math.cos(fr_angle) * fr_speed + (Math.random() - 0.5) * 0.3,
      Math.sin(fr_angle) * fr_speed + Math.random() * fr_upBias,
      (Math.random() - 0.5) * 0.2,
    );
    fr_aSpawnTimes.setX(fr_i, currentTime);
    fr_aLifetimes.setX(fr_i, fr_lifetime);
  }

  fr_aStarts.needsUpdate     = true;
  fr_aVelocities.needsUpdate = true;
  fr_aSpawnTimes.needsUpdate = true;
  fr_aLifetimes.needsUpdate  = true;
}
