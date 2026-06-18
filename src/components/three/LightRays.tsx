/**
 * LightRays — animated god-rays / crepuscular rays effect rendered via ogl
 * (standalone WebGL2 canvas, separate from the R3F scene graph). Mounted as
 * an HTML overlay div; z-ordering relative to the R3F canvas is controlled by
 * the parent container in VisualizerStage.
 *
 * Shader prefix rule: all local GLSL variables use `lr_` prefix.
 * See AGENTS.md §6 (ANGLE/Windows GLSL-Prefix-Regel).
 *
 * Audio reactivity:
 *   Primary:   uIntensityBoost — overall brightness boost on beat.
 *   Secondary: uPulsating      — activates shimmer-pulsing when beat > 0.3.
 *
 * Mouse-follow from the original reactbits source is intentionally omitted.
 */

import { useEffect, useRef, useMemo, type CSSProperties } from 'react';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import type { OGLRenderingContext } from 'ogl';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

// ─── Vertex shader ────────────────────────────────────────────────────────────

const VERT = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
// ALL local variables carry the `lr_` prefix (ANGLE Windows rule).
// Uniforms (uTime, uResolution, uRayPos, ...) keep their plain names.

const FRAG = /* glsl */ `#version 300 es
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

out vec4 fragColor;

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

  fragColor = vec4(lr_rays.rgb * uOpacity, lr_alpha);
}
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
    : [1, 1, 1];
}

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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LightRaysProps {
  className?: string;
  style?: CSSProperties;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LightRays renders an animated god-ray effect onto its own ogl canvas
 * element. The canvas is positioned `absolute inset-0` inside the container
 * div. The parent (VisualizerStage) controls z-index and optional logo mask.
 */
export function LightRays({ className, style }: LightRaysProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Beat detection — same pattern as Strands ──────────────────────────
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

  // Keep phase source ref current — rAF loop reads it, can't call hooks inside
  const phaseSrcRef = useRef(lightRaysPhaseSrc);
  phaseSrcRef.current = lightRaysPhaseSrc;

  // ── ogl lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    const ctn = containerRef.current;
    if (!ctn) return;

    // Create renderer — alpha: true so the canvas is transparent where no
    // rays are drawn. premultipliedAlpha: false for correct CSS compositing.
    const renderer = new Renderer({
      alpha:              true,
      premultipliedAlpha: false,
      antialias:          false,
      dpr:                Math.min(window.devicePixelRatio, 2),
    });
    const gl: OGLRenderingContext = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    ctn.appendChild(canvas);

    // ── Initial size ─────────────────────────────────────────────────────
    const resBuf: [number, number] = [0, 0];

    // Compute initial anchor/dir based on container size and default origin
    const initW = ctn.offsetWidth;
    const initH = ctn.offsetHeight;
    const initOrigin = DEFAULT_SETTINGS.background.lightRaysOrigin;
    const { anchor: initAnchor, dir: initDir } = getLightRaysAnchorAndDir(initOrigin, initW, initH);

    // ── Uniform storage ───────────────────────────────────────────────────
    const uniforms: Record<string, { value: number | number[] }> = {
      uTime:           { value: 0 },
      uResolution:     { value: resBuf },
      uRayPos:         { value: [...initAnchor] },
      uRayDir:         { value: [...initDir] },
      uRaysColor:      { value: hexToRgb(DEFAULT_SETTINGS.background.lightRaysColor) },
      uRaysSpeed:      { value: DEFAULT_SETTINGS.background.lightRaysSpeed },
      uLightSpread:    { value: DEFAULT_SETTINGS.background.lightRaysSpread },
      uRayLength:      { value: DEFAULT_SETTINGS.background.lightRaysLength },
      uPulsating:      { value: 0 },
      uFadeDistance:   { value: DEFAULT_SETTINGS.background.lightRaysFadeDistance },
      uOpacity:        { value: DEFAULT_SETTINGS.background.lightRaysOpacity },
      uIntensityBoost: { value: 1.0 },
    };

    const program = new Program(gl, {
      vertex:   VERT,
      fragment: FRAG,
      uniforms,
      transparent: true, // enables SRC_ALPHA / ONE_MINUS_SRC_ALPHA blending
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
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      resBuf[0] = w;
      resBuf[1] = h;
    }
    resize();
    window.addEventListener('resize', resize);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(ctn);
    }

    // ── rAF loop ──────────────────────────────────────────────────────────
    let animId: number;
    const startTime = performance.now();

    function update() {
      animId = requestAnimationFrame(update);
      const bg = getSettings().background;

      if (!(bg.lightRaysEnabled ?? DEFAULT_SETTINGS.background.lightRaysEnabled)) {
        const rawGl = gl as WebGL2RenderingContext;
        rawGl.clear(rawGl.COLOR_BUFFER_BIT);
        return;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      uniforms.uTime.value = elapsed;

      // ── Audio reactivity ───────────────────────────────────────────────
      const beat        = phaseSrcRef.current();
      const sensitivity = bg.lightRaysBeatSensitivity ?? DEFAULT_SETTINGS.background.lightRaysBeatSensitivity;
      const intensity   = bg.lightRaysBeatIntensity   ?? DEFAULT_SETTINGS.background.lightRaysBeatIntensity;
      const boost       = sensitivity > 0 ? intensity * beat : 0;

      uniforms.uIntensityBoost.value = 1.0 + boost;
      uniforms.uPulsating.value      = beat > 0.3 ? 1.0 : 0.0;

      // ── Update anchor/dir from origin setting ─────────────────────────
      const origin = bg.lightRaysOrigin ?? DEFAULT_SETTINGS.background.lightRaysOrigin;
      const dpr    = renderer.dpr;
      const w      = (ctn?.offsetWidth  ?? 0) * dpr;
      const h      = (ctn?.offsetHeight ?? 0) * dpr;
      const { anchor, dir } = getLightRaysAnchorAndDir(origin, w, h);
      (uniforms.uRayPos.value as number[])[0] = anchor[0];
      (uniforms.uRayPos.value as number[])[1] = anchor[1];
      (uniforms.uRayDir.value as number[])[0] = dir[0];
      (uniforms.uRayDir.value as number[])[1] = dir[1];

      // ── Settings → uniforms (every frame for live UI response) ────────
      const hex = bg.lightRaysColor ?? DEFAULT_SETTINGS.background.lightRaysColor;
      const rgb = hexToRgb(hex);
      (uniforms.uRaysColor.value as number[])[0] = rgb[0];
      (uniforms.uRaysColor.value as number[])[1] = rgb[1];
      (uniforms.uRaysColor.value as number[])[2] = rgb[2];

      uniforms.uRaysSpeed.value     = bg.lightRaysSpeed        ?? DEFAULT_SETTINGS.background.lightRaysSpeed;
      uniforms.uLightSpread.value   = bg.lightRaysSpread       ?? DEFAULT_SETTINGS.background.lightRaysSpread;
      uniforms.uRayLength.value     = bg.lightRaysLength       ?? DEFAULT_SETTINGS.background.lightRaysLength;
      uniforms.uOpacity.value       = bg.lightRaysOpacity      ?? DEFAULT_SETTINGS.background.lightRaysOpacity;
      uniforms.uFadeDistance.value  = bg.lightRaysFadeDistance ?? DEFAULT_SETTINGS.background.lightRaysFadeDistance;

      renderer.render({ scene: mesh });
    }

    animId = requestAnimationFrame(update);

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      resizeObserver?.disconnect();
      try {
        (gl as WebGL2RenderingContext)
          .getExtension('WEBGL_lose_context')
          ?.loseContext();
      } catch {
        // best-effort
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
