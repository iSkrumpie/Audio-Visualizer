# AudioVisualizer — Aktueller Stand

> Wird bei jeder Session aktualisiert. Gibt einem frischen Agenten in 30 Sekunden Kontext.

## Settings-Schema

- **Version**: v15
- **Storage-Key**: `audiovisualizer:settings:v15`
- **Migration**: deep-merge (alte User-Settings bleiben erhalten, neue Felder bekommen Defaults)
- **Bei nächstem Schema-Bump**: Key → `v16`, Version → 16, migrate → deep-merge wenn möglich

## Implementierte Features (aktueller Stand)

### Background
- ✅ Image-Effekte (Blur, Brightness, Saturation, Contrast, HueShift, Sharpen)
- ✅ Tint (Multiply/Overlay/Soft-Light/Screen)
- ✅ Beat FX (Scale on Beat)
- ✅ Vignette
- ✅ Nebula/Fog (fBM-Simplex, optional Beat-Pulse-Mode)
- ✅ Glow FX (Bloom, Chromatic Aberration)
- ✅ Color FX (Sepia, Color Average)
- ✅ Effects: Noise, Scanlines, Glitch, Pixelation, Dot Screen, Grid
- ✅ Weather FX: BG-Particles, Rain, Snow
- ✅ **Strands** (ogl-Overlay, Session 20) — Aurora/Lichtbänder
- ❌ Strands nicht im MP4-Export (TODO: ogl-Canvas screenshotten + in R3F composen)

### Logo
- ✅ Circular Logo mit Canvas-Mask
- ✅ Outer Glow (ShaderMaterial, 4 Color-Modi)
- ✅ Inner Glow (soft falloff, 4 Color-Modi)
- ✅ Fire Ring (Domain-Warp FBM, 3-Stop-User-Gradient, Session 16)
- ✅ Sparks/Embers (GPU Ambient Pool + CPU Burst Pool, Session 16)

### Bars / Particles
- ✅ Radial FFT-Bars mit Peak-Dots
- ✅ GPU-Particles mit Orbit-Modes + Connection Lines

### Audio
- ✅ Dual-Analyser (visual 256 + kick 2048)
- ✅ FreqBeatDetector (Spectral-Flux, 11 Instanzen)
- ✅ Pre-Analysis Pipeline (essentia.js BPM + Ticks + Key, Session 13)
- ✅ Multi-Band Beat (Kick/Snare/Vocal/HiHat)
- ⚠️ essentia.js WASM lädt manchmal nicht (fallback zu live-mode, kein Fehler für User)

### Export
- ✅ MP4-Export (mediabunny, H.264 + AAC)
- ✅ YouTube + TikTok Presets
- ✅ AAC-Bitrate-Probe (512k → 384k → ... → 128k)

## Offene TODOs

| Priorität | Was | Wo |
|---|---|---|
| Medium | Strands im MP4-Export (ogl-Canvas screenshotten + in R3F composen) | `Strands.tsx` + `exportEngine.ts` |
| Low | Strands Color-Editor: Farb-Swatch-Vorschau | `SettingsPanel.tsx` Strands-Accordion |
| Low | Mask bei Beat-Scale-Burst: Strands kurzzeitig am Logo-Rand sichtbar | `VisualizerStage.tsx` |

## Aktueller Build-Stand

```bash
npm run typecheck  # ✅ 0 errors
npm run build      # ✅ ~539 modules
```

## Letzte Session

**Session 20** — Strands Background Effect (ogl-Overlay). Alle Root-Causes dokumentiert in `docs/howto-effects.md` Checkliste C (ogl-Standalone-Effekt).
