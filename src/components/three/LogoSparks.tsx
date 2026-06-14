/**
 * LogoSparks — audio-reactive sparks / embers particle system (v15)
 *
 * Three independent ambient pools, each with its own style-specific
 * spawn geometry baked in at init time:
 *   weld     — fast radial outward, short life (0.3-0.8s)
 *   volcanic — slow radial + strong upward, long life (1.5-3.5s)
 *   ambient  — mixed mid-life (0.8-2.0s), constant flow
 *
 * Plus a CPU-triggered burst pool (weld only, fires on kick/snare).
 *
 * Bug fixes vs v14:
 *   1. gl_PointSize NO LONGER divided by uLogoSize/240 — sparks are
 *      bigger on larger logos (was the main complaint).
 *   2. Each pool has its own spawn attributes; style differences are
 *      visible immediately without restarting.
 *
 * z=0.15-0.17, renderOrder=9.
 * ANGLE-safety: ALL local GLSL vars use the fr_ prefix.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

const PARTICLES_PER_POOL  = 80;
const BURST_POOL_SIZE     = 60;
const LOGO_RADIUS_DEFAULT = 0.5;  // matches CenterLogo fire ring innerR

// ─── Per-style pool init ───────────────────────────────────────────────────

function initWeldPool(count: number) {
  const starts     = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes  = new Float32Array(count);
  const offsets    = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const fr_angle = Math.random() * Math.PI * 2;
    const fr_r     = LOGO_RADIUS_DEFAULT * (1.0 + Math.random() * 0.1);
    starts[i * 3 + 0] = Math.cos(fr_angle) * fr_r;
    starts[i * 3 + 1] = Math.sin(fr_angle) * fr_r;
    starts[i * 3 + 2] = 0;
    // Fast radial outward
    const fr_speed = 1.2 + Math.random() * 1.5;
    velocities[i * 3 + 0] = Math.cos(fr_angle) * fr_speed;
    velocities[i * 3 + 1] = Math.sin(fr_angle) * fr_speed;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    lifetimes[i] = 0.3 + Math.random() * 0.5;
    offsets[i]   = Math.random() * lifetimes[i];
  }
  return { starts, velocities, lifetimes, offsets };
}

function initVolcanicPool(count: number) {
  const starts     = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes  = new Float32Array(count);
  const offsets    = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const fr_angle = Math.random() * Math.PI * 2;
    const fr_r     = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.1);
    starts[i * 3 + 0] = Math.cos(fr_angle) * fr_r;
    starts[i * 3 + 1] = Math.sin(fr_angle) * fr_r;
    starts[i * 3 + 2] = 0;
    // Slow radial + strong upward bias
    const fr_radial = 0.2 + Math.random() * 0.4;
    const fr_up     = 0.4 + Math.random() * 0.6;
    velocities[i * 3 + 0] = Math.cos(fr_angle) * fr_radial;
    velocities[i * 3 + 1] = Math.sin(fr_angle) * fr_radial + fr_up;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    lifetimes[i] = 1.5 + Math.random() * 2.0;
    offsets[i]   = Math.random() * lifetimes[i];
  }
  return { starts, velocities, lifetimes, offsets };
}

function initAmbientPool(count: number) {
  const starts     = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes  = new Float32Array(count);
  const offsets    = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const fr_angle = Math.random() * Math.PI * 2;
    const fr_r     = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.15);
    starts[i * 3 + 0] = Math.cos(fr_angle) * fr_r;
    starts[i * 3 + 1] = Math.sin(fr_angle) * fr_r;
    starts[i * 3 + 2] = 0;
    const fr_speed = 0.4 + Math.random() * 0.8;
    velocities[i * 3 + 0] = Math.cos(fr_angle) * fr_speed;
    velocities[i * 3 + 1] = Math.sin(fr_angle) * fr_speed + (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    lifetimes[i] = 0.8 + Math.random() * 1.2;
    offsets[i]   = Math.random() * lifetimes[i];
  }
  return { starts, velocities, lifetimes, offsets };
}

// ─── GLSL: Ambient layer ───────────────────────────────────────────────────

const SPARKS_AMBIENT_VERT = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uDrag;
uniform float uBaseSize;
uniform float uBeatPulse;
uniform float uVocalBoost;
uniform float uKick;
uniform float uHihat;
uniform float uStyleFlag;
uniform float uLogoSize;

attribute vec3  aStart;
attribute vec3  aVelocity;
attribute float aLifetime;
attribute float aOffset;

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
  // Self-respawn: age wraps at lifetime
  float fr_age = mod(uTime + aOffset, aLifetime);
  float fr_t   = fr_age / aLifetime;

  // Per-style lifetime multiplier (weld short, volcanic long, ambient mid)
  float fr_styleMul = uStyleFlag < 0.5 ? 1.0 : (uStyleFlag < 1.5 ? 2.5 : 1.5);

  // Velocity with vocal boost
  float fr_boost = 1.0 + uVocalBoost * 1.5;
  // Divide by uLogoSize so world-space speed stays constant when the
  // <points> group is scaled by logoSize in the frame loop.
  float fr_invLs = 1.0 / max(uLogoSize, 1.0);
  vec3  fr_vel   = aVelocity * fr_boost * fr_invLs;

  // Ballistic position with drag
  float fr_k   = uDrag;
  vec3  fr_pos = aStart + fr_vel / fr_k * (1.0 - exp(-fr_k * fr_age * fr_styleMul));
  fr_pos.y    -= 0.5 * uGravity * fr_invLs * fr_age * fr_age * fr_styleMul;

  vColor = fr_sparkColor(fr_t);

  // Alpha: bright early, exponential dropoff
  vAlpha = pow(1.0 - smoothstep(0.4, 1.0, fr_t), 2.0);

  // SIZE FIX: No longer divided by uLogoSize/240.
  // The <points> group is scaled by logoSize; perspective projection then
  // gives correct world-space size automatically. Large logos → big sparks.
  float fr_sz = uBaseSize * (1.0 - fr_t * 0.7)
              * (1.0 + uBeatPulse * 0.5)
              * (1.0 + uKick * 0.3);

  vec4 fr_mvPos = modelViewMatrix * vec4(fr_pos, 1.0);
  gl_PointSize  = fr_sz * (400.0 / -fr_mvPos.z);
  gl_Position   = projectionMatrix * fr_mvPos;
}
`;

const SPARKS_AMBIENT_FRAG = /* glsl */ `
varying vec3  vColor;
varying float vAlpha;

void main() {
  float fr_dist = distance(gl_PointCoord, vec2(0.5));

  // Tight core + wide halo
  float fr_core = 1.0 - smoothstep(0.0, 0.20, fr_dist);
  float fr_halo = 1.0 - smoothstep(0.0, 0.50, fr_dist);
  float fr_glow = pow(fr_core, 2.0) * 0.85 + fr_halo * 0.25;

  float fr_finalAlpha = fr_glow * vAlpha;

  // Additive blending: pre-multiply
  gl_FragColor = vec4(vColor * fr_finalAlpha, fr_finalAlpha);
}
`;

