import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';
import path from 'node:path';

// Vite config for AudioVisualizer
// - React 19 + Tailwind v4 (CSS-first, no tailwind.config.ts needed)
// - GLSL plugin for shader files (Phase 2)
// - No COOP/COEP needed: Chrome only, no FFmpeg.wasm (no SharedArrayBuffer required)
export default defineConfig({
  plugins: [react(), tailwindcss(), glsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
