/**
 * AudioVisualizer — App root
 *
 * State machine: upload → visualize (+ export overlay)
 * Manages audio lifecycle, export flow, and stage transitions.
 */

import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Uploader } from '@/components/Uploader';
import { VisualizerStage } from '@/components/VisualizerStage';
import { ExportOverlay } from '@/components/ExportOverlay';
import { useAudioReactive } from '@/hooks/useAudioReactive';
import { useAudioStore } from '@/lib/audioStore';
import { exportMP4, downloadBlob, type ExportProgress } from '@/lib/exportEngine';
import { type ExportPreset } from '@/lib/exportPresets';

type Stage = 'upload' | 'visualize';

function App() {
  const [stage, setStage] = useState<Stage>('upload');
  const [exportMode, setExportMode] = useState<'idle' | 'picking' | 'running'>('idle');
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  const audioFile = useAudioStore((s) => s.audioFile);
  const audioObjectUrl = useAudioStore((s) => s.audioObjectUrl);
  const setError = useAudioStore((s) => s.setError);

  const { isPlaying, togglePlay, play, pause } = useAudioReactive();

  // Resolve audio duration once metadata loads
  useEffect(() => {
    if (!audioObjectUrl) return;
    const a = new Audio();
    a.src = audioObjectUrl;
    a.addEventListener('loadedmetadata', () => {
      useAudioStore.setState((s) => ({
        audioMetadata: s.audioMetadata
          ? { ...s.audioMetadata, duration: a.duration }
          : null,
      }));
    });
    return () => {
      a.removeAttribute('src');
      a.load();
    };
  }, [audioObjectUrl]);

  const handlePlay = useCallback(async () => {
    if (!audioFile) {
      setError('Bitte zuerst eine MP3-Datei hochladen.');
      return;
    }
    setError(null);
    setStage('visualize');
    requestAnimationFrame(async () => {
      try {
        await play();
      } catch (e) {
        setError(`Audio konnte nicht gestartet werden: ${(e as Error).message}`);
        setStage('upload');
      }
    });
  }, [audioFile, play, setError]);

  const handleBack = useCallback(() => {
    pause();
    setStage('upload');
  }, [pause]);

  const handleTogglePlay = useCallback(() => {
    void togglePlay();
  }, [togglePlay]);

  /** Open the preset picker */
  const handleExport = useCallback(() => {
    if (!audioFile) return;
    setExportMode('picking');
  }, [audioFile]);

  /** User confirmed a preset — start the actual encode */
  const handleStartExport = useCallback(async (preset: ExportPreset) => {
    if (!audioFile) return;

    setExportMode('running');
    setExportProgress({ phase: 'decoding', progress: 0, message: 'Starting...' });

    try {
      // Pause playback during export
      pause();

      const blob = await exportMP4(audioFile, {
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        videoBitrate: preset.videoBitrate,
        audioBitrate: preset.audioBitrate,
        onProgress: setExportProgress,
      });

      // Generate filename: <track>-<platform>-<label>-<date>.mp4
      const baseName = audioFile.name.replace(/\.[^.]+$/, '');
      const date = new Date().toISOString().slice(0, 10);
      const tag = `${preset.platform}-${preset.id.replace(/^(yt|tt)-/, '')}`;
      downloadBlob(blob, `${baseName}-${tag}-${date}.mp4`);
    } catch (e) {
      console.error('Export failed:', e);
    }
  }, [audioFile, pause]);

  const handleCancelExport = useCallback(() => {
    setExportMode('idle');
    setExportProgress(null);
  }, []);

  const canPlay = !!audioFile;

  return (
    <div className="h-full w-full">
      <AnimatePresence mode="wait">
        {stage === 'upload' ? (
          <Uploader key="uploader" onPlay={handlePlay} canPlay={canPlay} />
        ) : (
          <VisualizerStage
            key="visualizer"
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onBack={handleBack}
            onExport={handleExport}
          />
        )}
      </AnimatePresence>

      {/* Export overlay (on top of everything) */}
      <ExportOverlay
        mode={exportMode}
        progress={exportProgress}
        onStart={handleStartExport}
        onCancel={handleCancelExport}
      />
    </div>
  );
}

export default App;
