# AudioVisualizer — Architecture

> Geladen von `AGENTS.md` bei Bedarf. Enthält die vollständige App-Architektur.

## 4. App-Architektur

### 4.1 Verzeichnis-Layout

```
src/
├── main.tsx                 # Mount, <StrictMode>, <ThemeApplier> + <App>
├── App.tsx                  # State-Machine: 'upload' ↔ 'visualize'
│                            # exportMode: 'idle' | 'picking' | 'running'
├── index.css                # Tailwind v4 import, Design-Tokens, Theme-Vars, .hz-range-picker
├── vite-env.d.ts            # *.vert / *.frag / *.glsl + EyeDropper API type decls
│
├── components/
│   ├── Uploader.tsx         # 2-Spalten-Shell: Sidebar (Brand+Nav) + Main (4 Steps)
│   │                        # Steps: 01=Audio, 02=Logo, 03=Background, 04=Play
│   ├── DropZone.tsx         # Wiederverwendbar: drag/drop + click, mit Preview
│   ├── ThemeToggle.tsx      # Existiert noch (Datei), aber NICHT mehr verwendet
│   ├── VisualizerStage.tsx  # 3-Layer-Stage: <AudioScene/> + HTML-Overlays
│   ├── TransportBar.tsx     # Player: Seek-Slider, Play/Pause, Volume, Export
│   ├── SettingsPanel.tsx    # Right-Drawer mit 4 Tabs + Preset-Dropdown + Accordion-Sections
│   ├── ExportOverlay.tsx    # 2-Screen-Modal: Preset-Picker → Progress
│   ├── HzRangePicker.tsx    # Shared: 10 Preset-Buttons + log-Dual-Slider + Bin-Quality-Indicator
│   └── three/
│       ├── AudioScene.tsx       # <Canvas> frameloop="never", advance() via sceneRegistry
│       ├── BackgroundFx.tsx     # 3 backdrop effects: free particles, rain streaks, snow flakes — all behind logo (z=-9.5, renderOrder=1)
│       ├── BackgroundPlane.tsx  # ALLE Hintergrund-Effekte im GLSL-Shader (nur BG-Layer!):
│       │                        # blur, sharpen, CA, bloom, noise, scanlines, glitch,
│       │                        # pixelation, dot, grid, sepia, colorAvg,
│       │                        # hueShift, brightness, contrast, saturation, vignette, tint
│       ├── InstancedBars.tsx    # Radial-FFT-Bars + optionale Peak-Dots (2. InstancedMesh)
│       │                        # Eigener FreqBeatDetector für Hz-konfigurierbaren Beat-Boost
│       ├── GPUParticles.tsx     # THREE.Points + THREE.LineSegments (connection lines)
│       │                        # Shapes: circle/star/diamond, ColorModes: solid/rainbow/custom/random
│       ├── CenterLogo.tsx       # Logo: immer circle, ShaderMaterial Glow-Plane (4 Color-Modi),
│       │                        # Fire-Ring (fBm Procedural, RingGeometry auf Logo-Rand)
│       ├── NebulaPlane.tsx      # fBM-Simplex-Fog + optional Pulse-Mode (eigener FreqBeatDetector)
│       ├── PostFX.tsx           # PERMANENTER STUB - gibt immer null zurück
│       └── shaders/
│           ├── nebula.vert
│           └── nebula.frag
│
├── hooks/
│   ├── useAudioReactive.ts  # Dual-Analyser (visual=256 smoothed, kick=2048 raw)
│   │                        # rAF-Tick ruft sceneRegistry.advance() → treibt R3F-Frame
│   │                        # + globaler FreqBeatDetector für audioAnalysis.beatPhase
│   ├── useFileUpload.ts     # Validierung (Audio 2 GB / Image 100 MB) → store
│   └── useTheme.ts          # Mirror settings.theme.mode → document.documentElement.dataset.theme
│
└── lib/
    ├── audioStore.ts        # zustand: Files + Volume + ErrorMessage + Analysis-Felder
    ├── audioUtils.ts        # getFreqRangeEnergy() - Hz→Bin-Mapping
    │                        # FreqBeatDetector - Spectral-Flux Onset-Detection (pro Komponente eine Instanz)
    │                        # FREQ_PRESETS, sliderToHz/hzToSlider (log), getBinCountForRange
    ├── settingsStore.ts     # zustand + persist(key='audiovisualizer:settings:v12', v=12)
    │                        # DEFAULT_SETTINGS ist exportiert (für useF-Defensive-Defaults)
    ├── presetsStore.ts      # zustand + persist(key='audiovisualizer:presets:v1')
    ├── exportEngine.ts      # Mediabunny-MP4-Pipeline + AAC-Bitrate-Probe
    │                        # + eigener FreqBeatDetector für audioAnalysis.beatPhase
    ├── exportPresets.ts     # YouTube + TikTok Preset-Definitionen
    ├── fft.ts               # Offline-Cooley-Tukey-FFT für Export
    │                        # precomputeFFT() liefert freqData (128) UND rawFreqData (1024)
    └── utils.ts             # formatTime, clamp, lerp
```

