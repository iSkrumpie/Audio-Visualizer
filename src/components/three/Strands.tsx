/**
 * Strands — animated ribbon/aurora effect rendered via ogl (standalone WebGL2
 * canvas, separate from the R3F scene graph). Mounted as an HTML overlay div;
 * z-ordering relative to the R3F canvas is controlled by the parent container
 * in VisualizerStage (next worker task).
 *
 * Shader prefix rule: all local GLSL variables use `str_` prefix.
 * See AGENTS.md §6 (ANGLE/Windows GLSL-Prefix-Regel).
 *
 * Audio reactivity: FreqBeatDetector + usePhaseSource, same pattern as
 * BackgroundFx.tsx. Beat phase scales uAmplitude (+40%) and uGlow (+30%).
 *
 * Glass mode from the original reactbits source is removed intentionally.
 */

import { useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

// ─── Shader constants ─────────────────────────────────────────────────────────

const MAX_STRANDS = 12;
const MAX_COLORS  = 8;

// ─── Vertex shader ────────────────────────────────────────────────────────────
// Full-screen triangle via ogl's Triangle geometry.

const VERT = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// ALL local variables carry the `str_` prefix (ANGLE Windows rule).
// Uniforms (uTime, uResolution, uColors, ...) keep their plain names.

const FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uColors[${MAX_COLORS}];
uniform int   uColorCount;
uniform int   uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float str_PI = 3.14159265;

// Full-spectrum rainbow fallback (no user palette)
vec3 str_spectrum(float str_t) {
  return 0.5 + 0.5 * cos(2.0 * str_PI * (str_t + vec3(0.00, 0.33, 0.67)));
}

// Smooth circular palette from user-supplied color array
vec3 str_samplePalette(float str_tp) {
  str_tp = fract(str_tp);
  float str_scaled  = str_tp * float(uColorCount);
  int   str_idx     = int(floor(str_scaled));
  float str_blend   = fract(str_scaled);
  int   str_nextIdx = str_idx + 1;
  if (str_nextIdx >= uColorCount) str_nextIdx = 0;
  return mix(uColors[str_idx], uColors[str_nextIdx], str_blend);
}

vec3 str_strandColor(float str_tc) {
  if (uColorCount > 0) return str_samplePalette(str_tc);
  return str_spectrum(str_tc);
}

void main() {
  // Map fragment coordinate to screen-centered, aspect-correct UV
  vec2  str_uv  = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  str_uv /= max(uScale, 0.0001);

  float str_e   = 0.06 + uIntensity * 0.94;
  // Envelope: cos taper along X so strands fade at the edges
  float str_env = pow(max(cos(str_uv.x * str_PI * 1.3), 0.0), uTaper);

  vec3 str_col = vec3(0.0);

  for (int str_i = 0; str_i < ${MAX_STRANDS}; str_i++) {
    if (str_i >= uStrandCount) break;

    float str_fi   = float(str_i);
    float str_ph   = str_fi * 1.7 * uSpread;
    float str_freq = (2.0 + str_fi * 0.35) * uWaviness;
    float str_spd  = 1.4 + str_fi * 1.2;

    float str_tt = uTime * uSpeed;

    // Two-harmonic wave for natural, non-repeating motion
    float str_w  = sin(str_uv.x * str_freq + str_tt * str_spd + str_ph) * 0.60
                 + sin(str_uv.x * str_freq * 1.1 - str_tt * str_spd * 0.7 + str_ph * 1.7) * 0.40;

    float str_amp   = (0.1 + 0.02 * str_e) * str_env * uAmplitude;
    float str_y     = str_w * str_amp;

    float str_d     = abs(str_uv.y - str_y);
    float str_thick = (0.001 + 0.05 * str_e) * (0.35 + str_env) * uThickness;
    float str_g     = str_thick / (str_d + str_thick * 0.45);
    str_g           = str_g * str_g;

    // Per-strand hue: index offset + horizontal drift + slow time shift
    float str_h = str_fi / float(uStrandCount) + str_uv.x * 0.30 + uTime * 0.04 + uHueShift;
    str_col += str_strandColor(str_h) * str_g * str_env;
  }

  str_col *= 0.45 + 0.7 * str_e;
  // Filmic exposure / glow tone-mapping
  str_col  = 1.0 - exp(-str_col * uGlow);

  // Saturation
  float str_gray = dot(str_col, vec3(0.2126, 0.7152, 0.0722));
  str_col = max(mix(vec3(str_gray), str_col, uSaturation), 0.0);

  // Alpha driven by luminance so dark areas are transparent
  float str_lum   = max(max(str_col.r, str_col.g), str_col.b);
  float str_alpha = clamp(str_lum, 0.0, 1.0) * uOpacity;

  fragColor = vec4(str_col * uOpacity, str_alpha);
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an array of CSS hex colors to a flat Float32Array (length MAX_COLORS*3). */
function buildColorsBuffer(colors: string[], buf: Float32Array): void {
  buf.fill(0);
  const count = Math.min(colors.length, MAX_COLORS);
  for (let i = 0; i < count; i++) {
    const hex = colors[i].replace('#', '');
    buf[i * 3]     = parseInt(hex.slice(0, 2), 16) / 255;
    buf[i * 3 + 1] = parseInt(hex.slice(2, 4), 16) / 255;
    buf[i * 3 + 2] = parseInt(hex.slice(4, 6), 16) / 255;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StrandsProps {
  className?: string;
  style?: CSSProperties;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Strands renders an animated ribbon aurora effect onto its own ogl canvas
 * element. The canvas is positioned `absolute inset-0` inside the container
 * div. The parent (VisualizerStage) controls z-index via `strandsBehindLogo`.
 */
export function Strands({ className, style }: StrandsProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Beat detection — same pattern as BackgroundFx ────────────────────────
  const strandsBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(strandsBeatDetector);

  const strandsPhaseSrc = usePhaseSource({
    detector: strandsBeatDetector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.strandsBeatFreqStart ?? DEFAULT_SETTINGS.background.strandsBeatFreqStart,
        endHz:   bg.strandsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.strandsBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      strandsBeatDetector.setSensitivity(
        bg.strandsBeatSensitivity ?? DEFAULT_SETTINGS.background.strandsBeatSensitivity,
      );
      return strandsBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.strandsBeatFreqStart ?? DEFAULT_SETTINGS.background.strandsBeatFreqStart,
        bg.strandsBeatFreqEnd   ?? DEFAULT_SETTINGS.background.strandsBeatFreqEnd,
      );
    },
  });

  // Keep phase source ref current — rAF loop reads it, can't call hooks inside
  const phaseSrcRef = useRef(strandsPhaseSrc);
  phaseSrcRef.current = strandsPhaseSrc;

  // ── ogl lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    const ctn = containerRef.current;
    if (!ctn) return;

    // Create renderer — alpha: true so the canvas is transparent where no
    // strands are drawn. premultipliedAlpha: false for correct CSS compositing.
    const renderer = new Renderer({
      alpha:             true,
      premultipliedAlpha: false,
      antialias:         false,
      dpr:               Math.min(window.devicePixelRatio, 2),
    });
    const gl: OGLRenderingContext = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    ctn.appendChild(canvas);

    // ── Uniform storage (mutated in-place each frame) ──────────────────────
    const colorsBuf = new Float32Array(MAX_COLORS * 3);
    const resBuf    = [0, 0] as [number, number];
    buildColorsBuffer(DEFAULT_SETTINGS.background.strandsColors, colorsBuf);

    // ogl uniform map — each entry is { value: T }
    const uniforms: Record<string, { value: number | number[] | Float32Array }> = {
      uTime:        { value: 0 },
      uResolution:  { value: resBuf },
      uColors:      { value: colorsBuf },
      uColorCount:  { value: DEFAULT_SETTINGS.background.strandsColors.length },
      uStrandCount: { value: DEFAULT_SETTINGS.background.strandsCount },
      uSpeed:       { value: DEFAULT_SETTINGS.background.strandsSpeed },
      uAmplitude:   { value: DEFAULT_SETTINGS.background.strandsAmplitude },
      uWaviness:    { value: DEFAULT_SETTINGS.background.strandsWaviness },
      uThickness:   { value: DEFAULT_SETTINGS.background.strandsThickness },
      uGlow:        { value: DEFAULT_SETTINGS.background.strandsGlow },
      uTaper:       { value: DEFAULT_SETTINGS.background.strandsTaper },
      uSpread:      { value: DEFAULT_SETTINGS.background.strandsSpread },
      uHueShift:    { value: DEFAULT_SETTINGS.background.strandsHueShift },
      uIntensity:   { value: DEFAULT_SETTINGS.background.strandsIntensity },
      uOpacity:     { value: DEFAULT_SETTINGS.background.strandsOpacity },
      uScale:       { value: DEFAULT_SETTINGS.background.strandsScale },
      uSaturation:  { value: DEFAULT_SETTINGS.background.strandsSaturation },
    };

    const program = new Program(gl, {
      vertex:   VERT,
      fragment: FRAG,
      uniforms,
    });

    const mesh = new Mesh(gl, {
      geometry: new Triangle(gl),
      program,
    });

    // ── Resize ────────────────────────────────────────────────────────────
    function resize() {
      if (!ctn) return;
      const w = ctn.offsetWidth;
      const h = ctn.offsetHeight;
      renderer.setSize(w, h);
      resBuf[0] = w;
      resBuf[1] = h;
    }
    resize();
    window.addEventListener('resize', resize);

    // ── rAF loop ──────────────────────────────────────────────────────────
    let animId: number;
    const startTime = performance.now();

    function update() {
      animId = requestAnimationFrame(update);

      const bg = getSettings().background;

      if (!(bg.strandsEnabled ?? DEFAULT_SETTINGS.background.strandsEnabled)) {
        // Clear to transparent when hidden — avoids a stale rendered frame
        const rawGl = gl as WebGL2RenderingContext;
        rawGl.clear(rawGl.COLOR_BUFFER_BIT);
        return;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      uniforms.uTime.value = elapsed;

      // ── Audio reactivity ───────────────────────────────────────────────
      const beat        = phaseSrcRef.current();
      const sensitivity = bg.strandsBeatSensitivity ?? DEFAULT_SETTINGS.background.strandsBeatSensitivity;
      const boost       = sensitivity > 0 ? sensitivity * beat : 0;

      const baseAmp  = bg.strandsAmplitude ?? DEFAULT_SETTINGS.background.strandsAmplitude;
      const baseGlow = bg.strandsGlow      ?? DEFAULT_SETTINGS.background.strandsGlow;
      uniforms.uAmplitude.value = baseAmp  * (1 + boost * 0.4);
      uniforms.uGlow.value      = baseGlow * (1 + boost * 0.3);

      // ── Settings → uniforms (every frame for live UI response) ────────
      const colors = bg.strandsColors ?? DEFAULT_SETTINGS.background.strandsColors;
      buildColorsBuffer(colors, colorsBuf);
      // colorsBuf is mutated in-place; uniforms.uColors.value still points to it
      uniforms.uColorCount.value  = Math.min(colors.length, MAX_COLORS);
      uniforms.uStrandCount.value = Math.min(
        bg.strandsCount ?? DEFAULT_SETTINGS.background.strandsCount,
        MAX_STRANDS,
      );
      uniforms.uSpeed.value      = bg.strandsSpeed      ?? DEFAULT_SETTINGS.background.strandsSpeed;
      uniforms.uWaviness.value   = bg.strandsWaviness   ?? DEFAULT_SETTINGS.background.strandsWaviness;
      uniforms.uThickness.value  = bg.strandsThickness  ?? DEFAULT_SETTINGS.background.strandsThickness;
      uniforms.uTaper.value      = bg.strandsTaper      ?? DEFAULT_SETTINGS.background.strandsTaper;
      uniforms.uSpread.value     = bg.strandsSpread     ?? DEFAULT_SETTINGS.background.strandsSpread;
      uniforms.uHueShift.value   = bg.strandsHueShift   ?? DEFAULT_SETTINGS.background.strandsHueShift;
      uniforms.uIntensity.value  = bg.strandsIntensity  ?? DEFAULT_SETTINGS.background.strandsIntensity;
      uniforms.uOpacity.value    = bg.strandsOpacity    ?? DEFAULT_SETTINGS.background.strandsOpacity;
      uniforms.uScale.value      = bg.strandsScale      ?? DEFAULT_SETTINGS.background.strandsScale;
      uniforms.uSaturation.value = bg.strandsSaturation ?? DEFAULT_SETTINGS.background.strandsSaturation;

      renderer.render({ scene: mesh });
    }

    animId = requestAnimationFrame(update);

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      try {
        (gl as WebGL2RenderingContext)
          .getExtension('WEBGL_lose_context')
          ?.loseContext();
      } catch {
        // best-effort — some browsers throw on lost-context cleanup
      }
      canvas.remove();
    };
  }, []); // setup once; all settings read via getSettings() on each rAF tick

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position:      'absolute',
        inset:         0,
        pointerEvents: 'none',
        overflow:      'hidden',
        ...style,
      }}
    />
  );
}
