/**
 * useTheme — applies the current theme mode to the document root
 *
 * Side-effect only: subscribes to the settings store and mirrors
 * `settings.theme.mode` to `document.documentElement.dataset.theme`
 * + the standalone `audiovisualizer:theme` localStorage key (read by
 * the inline bootstrap script in index.html on the next reload).
 *
 * Components should NOT use this hook to read the mode — read it from
 * the store via `useSettingsStore(s => s.settings.theme.mode)`. This
 * hook just keeps the DOM in sync.
 */

import { useEffect } from 'react';
import { useSettingsStore, THEME_STORAGE_KEY, type ThemeMode } from '@/lib/settingsStore';

export function useTheme(): void {
  useEffect(() => {
    const apply = (mode: ThemeMode) => {
      if (mode !== 'dark' && mode !== 'light') return;
      document.documentElement.dataset.theme = mode;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
      } catch {
        // localStorage may be disabled — fail silently
      }
    };

    // Apply current state once (in case it diverged from the inline script)
    apply(useSettingsStore.getState().settings.theme.mode);

    // Subscribe to future changes
    const unsub = useSettingsStore.subscribe((state) => {
      apply(state.settings.theme.mode);
    });

    return unsub;
  }, []);
}

/** Standalone action: toggle between dark/light. */
export function toggleTheme(): void {
  const current = useSettingsStore.getState().settings.theme.mode;
  useSettingsStore.getState().setThemeMode(current === 'dark' ? 'light' : 'dark');
}

/** Standalone action: explicitly set the theme mode. */
export function setThemeMode(mode: ThemeMode): void {
  useSettingsStore.getState().setThemeMode(mode);
}
