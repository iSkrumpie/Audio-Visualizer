/**
 * AudioScene — main R3F Canvas composing all Three.js layers
 *
 * Orthographic camera (2D composition, 1 unit ≈ 1 pixel).
 * Z-layering: background → nebula → bars → particles → logo → postfx
 *
 * Exposed renderer ref for export pipeline.
 */

import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BackgroundPlane } from './BackgroundPlane';
import { BackgroundFx } from './BackgroundFx';
import { MagicRings } from './MagicRings';
import { LightPillar } from './LightPillar';
import { LightRays } from './LightRays';
import { Strands } from './Strands';
import { NebulaPlane } from './NebulaPlane';
import { InstancedBars } from './InstancedBars';
import { GPUParticles } from './GPUParticles';
import { CenterLogo } from './CenterLogo';
import { LogoSparks } from './LogoSparks';
import { PostFX } from './PostFX';

// Exported registry for the export pipeline and live-preview rAF driver
export const sceneRegistry: {
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
  /** Advance one R3F frame: runs all useFrame callbacks then renders. */
  advance: ((timestamp: number) => void) | null;
  /**
   * Resize the renderer AND R3F's internal state.size in sync.
   * Components read width/height from useThree(s => s.size) — if the
   * renderer is resized without updating R3F's size, the export pipeline
   * would render with mismatched canvas size vs. mesh scale vs.
   * shader resolution, causing the background plane to be sized for the
   * preview window and not the export frame.
   */
  setSize: ((width: number, height: number) => void) | null;
  /**
   * Set of per-component FreqBeatDetector instances that the export
   * pipeline needs to reset() before the first frame: each component
   * mounts its detector via useMemo and runs it continuously against
   * the live audio analyser. When the export starts writing precomputed
   * FFT data into audioAnalysis.rawFreqData, the detectors' prevBins
   * and fluxHistory are still trained on the live stream — without a
   * reset, the first ~40 frames (~0.67s) of the export would have wrong
   * beat cadences. Components register their detector here on mount
   * and unregister on unmount.
   */
  beatDetectors: Set<{ reset: () => void; resetForExport?: () => void; resetPhaseAndPrevBins?: () => void; setFrameDuration?: (dt: number) => void }>;
} = {
  gl: null,
  scene: null,
  camera: null,
  advance: null,
  setSize: null,
  beatDetectors: new Set(),
};

/** Captures Three.js internals for the export pipeline */
function SceneCapture() {
  const { gl, scene, camera, advance, setSize: r3fSetSize } = useThree();
  useEffect(() => {
    sceneRegistry.gl = gl;
    sceneRegistry.scene = scene;
    sceneRegistry.camera = camera;
    sceneRegistry.advance = advance;
    sceneRegistry.setSize = (width: number, height: number) => {
      gl.setSize(width, height, false);
      r3fSetSize(width, height);
    };
    return () => {
      sceneRegistry.gl = null;
      sceneRegistry.scene = null;
      sceneRegistry.camera = null;
      sceneRegistry.advance = null;
      sceneRegistry.setSize = null;
    };
  }, [gl, scene, camera, advance, r3fSetSize]);
  return null;
}

/**
 * Helper for components that own a FreqBeatDetector: registers it in the
 * scene-wide registry on mount and unregisters on unmount, so the export
 * pipeline can reset every detector to a clean first-frame state.
 */
export function useBeatDetectorRegistration(detector: { reset: () => void; resetForExport?: () => void; resetPhaseAndPrevBins?: () => void; setFrameDuration?: (dt: number) => void } | null) {
  useEffect(() => {
    if (!detector) return;
    sceneRegistry.beatDetectors.add(detector);
    return () => {
      sceneRegistry.beatDetectors.delete(detector);
    };
  }, [detector]);
}

type AudioSceneProps = {
  className?: string;
  style?: React.CSSProperties;
};

export function AudioScene({ className, style }: AudioSceneProps) {
  return (
    <Canvas
      orthographic
      frameloop="never"
      camera={{
        zoom: 1,
        position: [0, 0, 100],
        near: 0.1,
        far: 200,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true, // needed for export canvas capture
      }}
      dpr={Math.min(window.devicePixelRatio, 2)}
      style={{ position: 'absolute', inset: 0, ...style }}
      className={className}
    >
      <SceneCapture />
      <BackgroundPlane />
      <BackgroundFx />
      <Strands />
      <LightRays />
      <LightPillar />
      <MagicRings />
      <NebulaPlane />
      <InstancedBars />
      <GPUParticles />
      <CenterLogo />
      <LogoSparks />
      <PostFX />
    </Canvas>
  );
}
