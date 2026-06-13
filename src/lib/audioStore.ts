/**
 * Audio Store (Zustand)
 *
 * Holds user-uploaded files + playback state.
 *
 * Performance note: the per-frame analysis (bass/mids/highs/energy/rawFreq)
 * is written by useAudioReactive directly via `useAudioStore.getState().X = Y`
 * to avoid React re-renders. It is also mirrored to the standalone
 * `audioAnalysis` object in hooks/useAudioReactive.ts.
 */

import { create } from 'zustand';

export type AudioFileState = {
  audioFile: File | null;
  audioObjectUrl: string | null;
  audioMetadata: { name: string; size: number; duration: number } | null;

  logoFile: File | null;
  logoObjectUrl: string | null;

  bgFile: File | null;
  bgObjectUrl: string | null;

  isPlaying: boolean;
  currentTime: number;
  volume: number;

  errorMessage: string | null;

  // Direct-mutated analysis fields (mirrored from useAudioReactive rAF loop)
  bass: number;
  loudness: number;
  highs: number;
  energy: number;
  beatPhase: number;
  rawFreq: Uint8Array | null;
};

type AudioStore = AudioFileState & {
  setAudio: (file: File | null) => void;
  setLogo: (file: File | null) => void;
  setBackground: (file: File | null) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (t: number) => void;
  setVolume: (v: number) => void;
  setError: (msg: string | null) => void;
};

export const useAudioStore = create<AudioStore>((set) => ({
  audioFile: null,
  audioObjectUrl: null,
  audioMetadata: null,
  logoFile: null,
  logoObjectUrl: null,
  bgFile: null,
  bgObjectUrl: null,
  isPlaying: false,
  currentTime: 0,
  volume: 0.8,
  errorMessage: null,

  bass: 0,
  loudness: 0,
  highs: 0,
  energy: 0,
  beatPhase: 0,
  rawFreq: null,

  setAudio: (file) =>
    set((s) => {
      if (s.audioObjectUrl) URL.revokeObjectURL(s.audioObjectUrl);
      if (!file) {
        return {
          audioFile: null,
          audioObjectUrl: null,
          audioMetadata: null,
          isPlaying: false,
        };
      }
      return {
        audioFile: file,
        audioObjectUrl: URL.createObjectURL(file),
        audioMetadata: { name: file.name, size: file.size, duration: 0 },
        isPlaying: false,
        errorMessage: null,
      };
    }),
  setLogo: (file) =>
    set((s) => {
      if (s.logoObjectUrl) URL.revokeObjectURL(s.logoObjectUrl);
      if (!file) return { logoFile: null, logoObjectUrl: null };
      return { logoFile: file, logoObjectUrl: URL.createObjectURL(file) };
    }),
  setBackground: (file) =>
    set((s) => {
      if (s.bgObjectUrl) URL.revokeObjectURL(s.bgObjectUrl);
      if (!file) return { bgFile: null, bgObjectUrl: null };
      return { bgFile: file, bgObjectUrl: URL.createObjectURL(file) };
    }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  setError: (errorMessage) => set({ errorMessage }),
}));
