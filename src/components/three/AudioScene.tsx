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
import { NebulaPlane } from './NebulaPlane';
import { InstancedBars } from './InstancedBars';
import { GPUParticles } from './GPUParticles';
import { CenterLogo } from './CenterLogo';
import { PostFX } from './PostFX';

// Exported registry for the export pipeline and live-preview rAF driver
export const sceneRegistry: {
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
  /** Advance one R3F frame: runs all useFrame callbacks then renders. */
  advance: ((timestamp: number) => void) | null;
} = { gl: null, scene: null, camera: null, advance: null };

/** Captures Three.js internals for the export pipeline */
function SceneCapture() {
  const { gl, scene, camera, advance } = useThree();
  useEffect(() => {
    sceneRegistry.gl = gl;
    sceneRegistry.scene = scene;
    sceneRegistry.camera = camera;
    sceneRegistry.advance = advance;
    return () => {
      sceneRegistry.gl = null;
      sceneRegistry.scene = null;
      sceneRegistry.camera = null;
      sceneRegistry.advance = null;
    };
  }, [gl, scene, camera, advance]);
  return null;
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
      <NebulaPlane />
      <InstancedBars />
      <GPUParticles />
      <CenterLogo />
      <PostFX />
    </Canvas>
  );
}
