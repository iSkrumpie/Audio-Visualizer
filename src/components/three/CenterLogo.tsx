/**
 * CenterLogo — center logo with:
 *  - Outer glow (ShaderMaterial radial falloff plane, outward from logo edge)
 *  - Inner glow (soft falloff from logo edge inward toward center, additive)
 *  - Fire ring effect (fBm procedural fire via RingGeometry + ShaderMaterial)
 *  - Frequency-based audio reactivity via FreqBeatDetector
 *  - Beat scale driven by logo freq range
 *
 * v12: renamed glow → outerGlow, added innerGlow (soft falloff)
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAudioStore } from '@/lib/audioStore';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { useSettingsStore } from '@/lib/settingsStore';
import { useBeatDetectorRegistration } from './AudioScene';
import { FreqBeatDetector } from '@/lib/audioUtils';

const REF_VMIN = 900;

// ─── Shared vertex shader ─────────────────────────────────────────────────────

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ─── Outer Glow fragment shader ───────────────────────────────────────────────
// Alpha peaks just outside the logo edge, falls off outward.

const OUTER_GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3  uGwColor;
uniform float uGwIntensity;
uniform float uGwSize;
uniform float uGwBlur;
uniform float uGwBeat;

void main() {
  vec2  gw_center  = vUv - 0.5;
  float gw_dist    = length(gw_center) * 2.0;

  float gw_logoEdge = 1.0 / uGwSize;
  float gw_falloff  = max(0.0, gw_dist - gw_logoEdge * 0.8);
  float gw_blur     = max(0.01, uGwBlur * 0.02);
  float gw_alpha    = exp(-gw_falloff * gw_falloff / (gw_blur * gw_blur));

  // Fade to zero at geometry edge so no hard cutoff is visible
  float gw_edgeFade = 1.0 - smoothstep(0.7, 1.0, gw_dist);
  gw_alpha *= gw_edgeFade;

  gw_alpha *= uGwIntensity * (1.0 + uGwBeat * 0.5);

  if (gw_alpha < 0.005) discard;
  gl_FragColor = vec4(uGwColor, gw_alpha);
}
`;

// ─── Inner Glow fragment shader ───────────────────────────────────────────────
// Alpha peaks at the logo edge, decays INWARD toward center.
// soft falloff: exp(-falloff^2/blur^2), fade to 0 at center via smoothstep.

const INNER_GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3  uIgColor;
uniform float uIgIntensity;
uniform float uIgSize;
uniform float uIgBlur;
uniform float uIgBeat;

void main() {
  vec2  ig_center  = vUv - 0.5;
  float ig_dist    = length(ig_center) * 2.0;

  float ig_logoEdge = 1.0 / uIgSize;
  // falloff is positive when we're inside the logo edge (moving toward center)
  float ig_falloff  = max(0.0, ig_logoEdge - ig_dist);
  float ig_blur     = max(0.01, uIgBlur * 0.02);
  float ig_alpha    = exp(-ig_falloff * ig_falloff / (ig_blur * ig_blur));

  // Mirror of outer's edge fade: bring alpha to 0 at the very center
  float ig_edgeFade = smoothstep(0.0, 0.3, ig_dist);
  ig_alpha *= ig_edgeFade;

  // Clip to just inside the logo boundary (no spill outside)
  float ig_outerClip = 1.0 - smoothstep(ig_logoEdge - 0.05, ig_logoEdge + 0.1, ig_dist);
  ig_alpha *= ig_outerClip;

  ig_alpha *= uIgIntensity * (1.0 + uIgBeat * 0.5);

  if (ig_alpha < 0.005) discard;
  gl_FragColor = vec4(uIgColor, ig_alpha);
}
`;

// ─── Fire ShaderMaterial sources ──────────────────────────────────────────────

const FIRE_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uFrBass;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Ruffle the outer edge with multi-wave displacement
  float outerWeight = smoothstep(0.3, 1.0, uv.y);
  float wave = sin(uv.x * 12.0 + uTime * 3.5) * 0.04
             + sin(uv.x * 7.0  - uTime * 2.1) * 0.025;
  wave *= outerWeight * (1.0 + uFrBass * 1.5);
  vec2 radialDir = normalize(pos.xy);
  pos.xy += radialDir * wave;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uFrBass;
uniform float uFrBeat;
uniform float uFrIntensity;
uniform vec3  uFrColorInner;
uniform vec3  uFrColorMid;
uniform vec3  uFrColorOuter;

// Value noise helpers (fr_ prefix for ANGLE safety)
float fr_hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 18.5453);
  return fract(p.x * p.y);
}

float fr_vnoise(vec2 p) {
  vec2 fr_i = floor(p);
  vec2 fr_f = fract(p);
  vec2 fr_u = fr_f * fr_f * (3.0 - 2.0 * fr_f);
  return mix(
    mix(fr_hash(fr_i),              fr_hash(fr_i + vec2(1.0, 0.0)), fr_u.x),
    mix(fr_hash(fr_i + vec2(0.0, 1.0)), fr_hash(fr_i + vec2(1.0, 1.0)), fr_u.x),
    fr_u.y
  );
}

float fr_fbm(vec2 p) {
  float fr_v = 0.0;
  float fr_a = 0.5;
  mat2  fr_m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int fr_o = 0; fr_o < 5; fr_o++) {
    fr_v += fr_a * fr_vnoise(p);
    p     = fr_m * p;
    fr_a *= 0.5;
  }
  return fr_v;
}

void main() {
  float fr_radial = vUv.y;  // 0 = inner (base), 1 = outer (tip)
  float fr_circ   = vUv.x;  // 0..1 around circumference

  vec2  fr_noiseUv = vec2(fr_circ * 4.0, fr_radial * 2.5 - uTime * 0.9);
  float fr_n1      = fr_fbm(fr_noiseUv);
  float fr_n2      = fr_fbm(fr_noiseUv * 1.8 + vec2(3.7, uTime * 0.4));
  float fr_noise   = fr_n1 * 0.65 + fr_n2 * 0.35;

  float fr_baseMask  = smoothstep(0.0, 0.08, fr_radial);
  float fr_bassLift  = 1.0 + uFrBass * 0.6 + uFrBeat * 0.3;
  float fr_scaledR   = fr_radial / fr_bassLift;
  float fr_threshold = fr_scaledR + fr_noise * 0.45;
  float fr_flame     = smoothstep(1.0, 0.5, fr_threshold);
  fr_flame *= fr_baseMask;
  fr_flame *= uFrIntensity;

  if (fr_flame < 0.01) discard;

  float fr_heat = 1.0 - fr_scaledR;
  vec3 fr_col = mix(uFrColorOuter, uFrColorMid, smoothstep(0.0, 0.4, fr_heat));
  fr_col      = mix(fr_col, uFrColorInner,      smoothstep(0.4, 0.9, fr_heat));
  fr_col     += vec3(1.0) * uFrBeat * smoothstep(0.8, 1.0, fr_heat) * 0.4;
  fr_col     *= fr_flame;

  gl_FragColor = vec4(fr_col, fr_flame * 0.95);
}
`;

// ─── Shared glow color computation ───────────────────────────────────────────
// Module-level helper — computes glow color into `target` based on colorMode.
// Called for both outer and inner glows with their own hueRef instances.

function computeGlowColor(
  mode: 'solid' | 'rainbow' | 'custom' | 'random',
  hueRef: { current: number },
  scratch: THREE.Color[],
  randomColors: THREE.Color[],
  time: number,
  delta: number,
  solidColor: string,
  customColors: string[],
  cycleSpeed: number,
  themeAccent: string,
  target: THREE.Color,
): void {
  if (mode === 'solid') {
    target.set(solidColor || themeAccent);
  } else if (mode === 'rainbow') {
    hueRef.current = (hueRef.current + delta * cycleSpeed * 0.05) % 1;
    target.setHSL(hueRef.current, 0.9, 0.55);
  } else if (mode === 'custom') {
    const cols: string[] = (customColors?.length ?? 0) > 0
      ? customColors
      : ['#6366F1', '#22D3EE', '#F472B6', '#F59E0B'];
    const fi   = ((time * cycleSpeed * 0.05) % 1) * cols.length;
    const i0   = Math.floor(fi) % cols.length;
    const i1   = (i0 + 1) % cols.length;
    scratch[0].set(cols[i0]);
    scratch[1].set(cols[i1]);
    target.lerpColors(scratch[0], scratch[1], fi - Math.floor(fi));
  } else {
    // random
    const fi = ((time * cycleSpeed * 0.05) % 1) * randomColors.length;
    const i0 = Math.floor(fi) % randomColors.length;
    const i1 = (i0 + 1) % randomColors.length;
    target.lerpColors(randomColors[i0], randomColors[i1], fi - Math.floor(fi));
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CenterLogo() {
  const logoObjectUrl = useAudioStore((s) => s.logoObjectUrl);
  const logoFile      = useAudioStore((s) => s.logoFile);
  const enabled       = useSettingsStore((s) => s.settings.logo.enabled);

  if (!enabled || !logoObjectUrl || !logoFile) return null;
  return <LogoInner logoUrl={logoObjectUrl} />;
}

function LogoInner({ logoUrl }: { logoUrl: string }) {
  const meshRef         = useRef<THREE.Mesh>(null);
  const outerGlowRef    = useRef<THREE.Mesh>(null);
  const innerGlowRef    = useRef<THREE.Mesh>(null);
  const fireRef         = useRef<THREE.Mesh>(null);
  const logoMatRef      = useRef<THREE.MeshBasicMaterial>(null);
  const rotRef              = useRef(0);
  const timeRef             = useRef(0);
  const outerRainbowHueRef  = useRef(0);
  const innerRainbowHueRef  = useRef(0);

  // 4 random hues generated once at session start, for 'random' glow color mode
  // Shared between outer and inner glow.
  const glowRandomColors = useMemo(() =>
    [0, 0.25, 0.5, 0.75].map((base) =>
      new THREE.Color().setHSL((base + Math.random() * 0.2) % 1, 0.9, 0.55)
    )
  , []);
  // Scratch colors for smooth lerping in custom/random mode (avoids per-frame allocation)
  // Shared between outer and inner glow.
  const glowScratch = useMemo(() => [new THREE.Color(), new THREE.Color()], []);

  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const img    = new Image();
    img.onload   = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror  = () => setImgSize({ w: 1, h: 1 });
    img.src      = logoUrl;
  }, [logoUrl]);

  // ── Logo texture with circular alpha mask ───────────────────────────────────
  const texture = useMemo(() => {
    const diameter = 1024;
    const canvas   = document.createElement('canvas');
    canvas.width   = diameter;
    canvas.height  = diameter;
    const ctx      = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, diameter, diameter);
    const tex      = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter  = THREE.LinearFilter;
    tex.magFilter  = THREE.LinearFilter;

    if (imgSize) {
      const img        = new Image();
      img.crossOrigin  = 'anonymous';
      img.onload = () => {
        ctx.clearRect(0, 0, diameter, diameter);
        const drawW = (diameter * imgSize.w) / imgSize.h;
        const drawH = diameter;
        ctx.drawImage(img, (diameter - drawW) / 2, 0, drawW, drawH);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        tex.needsUpdate = true;
      };
      img.src = logoUrl;
    }
    return tex;
  }, [logoUrl, imgSize]);

  // ── Logo geometry ────────────────────────────────────────────────────────────
  const logoGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // ── Outer Glow uniforms (created once, mutated in useFrame) ─────────────────
  const outerGlowUniforms = useMemo(() => ({
    uGwColor:     { value: new THREE.Color('#6366F1') },
    uGwIntensity: { value: 0.5 },
    uGwSize:      { value: 1.15 },
    uGwBlur:      { value: 15.0 },
    uGwBeat:      { value: 0.0 },
  }), []);

  const outerGlowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   GLOW_VERT,
    fragmentShader: OUTER_GLOW_FRAG,
    uniforms:       outerGlowUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [outerGlowUniforms]);

  const outerGlowGeo = useMemo(() => new THREE.CircleGeometry(0.5, 64), []);

  // ── Inner Glow uniforms (created once, mutated in useFrame) ─────────────────
  const innerGlowUniforms = useMemo(() => ({
    uIgColor:     { value: new THREE.Color('#6366F1') },
    uIgIntensity: { value: 0.0 },
    uIgSize:      { value: 1.0 },
    uIgBlur:      { value: 15.0 },
    uIgBeat:      { value: 0.0 },
  }), []);

  const innerGlowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   GLOW_VERT,
    fragmentShader: INNER_GLOW_FRAG,
    uniforms:       innerGlowUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
  }), [innerGlowUniforms]);

  const innerGlowGeo = useMemo(() => new THREE.CircleGeometry(0.5, 64), []);

  // ── Fire uniforms (created once, mutated in useFrame) ───────────────────────
  const fireUniforms = useMemo(() => ({
    uTime:         { value: 0.0 },
    uFrBass:       { value: 0.0 },
    uFrBeat:       { value: 0.0 },
    uFrIntensity:  { value: 1.0 },
    uFrColorInner: { value: new THREE.Color('#ff2200') },
    uFrColorMid:   { value: new THREE.Color('#ff7700') },
    uFrColorOuter: { value: new THREE.Color('#ffee88') },
  }), []);

  const fireMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    uniforms:       fireUniforms,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    toneMapped:     false,
    side:           THREE.DoubleSide,
  }), [fireUniforms]);

  // ── Fire geometry — rebuilds when fireHeight changes ─────────────────────────
  const fireHeightRef  = useRef<number>(-1);
  const fireGeoRef     = useRef<THREE.RingGeometry | null>(null);
  const logoBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  const fireBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(logoBeatDetector);
  useBeatDetectorRegistration(fireBeatDetector);

  // ── useFrame: update all reactive state ─────────────────────────────────────
  useFrame((state, delta) => {
    const s   = getSettings().logo;
    const { width, height } = state.size;
    const vmin  = Math.min(width, height);
    const scale = Math.min(vmin / REF_VMIN, 1);
    const theme = getSettings().theme;

    // Advance time for fire animation
    timeRef.current += delta * (s.fireSpeed > 0 ? s.fireSpeed : 1.0);

    // ── Frequency energy ──────────────────────────────────────────────────────
    const rawData    = audioAnalysis.rawFreqData;
    logoBeatDetector.setSensitivity(s.beatFxSensitivity ?? 1.0);
    fireBeatDetector.setSensitivity(s.fireSensitivity ?? 1.0);
    const logoBeat   = logoBeatDetector.update(rawData, s.beatFxFreqStart, s.beatFxFreqEnd);
    const fireBeat   = fireBeatDetector.update(rawData, s.fireFreqStart, s.fireFreqEnd);
    const fireEnergy = fireBeatDetector.energy;

    // ── Logo mesh ─────────────────────────────────────────────────────────────
    const logoSize  = s.size * scale;
    const beatScale = 1 + logoBeat * (s.beatScaleStrength ?? 0.5) * 0.15;

    if (meshRef.current) {
      meshRef.current.position.set(0, 0, 0);
      meshRef.current.scale.set(logoSize * beatScale, logoSize * beatScale, 1);
      meshRef.current.rotation.z = rotRef.current;
    }
    if (logoMatRef.current) {
      logoMatRef.current.opacity = s.opacity;
    }

    // ── Outer Glow plane ─────────────────────────────────────────────────────
    const outerGlowEnabled = s.outerGlowEnabled ?? DEFAULT_SETTINGS.logo.outerGlowEnabled;
    if (outerGlowRef.current) {
      outerGlowRef.current.visible = outerGlowEnabled;
      if (outerGlowEnabled) {
        const outerPlaneSize = logoSize * (s.outerGlowSize ?? DEFAULT_SETTINGS.logo.outerGlowSize);
        outerGlowRef.current.position.set(0, 0, -0.1);
        outerGlowRef.current.scale.set(outerPlaneSize, outerPlaneSize, 1);
        outerGlowRef.current.rotation.z = rotRef.current;
      }
    }

    // ── Outer Glow color ─────────────────────────────────────────────────────
    computeGlowColor(
      (s.outerGlowColorMode ?? DEFAULT_SETTINGS.logo.outerGlowColorMode) as 'solid' | 'rainbow' | 'custom' | 'random',
      outerRainbowHueRef,
      glowScratch,
      glowRandomColors,
      timeRef.current,
      delta,
      s.outerGlowColor ?? DEFAULT_SETTINGS.logo.outerGlowColor,
      s.outerGlowCustomColors ?? DEFAULT_SETTINGS.logo.outerGlowCustomColors,
      s.outerGlowCycleSpeed ?? DEFAULT_SETTINGS.logo.outerGlowCycleSpeed,
      theme.accent,
      outerGlowUniforms.uGwColor.value,
    );
    outerGlowUniforms.uGwIntensity.value = ((s.outerGlowIntensity ?? DEFAULT_SETTINGS.logo.outerGlowIntensity) / 100) * (1 + logoBeat * 0.4);
    outerGlowUniforms.uGwSize.value      = s.outerGlowSize ?? DEFAULT_SETTINGS.logo.outerGlowSize;
    outerGlowUniforms.uGwBlur.value      = s.outerGlowBlur ?? DEFAULT_SETTINGS.logo.outerGlowBlur;
    outerGlowUniforms.uGwBeat.value      = logoBeat;

    // ── Inner Glow plane ─────────────────────────────────────────────────────
    const innerGlowEnabled = s.innerGlowEnabled ?? DEFAULT_SETTINGS.logo.innerGlowEnabled;
    if (innerGlowRef.current) {
      innerGlowRef.current.visible = innerGlowEnabled;
      if (innerGlowEnabled) {
        const innerPlaneSize = logoSize * (s.innerGlowSize ?? DEFAULT_SETTINGS.logo.innerGlowSize);
        innerGlowRef.current.position.set(0, 0, 0.05);
        innerGlowRef.current.scale.set(innerPlaneSize, innerPlaneSize, 1);
        innerGlowRef.current.rotation.z = rotRef.current;
      }
    }

    // ── Inner Glow color ─────────────────────────────────────────────────────
    computeGlowColor(
      (s.innerGlowColorMode ?? DEFAULT_SETTINGS.logo.innerGlowColorMode) as 'solid' | 'rainbow' | 'custom' | 'random',
      innerRainbowHueRef,
      glowScratch,
      glowRandomColors,
      timeRef.current,
      delta,
      s.innerGlowColor ?? DEFAULT_SETTINGS.logo.innerGlowColor,
      s.innerGlowCustomColors ?? DEFAULT_SETTINGS.logo.innerGlowCustomColors,
      s.innerGlowCycleSpeed ?? DEFAULT_SETTINGS.logo.innerGlowCycleSpeed,
      theme.accent,
      innerGlowUniforms.uIgColor.value,
    );
    innerGlowUniforms.uIgIntensity.value = ((s.innerGlowIntensity ?? DEFAULT_SETTINGS.logo.innerGlowIntensity) / 100) * (1 + logoBeat * 0.4);
    innerGlowUniforms.uIgSize.value      = s.innerGlowSize ?? DEFAULT_SETTINGS.logo.innerGlowSize;
    innerGlowUniforms.uIgBlur.value      = s.innerGlowBlur ?? DEFAULT_SETTINGS.logo.innerGlowBlur;
    innerGlowUniforms.uIgBeat.value      = logoBeat;

    // ── Fire ring ─────────────────────────────────────────────────────────────
    if (fireRef.current) {
      fireRef.current.visible = s.fireEnabled;

      if (s.fireEnabled) {
        // Rebuild geometry if fireHeight changed
        if (fireHeightRef.current !== s.fireHeight) {
          fireHeightRef.current = s.fireHeight;
          if (fireGeoRef.current) fireGeoRef.current.dispose();
          const innerR = 0.5;
          const outerR = 0.5 + s.fireHeight;
          fireGeoRef.current = new THREE.RingGeometry(innerR, outerR, 128, 32);
          fireRef.current.geometry = fireGeoRef.current;
        }

        // Scale fire ring to match logo size (same beat scale for cohesion)
        const fireScale = logoSize * beatScale;
        fireRef.current.position.set(0, 0, 0.1);
        fireRef.current.scale.set(fireScale, fireScale, 1);
        fireRef.current.rotation.z = rotRef.current;
      }
    }

    const reactiveFireEnergy = fireEnergy * s.fireReactivity;
    fireUniforms.uTime.value         = timeRef.current;
    fireUniforms.uFrBass.value       = reactiveFireEnergy;
    fireUniforms.uFrBeat.value       = fireBeat;
    fireUniforms.uFrIntensity.value  = s.fireIntensity;
    fireUniforms.uFrColorInner.value.set(s.fireColorInner);
    fireUniforms.uFrColorMid.value.set(s.fireColorMid);
    fireUniforms.uFrColorOuter.value.set(s.fireColorOuter);
  });

  return (
    <>
      {/* Outer glow plane — smooth radial falloff, sits behind logo */}
      <mesh ref={outerGlowRef} renderOrder={5}>
        <primitive object={outerGlowGeo} attach="geometry" />
        <primitive object={outerGlowMat} attach="material" />
      </mesh>

      {/* Fire ring — procedural fBm flames around logo edge */}
      <mesh ref={fireRef} renderOrder={7}>
        {/* Initial geometry — rebuilt in useFrame when fireHeight changes */}
        <ringGeometry args={[0.5, 0.5 + 0.3, 128, 32]} />
        <primitive object={fireMat} attach="material" />
      </mesh>

      {/* Inner glow plane — additive, sits in front of logo, behind fire */}
      <mesh ref={innerGlowRef} renderOrder={8}>
        <primitive object={innerGlowGeo} attach="geometry" />
        <primitive object={innerGlowMat} attach="material" />
      </mesh>

      {/* Logo mesh — on top */}
      <mesh ref={meshRef} renderOrder={6}>
        <primitive object={logoGeo} attach="geometry" />
        <meshBasicMaterial
          ref={logoMatRef}
          map={texture}
          toneMapped={false}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}
