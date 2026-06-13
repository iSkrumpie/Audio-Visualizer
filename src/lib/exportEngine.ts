/**
 * Export Engine — renders the Three.js scene frame-by-frame and encodes to MP4
 *
 * Uses Mediabunny (WebCodecs wrapper) for H.264/AAC encoding.
 * YouTube-spec: 1080p60, 12 Mbps, AAC-LC 384kbps Stereo 48kHz, BT.709.
 *
 * Flow:
 * 1. Decode audio file to AudioBuffer
 * 2. Pre-compute FFT data for every frame
 * 3. For each frame: set audioAnalysis, render scene, capture canvas
 * 4. Encode video + audio via Mediabunny
 * 5. Finalize + download
 */

import {
  Output,
  Mp4OutputFormat,
  CanvasSource,
  AudioBufferSource,
  BufferTarget,
} from 'mediabunny';
import * as THREE from 'three';
import { precomputeFFT } from './fft';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { sceneRegistry } from '@/components/three/AudioScene';
import { FreqBeatDetector } from './audioUtils';
import { getSettings } from './settingsStore';
import { useAudioStore } from './audioStore';

export type ExportProgress = {
  phase: 'decoding' | 'analyzing' | 'rendering' | 'finalizing' | 'done' | 'error';
  progress: number; // 0..1
  message: string;
};

export type ExportOptions = {
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  onProgress: (progress: ExportProgress) => void;
};

/**
 * Find the highest AAC bitrate supported by the current browser's WebCodecs AudioEncoder.
 * Tries candidates in descending order and returns the first supported one.
 */
async function findSupportedAacBitrate(
  candidates: number[],
  sampleRate: number,
  numberOfChannels: number,
): Promise<number> {
  for (const bitrate of candidates) {
    try {
      const result = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        bitrate,
        sampleRate,
        numberOfChannels,
      });
      if (result.supported) return bitrate;
    } catch {
      // isConfigSupported not available or threw — skip
    }
  }
  // Last resort: return smallest candidate and let the encoder fail naturally
  return candidates[candidates.length - 1];
}