### 4.2 Stage-State-Machine (App.tsx)

```
[upload]  -- Play & Visualize -->  [visualize]  -- Back -->  [upload]
```

- `stage: 'upload' | 'visualize'`
- `exportMode: 'idle' | 'picking' | 'running'` - steuert ExportOverlay (2-Screen)

### 4.3 R3F Frameloop - WICHTIG

Der Canvas läuft auf `frameloop="never"`. Das bedeutet:

- R3F rendert **nur** wenn explizit `advance(timestamp)` aufgerufen wird.
- **Live-Preview**: `useAudioReactive`-rAF-Tick ruft `sceneRegistry.advance(performance.now()/1000)` am Ende jedes Ticks.
- **Export**: `exportEngine.ts` ruft `sceneRegistry.advance(timestamp)` pro Frame - dadurch laufen alle `useFrame`-Callbacks (Bars, Particles, etc.) mit den precomputed FFT-Daten.
- `sceneRegistry` hat Felder: `gl`, `scene`, `camera`, `advance`, `setSize`, `beatDetectors: Set<{reset: () => void}>`.
- **`sceneRegistry.setSize(w, h)`** ruft intern `gl.setSize(w, h, false)` (kein Style-Update) + R3F's `r3fSetSize(w, h)`. R3F's subscribe triggert daraufhin `gl.setSize(w, h, true)` mit Style-Update. Im Export-Loop `gl.setSize(w, h, false)` **nach** `advance()` erneut aufrufen, falls ResizeObserver die Canvas-Größe zwischendurch verändert hat. Siehe §6.

**R3F-State-Sync:** Components dürfen `useFrame`-intern `width/height` aus dem `state.size`-Parameter des Callbacks lesen — **NICHT** aus einem `useThree((s) => s.size)`-Subscription, weil die Closure bei `r3fSetSize` **asynchron** (React-Re-Render) re-evaluiert wird, der `useFrame`-Callback aber im selben synchronen Block schon läuft. Siehe §6.

### 4.4 Datendfluss Audio

```
User-Upload → audioStore.setAudio(file) → useAudioReactive-useEffect
  → createMediaElementSource
    ├─→ AnalyserNode (fft 256, smooth 0.55) → "visual"
    │     → audioAnalysis.freqData    (128 bins, ~172 Hz/Bin) → Bars, Particles (Farben)
    │     → audioAnalysis.bass/loudness/highs
    └─→ AnalyserNode (fft 2048, smooth 0.0) → "kick"
          → audioAnalysis.rawFreqData (1024 bins, ~21.5 Hz/Bin)
          → global FreqBeatDetector(settings.audio.globalBeatFreqStart/End, settings.audio.globalBeatSensitivity)
          → audioAnalysis.beatPhase   (decaying 0..1, Hz-konfigurierbar via Settings)

Jeder rAF-Tick:
  → schreibt in audioAnalysis (mutable, von useFrame gelesen)
  → ruft sceneRegistry.advance() → R3F-Frame
```

**Three.js-Komponenten lesen NIE aus zustand für per-Frame-Daten.** Immer `audioAnalysis` direkt + `getSettings()`.

