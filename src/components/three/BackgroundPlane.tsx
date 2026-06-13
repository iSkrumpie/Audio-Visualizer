/**
 * BackgroundPlane — background image + all background-tab effects
 *
 * All PostFX effects (Glow FX, Color FX, Stylize) are applied here so they
 * affect ONLY the background layer, not bars/particles/logo.
 *
 * GLSL variable-naming rules (ANGLE/Windows compatibility):
 *   - vec2 ts is declared ONCE at the top of main() — never in sibling blocks
 *   - Every if-block and every loop uses a unique variable-name prefix
 *   - No two sibling blocks share any local variable name
 */

import { useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAudioStore } from '@/lib/audioStore';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';

const bgVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const bgFrag = /* glsl */ `
// ── Constants (module-level — declared once) ──────────────────────────────────
const float BLUR_SIGMA = 2.0;

// ── Blend helpers ─────────────────────────────────────────────────────────────
vec3 blendOverlay(vec3 base, vec3 blend) {
  return mix(2.0*base*blend, 1.0-2.0*(1.0-base)*(1.0-blend), step(0.5, base));
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0*base*blend + base*base*(1.0-2.0*blend),
    sqrt(base)*(2.0*blend-1.0) + 2.0*base*(1.0-blend),
    step(0.5, blend)
  );
}
vec3 blendScreen(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

// ── Color helpers ──────────────────────────────────────────────────────────────
vec3 hueRotate(vec3 col, float angleDeg) {
  float a    = angleDeg * 0.017453293;
  float c    = cos(a); float s = sin(a);
  vec3  axis = vec3(0.57735);
  return col * c + cross(axis, col) * s + axis * dot(axis, col) * (1.0 - c);
}
vec3 sepiaTone(vec3 col) {
  return vec3(
    dot(col, vec3(0.393, 0.769, 0.189)),
    dot(col, vec3(0.349, 0.686, 0.168)),
    dot(col, vec3(0.272, 0.534, 0.131))
  );
}
float hashRnd(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// ── Uniforms ───────────────────────────────────────────────────────────────────
uniform sampler2D uTexture;
uniform bool      uHasTexture;
uniform float     uThemeMode;
uniform vec2      uResolution;
uniform float     uTime;

// Image
uniform float uBgBlur;
uniform float uBrightness;
uniform float uSaturation;
uniform float uContrast;
uniform float uHueShift;
uniform float uSharpen;

// Tint
uniform vec3  uTintColor;
uniform float uTintOpacity;
uniform int   uTintMode;

// Vignette
uniform float uVignetteEnabled;
uniform float uVignetteStrength;

// PostFX toggles (float 0/1 — ANGLE-safe)
uniform float uCaEnabled;
uniform float uCaOffset;
uniform float uBloomEnabled;
uniform float uBloomIntensity;
uniform float uBloomThreshold;
uniform float uNoiseEnabled;
uniform float uNoiseIntensity;
uniform float uScanlineEnabled;
uniform float uScanlineDensity;
uniform float uGlitchEnabled;
uniform float uGlitchDelay;
uniform float uGlitchStrength;
uniform float uSepiaEnabled;
uniform float uSepiaIntensity;
uniform float uPixelEnabled;
uniform float uPixelGranularity;
uniform float uDotEnabled;
uniform float uDotScale;
uniform float uGridEnabled;
uniform float uGridScale;
uniform float uColorAvgEnabled;
// Noise animation
uniform float uNoiseSpeed;
uniform float uNoiseScale;
uniform float uNoiseColorMode;
uniform float uNoiseBeatBoost;
// Scanline animation
uniform float uScanScrollSpeed;
uniform float uScanThickness;
uniform float uScanBeatOpacity;
uniform float uScanBeatDensity;
// Glitch animation
uniform float uGlitchRGBSplit;
uniform float uGlitchBlockSize;
uniform float uGlitchBlockProb;
uniform float uGlitchVertical;
uniform float uGlitchBeatSync;
uniform float uGlitchDecay;
// Pixelation animation
uniform float uPixelBeatSize;
uniform float uPixelWave;
uniform float uPixelWaveSpeed;
// Dot screen animation
uniform float uDotRotation;
uniform float uDotRotSpeed;
uniform float uDotBeatScale;
uniform float uDotColorSep;
// Grid animation
uniform float uGridPulseStrength;
uniform float uGridWave;
uniform float uGridWaveSpeed;
uniform float uGridMovement;
uniform vec3  uGridColor;
// Beat phase
uniform float uBeatPhase;

varying vec2 vUv;

void main() {
  // ── Shared — declared ONCE, used everywhere (no sibling-block redeclarations) ──
  vec2 ts = vec2(1.0) / uResolution;

  // ── 1. UV transforms ─────────────────────────────────────────────────────────
  vec2 uv = vUv;

  // Pixelation (prefix: pix)
  if (uPixelEnabled > 0.5) {
    float pixBase = uPixelGranularity + uPixelBeatSize * uBeatPhase;
    float pixWave = 1.0 + uPixelWave * sin(vUv.x * 10.0 + uTime * uPixelWaveSpeed);
    float pixSize = max(1.0, pixBase * pixWave);
    vec2 pixStep = vec2(pixSize) / uResolution;
    uv = floor(uv / pixStep) * pixStep + pixStep * 0.5;
    uv = clamp(uv, 0.0, 1.0);
  }

  // Glitch (prefix: gl)
  if (uGlitchEnabled > 0.5) {
    float glPeriod = max(uGlitchDelay, 0.1);
    float glT      = mod(uTime, glPeriod);
    float glSeed   = mod(floor(uTime / glPeriod), 97.0);
    // Beat sync: glitch fades with beat phase when enabled
    float glBeatMul = uGlitchBeatSync > 0.5 ? uBeatPhase : step(glPeriod - 0.18, glT);
    if (glBeatMul > 0.01) {
      float glBlockRow  = floor(uv.y * uResolution.y / max(uGlitchBlockSize, 1.0));
      float glBlockRng  = hashRnd(vec2(glBlockRow * 0.37, glSeed));
      float glIsCorrupt = step(1.0 - uGlitchBlockProb * glBeatMul, glBlockRng);
      float glShiftH    = (hashRnd(vec2(glBlockRow, glSeed + 1.7)) * 2.0 - 1.0) * uGlitchStrength * 2.0;
      float glShiftV    = glShiftH * uGlitchVertical;
      uv.x = clamp(uv.x + glShiftH * glIsCorrupt * glBeatMul, 0.0, 1.0);
      uv.y = clamp(uv.y + glShiftV * glIsCorrupt * glBeatMul, 0.0, 1.0);
    }
  }

  // ── 2. Texture read ───────────────────────────────────────────────────────────
  vec3 col = vec3(0.0);

  if (uHasTexture) {

    // Blur — loop prefix: bl
    if (uBgBlur > 0.5) {
      float blStride = max(1.0, uBgBlur / (3.0 * BLUR_SIGMA));
      vec3  blSum    = vec3(0.0);
      float blTotW   = 0.0;
      for (int blI = -6; blI <= 6; blI++) {
        for (int blJ = -6; blJ <= 6; blJ++) {
          float blFi = float(blI); float blFj = float(blJ);
          float blW  = exp(-(blFi*blFi + blFj*blFj) / (2.0 * BLUR_SIGMA * BLUR_SIGMA));
          blSum  += texture2D(uTexture, clamp(uv + vec2(blFi, blFj) * blStride * ts, 0.0, 1.0)).rgb * blW;
          blTotW += blW;
        }
      }
      col = blSum / blTotW;
    } else {
      col = texture2D(uTexture, uv).rgb;
    }

    // Chromatic aberration — applied after blur, prefix: ca
    if (uCaEnabled > 0.5) {
      vec2 caOff = (uv - 0.5) * uCaOffset;
      col.r = texture2D(uTexture, clamp(uv + caOff, 0.0, 1.0)).r;
      col.b = texture2D(uTexture, clamp(uv - caOff, 0.0, 1.0)).b;
    }

    // RGB split from glitch (prefix: glRgb)
    if (uGlitchEnabled > 0.5 && uGlitchRGBSplit > 0.0001) {
      float glRgbPeriod = max(uGlitchDelay, 0.1);
      float glRgbPhase  = uGlitchBeatSync > 0.5
        ? uBeatPhase
        : step(glRgbPeriod - 0.18, mod(uTime, glRgbPeriod));
      float glRgbAmt = uGlitchRGBSplit * glRgbPhase;
      col.r = texture2D(uTexture, clamp(uv + vec2(glRgbAmt, 0.0), 0.0, 1.0)).r;
      col.b = texture2D(uTexture, clamp(uv - vec2(glRgbAmt, 0.0), 0.0, 1.0)).b;
    }

    // Sharpen (unsharp mask) — prefix: sh
    if (uSharpen > 0.01) {
      vec3 shBlur = vec3(0.0);
      for (int shI = -1; shI <= 1; shI++) {
        for (int shJ = -1; shJ <= 1; shJ++) {
          shBlur += texture2D(uTexture,
            clamp(uv + vec2(float(shI), float(shJ)) * ts * 2.0, 0.0, 1.0)).rgb;
        }
      }
      shBlur /= 9.0;
      vec3 shOrig = texture2D(uTexture, uv).rgb;
      col = clamp(shOrig + (shOrig - shBlur) * uSharpen, 0.0, 1.0);
    }

  } else {
    // ── Studio fallback gradient (prefix: gr) ──────────────────────────────────
    vec2  grP   = vUv - 0.5;
    float grT   = clamp((grP.x + grP.y) * 0.5 + 0.5, 0.0, 1.0);
    float grSeg = grT * 3.0;
    vec3 grC1 = vec3(0.0); vec3 grC2 = vec3(0.0);
    vec3 grC3 = vec3(0.0); vec3 grC4 = vec3(0.0);
    if (uThemeMode < 0.5) {
      grC1 = vec3(0.060, 0.260, 0.310); grC2 = vec3(0.160, 0.085, 0.250);
      grC3 = vec3(0.260, 0.060, 0.160); grC4 = vec3(0.260, 0.120, 0.030);
    } else {
      grC1 = vec3(0.88, 0.96, 0.99); grC2 = vec3(0.94, 0.90, 0.99);
      grC3 = vec3(0.99, 0.90, 0.94); grC4 = vec3(0.99, 0.93, 0.86);
    }
    vec3 grFb = vec3(0.0);
    if (grSeg < 1.0)      grFb = mix(grC1, grC2, grSeg);
    else if (grSeg < 2.0) grFb = mix(grC2, grC3, grSeg - 1.0);
    else                  grFb = mix(grC3, grC4, grSeg - 2.0);
    grFb *= 1.0 - length(grP) * 0.20;
    if (uThemeMode < 0.5) grFb *= 0.55;
    col = grFb;
  }

  // ── 3. Image adjustments ──────────────────────────────────────────────────────
  col *= uBrightness;
  col  = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  float imgLuma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(imgLuma), col, uSaturation);
  if (uHueShift > 0.5) col = clamp(hueRotate(col, uHueShift), 0.0, 1.0);

  // ── 4. Color grading (prefix: cg) ─────────────────────────────────────────────
  if (uColorAvgEnabled > 0.5) {
    float cgAvg = (col.r + col.g + col.b) / 3.0;
    col = vec3(cgAvg);
  }
  if (uSepiaEnabled > 0.5) {
    col = mix(col, sepiaTone(col), uSepiaIntensity);
  }

  // ── 5. Bloom (prefix: bm) ──────────────────────────────────────────────────────
  // Soft 2D Gaussian bright-pass glow. Uses 9×9 kernel with small stride
  // (1.0 texel) and proper Gaussian weights for a smooth result.
  if (uBloomEnabled > 0.5 && uHasTexture) {
    vec3  bmAcc  = vec3(0.0);
    float bmTotW = 0.0;
    for (int bmI = -4; bmI <= 4; bmI++) {
      for (int bmJ = -4; bmJ <= 4; bmJ++) {
        float bmFI = float(bmI);
        float bmFJ = float(bmJ);
        float bmD  = bmFI * bmFI + bmFJ * bmFJ;
        float bmW  = exp(-bmD / 8.0);  // sigma ≈ 2
        vec3  bmS  = texture2D(uTexture,
          clamp(uv + vec2(bmFI, bmFJ) * ts, 0.0, 1.0)).rgb;
        float bmLm = dot(bmS, vec3(0.299, 0.587, 0.114));
        float bmBr = max(0.0, bmLm - uBloomThreshold);
        bmAcc  += bmS * bmBr * bmW;
        bmTotW += bmBr * bmW;
      }
    }
    if (bmTotW > 0.001) {
      col = clamp(col + (bmAcc / bmTotW) * uBloomIntensity * 0.5, 0.0, 1.5);
    }
  }

  // ── 6. Noise / film grain (prefix: ns) ────────────────────────────────────────
  if (uNoiseEnabled > 0.5) {
    float ns_beatMul = 1.0 + uNoiseBeatBoost * uBeatPhase;
    vec2  ns_uv = vUv * uNoiseScale;
    if (uNoiseColorMode > 0.5) {
      // Color grain — independent R/G/B noise
      float ns_r = hashRnd(ns_uv + floor(uTime * uNoiseSpeed) + 0.0) * 2.0 - 1.0;
      float ns_g = hashRnd(ns_uv + floor(uTime * uNoiseSpeed) + 1.3) * 2.0 - 1.0;
      float ns_b = hashRnd(ns_uv + floor(uTime * uNoiseSpeed) + 2.6) * 2.0 - 1.0;
      col = clamp(col + vec3(ns_r, ns_g, ns_b) * uNoiseIntensity * 0.3 * ns_beatMul, 0.0, 1.0);
    } else {
      float ns_grain = hashRnd(ns_uv + fract(uTime * uNoiseSpeed * 0.37)) * 2.0 - 1.0;
      col = clamp(col + ns_grain * uNoiseIntensity * 0.3 * ns_beatMul, 0.0, 1.0);
    }
  }

  // ── 7. Scanlines (prefix: sc) ─────────────────────────────────────────────────
  if (uScanlineEnabled > 0.5) {
    float sc_beatMul = 1.0 + uScanBeatOpacity * uBeatPhase;
    float sc_density = uScanlineDensity * (1.0 + uScanBeatDensity * uBeatPhase);
    float sc_scroll  = uTime * uScanScrollSpeed;
    float sc_y       = fract((vUv.y + sc_scroll) * sc_density * 200.0);
    float sc_mask    = step(uScanThickness, sc_y);
    col *= mix(1.0 - 0.22 * sc_beatMul, 1.0, sc_mask);
  }

  // ── 8. Dot screen (prefix: dt) ────────────────────────────────────────────────
  if (uDotEnabled > 0.5) {
    float dt_scale = max(uDotScale * 8.0, 1.0) * (1.0 + uDotBeatScale * uBeatPhase);
    float dt_angle = uDotRotation * 0.017453 + uTime * uDotRotSpeed;
    float dt_cs = cos(dt_angle);
    float dt_sn = sin(dt_angle);
    vec2 dt_ruv = vec2(
      dt_cs * vUv.x - dt_sn * vUv.y,
      dt_sn * vUv.x + dt_cs * vUv.y
    ) * uResolution / dt_scale;
    vec2  dtCell = fract(dt_ruv) - 0.5;
    float dtCirc = 1.0 - smoothstep(0.22, 0.32, length(dtCell));
    col *= 0.55 + 0.45 * dtCirc;
  }

  // ── 9. Grid (prefix: gd) ──────────────────────────────────────────────────────
  if (uGridEnabled > 0.5) {
    vec2 gd_uv = vUv;
    // Wave distortion
    if (uGridWave > 0.001) {
      gd_uv.x += sin(vUv.y * 20.0 + uTime * uGridWaveSpeed) * uGridWave * 0.02 * uBeatPhase;
      gd_uv.y += sin(vUv.x * 20.0 + uTime * uGridWaveSpeed * 0.7) * uGridWave * 0.02 * uBeatPhase;
    }
    // Movement/scroll
    gd_uv += uTime * uGridMovement * 0.01;
    vec2  gdCoord = fract(gd_uv * uResolution / max(uGridScale * 8.0, 1.0));
    float gdLX    = smoothstep(0.0, 0.04, gdCoord.x) * smoothstep(1.0, 0.96, gdCoord.x);
    float gdLY    = smoothstep(0.0, 0.04, gdCoord.y) * smoothstep(1.0, 0.96, gdCoord.y);
    float gdLines = 1.0 - min(gdLX, gdLY);
    // Pulse glow on beat
    float gdGlow = 1.0 + uGridPulseStrength * uBeatPhase;
    vec3  gdLineColor = uGridColor * gdGlow;
    col = mix(col, gdLineColor, gdLines * 0.55);
  }

  // ── 10. Tint (only with image — skip on fallback gradient) ────────────────────
  if (uTintOpacity > 0.001 && uHasTexture) {
    vec3 tntResult = col;
    if      (uTintMode == 1) tntResult = blendOverlay(col, uTintColor);
    else if (uTintMode == 2) tntResult = blendSoftLight(col, uTintColor);
    else if (uTintMode == 3) tntResult = blendScreen(col, uTintColor);
    else                     tntResult = col * uTintColor;
    col = mix(col, tntResult, uTintOpacity);
  }

  // ── 11. Vignette (prefix: vg) ────────────────────────────────────────────────
  if (uVignetteEnabled > 0.5) {
    vec2  vgCenter = vUv - 0.5;
    float vgVal    = 1.0 - dot(vgCenter, vgCenter) * uVignetteStrength * 4.0;
    col *= clamp(vgVal, 0.0, 1.0);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

// ── React component ──────────────────────────────────────────────────────────
export function BackgroundPlane() {
  const { width, height } = useThree((s) => s.size);
  const bgObjectUrl = useAudioStore((s) => s.bgObjectUrl);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.ShaderMaterial>(null);

  const textureRef = useRef<{ url: string | null; tex: THREE.Texture | null }>({ url: null, tex: null });
  if (textureRef.current.url !== bgObjectUrl) {
    if (textureRef.current.tex) textureRef.current.tex.dispose();
    if (bgObjectUrl) {
      const tex = new THREE.TextureLoader().load(bgObjectUrl);
      tex.colorSpace   = THREE.SRGBColorSpace;
      tex.minFilter    = THREE.LinearFilter;
      tex.magFilter    = THREE.LinearFilter;
      tex.wrapS        = THREE.ClampToEdgeWrapping;
      tex.wrapT        = THREE.ClampToEdgeWrapping;
      textureRef.current = { url: bgObjectUrl, tex };
    } else {
      textureRef.current = { url: null, tex: null };
    }
  }
  const texture = textureRef.current.tex;

  const uniforms = useMemo(() => ({
    uTexture:          { value: null as THREE.Texture | null },
    uHasTexture:       { value: false },
    uThemeMode:        { value: 0 },
    uResolution:       { value: new THREE.Vector2(1920, 1080) },
    uTime:             { value: 0 },
    // Image
    uBgBlur:           { value: 0 },
    uBrightness:       { value: 1.0 },
    uSaturation:       { value: 1.0 },
    uContrast:         { value: 1.0 },
    uHueShift:         { value: 0 },
    uSharpen:          { value: 0 },
    // Tint
    uTintColor:        { value: new THREE.Color('#0B0D10') },
    uTintOpacity:      { value: 0.3 },
    uTintMode:         { value: 0 },
    // Vignette
    uVignetteEnabled:  { value: 0 },
    uVignetteStrength: { value: 0.5 },
    // PostFX (float 0/1)
    uCaEnabled:        { value: 0 },
    uCaOffset:         { value: 0.002 },
    uBloomEnabled:     { value: 0 },
    uBloomIntensity:   { value: 1.2 },
    uBloomThreshold:   { value: 0.25 },
    uNoiseEnabled:     { value: 0 },
    uNoiseIntensity:   { value: 0.3 },
    uScanlineEnabled:  { value: 0 },
    uScanlineDensity:  { value: 1.5 },
    uGlitchEnabled:    { value: 0 },
    uGlitchDelay:      { value: 3.0 },
    uGlitchStrength:   { value: 0.1 },
    uSepiaEnabled:     { value: 0 },
    uSepiaIntensity:   { value: 0.5 },
    uPixelEnabled:     { value: 0 },
    uPixelGranularity: { value: 5 },
    uDotEnabled:       { value: 0 },
    uDotScale:         { value: 1.0 },
    uGridEnabled:      { value: 0 },
    uGridScale:        { value: 1.0 },
    uColorAvgEnabled:  { value: 0 },
    // Noise animation
    uNoiseSpeed:        { value: 3.0 },
    uNoiseScale:        { value: 1.0 },
    uNoiseColorMode:    { value: 0 },
    uNoiseBeatBoost:    { value: 0 },
    // Scanline animation
    uScanScrollSpeed:   { value: 0 },
    uScanThickness:     { value: 0.5 },
    uScanBeatOpacity:   { value: 0 },
    uScanBeatDensity:   { value: 0 },
    // Glitch animation
    uGlitchRGBSplit:    { value: 0 },
    uGlitchBlockSize:   { value: 16 },
    uGlitchBlockProb:   { value: 0.3 },
    uGlitchVertical:    { value: 0 },
    uGlitchBeatSync:    { value: 1 },
    uGlitchDecay:       { value: 4.0 },
    // Pixelation animation
    uPixelBeatSize:     { value: 0 },
    uPixelWave:         { value: 0 },
    uPixelWaveSpeed:    { value: 1.5 },
    // Dot screen animation
    uDotRotation:       { value: 0 },
    uDotRotSpeed:       { value: 0 },
    uDotBeatScale:      { value: 0 },
    uDotColorSep:       { value: 0 },
    // Grid animation
    uGridPulseStrength: { value: 0 },
    uGridWave:          { value: 0 },
    uGridWaveSpeed:     { value: 2.0 },
    uGridMovement:      { value: 0 },
    uGridColor:         { value: new THREE.Color('#6366F1') },
    // Beat phase
    uBeatPhase:         { value: 0 },
  }), []);

  const beatDetector = useMemo(() => new FreqBeatDetector(), []);

  useFrame((_, delta) => {
    const mat = matRef.current;
    if (!mat) return;
    const s  = getSettings();
    const bg = s.background;
    const beatPhase = beatDetector.update(audioAnalysis.rawFreqData, bg.beatFxFreqStart, bg.beatFxFreqEnd);

    mat.uniforms.uTime.value       += delta;
    mat.uniforms.uTexture.value     = texture;
    mat.uniforms.uHasTexture.value  = !!texture;
    mat.uniforms.uThemeMode.value   = s.theme.mode === 'light' ? 1.0 : 0.0;
    mat.uniforms.uResolution.value.set(width, height);
    mat.uniforms.uBgBlur.value      = bg.blur;
    mat.uniforms.uBrightness.value  = bg.brightness;
    mat.uniforms.uSaturation.value  = bg.saturation;
    mat.uniforms.uContrast.value    = bg.contrast;
    mat.uniforms.uHueShift.value    = bg.hueShift;
    mat.uniforms.uSharpen.value     = bg.sharpen;
    mat.uniforms.uTintColor.value.set(bg.tintColor);
    mat.uniforms.uTintOpacity.value = bg.tintOpacity;
    mat.uniforms.uTintMode.value    =
      bg.tintMode === 'overlay'    ? 1 :
      bg.tintMode === 'soft-light' ? 2 :
      bg.tintMode === 'screen'     ? 3 : 0;
    mat.uniforms.uVignetteEnabled.value  = bg.vignetteEnabled  ? 1 : 0;
    mat.uniforms.uVignetteStrength.value = bg.vignetteStrength;
    mat.uniforms.uCaEnabled.value        = bg.caEnabled        ? 1 : 0;
    mat.uniforms.uCaOffset.value         = bg.caOffset;
    mat.uniforms.uBloomEnabled.value     = bg.bloomEnabled      ? 1 : 0;
    mat.uniforms.uBloomIntensity.value   = bg.bloomIntensity;
    mat.uniforms.uBloomThreshold.value   = bg.bloomThreshold;
    mat.uniforms.uNoiseEnabled.value     = bg.noiseEnabled      ? 1 : 0;
    mat.uniforms.uNoiseIntensity.value   = bg.noiseIntensity;
    mat.uniforms.uScanlineEnabled.value  = bg.scanlineEnabled   ? 1 : 0;
    mat.uniforms.uScanlineDensity.value  = bg.scanlineDensity;
    mat.uniforms.uGlitchEnabled.value    = bg.glitchEnabled     ? 1 : 0;
    mat.uniforms.uGlitchDelay.value      = bg.glitchDelay;
    mat.uniforms.uGlitchStrength.value   = bg.glitchStrength;
    mat.uniforms.uSepiaEnabled.value     = bg.sepiaEnabled      ? 1 : 0;
    mat.uniforms.uSepiaIntensity.value   = bg.sepiaIntensity;
    mat.uniforms.uPixelEnabled.value     = bg.pixelationEnabled ? 1 : 0;
    mat.uniforms.uPixelGranularity.value = bg.pixelGranularity;
    mat.uniforms.uDotEnabled.value       = bg.dotScreenEnabled  ? 1 : 0;
    mat.uniforms.uDotScale.value         = bg.dotScale;
    mat.uniforms.uGridEnabled.value      = bg.gridEnabled       ? 1 : 0;
    mat.uniforms.uGridScale.value        = bg.gridScale;
    mat.uniforms.uColorAvgEnabled.value  = bg.colorAverageEnabled ? 1 : 0;
    // Beat phase
    mat.uniforms.uBeatPhase.value = beatPhase;
    // Noise animation
    mat.uniforms.uNoiseSpeed.value      = bg.noiseSpeed;
    mat.uniforms.uNoiseScale.value      = bg.noiseScale;
    mat.uniforms.uNoiseColorMode.value  = bg.noiseColorMode ? 1 : 0;
    mat.uniforms.uNoiseBeatBoost.value  = bg.noiseBeatBoost;
    // Scanline animation
    mat.uniforms.uScanScrollSpeed.value = bg.scanScrollSpeed;
    mat.uniforms.uScanThickness.value   = bg.scanThickness;
    mat.uniforms.uScanBeatOpacity.value = bg.scanBeatOpacity;
    mat.uniforms.uScanBeatDensity.value = bg.scanBeatDensity;
    // Glitch animation
    mat.uniforms.uGlitchRGBSplit.value  = bg.glitchRGBSplit;
    mat.uniforms.uGlitchBlockSize.value = bg.glitchBlockSize;
    mat.uniforms.uGlitchBlockProb.value = bg.glitchBlockProb;
    mat.uniforms.uGlitchVertical.value  = bg.glitchVertical;
    mat.uniforms.uGlitchBeatSync.value  = bg.glitchBeatSync ? 1 : 0;
    mat.uniforms.uGlitchDecay.value     = bg.glitchDecay;
    // Pixelation animation
    mat.uniforms.uPixelBeatSize.value   = bg.pixelBeatSize;
    mat.uniforms.uPixelWave.value       = bg.pixelWave;
    mat.uniforms.uPixelWaveSpeed.value  = bg.pixelWaveSpeed;
    // Dot screen animation
    mat.uniforms.uDotRotation.value     = bg.dotRotation;
    mat.uniforms.uDotRotSpeed.value     = bg.dotRotSpeed;
    mat.uniforms.uDotBeatScale.value    = bg.dotBeatScale;
    mat.uniforms.uDotColorSep.value     = bg.dotColorSep;
    // Grid animation
    mat.uniforms.uGridPulseStrength.value = bg.gridPulseStrength;
    mat.uniforms.uGridWave.value          = bg.gridWave;
    mat.uniforms.uGridWaveSpeed.value     = bg.gridWaveSpeed;
    mat.uniforms.uGridMovement.value      = bg.gridMovement;
    mat.uniforms.uGridColor.value.set(bg.gridColor);

    if (meshRef.current) {
      const beatScale = 1 + beatPhase * bg.scaleOnBeat;
      const base      = 1.16;
      meshRef.current.scale.set(width * base * beatScale, height * base * beatScale, 1);
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -10]} renderOrder={0}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={bgVert}
        fragmentShader={bgFrag}
        uniforms={uniforms}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