// ─── GLSL: Burst layer ─────────────────────────────────────────────────────

const SPARKS_BURST_VERT = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uDrag;
uniform float uBaseSize;
uniform float uLogoSize;

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

  // Not yet spawned or already dead — hide off-screen
  if (fr_age < 0.0 || fr_age > aLifetime) {
    gl_Position  = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor       = vec3(0.0);
    vAlpha       = 0.0;
    return;
  }

  float fr_t     = fr_age / aLifetime;
  float fr_invLs = 1.0 / max(uLogoSize, 1.0);
  float fr_k     = uDrag;
  vec3  fr_vel   = aVelocity * fr_invLs;
  vec3  fr_pos   = aStart + fr_vel / fr_k * (1.0 - exp(-fr_k * fr_age));
  fr_pos.y      -= 0.5 * uGravity * fr_invLs * fr_age * fr_age;

  vColor = fr_sparkColor(fr_t);
  vAlpha = pow(1.0 - smoothstep(0.3, 1.0, fr_t), 2.0);

  // SIZE FIX: same as ambient — no division by uLogoSize/240
  float fr_sz    = uBaseSize * (1.0 - fr_t * 0.75);
  vec4  fr_mvPos = modelViewMatrix * vec4(fr_pos, 1.0);
  gl_PointSize   = fr_sz * (400.0 / -fr_mvPos.z);
  gl_Position    = projectionMatrix * fr_mvPos;
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeAmbientGeo(init: ReturnType<typeof initWeldPool>) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLES_PER_POOL * 3);
  geo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aStart',    new THREE.BufferAttribute(init.starts, 3));
  geo.setAttribute('aVelocity', new THREE.BufferAttribute(init.velocities, 3));
  geo.setAttribute('aLifetime', new THREE.BufferAttribute(init.lifetimes, 1));
  geo.setAttribute('aOffset',   new THREE.BufferAttribute(init.offsets, 1));
  return geo;
}

