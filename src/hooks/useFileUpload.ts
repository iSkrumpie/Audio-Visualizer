/**
 * useFileUpload — file input helpers
 *
 * Validates + dispatches to the audio store. Used by `<DropZone>` components.
 *
 * Max file sizes:
 *   audio: 2 GB cap (covers lossless / long recordings)
 *   image (logo/bg): 100 MB cap (covers large uncompressed images)
 */

import { useCallback } from 'react';
import { useAudioStore } from '@/lib/audioStore';

const MAX_AUDIO_BYTES = 2048 * 1024 * 1024; // 2 GB
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;  // 100 MB

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'];
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

export type UploadKind = 'audio' | 'logo' | 'background';

export function useFileUpload(kind: UploadKind) {
  const setAudio = useAudioStore((s) => s.setAudio);
  const setLogo = useAudioStore((s) => s.setLogo);
  const setBackground = useAudioStore((s) => s.setBackground);
  const setError = useAudioStore((s) => s.setError);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (kind === 'audio') {
        if (!ALLOWED_AUDIO_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.mp3')) {
          setError(`Unsupported audio format: ${file.type || 'unknown'}. Use MP3, WAV, OGG, or WebM.`);
          return;
        }
        if (file.size > MAX_AUDIO_BYTES) {
          setError(`Audio file too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 GB.`);
          return;
        }
        setAudio(file);
      } else {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          setError(`Unsupported image format: ${file.type || 'unknown'}. Use PNG, JPG, WebP, or SVG.`);
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`Image file too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 100 MB.`);
          return;
        }
        if (kind === 'logo') setLogo(file);
        else setBackground(file);
      }
    },
    [kind, setAudio, setLogo, setBackground, setError],
  );

  return { handleFile };
}
