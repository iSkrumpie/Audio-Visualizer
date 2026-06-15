/**
 * LogoSparks — single audio-reactive sparks/embers pool (v16)
 *
 * One pool, one toggle. Audio-reactive via the multi-band precomputed
 * phases (kick/snare/vocal/hihat) plus the legacy fire BeatDetector.
 *
 * z=0.15, renderOrder=9. ANGLE-safety: ALL local GLSL vars use fr_ prefix.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

const AMBIENT_COUNT      = 120;
const BURST_POOL_SIZE    = 80;
const LOGO_RADIUS_DEFAULT = 0.5;  // matches CenterLogo fire ring innerR

// ─── Pool init ─────────────────────────────────────────────────────────────

function initAmbientPool(count: number) {
  // Mid-life sparks: moderate radial + small upward, randomized
  const starts     = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes  = new Float32Array(count);
  const offsets    = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r     = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.15);
    starts[i * 3 + 0] = Math.cos(angle) * r;
    starts[i * 3 + 1] = Math.sin(angle) * r;
    starts[i * 3 + 2] = 0;
    // Mid-speed radial + small upward
    const speed  = 0.6 + Math.random() * 1.4;
    const upBias = 0.15 + Math.random() * 0.4;
    velocities[i * 3 + 0] = Math.cos(angle) * speed;
    velocities[i * 3 + 1] = Math.sin(angle) * speed + upBias;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    lifetimes[i] = 0.6 + Math.random() * 1.4;
    offsets[i]   = Math.random() * lifetimes[i];
  }
  return { starts, velocities, lifetimes, offsets };
}

// ─── GLSL: Ambient (self-respawn) ─────────────────────────────────────────

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
uniform float uLogoSize;
uniform vec3  uColorHot;   // user-tunable hot color (freshly spawned)
uniform vec3  uColorMid;   // user-tunable mid color (cooling, middle of gradient)
uniform vec3  uColorCool;  // user-tunable cool color (about to die)

attribute vec3  aStart;
attribute vec3  aVelocity;
attribute float aLifetime;
attribute float aOffset;

varying vec3  vColor;
varying float vAlpha;

vec3 fr_sparkColor(float t) {
  t = clamp(t, 0.0, 1.0);
  // 4-stop gradient: hot -> mid -> cool -> black (death)
  float s = t * 3.0;
  vec3 col = mix(uColorHot,  uColorMid,  clamp(s,         0.0, 1.0));
  col = mix(col,           uColorCool, clamp(s - 1.0,   0.0, 1.0));
  col = mix(col,           vec3(0.0),  clamp(s - 2.0,   0.0, 1.0));
  return col;
}

void main() {
  float age = mod(uTime + aOffset, aLifetime);
  float t   = age / aLifetime;

  // Velocity scaled by group + normalized by uLogoSize so world speed stays constant
  float boost = 1.0 + uVocalBoost * 1.5;
  float invLs = 1.0 / max(uLogoSize, 1.0);
  vec3 vel    = aVelocity * boost * invLs;

  // Ballistic position with drag
  float k   = uDrag;
  vec3 pos  = aStart + vel / k * (1.0 - exp(-k * age));
  pos.y    -= 0.5 * uGravity * age * age * invLs;

  vColor  = fr_sparkColor(t);
  vAlpha  = pow(1.0 - smoothstep(0.4, 1.0, t), 2.0);

  // Size: big when hot, shrinks over life. NOT divided by uLogoSize — bigger
  // logo = bigger sparks (this is the v15 fix).
  float sz = uBaseSize * (1.0 - t * 0.7) * (1.0 + uBeatPulse * 0.5) * (1.0 + uKick * 0.3);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = sz * (400.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const SPARKS_FRAG = /* glsl */ `
varying vec3  vColor;
varying float vAlpha;

void main() {
  float dist = distance(gl_PointCoord, vec2(0.5));
  float core = 1.0 - smoothstep(0.0, 0.20, dist);
  float halo = 1.0 - smoothstep(0.0, 0.50, dist);
  float glow = pow(core, 2.0) * 0.85 + halo * 0.25;
  float a    = glow * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

// ─── GLSL: Burst (CPU-controlled spawn) ──────────────────────────────────

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

vec3 fr_sparkColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(1.00, 0.97, 0.88);
  vec3 c1 = vec3(1.00, 0.93, 0.31);
  vec3 c2 = vec3(1.00, 0.48, 0.00);
  vec3 c3 = vec3(0.80, 0.13, 0.00);
  vec3 c4 = vec3(0.33, 0.00, 0.00);
  float s = t * 4.0;
  vec3 col = mix(c0, c1, clamp(s,        0.0, 1.0));
  col = mix(col, c2, clamp(s - 1.0, 0.0, 1.0));
  col = mix(col, c3, clamp(s - 2.0, 0.0, 1.0));
  col = mix(col, c4, clamp(s - 3.0, 0.0, 1.0));
  return col;
}

void main() {
  float age = uTime - aSpawnTime;
  if (age < 0.0 || age > aLifetime) {
    gl_Position  = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
    return;
  }
  float t    = age / aLifetime;
  float invLs = 1.0 / max(uLogoSize, 1.0);
  vec3 vel   = aVelocity * invLs;
  float k    = uDrag;
  vec3 pos   = aStart + vel / k * (1.0 - exp(-k * age));
  pos.y    -= 0.5 * uGravity * age * age * invLs;
  vColor  = fr_sparkColor(t);
  vAlpha  = pow(1.0 - smoothstep(0.3, 1.0, t), 2.0);
  float sz = uBaseSize * (1.0 - t * 0.75);
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = sz * (400.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

// ─── Component ─────────────────────────────────────────────────────────────

let burstCursor = 0;

function spawnBurst(
  geo: THREE.BufferGeometry,
  count: number,
  currentTime: number,
  speedMul: number,
  spread: number,
): void {
  const aStarts     = geo.attributes['aStart']     as THREE.BufferAttribute;
  const aVelocities = geo.attributes['aVelocity']  as THREE.BufferAttribute;
  const aSpawnTimes = geo.attributes['aSpawnTime'] as THREE.BufferAttribute;
  const aLifetimes  = geo.attributes['aLifetime']  as THREE.BufferAttribute;

  for (let n = 0; n < count; n++) {
    const i = burstCursor++ % BURST_POOL_SIZE;
    const angle  = Math.random() * Math.PI * 2;
    const r      = LOGO_RADIUS_DEFAULT * (0.95 + Math.random() * 0.1);
    const speed  = (2.5 + Math.random() * 3.0) * speedMul;
    const lifetime = 0.4 + Math.random() * 0.4;
    aStarts.setXYZ(i, Math.cos(angle) * r, Math.sin(angle) * r, 0);
    aVelocities.setXYZ(
      i,
      Math.cos(angle) * speed + (Math.random() - 0.5) * spread,
      Math.sin(angle) * speed + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.2,
    );
    aSpawnTimes.setX(i, currentTime);
    aLifetimes.setX(i, lifetime);
  }

  aStarts.needsUpdate     = true;
  aVelocities.needsUpdate = true;
  aSpawnTimes.needsUpdate = true;
  aLifetimes.needsUpdate  = true;
}

export function LogoSparks() {
  const ambientRef = useRef<THREE.Points>(null);
  const burstRef   = useRef<THREE.Points>(null);

  // Beat detector for global spark trigger
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

  // ── Ambient pool geometry ────────────────────────────
  const ambientGeo = useMemo(() => {
    const { starts, velocities, lifetimes, offsets } = initAmbientPool(AMBIENT_COUNT);
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(AMBIENT_COUNT * 3);
    geo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aStart',    new THREE.BufferAttribute(starts, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('aLifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('aOffset',   new THREE.BufferAttribute(offsets, 1));
    return geo;
  }, []);

  const ambientMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SPARKS_AMBIENT_VERT,
    fragmentShader: SPARKS_FRAG,
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
      uLogoSize:   { value: 240 },
      uColorHot:   { value: new THREE.Color('#fff5d8') },
      uColorMid:   { value: new THREE.Color('#ff7700') },
      uColorCool:  { value: new THREE.Color('#aa0000') },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  }), []);

  // ── Burst pool geometry (CPU-spawned on beat) ─────────
  const burstGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
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
    fragmentShader: SPARKS_FRAG,
    uniforms: {
      uTime:     { value: 0 },
      uGravity:  { value: 2.5 },
      uDrag:     { value: 2.0 },
      uBaseSize: { value: 5.0 },
      uLogoSize: { value: 240 },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  }), []);

  // ── Rising-edge state ────────────────────────────────
  const prevKickRef  = useRef(0);
  const prevSnareRef = useRef(0);

  // ── Per-frame ────────────────────────────────────────
  useFrame((state) => {
    const sL = getSettings().logo as any;
    const enabled = sL.sparksEnabled ?? false;

    if (ambientRef.current) ambientRef.current.visible = enabled;
    if (burstRef.current)   burstRef.current.visible   = enabled;

    if (!enabled) return;

    // Compute logo scale (matches CenterLogo's mesh scale)
    const { width, height } = state.size;
    const vmin = Math.min(width, height);
    const viewportScale = Math.min(vmin / 900, 1);
    const logoSize = (sL.size ?? 240) * viewportScale;

    const time = state.clock.elapsedTime;
    const beatPulse = sparksPhaseSrc();

    // Shared spark settings
    const sparksSize    = sL.sparksSize       ?? 1.0;
    const sparksSpeed   = sL.sparksSpeed      ?? 1.0;
    const sparksBurst   = sL.sparksBurstCount ?? 30;
    const sparksGravity = sL.sparksGravity    ?? 2.5;
    const sparksDrag    = sL.sparksDrag       ?? 2.0;
    const sparksSpread  = sL.sparksSpread     ?? 0.4;
    const sparksOpacity = sL.sparksOpacity    ?? 0.9;

    // Update ambient uniforms
    const aU = ambientMat.uniforms;
    aU.uTime.value       = time;
    aU.uGravity.value    = sparksGravity;
    aU.uDrag.value       = sparksDrag;
    aU.uBaseSize.value   = sparksSize * 4.0 * sparksOpacity;
    aU.uBeatPulse.value  = beatPulse;
    aU.uVocalBoost.value = audioAnalysis.vocalPhase ?? 0;
    aU.uKick.value       = audioAnalysis.kickPhase  ?? 0;
    aU.uHihat.value      = audioAnalysis.hihatPhase ?? 0;
    aU.uLoudness.value   = audioAnalysis.loudness   ?? 0;
    aU.uLogoSize.value   = logoSize;
    aU.uColorHot.value.set(sL.sparksColorHot ?? '#fff5d8');
    aU.uColorMid.value.set(sL.sparksColorMid ?? '#ff7700');
    aU.uColorCool.value.set(sL.sparksColorCool ?? '#aa0000');

    // Update burst uniforms
    const bU = burstMat.uniforms;
    bU.uTime.value     = time;
    bU.uGravity.value  = sparksGravity;
    bU.uDrag.value     = sparksDrag;
    bU.uBaseSize.value = sparksSize * 6.0;
    bU.uLogoSize.value = logoSize;

    // Apply group scale to both
    const groupScale = logoSize * (1.0 + beatPulse * 0.10);
    if (ambientRef.current) ambientRef.current.scale.set(groupScale, groupScale, 1);
    if (burstRef.current)   burstRef.current.scale.set(groupScale, groupScale, 1);

    // Rising-edge kick → burst
    const kick = audioAnalysis.kickPhase ?? 0;
    if (kick > 0.5 && prevKickRef.current <= 0.5) {
      const n = Math.round(sparksBurst * (kick * 0.5 + 0.5));
      spawnBurst(burstGeo, n, time, sparksSpeed, sparksSpread);
    }
    prevKickRef.current = kick;

    // Rising-edge snare → smaller burst
    const snare = audioAnalysis.snarePhase ?? 0;
    if (snare > 0.5 && prevSnareRef.current <= 0.5) {
      spawnBurst(burstGeo, Math.round(sparksBurst * 0.4), time, sparksSpeed, sparksSpread);
    }
    prevSnareRef.current = snare;
  });

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
