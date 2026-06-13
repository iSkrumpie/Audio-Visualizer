/**
 * NebulaPlane — fBM noise fog, reads from settings.background.nebula*
 */

import { useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import nebulaVert from './shaders/nebula.vert';
import nebulaFrag from './shaders/nebula.frag';

export function NebulaPlane() {
  const { width, height } = useThree((s) => s.size);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const nebulaBeatDetector = useMemo(() => new FreqBeatDetector(), []);

  const uniforms = useMemo(() => ({
    uTime:        { value: 0 },
    uIntensity:   { value: 0 },
    uDriftSpeed:  { value: 1.0 },
    uAudioEnergy: { value: 0 },
    uAudioBass:   { value: 0 },
    uAudioPulse:  { value: 0 },
    uColor1:      { value: new THREE.Color('#6366F1') },
    uColor2:      { value: new THREE.Color('#22D3EE') },
  }), []);

  useFrame((_, delta) => {
    const mat = matRef.current;
    if (!mat) return;
    const bg = getSettings().background;

    if (!bg.nebulaEnabled) {
      if (meshRef.current) meshRef.current.visible = false;
      return;
    }
    if (meshRef.current) meshRef.current.visible = true;

    const { bass, loudness } = audioAnalysis;
    const energy = Math.min(1, bass * 2 + loudness);

    // Beat pulse mode: use FreqBeatDetector if nebulaBeatMode enabled
    let audioPulse = 0;
    if (bg.nebulaBeatMode) {
      nebulaBeatDetector.setSensitivity(bg.nebulaBeatSensitivity ?? 1.0);
      audioPulse = nebulaBeatDetector.update(
        audioAnalysis.rawFreqData,
        bg.nebulaBeatFreqStart ?? 40,
        bg.nebulaBeatFreqEnd ?? 120,
      );
    }

    mat.uniforms.uTime.value += delta;
    mat.uniforms.uIntensity.value = bg.nebulaIntensity;
    mat.uniforms.uDriftSpeed.value = bg.nebulaDriftSpeed;
    mat.uniforms.uAudioEnergy.value = energy * bg.nebulaReactivity;
    mat.uniforms.uAudioBass.value = bass;
    mat.uniforms.uAudioPulse.value = audioPulse;
    mat.uniforms.uColor1.value.set(bg.nebulaColor1);
    mat.uniforms.uColor2.value.set(bg.nebulaColor2);

    if (meshRef.current) {
      const scale = bg.nebulaScale ?? 1.0;
      const ox    = bg.nebulaOffsetX ?? 0;
      const oy    = bg.nebulaOffsetY ?? 0;
      meshRef.current.scale.set(width * scale, height * scale, 1);
      meshRef.current.position.x = ox * width  * 0.5;
      meshRef.current.position.y = oy * height * 0.5;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -8]} renderOrder={2} visible={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={nebulaVert}
        fragmentShader={nebulaFrag}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
