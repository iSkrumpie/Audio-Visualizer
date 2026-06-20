/**
 * Presets Store — named snapshots of the full Settings object.
 *
 * Persisted in localStorage under 'audiovisualizer:presets:v1'.
 * Each preset stores a copy of the complete Settings at save time.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Settings } from './settingsStore';

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  settings: Settings;
};

type PresetsStore = {
  presets: Preset[];
  /** Save current settings under the given name. Returns the new preset. */
  savePreset: (name: string, settings: Settings) => Preset;
  /** Delete a preset by id. */
  deletePreset: (id: string) => void;
  /** Rename a preset by id. */
  renamePreset: (id: string, name: string) => void;
};

export const usePresetsStore = create<PresetsStore>()(
  persist(
    (set) => ({
      presets: [],

      savePreset: (name, settings) => {
        const preset: Preset = {
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: name.trim() || 'Untitled Preset',
          createdAt: Date.now(),
          settings: structuredClone(settings),
        };
        set((s) => ({ presets: [preset, ...s.presets] }));
        return preset;
      },

      deletePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      renamePreset: (id, name) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, name: name.trim() || p.name } : p,
          ),
        })),
    }),
    {
      name: 'audiovisualizer:presets:v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: () => ({ presets: [] }),
    },
  ),
);