**`audioAnalysis.rawFreqData`** - WICHTIG: Immer für `FreqBeatDetector.update()` verwenden, NICHT `freqData`. Die geglätteten `freqData` (smoothing=0.55) verschlucken Transienten → Beat-Detection feuert nie.

**`audioAnalysis.beatPhase`** - Wird vom globalen `FreqBeatDetector` in `useAudioReactive` erzeugt. Frequenzbereich und Sensitivity kommen aus `settings.audio.globalBeat*`. Default 40-120 Hz (Kick). Im Export wird der **gleiche** Detector mit den **gleichen** Settings nachgebaut (siehe §4.5).

### 4.5 Export-Pipeline (`src/lib/exportEngine.ts`)

```
exportMP4(file, options)
  1. AAC-Bitrate-Probe  → AudioEncoder.isConfigSupported() mit [audioBitrate, 320k, 256k, 192k, 128k]
  2. decode   → AudioBuffer (Original-Sample-Rate des Files, z.B. 44100 oder 48000)
  3. analyze  → precomputeFFT(audioBuffer, fps) → Array<{freqData, rawFreqData, bass, loudness, highs, energy}>
                precomputeFFT: Blackman-Window + 1/N-Scaling + [-100,-30] dB → byte + Trailing-Window
                              + Inter-Frame-EMA-Smoothing (0.55 für visual, 0.0 für kick) + Mono-Downmix
  4. Renderer resize auf Zielauflösung, Camera anpassen
     - sceneRegistry.setSize(w, h) — synced R3F state.size mit Canvas-Buffer
     - gl.setPixelRatio(1) — keine DPR-Skalierung im Export
     - canvas.style.width/height = `${w}px` / `${h}px` (CSS-Size pinnen, sonst ResizeObserver-Clipping)
  5. **DETECTOR-RESET** (KRITISCH): for each detector in sceneRegistry.beatDetectors: detector.reset()
     — setzt prevBins, fluxHistory, phase auf 0. Sonst reagieren die ersten ~40 Frames auf den
       Live-Stream-trainierten Detector-State und nicht auf die precomputed Daten.
  6. render   → pro Frame:
                  audioAnalysis.freqData.set(...)
                  audioAnalysis.rawFreqData.set(...)   ← KRITISCH: ohne das feuert KEIN FreqBeatDetector
                  global FreqBeatDetector(settings.audio.globalBeat*).update(rawFreqData, ...)
                  audioAnalysis.beatPhase = globalBeat
                  if (sceneRegistry.setSize) sceneRegistry.setSize(w, h)   ← state.size pro Frame syncen
                  if (canvas.width !== w || canvas.height !== h) gl.setSize(w, h, false)  ← Buffer-Size pinnen
                  sceneRegistry.advance(timestamp)
                  if (canvas.width !== w || canvas.height !== h) gl.setSize(w, h, false)  ← nochmal nach advance()
                  videoSource.add(timestamp, 1/fps)
                  if (i % 30 === 0) await new Promise(r => setTimeout(r, 0))  ← Event-Loop yield
  7. audio    → audioSource.add(audioBuffer)
  8. finalize → output.finalize() → Blob
  9. restore  → sceneRegistry.setSize(origSize.x, origSize.y) + gl.setPixelRatio(orig) + Camera reset
```

**KRITISCH (v11-Fix):** `audioAnalysis.rawFreqData` muss pro Frame gesetzt werden. Sonst sehen alle 5+ `FreqBeatDetector`-Instanzen (Background, Logo×2, Particles, Bars, Nebula-Pulse) leere Daten und **nur Bars animieren sich** im Export (über `freqData`). Hardcoded 60-120 Hz Kick-Detection wurde entfernt - der globale `FreqBeatDetector` läuft mit den **gleichen** Settings wie das Live-Preview.

**Live/Export-Sync (Session 9 Fixes):** `useAudioReactive.stopAndPause()` wird in `App.tsx:handleStartExport` aufgerufen, BEVOR `exportMP4` läuft. Nach Export (success oder error) wird `startAndPlay()` in `finally` aufgerufen. Sonst race-bedingt beide Loops schreiben in `audioAnalysis`.