export async function exportMP4(
  audioFile: File,
  options: ExportOptions,
): Promise<Blob> {
  const {
    width = 1920,
    height = 1080,
    fps = 60,
    videoBitrate = 12_000_000,
    audioBitrate = 384_000,
    onProgress,
  } = options;

  try {
    // Phase 1: Decode audio
    onProgress({ phase: 'decoding', progress: 0, message: 'Decoding audio...' });
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();
    onProgress({ phase: 'decoding', progress: 1, message: 'Audio decoded.' });

    // Phase 2: Pre-compute FFT
    onProgress({ phase: 'analyzing', progress: 0, message: 'Analyzing audio...' });
    const fftFrames = precomputeFFT(audioBuffer, fps);
    onProgress({ phase: 'analyzing', progress: 1, message: `${fftFrames.length} frames analyzed.` });

    // Phase 3: Render frames
    const { gl, scene, camera } = sceneRegistry;
    if (!gl || !scene || !camera) {
      throw new Error('Three.js scene not ready. Please start playback first.');
    }

    // Save original renderer state
    const origSize = gl.getSize(new THREE.Vector2());
    const origPixelRatio = gl.getPixelRatio();

    // Resize renderer + R3F's internal state.size for export.
    // CRITICAL: must use sceneRegistry.setSize (not just gl.setSize) so
    // components that read width/height from useThree(s => s.size) — like
    // the background plane scale, shader uResolution, and bars/particle
    // scaling — see the export resolution and not the preview-window size.
    if (sceneRegistry.setSize) {
      sceneRegistry.setSize(width, height);
    } else {
      gl.setSize(width, height, false);
    }
    gl.setPixelRatio(1);

    // Update camera for new aspect ratio
    const cam = camera as any;
    if (cam.isOrthographicCamera) {
      cam.left = -width / 2;
      cam.right = width / 2;
      cam.top = height / 2;
      cam.bottom = -height / 2;
      cam.updateProjectionMatrix();
    }

    const canvas = gl.domElement;

    // Create Mediabunny output
    const target = new BufferTarget();
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: videoBitrate,
      keyFrameInterval: 2,
    });
    // Probe for supported AAC bitrate — Chrome WebCodecs often rejects high values
    const aacCandidates = [audioBitrate, 320_000, 256_000, 192_000, 128_000].filter(
      (v, i, a) => a.indexOf(v) === i, // deduplicate
    );
    const resolvedAudioBitrate = await findSupportedAacBitrate(
      aacCandidates,
      audioBuffer.sampleRate,
      audioBuffer.numberOfChannels,
    );

    const audioSource = new AudioBufferSource({
      codec: 'aac',
      bitrate: resolvedAudioBitrate,
    });

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);

    // Start the output — required before any frames can be added
    await output.start();

    // Global beat detector — mirrors useAudioReactive's live detector so the
    // exported video matches the live preview's audio reactivity exactly.
    // Sample rate is hard-pinned to 48 kHz (the AudioContext above) for
    // correct Hz→bin mapping.
    const globalBeatDetector = new FreqBeatDetector(audioBuffer.sampleRate);

    onProgress({ phase: 'rendering', progress: 0, message: `Rendering 0/${fftFrames.length} frames...` });

    const frameDuration = 1 / fps;
    const totalFrames = fftFrames.length;
    const audioSettings = getSettings().audio;

    for (let i = 0; i < totalFrames; i++) {
      const frame = fftFrames[i];

      // Set audioAnalysis to pre-computed values
      audioAnalysis.freqData.set(frame.freqData.subarray(0, 128));
      audioAnalysis.rawFreqData.set(frame.rawFreqData.subarray(0, 1024));
      audioAnalysis.bass = frame.bass;
      audioAnalysis.loudness = frame.loudness;
      audioAnalysis.highs = frame.highs;

      // Drive the global beat detector with the same settings as live preview
      globalBeatDetector.setSensitivity(audioSettings.globalBeatSensitivity ?? 1.0);
      const globalBeat = globalBeatDetector.update(
        frame.rawFreqData,
        audioSettings.globalBeatFreqStart ?? 40,
        audioSettings.globalBeatFreqEnd ?? 120,
      );
      audioAnalysis.beatPhase = globalBeat;
      useAudioStore.getState().beatPhase = globalBeat;

      // Advance R3F frame — runs all useFrame callbacks (bars, particles, etc.) then renders
      const timestamp = i * frameDuration;
      if (sceneRegistry.advance) {
        sceneRegistry.advance(timestamp);
      } else {
        gl.render(scene, camera);
      }

      // Force the canvas backing buffer back to the target export size.
      // R3F's resize-pipeline (react-use-measure + subscribe block) sets the
      // canvas CSS size, then the browser's ResizeObserver fires async and
      // reports the actual rendered size — which can be clipped by the
      // preview's parent container (overflow-hidden / scrollbar width) and
      // differ from the export target by a few pixels. R3F's subscribe then
      // calls gl.setSize() with the wrong size, shrinking the canvas buffer
      // mid-export. Mediabunny's video encoder then sees a different
      // canvas size than the first frame and refuses to encode.
      // We pin canvas.width/height directly here, AFTER advance() and BEFORE
      // videoSource.add() reads them. updateStyle=false leaves the CSS box
      // alone, so the ResizeObserver won't immediately re-fire.
      if (canvas.width !== width || canvas.height !== height) {
        gl.setSize(width, height, false);
      }

      // Capture frame
      await videoSource.add(timestamp, frameDuration);

      // Progress update every 10 frames
      if (i % 10 === 0 || i === totalFrames - 1) {
        onProgress({
          phase: 'rendering',
          progress: (i + 1) / totalFrames,
          message: `Rendering ${i + 1}/${totalFrames} frames...`,
        });
      }

      // Yield to event loop periodically
      if (i % 30 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Close video source
    videoSource.close();

    // Add audio
    onProgress({ phase: 'finalizing', progress: 0.5, message: 'Encoding audio...' });
    await audioSource.add(audioBuffer);
    audioSource.close();

    // Finalize
    onProgress({ phase: 'finalizing', progress: 0.8, message: 'Finalizing MP4...' });
    await output.finalize();

    // Restore renderer state
    if (sceneRegistry.setSize) {
      sceneRegistry.setSize(origSize.x, origSize.y);
    } else {
      gl.setSize(origSize.x, origSize.y, false);
    }
    gl.setPixelRatio(origPixelRatio);
    if (cam.isOrthographicCamera) {
      cam.left = -origSize.x / 2;
      cam.right = origSize.x / 2;
      cam.top = origSize.y / 2;
      cam.bottom = -origSize.y / 2;
      cam.updateProjectionMatrix();
    }

    const buffer = target.buffer;
    if (!buffer) throw new Error('Export failed: no output buffer');

    onProgress({ phase: 'done', progress: 1, message: 'Export complete!' });
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (error) {
    onProgress({
      phase: 'error',
      progress: 0,
      message: `Export failed: ${(error as Error).message}`,
    });
    throw error;
  }
}

/** Trigger a browser download of a Blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
