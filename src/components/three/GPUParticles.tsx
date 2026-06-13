/**
 * GPUParticles — orbit particle system with connection lines.
 *
 * New: colorMode (accent/spectrum/mono/rainbow), opacity, sizeOnBeat,
 * connectionLines, twinkle toggle, reactiveAxis, orbitMode (circular/
 * elliptical/scatter), particleShape (circle/star/diamond), blendMode.
 */

import { useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';

const MAX_PARTICLES = 400;
const REF_VMIN      = 900;

interface ParticleState {
  x: number; y: number; baseX: number; baseY: number;
  orbitNorm: number; orbitAngle: number; orbitSpeed: number;
  vx: number; vy: number; size: number;
  alpha: number; alphaTarget: number; alphaSpeed: number;
  hue: number; hueOffset: number;
  // scatter drift
  driftVx: number; driftVy: number;
}

function createParticle(hue: number): ParticleState {
  return {
    x: 0, y: 0, baseX: 0, baseY: 0,
    orbitNorm:  Math.random(),
    orbitAngle: Math.random() * Math.PI * 2,
    orbitSpeed: (Math.random() - 0.5) * 0.004,
    vx: 0, vy: 0,
    size: 0.8 + Math.random() * 2.2,
    alpha: Math.random() * 0.5 + 0.1,
    alphaTarget: Math.random() * 0.7 + 0.1,
    alphaSpeed: 0.01 + Math.random() * 0.02,
    hue,
    hueOffset: (Math.random() - 0.5) * 30,
    driftVx: (Math.random() - 0.5) * 0.3,
    driftVy: (Math.random() - 0.5) * 0.3,
  };
}

function hexToHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 230;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >>  8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function lerpHue(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return ((a + d * t) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [f(h + 1/3), f(h), f(h - 1/3)];
}

// ── Shaders ───────────────────────────────────────────────────────────────

const vtx = /* glsl */ `
attribute float aSize;
attribute vec3  aColor;
attribute float aAlpha;
varying vec3  vColor;
varying float vAlpha;
void main() {
  vColor = aColor; vAlpha = aAlpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
  gl_Position  = projectionMatrix * mvPos;
}`;

const frag = /* glsl */ `
uniform int uShape; // 0=circle 1=star 2=diamond
varying vec3  vColor;
varying float vAlpha;

float starSDF(vec2 p, float r, int n) {
  float a = atan(p.y, p.x) + 3.14159 / float(n);
  float b = 3.14159 * 2.0 / float(n);
  vec2  q = length(p) * vec2(cos(mod(a, b) - b * 0.5), sin(mod(a, b) - b * 0.5));
  return max(q.x - r, r * 0.4 - q.y * 1.0);
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float alpha = 0.0;

  if (uShape == 1) {
    // 6-point star
    float d = starSDF(c, 0.45, 6);
    float inner = 1.0 - smoothstep(-0.02, 0.02, d);
    float glow  = exp(-length(c) * 6.0) * 0.4;
    alpha = (inner + glow) * vAlpha;
  } else if (uShape == 2) {
    // Diamond
    float d = abs(c.x) + abs(c.y);
    float inner = 1.0 - smoothstep(0.3, 0.35, d);
    float glow  = exp(-d * 5.0) * 0.4;
    alpha = (inner + glow) * vAlpha;
  } else {
    // Circle (default)
    float d = length(c);
    float inner = 1.0 - smoothstep(0.15, 0.5, d);
    float glow  = exp(-d * 4.0) * 0.5;
    alpha = (inner + glow) * vAlpha;
  }

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}`;

// ── Component ─────────────────────────────────────────────────────────────

export function GPUParticles() {
  useThree((s) => s.size);
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef  = useRef<THREE.LineSegments>(null);
  const timeRef   = useRef(0);
  const particleBeatDetector = useMemo(() => new FreqBeatDetector(), []);

  const particles = useMemo(() => {
    const accentHue    = hexToHue(getSettings().theme.accent);
    const secondaryHue = hexToHue(getSettings().theme.secondary);
    return Array.from({ length: MAX_PARTICLES }, (_, i) => {
      const base = i % 2 === 0 ? accentHue : lerpHue(accentHue, secondaryHue, 0.5);
      return createParticle(base);
    });
  }, []);

  // 4 random colors generated once per session for 'random' colorMode
  const randomColors = useMemo<[number, number, number][]>(() => {
    return Array.from({ length: 4 }, () => {
      const hVal = Math.random();
      const sVal = 0.7 + Math.random() * 0.3;
      const lVal = 0.45 + Math.random() * 0.2;
      return hslToRgb(hVal, sVal, lVal) as [number, number, number];
    });
  }, []);

  const { positions, sizes, colors, alphas } = useMemo(() => ({
    positions: new Float32Array(MAX_PARTICLES * 3),
    sizes:     new Float32Array(MAX_PARTICLES),
    colors:    new Float32Array(MAX_PARTICLES * 3),
    alphas:    new Float32Array(MAX_PARTICLES),
  }), []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
    g.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aAlpha',   new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, colors, alphas]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vtx, fragmentShader: frag,
    uniforms: { uShape: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  // Connection lines geometry
  const MAX_LINES = 200 * 199 / 2; // upper bound for 200 particles
  const linePositions = useMemo(() => new Float32Array(MAX_LINES * 6), []);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    return g;
  }, [linePositions]);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);

  useFrame((state, delta) => {
    const pts = pointsRef.current;
    if (!pts) return;
    timeRef.current += delta;

    const s  = getSettings();
    const sp = s.particles;

    if (!sp.enabled) { pts.visible = false; if (linesRef.current) linesRef.current.visible = false; return; }
    pts.visible = true;

    // Blend mode
    material.blending = sp.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;

    // Shape uniform
    material.uniforms.uShape.value =
      sp.particleShape === 'star' ? 1 : sp.particleShape === 'diamond' ? 2 : 0;

    const { width: w, height: h } = state.size;
    const vmin  = Math.min(w, h);
    const scale = Math.min(vmin / REF_VMIN, 1);

    const baseOrbit = sp.orbitRadius * scale;
    const orbitMin  = baseOrbit * 0.5;
    const orbitMax  = baseOrbit * 1.2;

    // Audio reactivity from configured Hz range
    const { bass, loudness } = audioAnalysis;
    const particleBeat = particleBeatDetector.update(audioAnalysis.rawFreqData, sp.reactiveFreqStart, sp.reactiveFreqEnd);
    const axisEnergy   = particleBeatDetector.energy;
    const kickForce    = Math.pow(particleBeat, 1.5) * 12 * Math.min(scale * 2, 1) * sp.kickBurstStrength;

    const count = Math.min(sp.count, MAX_PARTICLES);
    const posA  = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizeA = geometry.getAttribute('aSize')    as THREE.BufferAttribute;
    const colorA= geometry.getAttribute('aColor')   as THREE.BufferAttribute;
    const alphaA= geometry.getAttribute('aAlpha')   as THREE.BufferAttribute;

    for (let i = 0; i < count; i++) {
      const p = particles[i];

      // Orbit
      p.orbitAngle += p.orbitSpeed * sp.speed + loudness * 0.003;
      const orbitR = orbitMin + p.orbitNorm * (orbitMax - orbitMin);

      if (sp.orbitMode === 'scatter') {
        // Random drift constrained to orbit band
        p.driftVx += (Math.random() - 0.5) * 0.4;
        p.driftVy += (Math.random() - 0.5) * 0.4;
        p.driftVx *= 0.97; p.driftVy *= 0.97;
        const cx = Math.cos(p.orbitAngle) * orbitR;
        const cy = Math.sin(p.orbitAngle) * orbitR;
        p.baseX = cx + p.driftVx * 20 * sp.spread;
        p.baseY = cy + p.driftVy * 20 * sp.spread;
      } else {
        const spreadOff = (p.orbitSpeed > 0 ? 1 : -1) * sp.spread * 15 * Math.sin(p.orbitAngle * 3);
        const rx = orbitR + spreadOff;
        const ry = rx * (sp.orbitMode === 'elliptical' ? sp.ellipseRatio : 1.0);
        p.baseX = Math.cos(p.orbitAngle) * rx;
        p.baseY = Math.sin(p.orbitAngle) * ry;
      }

      // Physics (spring + kick)
      if (kickForce > 0.05) {
        const dx = p.x, dy = p.y;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        p.vx += (dx / len) * kickForce;
        p.vy += (dy / len) * kickForce;
      }
      p.vx += (p.baseX - p.x) * 0.04;
      p.vy += (p.baseY - p.y) * 0.04;
      p.vx *= 0.88; p.vy *= 0.88;
      p.x  += p.vx; p.y += p.vy;

      // Alpha (twinkle)
      if (sp.twinkle) {
        const aspd = p.alphaSpeed * sp.twinkleSpeed;
        if (Math.abs(p.alpha - p.alphaTarget) < 0.01)
          p.alphaTarget = 0.08 + Math.random() * 0.65;
        p.alpha += (p.alphaTarget - p.alpha) * aspd;
      }

      posA.array[i*3]   = p.x;
      posA.array[i*3+1] = p.y;
      posA.array[i*3+2] = 0;
      sizeA.array[i] = (p.size * sp.size + axisEnergy * 1.5 + particleBeat * sp.sizeOnBeat) * Math.min(scale * 2, 1) * 3;
      alphaA.array[i] = Math.min(1, p.alpha + loudness * 0.4) * sp.opacity;

      // Color mode
      let r = 1, g_ = 1, b_ = 1;
      if (sp.colorMode === 'solid') {
        [r, g_, b_] = hexToRgb(sp.solidColor);
      } else if (sp.colorMode === 'custom') {
        // Map particle index proportionally across user-defined color zones
        const zoneIdx = Math.min(
          Math.floor((i / count) * sp.customColors.length),
          sp.customColors.length - 1
        );
        [r, g_, b_] = hexToRgb(sp.customColors[zoneIdx] || '#ffffff');
        // Audio-reactive brightness variation
        const lMul = 0.8 + bass * 0.3 + loudness * 0.2;
        r *= lMul; g_ *= lMul; b_ *= lMul;
      } else if (sp.colorMode === 'rainbow') {
        const hue = ((i / count) * 360 + timeRef.current * 30) % 360;
        const l   = (40 + bass * 35 + loudness * 20) / 100;
        [r, g_, b_] = hslToRgb(hue / 360, 0.9, l);
      } else {
        // random — 4 colors fixed at session start
        [r, g_, b_] = randomColors[i % randomColors.length];
      }
      colorA.array[i*3]   = r;
      colorA.array[i*3+1] = g_;
      colorA.array[i*3+2] = b_;
    }

    // Hide unused
    for (let i = count; i < MAX_PARTICLES; i++) {
      posA.array[i*3+2] = -9999;
      sizeA.array[i]    = 0;
      alphaA.array[i]   = 0;
    }

    posA.needsUpdate  = true;
    sizeA.needsUpdate = true;
    colorA.needsUpdate= true;
    alphaA.needsUpdate= true;
    geometry.setDrawRange(0, count);

    // ── Connection lines ───────────────────────────────────────────────
    const lines = linesRef.current;
    if (!lines) return;

    if (!sp.connectionLines) {
      lines.visible = false;
      return;
    }

    lines.visible = true;
    lineMat.opacity = sp.connectionOpacity * (0.5 + bass * 0.5);
    lineMat.color.set(s.theme.accent);
    lineMat.blending = sp.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;

    const effectiveCount = Math.min(count, 200);
    const distSq = sp.connectionDistance * sp.connectionDistance * scale * scale;
    let segIdx = 0;

    for (let i = 0; i < effectiveCount; i++) {
      const pi = particles[i];
      for (let j = i + 1; j < effectiveCount; j++) {
        const pj  = particles[j];
        const dx  = pi.x - pj.x, dy = pi.y - pj.y;
        if (dx*dx + dy*dy < distSq && segIdx + 5 < linePositions.length) {
          linePositions[segIdx]   = pi.x; linePositions[segIdx+1] = pi.y; linePositions[segIdx+2] = 0;
          linePositions[segIdx+3] = pj.x; linePositions[segIdx+4] = pj.y; linePositions[segIdx+5] = 0;
          segIdx += 6;
        }
      }
    }

    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    lineGeo.setDrawRange(0, (segIdx / 3));
  });

  return (
    <>
      <points ref={pointsRef} position={[0, 0, -3]} renderOrder={4} frustumCulled={false}>
        <primitive object={geometry} attach="geometry" />
        <primitive object={material} attach="material" />
      </points>
      <lineSegments ref={linesRef} position={[0, 0, -3.1]} renderOrder={3} frustumCulled={false}>
        <primitive object={lineGeo} attach="geometry" />
        <primitive object={lineMat} attach="material" />
      </lineSegments>
    </>
  );
}