**Export-Presets** (`src/lib/exportPresets.ts`):
- YouTube: 1080p@60 (12Mbps), 1080p@30 (8Mbps), 1440p@60 (24Mbps), 1440p@30 (16Mbps), 4K@30 (45Mbps)
- TikTok: 1080×1920 Portrait @60 (10Mbps), @30 (10Mbps)

### 4.6 Settings-Store (localStorage)

- Key: `audiovisualizer:settings:v12`
- `version: 12`, `migrate: () => DEFAULT_SETTINGS` → bei Schema-Bump alles wipen
- `DEFAULT_SETTINGS` ist **exportiert** (für `useF`-Defensive-Defaults bei alten Presets - siehe §6)
- **Gruppen:**

| Gruppe | Inhalt |
|--------|--------|
| `theme` | `mode`, `accent`, `secondary` (Palette-Farben, kein eigener Tab) |
| `audio` (NEU v11) | `globalBeatFreqStart`, `globalBeatFreqEnd` (Hz, default 40-120 = Kick), `globalBeatSensitivity` (0.1-5.0, default 1.0). Treibt den globalen `FreqBeatDetector` in `useAudioReactive` + `exportEngine` → schreibt `audioAnalysis.beatPhase`. |
| `background` | blur, brightness, saturation, contrast, hueShift, sharpen, tint (color/opacity/mode), **beatFxFreqStart/beatFxFreqEnd** (HzRangePicker), **beatFxSensitivity** (0.1-5.0), scaleOnBeat (0..0.5), vignette (enabled/strength), nebula (enabled/intensity/color1/color2/driftSpeed/reactivity/scale/offsetX/offsetY + **nebulaBeatMode/FreqStart/End/Sensitivity** für optionalen Pulse-Mode), PostFX: bloom (enabled/intensity/threshold), CA (enabled/offset), noise (enabled/intensity/speed/beatReactivity/scale/colorMode), scanlines (enabled/density/speed/beatReactivity/thickness), glitch (enabled/delay/strength/RGBSplit/BlockSize/BlockProb/Vertical/BeatSync/Decay), sepia (enabled/intensity), pixelation (enabled/granularity/beatReactivity/wave/waveSpeed), dotscreen (enabled/scale/rotation/rotSpeed/beatScale/colorSep), grid (enabled/scale/pulseStrength/wave/waveSpeed/movement/color), colorAverage (enabled), **bgParticles** (bgParticlesEnabled/Count/Speed/Size/Opacity/Color/BeatFreqStart/BeatFreqEnd/BeatSensitivity), **rain** (rainEnabled/Count/Speed/Angle/Length/Width/Color/Opacity/BeatFreqStart/BeatFreqEnd/BeatSensitivity), **snow** (snowEnabled/Count/Speed/Size/Color/Opacity/Sway/BeatFreqStart/BeatFreqEnd/BeatSensitivity), **strands** (strandsEnabled/Colors/Count/Speed/Amplitude/Waviness/Thickness/Glow/Taper/Spread/HueShift/Intensity/Saturation/Opacity/Scale/BeatFreqStart/BeatFreqEnd/BeatSensitivity/BehindLogo) |
| `logo` | enabled, size (80-1600), opacity, **beatScaleStrength**, **beatFxFreqStart/beatFxFreqEnd** (HzRangePicker), **beatFxSensitivity**, **outerGlow** (outerGlowEnabled/Intensity/Color/Size/Blur/ColorMode/CycleSpeed/CustomColors), **innerGlow** (innerGlowEnabled/Intensity/Color/Size/Blur/ColorMode/CycleSpeed/CustomColors — soft falloff from logo edge toward center), fire (enabled/intensity/height/speed/inner/mid/outerColor/**reactivity/freqStart/freqEnd/sensitivity**). - shape/cornerRadius/**beatRotationBurst**/ring entfernt (v11), Logo ist immer circle, kein Rotation-Burst mehr. v12: Glow → Outer Glow + new Inner Glow (soft falloff). |
| `bars` | enabled, count, thickness, lengthScale, innerRadius, rotationSpeed, rotationOnBeat, colorMode (solid/rainbow/custom/random), solidColor, customColors (string[]), customFreqBoundaries (number[]), reactivity, freqStart/freqEnd (Bin-Index, für Height-Mapping - **separat** von beatFreq*), opacity, minHeight, gapSize, smoothing, peakEnabled, peakDecay - **NEU v11: beatFreqStart/beatFreqEnd (HzRangePicker) + beatSensitivity** für eigenen Bars-Beat-Boost. mirror entfernt |
| `particles` | enabled, count, size, orbitRadius, speed, spread, kickBurstStrength, opacity, sizeOnBeat, colorMode (solid/rainbow/custom/random), solidColor, customColors (string[]), customFreqBoundaries (number[]), reactiveFreqStart/reactiveFreqEnd (HzRangePicker), **reactiveSensitivity**, orbitMode (circular/elliptical/scatter), ellipseRatio, particleShape (circle/star/diamond), blendMode, connectionLines, connectionDistance, connectionOpacity, twinkle, twinkleSpeed - monoColor/reactiveAxis entfernt |

### 4.7 Preset-Store (localStorage)

- Key: `audiovisualizer:presets:v1`
- Jedes Preset: `{ id, name, createdAt, settings: Settings }` - **vollständiger** Settings-Snapshot (überlebt Schema-Bumps nicht)
- UI: Dropdown (auto-load bei Auswahl) + "Save"-Button (expandiert Name-Input) + Trash-Icon
- **Alte Presets** (vor Schema-Bump gespeichert) haben Felder der neueren Version **nicht**. Wird vom `useF`-Hook defensiv behandelt (siehe §6 + §9).

### 4.8 SettingsPanel - Tab-Struktur

**4 Tabs**: Background · Logo · Bars · Particles

Jeder Tab nutzt **Accordion-Sections** (`<Acc label="...">`) - nur eine auf einmal aufklappbar.

| Tab | Accordions |
|-----|-----------|
| Background | Image · Tint · **Beat FX (HzRangePicker + Sensitivity)** · Vignette · **Nebula/Fog (Scale+Offset + optional Beat-Pulse Mode)** · Glow FX · Color FX (CA, Sepia, ColorAvg) · Effects (Noise+anim, Scanlines+anim, Glitch+Controls+beatReactivity, Pixelation+beatReactivity, DotScreen+anim, Grid+anim) |
| Logo | Size · **Outer Glow (ColorMode solid/rainbow/custom/random + CycleSpeed)** · **Inner Glow (soft falloff, same ColorMode controls)** · **Fire Ring (HzRangePicker + Sensitivity)** · **Animation (HzRangePicker + Sensitivity, kein Rotation-Burst mehr)** |
| Bars | General · Shape · Frequency · Animation · Size & Radius · Peaks · **Beat Boost (HzRangePicker + Sensitivity, NEU v11)** · **Custom Colors** (bei colorMode=custom) |
| Particles | General · Shape & Size · Orbit · **Physics (HzRangePicker + Sensitivity)** · Connections · Flicker · **Custom Colors** (bei colorMode=custom) |

**HzRangePicker** (`src/components/HzRangePicker.tsx`):
- **10 Preset-Buttons**: Kick (40-120), Sub-Bass (20-80), Bass (20-250), Snare (150-900), Vocal (300-3000), Mids (250-4000), High-Mids (2000-6000), Highs (4000-20000), Hi-Hat (6000-14000), Full (20-16000)
- **Logarithmischer Dual-Slider** (sliderToHz/hzToSlider in `audioUtils.ts`) - 20-20000 Hz
- **Bin-Quality-Indicator** (poor/ok/good) - warnt vor zu schmalen Bändern (< 4 FFT-Bins)
- CSS in `index.css` unter `.hz-range-picker` (overlapping range inputs mit transparent track)

**Preset-Bar** sitzt zwischen Header und Tabs: `[Dropdown ▼] [🗑] [Save]` + optionales Name-Input.

**UI-Primitives** in SettingsPanel.tsx (alle intern, nicht exportiert):
- `FR({ label, hint?, sub?, children })` - Field Row
- `Sl({ value, min, max, step, onChange })` - Range Slider
- `CP({ value, onChange })` - Color Picker mit EyeDropper-Button (Chrome 95+)
- `CB<T>({ value, options, onChange })` - Segmented Buttons
- `Tg({ value, onChange, label, info? })` - Toggle Switch. **`info?`** rendert `Hint` als Sibling inline neben dem Toggle (DOM: `<div flex>` + inner `<button flex-1>` + `<Hint/>` — keine nested-buttons). Setze `info` nur, wenn der Toggle-Name nicht selbsterklärend ist (z.B. `outerGlowEnabled`, `connectionLines`). Master-Toggles wie `logo.enabled` / `bars.enabled` / `particles.enabled` **bekommen KEINEN Hint** — der Name ist klar genug.
- `Acc({ label, children, description? })` - Accordion. **`defaultOpen?` ist in Session 19 entfernt** — `useState(false)` ist jetzt hartcodiert. Alle Zieharmonikas starten eingeklappt, ohne Ausnahme. Beim Hinzufügen eines neuen `<Acc>` **kein** `defaultOpen` setzen.
- `EffectCard({ label, enabled, onToggle, children? })` - PostFX-Card mit Toggle
- `CustomColorEditor({ group })` - Editor für custom Farb-Zonen (Bars + Particles; nicht Glow - Glow hat eigenen inline-Editor)
- `useF(group, key)` - gibt `[value, setter]` zurück, **kein** Rerender-overhead für Three.js. **Defensive**: gibt `DEFAULT_SETTINGS[group][key]` zurück wenn Feld im aktuellen State `undefined` ist (z.B. altes Preset geladen).

### 4.9 Three.js Komponenten - Was macht was

| Komponente | Liest Settings aus | Besonderheiten |
|-----------|-------------------|----------------|
| `BackgroundFx` | `settings.background.{bgParticles,rain,snow}.*` | 3× FreqBeatDetector für per-Effect Beat-Reaktivität. Screen-fill THREE.Points mit custom Shaders, AdditiveBlending, depthWrite=false, z=-9.5/renderOrder=1. Shader-Prefixes: bpv_/bpf_ (BG-Particles), rpv_/rp_ (Rain), snv_/sn_ (Snow). |
| `BackgroundPlane` | `settings.background.*`, `settings.theme.mode` | Alle Hintergrund-Effekte im GLSL-Shader. NUR Hintergrund betroffen. useFrame hat `delta` für `uTime` (Noise/Glitch). ANGLE-Variablen-Prefix-Regel! **1× FreqBeatDetector** (useMemo) → `setSensitivity(beatFxSensitivity) + update(rawFreqData, beatFxFreqStart, beatFxFreqEnd)`. Bloom: 9×9 2D Gaussian Kernel, 1-Texel-Stride. |
| `NebulaPlane` | `settings.background.nebula*` | fBM-Simplex-Fog, 2 Farben, audio-reaktiv, nebulaScale + nebulaOffsetX/Y. **Optional Pulse-Mode** (`nebulaBeatMode`): eigener `FreqBeatDetector` + neuer `uAudioPulse` uniform im `nebula.frag` (np_ prefix). Default OFF → alte bass+loudness Waber-Logik bleibt. |
| `PostFX` | - | **Permanenter Stub**, immer `null`. Kein EffectComposer. |
| `InstancedBars` | `settings.bars.*` | MAX_BARS=256, 2. InstancedMesh für Peak-Dots, freqStart/freqEnd remappt FFT-Bins (Height); colorMode custom/random per-Bar-Color via Instanced Attribute. **Eigener FreqBeatDetector** (barsBeatDetector) → `setSensitivity(beatSensitivity) + update(rawFreqData, beatFreqStart, beatFreqEnd)` für `barH += beat * 25 * scale` Boost. |
| `CenterLogo` | `settings.logo.*` | Immer circle; canvas-Circular-Mask; **Outer Glow ShaderMaterial** (OUTER_GLOW_FRAG, z=-0.1, renderOrder=5, alpha peaks just outside logo edge, falls off outward). **Inner Glow ShaderMaterial** (INNER_GLOW_FRAG, z=+0.05, renderOrder=8, AdditiveBlending, soft falloff from logo edge inward to center). Plane ist **1.03× logo radius** (`CircleGeometry(0.5 * 1.03, 64)`) + sanfter `edgeFade = 1.0 - smoothstep(0.97, 1.0)` → Logo-Edge sitzt bei `ig_dist ≈ 0.97` mit voller Alpha, keine sichtbare Gap (Session 18). Shared `computeGlowColor()` helper für beide Glow-Arten. **Glow Color-Modi**: solid / rainbow / custom / random (modul-level helper `computeGlowColor`). **Fire-Ring** = RingGeometry (innerR=0.5, outerR=0.5+fireHeight) + fBm-Noise-ShaderMaterial. Scale = `logoSize * beatScale`. z=0.1, renderOrder=7. **2× FreqBeatDetector** (logoBeatDetector + fireBeatDetector). v12: glow → outerGlow + new innerGlow fields. |
| `GPUParticles` | `settings.particles.*` | Custom Shader mit uShape (circle/star/diamond), LineSegments für connectionLines (O(n2), cap 200), orbitMode elliptical/scatter. **1× FreqBeatDetector** (particleBeatDetector) → setSensitivity(reactiveSensitivity) + update(rawFreqData, reactiveFreqStart, reactiveFreqEnd). |
| `Strands` | `settings.background.strands*` | **Standalone ogl-WebGL2-Canvas**, nicht in R3F. Eigener rAF-Loop, eigener ResizeListener. **1× FreqBeatDetector** → `setSensitivity(beatSensitivity) + update(rawFreqData, beatFreqStart, beatFreqEnd)`. Beat boostet uAmplitude +40% und uGlow +30%. GLSL: alle lokalen Vars mit `str_` Prefix (ANGLE-Windows-Sicherheit, §6). |

### 4.10 Z-Layering (von hinten nach vorne)

```
-10  BackgroundPlane   (alle BG-Effekte im Shader)
-9.5 BackgroundFx (Particles+Rain+Snow) renderOrder=1
 -8  NebulaPlane
 -5  InstancedBars (renderOrder=3)
-3.1 GPUParticles LineSegments (renderOrder=3)
 -3  GPUParticles Points (renderOrder=4)
  0  CenterLogo mesh (renderOrder=6)
 0.05 Inner-Glow Plane ShaderMaterial (renderOrder=8)         ← additiv, vor dem Logo, hinter Fire
 0.1  Fire-Ring RingGeometry ShaderMaterial (renderOrder=7)   ← zeichnet über Logo
      PostFX = stub, kein EffectComposer
      Outer-Glow Plane (renderOrder=5) sitzt hinter dem Logo, eigene z=-0.1 in useFrame
```

**HTML-Overlay-Layer** (DOM-Order entscheidet z-index, kein R3F-z-Wert):
```
1. VisualizerStage Backdrop (CSS-Hintergrund)
2. <AudioScene/> R3F Canvas  (opak — gl: { alpha: false }, daher keine Transparenz)
3. <Strands/>  (immer NACH R3F gemounted — siehe §17.5)
4. TransportBar, ExportOverlay, etc. (HTML-Overlays)
```

**Wichtig:** `strandsBehindLogo` nutzt eine SVG-Maske um einen kreisförmigen Bereich in der Logo-Position aus dem Strands-Overlay auszuschneiden. Das simuliert eine echte Z-Layer-Trennung zwischen Logo (oben) und Background (unten):
- `strandsBehindLogo=true` (default): Strands voll sichtbar im Hintergrund-Bild, kreisförmiger Ausschnitt in der Mitte wo das Logo sitzt → visuell wie „hinter dem Logo aber vor dem Background"
- `strandsBehindLogo=false`: keine Maske → Strands liegen über allem

Die SVG-Maske wird einmal beim Mount berechnet basierend auf `settings.logo.size` und der aktuellen Viewport-Größe (kein Live-Resize-Listener — wenn der User das Browser-Fenster resized, muss die Seite neu geladen werden für korrekte Mask-Größe).
**Hinweis:** Strands ist ein eigenständiger ogl-Renderer außerhalb des R3F-SceneGraphs. Die z-Position wird über DOM-Order in `VisualizerStage.tsx` gesteuert, nicht über Three.js-Z-Werte.

### 4.11 FreqBeatDetector-Inventar (welche Komponente hat eigene Instanz)

| Instanz | Datei | Settings-Quelle | update() Argumente |
|---|---|---|---|
| global | `useAudioReactive.ts` (module-level) + `exportEngine.ts` (eigene Instanz) | `settings.audio.globalBeatFreq*` + `globalBeatSensitivity` | `rawFreqData`, `globalBeatFreqStart`, `globalBeatFreqEnd` |
| background | `BackgroundPlane.tsx` (`beatDetector`) | `settings.background.beatFxFreq*` + `beatFxSensitivity` | `rawFreqData`, `beatFxFreqStart`, `beatFxFreqEnd` |
| bg-particles | `BackgroundFx.tsx` (`bgParticlesBeatDetector`) | `settings.background.bgParticlesBeatFreq*` + `bgParticlesBeatSensitivity` | `rawFreqData`, `bgParticlesBeatFreqStart`, `bgParticlesBeatFreqEnd` |
| rain | `BackgroundFx.tsx` (`rainBeatDetector`) | `settings.background.rainBeatFreq*` + `rainBeatSensitivity` | `rawFreqData`, `rainBeatFreqStart`, `rainBeatFreqEnd` |
| snow | `BackgroundFx.tsx` (`snowBeatDetector`) | `settings.background.snowBeatFreq*` + `snowBeatSensitivity` | `rawFreqData`, `snowBeatFreqStart`, `snowBeatFreqEnd` |
| logo | `CenterLogo.tsx` (`logoBeatDetector`) | `settings.logo.beatFxFreq*` + `beatFxSensitivity` | `rawFreqData`, `beatFxFreqStart`, `beatFxFreqEnd` |
| fire | `CenterLogo.tsx` (`fireBeatDetector`) | `settings.logo.fireFreq*` + `fireSensitivity` | `rawFreqData`, `fireFreqStart`, `fireFreqEnd` |
| particles | `GPUParticles.tsx` (`particleBeatDetector`) | `settings.particles.reactiveFreq*` + `reactiveSensitivity` | `rawFreqData`, `reactiveFreqStart`, `reactiveFreqEnd` |
| bars | `InstancedBars.tsx` (`barsBeatDetector`) | `settings.bars.beatFreq*` + `beatSensitivity` | `rawFreqData`, `beatFreqStart`, `beatFreqEnd` |
| nebula-pulse | `NebulaPlane.tsx` (`nebulaBeatDetector`) | `settings.background.nebulaBeatFreq*` + `nebulaBeatSensitivity` | `rawFreqData`, `nebulaBeatFreqStart`, `nebulaBeatFreqEnd` |
| strands | `Strands.tsx` (`strandsBeatDetector`) | `settings.background.strandsBeatFreq*` + `strandsBeatSensitivity` | `rawFreqData`, `strandsBeatFreqStart`, `strandsBeatFreqEnd` |

**11 Instanzen gesamt** (1 global + 9 komponenten-spezifisch + 1 strands-ogl). Alle nutzen `setSensitivity()` VOR `update()` im useFrame.

**Detektor-Konstruktion:** Alle Component-Instanzen: `new FreqBeatDetector(48000)` mit hartcodiertem 48 kHz sampleRate. Constructor-Param `sampleRate` ist Pflicht (default 48000), weil die Hz→bin-Map sonst bei 44.1 kHz vs. 48 kHz Contexts driften würde. Tatsächliche Sample-Rate im Live-Stream hängt vom `AudioContext` ab (Browser-Default, meist 48 kHz); im Export ist es hartcodiert 48 kHz (`new AudioContext({ sampleRate: 48000 })` in `exportEngine.ts:88`).

**Detektor-Reset (Session 9):** `FreqBeatDetector.reset()` Methode löscht `prevBins`, `fluxHistory`, `phase`, `lastEnergy`. Jede Component registriert ihre Instanz via `useBeatDetectorRegistration(detector)` in `sceneRegistry.beatDetectors` Set. `exportEngine.ts` ruft `for (const d of sceneRegistry.beatDetectors) d.reset()` einmalig vor Frame 0, damit die ersten ~40 Frames des Exports nicht gegen den Live-Stream-trainierten Detector-State vergleichen. Siehe `bug.md` H3 für Details, warum das nötig ist. (bug.md gelöscht in Session 12 Cleanup, Inhalt in §6.1.)

---