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

    // Resize renderer for export
    gl.setSize(width, height);
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

    // Beat detection state for export
    const beatHistory: number[] = new Array(25).fill(0);
    let beatGlow = 0;

    onProgress({ phase: 'rendering', progress: 0, message: `Rendering 0/${fftFrames.length} frames...` });

    const frameDuration = 1 / fps;
    const totalFrames = fftFrames.length;

    for (let i = 0; i < totalFrames; i++) {
      const frame = fftFrames[i];

      // Set audioAnalysis to pre-computed values
      audioAnalysis.freqData.set(frame.freqData.subarray(0, 128));
      audioAnalysis.bass = frame.bass;
      audioAnalysis.loudness = frame.loudness;
      audioAnalysis.highs = frame.highs;

      // Beat detection (same logic as live)
      const kickBinHz = 48000 / 2048;
      const lo = Math.floor(60 / kickBinHz);
      const hi = Math.ceil(120 / kickBinHz);
      let kickEnergy = 0;
      for (let j = lo; j <= hi && j < frame.freqData.length; j++) {
        kickEnergy += frame.freqData[j];
      }
      kickEnergy /= (hi - lo + 1) * 255;
      beatHistory.push(kickEnergy);
      beatHistory.shift();
      const avg = beatHistory.reduce((a, b) => a + b, 0) / beatHistory.length;
      if (kickEnergy > avg * 1.6 && kickEnergy > 0.12) beatGlow = 1;
      beatGlow = Math.max(0, beatGlow - 0.035);
      audioAnalysis.beatPhase = beatGlow;

      // Advance R3F frame — runs all useFrame callbacks (bars, particles, etc.) then renders
      const timestamp = i * frameDuration;
      if (sceneRegistry.advance) {
        sceneRegistry.advance(timestamp);
      } else {
        gl.render(scene, camera);
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
    gl.setSize(origSize.x, origSize.y);
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