function makeAmbientMat(styleFlag: number) {
  return new THREE.ShaderMaterial({
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
      uStyleFlag:  { value: styleFlag },
      uLogoSize:   { value: 240 },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
}

// ─── Component ────────────────────────────────────────────────────────────

export function LogoSparks() {
  const weldRef     = useRef<THREE.Points>(null);
  const volcanicRef = useRef<THREE.Points>(null);
  const ambientRef  = useRef<THREE.Points>(null);
  const burstRef    = useRef<THREE.Points>(null);

  // Beat detector
  const sparksBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(sparksBeatDetector);

  const sparksPhaseSrc = usePhaseSource({
    detector: sparksBeatDetector,
    getPrecomputedRange: () => {
      const sL = getSettings().logo;
      return { startHz: sL.fireFreqStart ?? 40, endHz: sL.fireFreqEnd ?? 160 };
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

  // ── Geometries (style-specific, baked at init) ───────────────────────────
  const weldGeo     = useMemo(() => makeAmbientGeo(initWeldPool(PARTICLES_PER_POOL)), []);
  const volcanicGeo = useMemo(() => makeAmbientGeo(initVolcanicPool(PARTICLES_PER_POOL)), []);
  const ambientGeo  = useMemo(() => makeAmbientGeo(initAmbientPool(PARTICLES_PER_POOL)), []);

  // ── Materials ────────────────────────────────────────────────────────────
  const weldMat     = useMemo(() => makeAmbientMat(0), []);
  const volcanicMat = useMemo(() => makeAmbientMat(1), []);
  const ambientMat  = useMemo(() => makeAmbientMat(2), []);

  // ── Burst pool ───────────────────────────────────────────────────────────
  const burstGeo = useMemo(() => {
    const geo         = new THREE.BufferGeometry();
    const positions   = new Float32Array(BURST_POOL_SIZE * 3);
    const aStarts     = new Float32Array(BURST_POOL_SIZE * 3);
    const aVelocities = new Float32Array(BURST_POOL_SIZE * 3);
    const aSpawnTimes = new Float32Array(BURST_POOL_SIZE);
    const aLifetimes  = new Float32Array(BURST_POOL_SIZE);
    for (let i = 0; i < BURST_POOL_SIZE; i++) {
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

  const burstMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SPARKS_BURST_VERT,
    fragmentShader: SPARKS_AMBIENT_FRAG,
    uniforms: {
      uTime:     { value: 0 },
      uGravity:  { value: 3.0 },
      uDrag:     { value: 2.5 },
      uBaseSize: { value: 5.0 },
      uLogoSize: { value: 240 },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sF = getSettings().logo as any;

    const fr_weldOn     = sF.sparksWeldEnabled     ?? false;
    const fr_volcanicOn = sF.sparksVolcanicEnabled ?? false;
    const fr_ambientOn  = sF.sparksAmbientEnabled  ?? false;

    // Visibility
    if (weldRef.current)     weldRef.current.visible     = fr_weldOn;
    if (volcanicRef.current) volcanicRef.current.visible = fr_volcanicOn;
    if (ambientRef.current)  ambientRef.current.visible  = fr_ambientOn;
    if (burstRef.current)    burstRef.current.visible    = fr_weldOn;

    const fr_anyOn = fr_weldOn || fr_volcanicOn || fr_ambientOn;
    if (!fr_anyOn) return;

    const fr_time     = state.clock.elapsedTime;
    const fr_beatPuls = sparksPhaseSrc();

    // Shared settings
    const fr_sparksSize     = sF.sparksSize      ?? 1.0;
    const fr_sparksGravity  = sF.sparksGravity   ?? 2.5;
    const fr_sparksDrag     = sF.sparksDrag      ?? 2.0;
    const fr_sparksSpread   = sF.sparksSpread    ?? 0.4;
    const fr_sparksSpeed    = sF.sparksSpeed     ?? 1.0;
    const fr_sparksBurst    = sF.sparksBurstCount ?? 30;

    // Logo world-size (mirrors CenterLogo formula)
    const { width, height } = state.size;
    const fr_vmin           = Math.min(width, height);
    const fr_vpScale        = Math.min(fr_vmin / 900, 1);
    const fr_logoSize       = (sF.size ?? 240) * fr_vpScale;
    const fr_totalScale     = fr_logoSize * (1.0 + fr_beatPuls * 0.15);

    // Per-style gravity / drag adjustments (visual tuning)
    const FR_WELD_GRAVITY    = fr_sparksGravity;
    const FR_WELD_DRAG       = fr_sparksDrag;
    const FR_VOLCANIC_GRAVITY = fr_sparksGravity * 0.3;
    const FR_VOLCANIC_DRAG   = fr_sparksDrag * 0.7;
    const FR_AMBIENT_GRAVITY  = fr_sparksGravity * 0.6;
    const FR_AMBIENT_DRAG    = fr_sparksDrag * 0.85;

    const fr_kick   = audioAnalysis.kickPhase  ?? 0;
    const fr_hihat  = audioAnalysis.hihatPhase ?? 0;
    const fr_vocal  = audioAnalysis.vocalPhase ?? 0;
    const fr_beat   = audioAnalysis.beatPhase  ?? 0;

    // Update material uniforms helper
    const fr_updateMat = (
      mat: THREE.ShaderMaterial,
      gravity: number,
      drag: number,
    ) => {
      const u = mat.uniforms;
      u.uTime.value       = fr_time;
      u.uGravity.value    = gravity;
      u.uDrag.value       = drag;
      u.uBaseSize.value   = fr_sparksSize * 4.0;
      u.uBeatPulse.value  = fr_beat;
      u.uVocalBoost.value = fr_vocal;
      u.uKick.value       = fr_kick;
      u.uHihat.value      = fr_hihat;
      u.uLogoSize.value   = fr_logoSize;
    };

    if (fr_weldOn) {
      fr_updateMat(weldMat, FR_WELD_GRAVITY, FR_WELD_DRAG);
      if (weldRef.current) weldRef.current.scale.set(fr_totalScale, fr_totalScale, 1);
    }
    if (fr_volcanicOn) {
      fr_updateMat(volcanicMat, FR_VOLCANIC_GRAVITY, FR_VOLCANIC_DRAG);
      if (volcanicRef.current) volcanicRef.current.scale.set(fr_totalScale, fr_totalScale, 1);
    }
    if (fr_ambientOn) {
      fr_updateMat(ambientMat, FR_AMBIENT_GRAVITY, FR_AMBIENT_DRAG);
      if (ambientRef.current) ambientRef.current.scale.set(fr_totalScale, fr_totalScale, 1);
    }

    // Burst material
    if (fr_weldOn) {
      const u = burstMat.uniforms;
      u.uTime.value     = fr_time;
      u.uGravity.value  = FR_WELD_GRAVITY;
      u.uDrag.value     = FR_WELD_DRAG;
      u.uBaseSize.value = fr_sparksSize * 6.0;
      u.uLogoSize.value = fr_logoSize;
      if (burstRef.current) burstRef.current.scale.set(fr_totalScale, fr_totalScale, 1);

      // Rising-edge kick burst
      if (fr_kick > 0.5 && prevKickRef.current <= 0.5) {
        const fr_n = Math.round(fr_sparksBurst * (fr_kick * 0.5 + 0.5));
        fr_spawnBurst(burstGeo, fr_n, fr_time, fr_sparksSpread, fr_sparksSpeed);
      }
      prevKickRef.current = fr_kick;

      // Rising-edge snare (smaller burst)
      const fr_snare = audioAnalysis.snarePhase ?? 0;
      if (fr_snare > 0.5 && prevSnareRef.current <= 0.5) {
        fr_spawnBurst(burstGeo, Math.round(fr_sparksBurst * 0.4), fr_time, fr_sparksSpread, fr_sparksSpeed);
      }
      prevSnareRef.current = fr_snare;
    } else {
      prevKickRef.current  = 0;
      prevSnareRef.current = 0;
    }
  });

  return (
    <>
      {/* Weld ambient pool */}
      <points ref={weldRef} position={[0, 0, 0.15]} renderOrder={9} frustumCulled={false}>
        <primitive object={weldGeo}  attach="geometry" />
        <primitive object={weldMat}  attach="material" />
      </points>

      {/* Volcanic ambient pool */}
      <points ref={volcanicRef} position={[0, 0, 0.16]} renderOrder={9} frustumCulled={false}>
        <primitive object={volcanicGeo} attach="geometry" />
        <primitive object={volcanicMat} attach="material" />
      </points>

      {/* Ambient pool */}
      <points ref={ambientRef} position={[0, 0, 0.17]} renderOrder={9} frustumCulled={false}>
        <primitive object={ambientGeo} attach="geometry" />
        <primitive object={ambientMat} attach="material" />
      </points>

      {/* Weld burst pool */}
      <points ref={burstRef} position={[0, 0, 0.15]} renderOrder={9} frustumCulled={false}>
        <primitive object={burstGeo} attach="geometry" />
        <primitive object={burstMat} attach="material" />
      </points>
    </>
  );
}

// ─── CPU burst helper ──────────────────────────────────────────────────────

let fr_burstCursor = 0;

function fr_spawnBurst(
  geo: THREE.BufferGeometry,
  count: number,
  currentTime: number,
  _spread: number,
  speedMul: number,
): void {
  const fr_aStarts     = geo.attributes['aStart']     as THREE.BufferAttribute;
  const fr_aVelocities = geo.attributes['aVelocity']  as THREE.BufferAttribute;
  const fr_aSpawnTimes = geo.attributes['aSpawnTime'] as THREE.BufferAttribute;
  const fr_aLifetimes  = geo.attributes['aLifetime']  as THREE.BufferAttribute;

  for (let n = 0; n < count; n++) {
    const fr_i     = fr_burstCursor++ % BURST_POOL_SIZE;
    const fr_angle = Math.random() * Math.PI * 2;
    const fr_r     = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.1);
    const fr_speed = (3.0 + Math.random() * 4.0) * speedMul;
    const fr_life  = 0.3 + Math.random() * 0.5;

    fr_aStarts.setXYZ(fr_i,
      Math.cos(fr_angle) * fr_r,
      Math.sin(fr_angle) * fr_r,
      0,
    );
    fr_aVelocities.setXYZ(fr_i,
      Math.cos(fr_angle) * fr_speed + (Math.random() - 0.5) * 0.3,
      Math.sin(fr_angle) * fr_speed + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.2,
    );
    fr_aSpawnTimes.setX(fr_i, currentTime);
    fr_aLifetimes.setX(fr_i, fr_life);
  }

  fr_aStarts.needsUpdate     = true;
  fr_aVelocities.needsUpdate = true;
  fr_aSpawnTimes.needsUpdate = true;
  fr_aLifetimes.needsUpdate  = true;
}
