/**
 * InstancedBars — radial FFT bars + optional peak indicators.
 *
 * New settings: freqStart/freqEnd, solidColor, opacity, minHeight,
 * smoothing, peakEnabled/peakDecay, gapSize, rotationOnBeat, mirror,
 * audio-reactive color mode.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { useBeatDetectorRegistration } from './AudioScene';
import { getSettings } from '@/lib/settingsStore';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { usePhaseSource } from '@/hooks/usePhaseSource';
import { keyToPalette, bandPhasesToColor } from '@/lib/keyColors';


const MAX_BARS = 256;
const REF_VMIN = 900;

export function InstancedBars() {
  const meshRef     = useRef<THREE.InstancedMesh>(null);
  const peakMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy       = useMemo(() => new THREE.Object3D(), []);
  const smoothed    = useMemo(() => new Float32Array(MAX_BARS).fill(0), []);
  const peaks       = useMemo(() => new Float32Array(MAX_BARS).fill(0.02), []);
  const peakHeights = useMemo(() => new Float32Array(MAX_BARS).fill(0), []);
  const rotationRef     = useRef(0);
  const timeRef         = useRef(0);
  const colorObj        = useMemo(() => new THREE.Color(), []);
  const barsBeatDetector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(barsBeatDetector);

  // 4 random colors generated once per session for 'random' color mode
  const randomColors = useMemo(() => {
    return Array.from({ length: 4 }, () => {
      const h = Math.random();
      const sv = 0.7 + Math.random() * 0.3;
      const lv = 0.45 + Math.random() * 0.2;
      const c = new THREE.Color();
      c.setHSL(h, sv, lv);
      return c;
    });
  }, []);

  // v13.1: phase source — weighted blend of the 4 pre-analysis bands
  // by the user's Hz range. v13 had this hard-coded to kickPhase, which
  // broke when the user set a different band (e.g. "Bass" or "Sub-Bass"
  // would not trigger the bar boost even when the audio had bass). Now
  // the user's beatFreqStart/End drive the band weighting via
  // computeWeightedPhase() — so "Sub-Bass (20-80Hz)" still triggers
  // the bar boost (100% kick band) and "20-16000Hz Full" gets a
  // proportional blend of all 4 bands.
  const barsPhaseSource = usePhaseSource({
    detector: barsBeatDetector,
    getPrecomputedRange: () => {
      const bR = getSettings().bars;
      return {
        startHz: bR.beatFreqStart ?? 60,
        endHz:   bR.beatFreqEnd   ?? 250,
      };
    },
    liveFn: () => {
      const bLive = getSettings().bars;
      barsBeatDetector.setSensitivity(bLive.beatSensitivity ?? 1.0);
      return barsBeatDetector.update(
        audioAnalysis.rawFreqData,
        bLive.beatFreqStart ?? 60,
        bLive.beatFreqEnd ?? 250,
      );
    },
  });

  useFrame((state, delta) => {
    const mesh     = meshRef.current;
    const peakMesh = peakMeshRef.current;
    if (!mesh) return;

    const s = getSettings();
    const b = s.bars;

    if (!b.enabled) {
      mesh.visible = false;
      if (peakMesh) peakMesh.visible = false;
      return;
    }
    mesh.visible = true;
    if (peakMesh) peakMesh.visible = b.peakEnabled;

    // Sync opacity every frame so slider changes take effect immediately
    (mesh.material as THREE.MeshBasicMaterial).opacity = b.opacity;

    const { width, height } = state.size;
    const vmin  = Math.min(width, height);
    const scale = Math.min(vmin / REF_VMIN, 1);
    const radius = b.innerRadius * scale;
    const barMax = Math.round(100 * scale);

    timeRef.current += delta;

    const freq     = audioAnalysis.freqData;
    const loudness = audioAnalysis.loudness;
    // v13: get the active phase. In 'precomputed' mode → audioAnalysis.kickPhase
    // (separated from bass/snare in the pre-analysis pipeline). In 'live'
    // mode → the per-component FreqBeatDetector (registered for export reset).
    const beat = barsPhaseSource();

    const totalBars = Math.min(b.count, MAX_BARS);

    // Rotation
    rotationRef.current +=
      (0.0003 + b.rotationSpeed * 0.002) +
      loudness * 0.0007 +
      beat * b.rotationOnBeat * 0.01;

    // FFT bin range
    const freqRange = Math.max(1, b.freqEnd - b.freqStart);

    for (let i = 0; i < totalBars; i++) {
      // Map bar index → FFT bin within [freqStart, freqEnd]
      const binIndex = b.freqStart + Math.floor((i / Math.max(totalBars - 1, 1)) * freqRange);
      const fftBin = Math.min(Math.max(binIndex, 0), 127);

      const raw01 = freq[fftBin] / 255;
      peaks[i] = Math.max(raw01, peaks[i] * 0.987, 0.02);
      const norm01  = raw01 / peaks[i];
      const curved  = Math.pow(norm01, 3.5);
      const target  = curved * barMax * b.reactivity;
      smoothed[i]  += (target - smoothed[i]) * b.smoothing;

      const barH   = b.minHeight + smoothed[i] * b.lengthScale + beat * 25 * scale;
      const angle  = (i / totalBars) * Math.PI * 2 + rotationRef.current;
      const dist   = radius + barH / 2;
      const thinned = Math.max(0.1, 1.0 - b.gapSize);

      dummy.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
      dummy.rotation.set(0, 0, angle - Math.PI / 2);
      dummy.scale.set(b.thickness * thinned, barH, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color
      if (b.colorMode === 'rainbow') {
        // Hue cycles per bar position and shifts over time
        const hue = ((i / totalBars) + timeRef.current * 0.05) % 1.0;
        colorObj.setHSL(hue, 0.9, 0.55);
      } else if (b.colorMode === 'custom') {
        // Map FFT bin to Hz, then pick the matching user-defined color zone
        const barHz = (fftBin / 128) * 22050;
        let zoneIdx = 0;
        for (let z = 0; z < b.customFreqBoundaries.length; z++) {
          if (barHz >= b.customFreqBoundaries[z]) zoneIdx = z + 1;
        }
        zoneIdx = Math.min(zoneIdx, b.customColors.length - 1);
        colorObj.set(b.customColors[zoneIdx] || s.theme.accent);
      } else if (b.colorMode === 'random') {
        // 4 colors generated once per session, cycled per bar
        colorObj.copy(randomColors[i % randomColors.length]);
      } else if (b.colorMode === 'key-derived') {
        // v13: colour from the detected key. The 4-colour palette
        // (primary/secondary/accent/deep) is cycled by FFT bin position
        // (low-freq bars get primary, mid get secondary, high-mid
        // get accent, top get deep). Fall back to theme.accent if
        // no key has been detected yet.
        const palette = keyToPalette(audioAnalysis.key, audioAnalysis.scale);
        if (palette) {
          const fftNorm = fftBin / 127; // 0..1
          let color: string;
          if (fftNorm < 0.33)      color = palette.primary;
          else if (fftNorm < 0.66) color = palette.secondary;
          else if (fftNorm < 0.85) color = palette.accent;
          else                     color = palette.deep;
          // Mix with theme.accent by keyInfluence
          colorObj.set(color);
          if (s.theme?.accent) {
            const accent = new THREE.Color(s.theme.accent);
            colorObj.lerp(accent, 1 - (s.audio?.keyInfluence ?? 0.5));
          }
        } else {
          colorObj.set(s.theme.accent);
        }
      } else if (b.colorMode === 'band-driven') {
        // v13: colour = weighted HSL blend of the 4 band phases.
        // Bars with low-freq FFT bin get the kick weight (more red),
        // high-freq bars get the hihat weight (more cyan).
        const bandWeight = fftBin < 30 ? 'kick' : fftBin < 60 ? 'snare' : fftBin < 100 ? 'vocal' : 'hihat';
        let k = 0, s_ = 0, v = 0, h = 0;
        if (bandWeight === 'kick')  { k = audioAnalysis.kickPhase  * 1.5; s_ = audioAnalysis.snarePhase * 0.3; v = audioAnalysis.vocalPhase * 0.2; h = audioAnalysis.hihatPhase * 0.2; }
        else if (bandWeight === 'snare') { k = audioAnalysis.kickPhase  * 0.3; s_ = audioAnalysis.snarePhase * 1.5; v = audioAnalysis.vocalPhase * 0.2; h = audioAnalysis.hihatPhase * 0.4; }
        else if (bandWeight === 'vocal') { k = audioAnalysis.kickPhase  * 0.2; s_ = audioAnalysis.snarePhase * 0.3; v = audioAnalysis.vocalPhase * 1.5; h = audioAnalysis.hihatPhase * 0.3; }
        else                              { k = audioAnalysis.kickPhase  * 0.1; s_ = audioAnalysis.snarePhase * 0.2; v = audioAnalysis.vocalPhase * 0.3; h = audioAnalysis.hihatPhase * 1.5; }
        const cssColor = bandPhasesToColor(k, s_, v, h);
        colorObj.set(cssColor);
        // Blend with theme.accent by keyInfluence
        if (s.theme?.accent) {
          const accent = new THREE.Color(s.theme.accent);
          colorObj.lerp(accent, 1 - (s.audio?.keyInfluence ?? 0.5));
        }
      } else {
        colorObj.set(b.solidColor || s.theme.accent);
      }
      mesh.setColorAt(i, colorObj);

      // Peak indicator
      if (b.peakEnabled && peakMesh) {
        peakHeights[i] = Math.max(barH, peakHeights[i] * b.peakDecay);
        const pd = radius + peakHeights[i];
        dummy.position.set(Math.cos(angle) * pd, Math.sin(angle) * pd, 0);
        dummy.rotation.set(0, 0, angle - Math.PI / 2);
        dummy.scale.set(b.thickness * 1.5, 2, 1);
        dummy.updateMatrix();
        peakMesh.setMatrixAt(i, dummy.matrix);
        peakMesh.setColorAt(i, colorObj);
      }
    }

    // Hide unused slots
    for (let i = totalBars; i < MAX_BARS; i++) {
      dummy.position.set(0, 0, -9999);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (b.peakEnabled && peakMesh) peakMesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = totalBars;

    if (b.peakEnabled && peakMesh) {
      peakMesh.instanceMatrix.needsUpdate = true;
      if (peakMesh.instanceColor) peakMesh.instanceColor.needsUpdate = true;
      peakMesh.count = totalBars;
    }
  });

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_BARS]}
        position={[0, 0, -5]}
        renderOrder={3}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={1.0} />
      </instancedMesh>

      {/* Peak dots */}
      <instancedMesh
        ref={peakMeshRef}
        args={[undefined, undefined, MAX_BARS]}
        position={[0, 0, -4.9]}
        renderOrder={3}
        frustumCulled={false}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={1.0} />
      </instancedMesh>
    </>
  );
}
