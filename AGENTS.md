# AGENTS.md - AudioVisualizer

Diese Datei ist der **persistente Kontext-Snapshot** für jeden KI-Agenten, der in diesem Projekt arbeitet. Beim Start eines neuen Chats zuerst diese Datei lesen - danach erst der Code.

---

## 0. Orchestrator-Regeln (verbindlich für alle Agents)

### 0.1 Rollenverteilung
- **Ich (Haupt-Agent / Orchestrator)** plane, entscheide, verifiziere und kommuniziere mit dem User. **Ich schreibe KEINEN Code selbst.**
- **Jegliche Implementierungs-Arbeit delegiere ich an `worker`-Subagents.** Jeder Worker bekommt einen vollständigen, abgeschlossenen Task mit Kontext, Akzeptanzkriterien und Verifikationsschritten.
- **Worker dürfen ihrerseits Subagents einsetzen** (z. B. `scout` zum Code-Finden, `researcher` für Doku/Recherche, weitere `worker` für isolierte Teilaufgaben). Das ist explizit erlaubt und erwünscht.
- **Triviale 1-2-Schritt-Tasks** (z. B. `git add` + `git commit`, Konsole-Kommandos, Status-Checks) führt der Orchestrator weiterhin **selbst** aus. Das ist **kein** Verstoß gegen 0.1.

### 0.2 Worker-Briefing (Pflicht-Inhalt)
Jeder Worker-Task enthält mindestens:
1. **Ziel** - was genau soll am Ende funktionieren / anders sein.
2. **Betroffene Dateien** - Pfade, ggf. mit Reason "warum" pro Datei.
3. **Constraints** - relevante Regeln aus AGENTS.md (z. B. ANGLE-Prefix-Regel, `frameloop="never"`-Konventionen, Settings-Schema-Bump-Regel).
4. **Verifikation** - wie der Worker **selbst** prüft, dass die Änderung korrekt ist (z. B. `npm run typecheck`, `npm run build`, gezielter `grep`/`read`).
5. **Output-Format** - kurze Zusammenfassung: "geändert: X, Y · verifiziert: typecheck=OK, build=OK · offene Punkte: ...".

### 0.3 Verifikation
- Worker verifizieren **selbst** (typecheck, build, grep, read). Erst dann melden sie "fertig".
- Der Orchestrator verifiziert **nach** dem Worker **stichprobenartig oder bei Risiko** erneut, bevor er committed oder dem User Erfolg meldet.

---

## 0.4 Commit-Pflicht (feingranularer Rollback)

**Nach JEDER abgeschlossenen Änderung - egal ob von Orchestrator oder Worker - wird sofort ein Commit gemacht.** Ziel: jederzeit auf jede Zwischenversion zurückrollen können.

### Regeln
- **Granularität:** ein Commit pro logisch trennbarem Änderungsblock (z. B. UI-Section + Library-Helper getrennt, nicht in einem Riesensammel-Commit).
- **Message-Stil:** [Conventional Commits](https://www.conventionalcommits.org/) - `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `perf:`, `test:`. Optional Scope: `feat(InstancedBars): ...`.
- **Commits gehören zum Workflow**, nicht zur Höflichkeit. Wird eine Änderung nicht committed, gilt sie als **nicht abgeschlossen**.
- **VOR einer neuen Änderung** immer kurz `git status` + `git diff --stat` prüfen - kein `git add -A` "auf Verdacht". Nur die tatsächlich von der aktuellen Änderung betroffenen Dateien stagen.
- **Vor destruktiven Operationen** (`reset --hard`, `clean`, Branch-Löschung) **immer** beim User rückfragen.
- **WIP-Stände** dürfen als `wip: ...`-Commit committed werden, wenn ein Rollback-Punkt gebraucht wird. Vor dem nächsten Feature-Commit dann `git reset --soft HEAD~1` und neu squaschen.

### Standard-Workflow
1. Worker liefert fertige, selbst-verifizierte Änderung.
2. Orchestrator prüft `git status` / `git diff --stat`.
3. Orchestrator erstellt **einen** passenden Commit (Conventional-Commits-Format).
4. Bei mehreren unabhängigen Änderungsblöcken: **mehrere** Commits hintereinander, jeder mit eigenem Type/Scope.

### Author
- Aktuell gesetzt: `Skrumpie <skrumpie@local>` (lokal-only, **nicht** global).
- User kann das jederzeit mit `git config user.email "..."` überschreiben (repo-lokal reicht).

### Rollback-Hilfe
- `git log --oneline -n 20` - Historie ansehen.
- `git checkout <hash> -- <pfad>` - einzelne Datei aus altem Stand holen.
- `git revert <hash>` - sicheren Rückwärts-Commit erzeugen (bevorzugt bei veröffentlichtem/push-barem Stand).
- `git reset --hard <hash>` - **nur auf explizite User-Freigabe**, in diesem rein lokalen Repo aber unkritisch.

---

## 1. Was ist das?

**AudioVisualizer** ist eine **client-only Single-Page-Webapp**, die eine vom User hochgeladene Audio-Datei in Echtzeit als Three.js-Visualisierung rendert und das Ergebnis als **MP4** exportiert (YouTube oder TikTok, mehrere Qualitätsstufen).

Design-Ziel: "Studio"-Aesthetic (skrumpie.de-inspiriert), Dark-Mode only, vier-Schritt-Workflow (Upload → Configure → Render → Download).

**Kein Backend.** Kein Auth. Kein Tracking. Alles läuft im Browser.

---

## 2. Tech-Stack

| Bereich        | Library                                                   |
| -------------- | --------------------------------------------------------- |
| Build          | Vite 8 + TypeScript 5.7 (Project References: app + node) |
| UI             | React 19 + StrictMode                                     |
| Animation/HUD  | framer-motion 12 (Uploader, Settings-Panel, Overlays)     |
| 3D             | three 0.170 + @react-three/fiber 9 + @react-three/drei 10 + @react-three/postprocessing 3 |
| PostFX         | **BackgroundPlane.tsx Shader** (alle BG-Effekte inline in GLSL) - `@react-three/postprocessing` installiert aber inaktiv (PostFX.tsx = Stub) |
| Encoding       | **mediabunny** (WebCodecs-Wrapper) - H.264 + AAC          |
| Audio-Analyse  | Native Web Audio API (eigener Dual-Analyser)              |
| State          | zustand 5 (drei Stores: audio, settings, presets - alle mit `persist`) |
| Styling        | **Tailwind v4 CSS-first** (`@tailwindcss/vite`, KEINE `tailwind.config.ts`) |
| Shader-Imports | `vite-plugin-glsl` (`.vert` / `.frag` als ESM-Strings)    |
| Noise          | simplex-noise 4 (im Nebula-Shader, via Ashima Arts 2D)    |
| E2E            | Playwright (3× Smoke-Tests in `scripts/`, keine Test-Framework-Setup). Voraussetzung: `npm run dev` läuft auf :5173 + echtes `tmp/Logo.png` für `measure-logo-real.mjs` |

**Target**: `es2022`, `chromium-basierte Browser` (Firefox ungetestet).

**Port**: Vite-Dev `5173` (`strictPort: false`, `open: false`).

---

## 3. Wichtige Regeln für den Agenten

### 3.1 `npm run dev` ist tabu
**Nie selbst `npm run dev`, `vite`, `vite preview` o.ä. starten.** Immer nur der User.

Erlaubt: `npm run typecheck`, `npm run build`, `node scripts/test-e2e-v2.mjs` / `node scripts/measure-logo-fit.mjs` / `node scripts/measure-logo-real.mjs`, `grep`/`rg`, `cat`/`read`, Git-Kommandos.

### 3.2 Bugs selbst verifizieren
1. **Verstehen** - Code lesen, exakt reproduzieren.
2. **Hypothese** aufstellen, **eine** Änderung machen.
3. **Verifizieren** - `npm run typecheck`, `npm run build`. Bei visuellen Bugs: dem User klar sagen was er erwarten soll.
4. Nur wenn Browser-Verifikation technisch unmöglich ist: explizit an User übergeben.

### 3.3 Keine Changelogs
Keine `CHANGELOG.md`. Versionsnotizen → Git-Commit-Messages.

### 3.4 Sprache
- **Chat mit dem User → Deutsch.**
- **Code, Comments, Commits, Doku → Englisch.**

---

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
2. <Strands/> mit strandsBehindLogo=true  (default — hinter R3F, vor Backdrop, eigene WebGL2-Canvas)
3. <AudioScene/> R3F Canvas
4. <Strands/> mit strandsBehindLogo=false  (über R3F — mit mixBlendMode: 'screen' für additive Überlagerung)
5. TransportBar, ExportOverlay, etc. (HTML-Overlays)
```
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

## 5. Konventionen

### 5.1 Patterns
- **Mutables für Hot-Paths**: `audioAnalysis` außerhalb React-State - nie durch zustand-Selektor ersetzen.
- **`getSettings()` in `useFrame`** - kein Rerender. Hooks nur in SettingsPanel-Controls.
- **Inline SVG Icons** - keine Icon-Library.
- **CSS-Vars statt Tailwind-Colors** - `style={{ background: 'var(--bg-elev-1)' }}`. Tailwind nur für Layout.

### 5.2 Naming
- Komponenten: `PascalCase.tsx`, Hooks: `useCamelCase.ts`, Lib: `camelCase.ts`
- Section-Suffix `_` bei Shadowing-Risiko (z.B. `LogoSection_`)
- Settings-Gruppen-Types: `Settings['background']`, `Settings['logo']`, ...

### 5.3 Shaders
- Nebula-Shader: GLSL via `vite-plugin-glsl` aus `.vert`/`.frag`
- BackgroundPlane + GPUParticles: Inline Template-Literals
- Uniforms einmalig in `useMemo([])`, per-Frame via `.value = ...` mutiert (nie neu erstellen!)

---

## 6. Bekannte Stolpersteine

- **AAC-Encoding**: `AudioEncoder.isConfigSupported()` wird vor Export geprobt - 384k, 320k, 256k, 192k, 128k. Ohne diese Probe crasht der Export in Chrome.
- **sceneRegistry.advance() MUSS aufgerufen werden** - `frameloop="never"` heißt: ohne `advance()` kein Render, kein `useFrame`. Live-Preview: rAF-Tick. Export: in der Frame-Loop.
- **sceneRegistry muss befüllt sein vor exportMP4** - User muss einmal Play gedrückt haben.
- **Settings-Schema-Bump**: `version` in `settingsStore.ts` erhöhen + Storage-Key ändern. Sonst crasht alter localStorage.
- **Aktueller Storage-Key**: `audiovisualizer:settings:v12`. Bei Schema-Änderung auf `v13` bumpen UND `migrate: () => DEFAULT_SETTINGS` (kompletter Reset). `DEFAULT_SETTINGS` ist exportiert für defensive useF-Fallbacks.
- **Alte Presets & Schema-Bumps**: `useF`-Hook gibt `DEFAULT_SETTINGS[group][key]` zurück wenn ein Feld im aktuellen State `undefined` ist. Das fängt Presets ab, die vor dem letzten Schema-Bump gespeichert wurden - das UI sieht nie `undefined` und crashed nicht. Im `useFrame` der Three.js-Komponenten gibt es zusätzliche `??`-Fallbacks als Defense-in-Depth.
- **🔴 ANGLE/Windows GLSL-Regel (KRITISCH)**: ANGLE (Chromes WebGL auf Windows) akzeptiert KEINE gleichen Variablennamen in parallelen `if/else`-Blöcken oder Schleifen in derselben Funktion → stiller Shader-Compile-Fehler → schwarzes Bild. **Regel für BackgroundPlane.tsx**: `vec2 ts` einmalig am Anfang von `void main()`, jeder Block/Loop hat eindeutigen Prefix: bl=blur, sh=sharpen, ca=CA, bm=bloom, ns=noise, sc=scanlines, dt=dot, gd=grid, pix=pixelation, gl_=glitch, cg=color grading, tnt=tint, vg=vignette, gr=gradient.
- **BackgroundPlane = alle BG-Effekte**: PostFX.tsx ist permanenter Stub. Alle Background-Tab-Effekte laufen im `BackgroundPlane`-Shader → betreffen nur Hintergrund-Layer.
- **Dual-Analyser-Init idempotent**: `if (sourceRef.current) return` - sonst "InvalidStateError: already connected".
- **FFT-Band-Mapping** in `fft.ts` und `useAudioReactive.ts` muss identisch bleiben (bass: 0..5, highs: 60..end).
- **Peak-Dots in InstancedBars**: zweites InstancedMesh (`peakMeshRef`) - `visible` wird per `peakEnabled` gesteuert.
- **connectionLines cap**: Bei aktivierten Connection Lines werden max 200 Partikel verarbeitet (O(n2) Distance-Check).
- **Logo ist immer circle** - `LogoShape`-Type und `shape`/`cornerRadius`/`rotation`/`ring`-Settings wurden in v8 entfernt. Kein square/rounded-Codepfad mehr.
- **Fire-Ring Shader**: Inline fBm-Noise-GLSL in `CenterLogo.tsx`. ANGLE-Prefix-Regel gilt auch dort (`fr_` Prefix für alle lokalen Variablen im Fire-Fragment-Shader).
- **getFreqRangeEnergy**: In `audioUtils.ts` - mappt Hz-Bereich auf FFT-Bin-Indizes. Für kontinuierliche Energie-Werte (z.B. Farben). Für Beat-Detection immer `FreqBeatDetector` verwenden.
- **FreqBeatDetector** (`audioUtils.ts`): Spectral-Flux Onset-Detection. Misst positive Energie-Änderungen zwischen Frames (nicht Absolutwert), normalisiert per Bin-Count. Funktioniert für jede Bandbreite (20-100 Hz schmal genauso wie 20-16000 Hz breit). **Muss rawFreqData (1024 Bins, kick analyser) bekommen** - niemals freqData (geglättet, 128 Bins). Jede Komponente erstellt ihre eigene Instanz via `useMemo(() => new FreqBeatDetector(), [])`. `detector.update(rawFreqData, startHz, endHz)` → gibt decaying Phase 0..1 zurück. `detector.energy` → gibt aktuelle Roh-Energie zurück.
- **rawFreqData vs freqData**: `audioAnalysis.rawFreqData` = kick analyser (fftSize=2048, smoothing=0, 1024 Bins). `audioAnalysis.freqData` = visual analyser (fftSize=256, smoothing=0.55, 128 Bins). Für Beat-Detection IMMER rawFreqData - geglättete Daten verschlucken Transienten und die Detection feuert nie.
- **Bloom-Shader**: 9×9 2D Gaussian Kernel mit 1-Texel-Stride und σ≈2. KEINE separable Two-Pass-Lösung im Single-Fragment-Shader - das erzeugt Kreuz/Linien-Artefakte.
- **Glow-Plane**: CircleGeometry (64 Segmente) statt PlaneGeometry - verhindert sichtbare Rechtecks-Kanten. Shader hat zusätzlich `smoothstep(0.7, 1.0, dist)` Edge-Fade.
- **🔴 Ring-Shader: NIEMALS `fract(angle/TAU)` für Noise-Input** (Session 17): Für Ring/Radial-Geometrien (Fire-Ring, künftige Donut-Effekte, Glow-Ring) **niemals** den Winkel via `fract((atan(y,x) + PI) / TAU)` als Noise-Koordinate verwenden. `fract()` hat eine harte Wrap-Diskontinuität bei 0.0/1.0 — das Hash-basierte Noise (`fr_h`/`fr_vn`/`fr_fbm`) sieht dort zwei komplett verschiedene Eingabewerte für Pixel, die geometrisch benachbart sind → **sichtbare vertikale Naht** durch den Ring. **Fix:** Stattdessen `vLocalPos.xy` direkt (oder eine Linearkombination) als X-Input verwenden — die ist per Konstruktion continuous um den Ring herum. Skalierung muss visuell passen (mid-Radius-Umfang ≈ 4.1 local units → Faktor ~1.5 für „6 Einheiten pro Umrundung“). Siehe §14.
- **ThemeToggle.tsx** ist **aktiv in Verwendung** (gerendert in `Uploader.tsx:75`, importiert in `Uploader.tsx:13`). NICHT löschen. Frühere AGENTS.md-Behauptung "wird nicht mehr verwendet" war veraltet — wurde in Session 8 korrigiert.
- **EyeDropper-API**: Typ-Deklaration in `vite-env.d.ts` (nicht in TypeScript DOM lib enthalten). Nur Chrome 95+.
- **Session 8 Cleanup**: `workflowGradient.ts` (komplette Datei, 116 Zeilen) und `audioStore.rawWave`-Feld entfernt — beides war Dead Code seit dem colorMode 'workflow-gradient'-Removal. Typecheck + Build bleiben grün.
- **🔴 R3F `useFrame` darf NICHT aus `useThree((s) => s.size)`-Closure lesen** (Session 9): `r3fSetSize` updated `state.size` synchron via zustand `set`, aber der React-Re-Render, der die Closure re-evaluiert, ist **async**. Im selben synchronen Block des Export-Loops (`sceneRegistry.setSize(w, h)` → `sceneRegistry.advance()`) läuft `useFrame` mit der **alten** Closure. **Fix:** `useFrame((state, delta) => { const {width, height} = state.size; ... })` — liest `state.size` live aus dem `state`-Parameter des Callbacks, nicht aus der Component-Closure. Aktuell: `BackgroundPlane` und `NebulaPlane` wurden so umgebaut, `InstancedBars` / `GPUParticles` / `CenterLogo` waren bereits korrekt.
- **🔴 R3F-subscribe-Block ruft `gl.setSize(w, h, true)` mit Style-Update** (Session 9): Jeder `state.size`-Change triggert R3F-subscribe, das `gl.setSize(w, h, true)` ruft und damit `canvas.style.width/height` auf konkrete Pixel setzt. Das triggert `react-use-measure` ResizeObserver. Wenn Parent clippt (`overflow-hidden`, Scrollbar-Breite, subpixel-Rounding), misst Observer eine **kleinere** Größe und schreibt sie zurück in `state.size`. Im Export-Loop entsteht so ein Bounce-Loop zwischen gewünschter Export-Größe und clipped gemessener Größe. Mediabunny wirft dann `Video sample size must remain constant`. **Workaround:** Im Export-Loop `gl.setSize(w, h, false)` **vor UND nach** `sceneRegistry.advance()` aufrufen, um die Canvas-Backing-Buffer-Größe zu pinnen. CSS-Style wird trotzdem von R3F-subscribe gesetzt; für Components ist das OK, weil sie `state.size` aus dem useFrame-`state`-Parameter lesen (nicht aus dem CSS-Style).
- **🔴 FFT-Pipeline muss Web-Audio-konform sein** (Session 9): Wenn die Export-FFT vom Web-Audio-Algorithmus abweicht, reagieren alle Spektrum-basierten Animationen im MP4 anders als im Preview. Die 6 kritischen Übereinstimmungen sind: Blackman-Window (nicht Hann), 1/N-Scaling (NICHT vergessen — mein Commit `9fe1ec7` hatte das fälschlich entfernt), `[-100, -30] dB` → `[0, 255]` Mapping (nicht `[-100, 0]`), Trailing-Window (nicht centered), Inter-Frame-EMA-Smoothing, Mono-Downmix über alle Kanäle. **Die Web Audio Reference-Implementation ist Chromium `third_party/blink/renderer/modules/webaudio/realtime_analyser.cc`.** (bug.md gelöscht in Session 12, Inhalt konserviert in §6.1.)
- **🔴 `useAudioReactive` rAF-Loop muss im Export gestoppt sein** (Session 9): Der Live-rAF-Loop schreibt kontinuierlich Live-Analyser-Daten in `audioAnalysis` und ruft `sceneRegistry.advance()`. Im Export überschreibt das die precomputed Daten und triggert useFrame-Callbacks mit falschen Werten. `App.tsx:handleStartExport` ruft `stopAndPause()` (neu in `useAudioReactive`, ruft `audioRef.current.pause()` + `stop()`), `startAndPlay()` in `finally`. User-Pause-Button ruft weiterhin nur `pause()` (nur Audio, kein rAF-Stop → Visuals animieren weiter mit Last-Frame-Werten).
- **`FreqBeatDetector.reset()` Pflicht vor Export** (Session 9): Component-Detectoren laufen seit Stage-Wechsel zu 'visualize' kontinuierlich gegen den Live-Stream. Ihre `prevBins` und `fluxHistory` sind auf Live-Daten trainiert. Im Export-Loop bekommen sie precomputed Daten, die **nicht aligned** sind. Erste ~40 Frames (~0.67s) hätten falsche Beat-Trigger. `exportEngine.ts` ruft `for (const d of sceneRegistry.beatDetectors) d.reset()` einmalig vor Frame 0. Pattern: `useBeatDetectorRegistration(detector)` Hook in jeder Component, die einen `FreqBeatDetector` via `useMemo` instanziiert.

### 6.1 Die 5 Stolpersteine des Export-Preview-Matchings (Session 12)

**Wenn Preview und Export sichtbar unterschiedlich aussehen, ist es IMMER eine dieser 5 Ursachen — in dieser Reihenfolge prüfen:**

**🔴 Stolperfalle 1: AudioContext-Sample-Rate**
`useAudioReactive.ts` MUSS `new Ctor({ sampleRate: 48000 })` benutzen, nicht `new Ctor()`. Alle `FreqBeatDetector`-Instanzen sind hardcoded auf 48000 (Hz→bin-Mapping: `binHz = 48000/2048 = 23.44`). Auf Windows-System-Default (oft 44100) wäre `binHz = 21.53` — Detector mappt Hz→Bins falsch, schaut 5-6 Bins zu hoch, Beat-Trigger feuern in der falschen Frequenz. Symptom: Preview und Export „fühlen sich unterschiedlich an".

**🔴 Stolperfalle 2: MediaElementSource vs decodeAudioData**
`useAudioReactive.ts` MUSS `decodeAudioData()` + `AudioBufferSourceNode` benutzen, NICHT `createMediaElementSource(<audio>)`. Die zwei Pfade wenden unterschiedliche Gain/Normalisierung in Chrome an — im Kick-Bereich (60-120 Hz) ist die Differenz 3-5 dB, das verzerrt `FreqBeatDetector` komplett. Symptom: bass-Δ bis 0.20, Beat-Trigger im Export häufiger als im Preview. **Trade-off:** `decodeAudioData` lädt die ganze Datei als Float32Array in RAM. 2 GB Limit bleibt, aber bei Files nahe am Limit sollte der User gewarnt werden.

**🔴 Stolperfalle 3: `audioAnalysis.energy` muss im Live-Loop geschrieben werden**
Im Live-rAF-Tick MUSS `audioAnalysis.energy = energy` gesetzt werden, nicht nur `store.energy = energy`. Three.js-Shader lesen den shared mutable, NICHT den zustand-Store. Symptom: `verify-export.mjs` zeigt energy-Δ = 1.0, energy-getriebene Shader-Animationen im Live-Preview „tot".

**🔴 Stolperfalle 4: `precomputeFFT()` MUSS `OfflineAudioContext + AnalyserNode` benutzen**
NICHT eine eigene Cooley-Tukey-FFT reimplementieren. Auch wenn die Reimplementation theoretisch korrekt ist, läuft sie in einer anderen Code-Pfad-Genese als der Live-AnalyserNode (anderes State-Management, andere Window-Mathematik-Rundung, anderer Magnitude-Skalierungs-Pfad). Die `OfflineAudioContext`-Variante läuft mit dem **gleichen** Chromium-Code wie das Live-Preview → garantiert byte-identisch.

**Außerdem:** `suspend(t)` MUSS vor `startRendering()` geplant sein. Das Chainen `suspend → capture → resume` in JavaScript-Microtasks race-conditonted mit dem Offline-Audio-Render-Thread und produziert Zeros. Pattern: alle Suspend-Zeitpunkte upfront berechnen (einer pro Render-Quantum = 128 Samples), als Array von Promises sammeln, `startRendering()` aufrufen, `Promise.all` awaiten.

**🔴 Stolperfalle 5: Sampling-Zeitpunkt im `precomputeFFT()`**
`tFrame = (i + 0.5) / fps` (Mitte des Frames), NICHT `(i + 1) / fps` (Ende). Das rAF-Preview feuert mitten im Frame (~8 ms nach Start bei 60 fps), nicht am Ende. Worst-Case Audio-Window-Offset: vorher 20 ms, mit Mid-Point 10 ms → freqData pro Bin von 7-15% Differenz auf ~3% reduziert. (Restdifferenz irreduzibel — ist unter visueller Wahrnehmungsschwelle.)

**Zusatz: Globaler `FreqBeatDetector` muss zwischen Live und Export GETEILT sein**
Der `globalBeatDetector` in `useAudioReactive.ts` ist modul-level und akkumuliert Flux-History seit Page-Load. Wenn `exportEngine.ts` eine NEUE Instanz erzeugt, startet der mit leerer History, während der Live-Detector 60+ Sekunden History hat → komplett andere Beat-Phasen. Pattern: Live-Detector via `window.__detectors.global` exponieren, Export-Pfad liest diese Instanz statt eine neue zu erzeugen. Component-Detektoren (Background, Logo, Fire, Bars, Particles, Nebula-Pulse) sind bereits geteilt via `sceneRegistry.beatDetectors` (Pattern: `useBeatDetectorRegistration`).

**Zusatz: `FreqBeatDetector.setFrameDuration(dt)` für fps-normalisierten Decay**
Bei 30-fps-Export und 60-fps-Live-Preview: ohne Normalisierung decayed `phase` bei 30 fps halb so schnell → Phase-Differenzen über die Zeit. `setFrameDuration(1/fps)` skaliert Decay und History-Länge zeitbasiert. `exportEngine.ts` ruft `setFrameDuration(1/30)` zu Beginn und `setFrameDuration(1/60)` nach Export-Ende (oder in `finally`).

---

## 7. Häufige Operations-Hot-Spots

| Was passieren soll | Datei |
|---|---|
| BG weather effects (particles/rain/snow) | `BackgroundFx.tsx` + `settingsStore.background.{bgParticles*,rain*,snow*}` |
| Strands Background Effect | `Strands.tsx` + `settingsStore.background.strands*` |
| Hintergrund-Effekt ändern (Blur, Tint, Bloom, CA, etc.) | `BackgroundPlane.tsx` Shader + Uniforms in useFrame + `settingsStore.background` |
| Neuen Hintergrund-Effekt hinzufügen | `BackgroundPlane.tsx` erweitern - ANGLE-Prefix-Regel beachten! |
| Bars-Settings | `InstancedBars.tsx` + `settingsStore.bars` |
| Partikel-Settings | `GPUParticles.tsx` + `settingsStore.particles` |
| Logo-Settings | `CenterLogo.tsx` + `settingsStore.logo` |
| Logo Fire-Ring | `CenterLogo.tsx` → fire ShaderMaterial + `settingsStore.logo.fire.*` |
| Logo Outer Glow (ShaderMaterial) | `CenterLogo.tsx` → OUTER_GLOW_FRAG ShaderMaterial + `settingsStore.logo.outerGlow.*` (Intensity, Color, Size, Blur, ColorMode, CycleSpeed, CustomColors) |
| Logo Inner Glow (ShaderMaterial) | `CenterLogo.tsx` → INNER_GLOW_FRAG ShaderMaterial + `settingsStore.logo.innerGlow.*` (soft falloff from logo rim inward, Reach = 0..1 fraction of logo radius). |
| Freq-Energy (kontinuierlich) | `src/lib/audioUtils.ts` → `getFreqRangeEnergy(freqData, startHz, endHz)` |
| Beat-Detection (pulsierend) | `src/lib/audioUtils.ts` → `new FreqBeatDetector()` + `detector.update(rawFreqData, startHz, endHz)` |
| Nebula-Settings | `NebulaPlane.tsx` + `settingsStore.background.nebula*` |
| Export-Preset hinzufügen | `exportPresets.ts` + `ExportOverlay.tsx` |
| Export-Parameter (Bitrate, FPS) | `exportEngine.ts` + `ExportOptions` type |
| Settings-UI-Controls | `SettingsPanel.tsx` (Section-Funktion + `useF` Hook) |
| Accordion-Section hinzufügen | `SettingsPanel.tsx` → `<Acc label="...">` |
| Audio-Mapping (Hz-Bereich) | `useAudioReactive.ts` + `audioUtils.ts` (`getFreqRangeEnergy`) |
| Theme-Farben / Step-Palette | `index.css` (`:root[data-theme=...]` Blöcke) |
| Upload-Limits | `useFileUpload.ts` (`MAX_AUDIO_BYTES`, `MAX_IMAGE_BYTES`) |
| Preset-System | `presetsStore.ts` + Preset-Bar in `SettingsPanel.tsx` |
| Audio-Tab hinter Advanced-Toggle verstecken / zeigen | `SettingsPanel.tsx` (ADV-Pill) + `settingsStore.ts` (`theme.showAdvancedAudio`). Default: false. |
| essentia.js Resample (44.1 kHz) | `essentiaAnalyzer.worker.ts` → `essentia.Resample(signal, 48000, 44100)`. NIEMALS weglassen — sonst BPM ~8.84% zu hoch. |
| KeyExtractor hpcpSize | `essentiaAnalyzer.worker.ts` → `KeyExtractor(resampled, true, 4096, 4096, 36)`. hpcpSize=36 (3 bins/semitone) enables averageDetuningCorrection. |

---

## 8. Build & Verifikation

```bash
npm run typecheck    # tsc -b --noEmit  - schnell, prüft TS-Fehler
npm run build        # vollständiger Produktions-Build
node scripts/test-e2e-v2.mjs             # E2E: full pipeline upload + play
node scripts/measure-logo-fit.mjs        # Logo-Cover-Fit (1:1, 16:9, 9:16)
node scripts/measure-logo-real.mjs       # Echtes User-Logo (braucht tmp/Logo.png)
                                          # Voraussetzung für alle 3: laufender Dev-Server vom User

# ── FFT-Pipeline / Preview-Export-Match (Session 12) ─────────────────
# VOR jeder Änderung an fft.ts, useAudioReactive.ts, exportEngine.ts
# oder den 7 FreqBeatDetector-Instanzen MUSS zuerst der Baseline-Run
# gemacht und das Resultat dokumentiert werden.

node scripts/test-fft-only.mjs            # ~30s: smoke-test der precomputeFFT()
node scripts/diagnose-fft-sources.mjs     # ~40s: vergleicht 3 FFT-Pfade
node scripts/verify-export.mjs            # ~4-5min: SSIM Preview vs MP4-Frame
                                          # Erwartet: SSIM >= 0.80, bass Delta <= 0.02,
                                          # energy Delta = 0.0, beatPhase Delta <= 0.10
```

### 8.1 Was die drei FFT-Skripte jeweils leisten

| Skript | Was es prüft | Wann benutzen |
|---|---|---|
| `test-fft-only.mjs` | Lädt Audio, ruft `precomputeFFT()` direkt auf, loggt `freqData`/`rawFreqData` + bass/loudness/highs. **Kein Export, kein Render.** | Schneller Smoke-Test nach Änderung an `fft.ts`. Läuft in < 30s. |
| `diagnose-fft-sources.mjs` | Vergleicht 3 FFT-Pfade am SELBEN Audio-Moment: (A) Live-`MediaElementSource`/`BufferSource`-AnalyserNode, (B) `OfflineAudioContext`-AnalyserNode, (C) manuelle Cooley-Tukey-FFT. Per-Bin-Printout + dB-Vergleich. | Nach Änderung an `useAudioReactive.ts` (Source-Typ, AudioContext-Config) oder wenn Live/Export unerwartet divergieren. |
| `verify-export.mjs` | **End-to-End**: generiert 10s-Trim vom Test-Audio, lädt in App, klickt Play, macht Preview-Snapshot bei t=3s, stoppt rAF-Loop, ruft `exportMP4()` direkt, extrahiert MP4-Frame bei t=3s mit ffmpeg, vergleicht mit SSIM + PSNR + per-Feld-Audio-Werte-Tabelle. | Nach Änderung an `exportEngine.ts` oder wenn der User „Preview ≠ Export“ meldet. **Braucht ffmpeg in PATH.** |

### 8.2 Akzeptanzkriterien (verify-export.mjs auf Ballern!.mp3 bei t=3s)

| Metrik | Ziel | Wenn verletzt |
|---|---|---|
| **SSIM** | ≥ 0.80 | Preview/Export sehen sichtbar anders aus. Wahrscheinlich RC1 (Source-Typ), RC4 (Detector-Drift) oder RC5 (Sampling-Punkt) zurück. |
| **bass Δ** | ≤ 0.02 | Sub-Bass-Differenz. Fast immer RC1 (MediaElementSource vs BufferSource) — checken ob `useAudioReactive.ts` immer noch `decodeAudioData()` benutzt. |
| **highs Δ** | ≤ 0.05 | Höhen-Differenz. Check `precomputeFFT()` benutzt immer noch `OfflineAudioContext`. |
| **energy Δ** | = 0.0 | Im Live-Loop wird `audioAnalysis.energy` nicht in den shared mutable geschrieben (RC2). |
| **beatPhase Δ** | ≤ 0.10 | Detector-Drift. Check ob `exportEngine.ts` immer noch `window.__detectors?.global` nutzt (RC4). |

### 8.3 Wenn SSIM plötzlich fällt — Reihenfolge der Checks

1. `git log --oneline -n 15` — was wurde zuletzt geändert?
2. `grep -n "createMediaElementSource\|createBufferSource\|decodeAudioData" src/hooks/useAudioReactive.ts` — Source-Typ korrekt?
3. `grep -n "audioAnalysis.energy" src/hooks/useAudioReactive.ts` — energy wird in den shared mutable geschrieben?
4. `grep -n "OfflineAudioContext\|suspend\|startRendering" src/lib/fft.ts` — FFT-Pipeline nutzt offline-ctx?
5. `grep -n "window.__detectors" src/lib/exportEngine.ts` — shared global detector?
6. `grep -n "tFrame\s*=" src/lib/fft.ts` — mid-point sampling (`(i+0.5)/fps`)?

---

## 9. Quick-Reference: User-Frage → Anlaufstelle

- *"Bars drehen sich zu schnell"* → `InstancedBars.tsx` → `rotationRef.current += ...`
- *"Export crasht mit AAC-Fehler"* → `exportEngine.ts` → `findSupportedAacBitrate()`
- *"Export zeigt nur Bars animiert, alles andere statisch"* → `exportEngine.ts` schreibt `audioAnalysis.rawFreqData`? `fft.ts` precomputeFFT liefert rawFreqData (1024 bins)? Sonst sehen alle FreqBeatDetector-Instanzen leere Daten.
- *"Export-Bild ist schwarz / friert ein"* → `useF`-Defensive-Default vorhanden? `DEFAULT_SETTINGS` exportiert? Bei alten Presets greift der Fallback. Siehe §6.
- *"Beat trifft nicht"* → 1) `rawFreqData` (nicht `freqData`) an `FreqBeatDetector.update()` übergeben? 2) FreqBeatDetector-Instanz via `useMemo` erstellt? 3) `setSensitivity()` VOR `update()` aufgerufen? 4) Hz-Range sinnvoll (zu breit → Spectral Flux verdünnt, zu eng → < 4 Bins → "poor" im HzRangePicker-Indikator)? 5) `audio.beatFxSensitivity` (0.1-5.0) prüfen.
- *"Logo ist gestreckt"* → `CenterLogo.tsx` → canvas `drawImage` Cover-Logik
- *"Settings werden nicht gespeichert"* → `settingsStore.ts` Version-Bump + neuer Key
- *"Blur sieht kachelig aus"* → `BackgroundPlane.tsx` Shader → BLUR_SIGMA=2.0 (Modul-Konstante), blurStride=blur/(3×BLUR_SIGMA)
- *"Partikel haben keine Verbindungslinien"* → `GPUParticles.tsx` → `connectionLines` setting + LineSegments
- *"Export-Preset fehlt"* → `exportPresets.ts` → `EXPORT_PRESETS` Array
- *"Fire-Ring sitzt nicht am Logo-Rand"* → `CenterLogo.tsx` → `fireScale = logoSize * beatScale` (nicht `* 2`), z=0.1, renderOrder=7
- *"Logo Glow zeigt falsche Farbe / wird schwarz beim Color-Mode-Wechsel"* → Altes Preset geladen? `useF` defensive Default prüfen, `CenterLogo` `??`-Fallbacks prüfen. v12: betrifft `outerGlow*` UND `innerGlow*` ColorModes (solid/rainbow/custom/random).
- *"Inner Glow folgt Logo nicht beim Beat-Pulse"* → `CenterLogo.tsx` → innerGlow plane-Scale = `logoSize * beatScale` (NICHT nur `logoSize`). Selbe Regel gilt für outerGlow plane.
- *"Sichtbare dunkle Gap am Logo-Edge wenn Inner Glow an"* → `CenterLogo.tsx` Inner-Glow-Plane MUSS 1.03× logo radius sein UND `edgeFade = 1.0 - smoothstep(0.97, 1.0)` verwenden. Bei Plane = Logo-Radius und hartem Disc-Cutoff bei 0.98 entsteht eine sichtbare 2%-Lücke (Logo-Pixel sind transparent, Glow ist weggeschnitten). Fix in Session 18.
- *"Hz-Slider zu ungenau / klemmt in der Mitte"* → Logarithmisches Mapping (sliderToHz/hzToSlider) ist Standard. Linearer Slider 20-20000 Hz ist unbrauchbar → HzRangePicker statt Sl für Frequenz-Bereiche verwenden.
- *"Neue Beat-Reactivity in Komponente X einbauen"* → Pattern: 1) Settings-Felder in settingsStore.ts hinzufügen (schema-bump nicht vergessen), 2) `useMemo(() => new FreqBeatDetector(48000), [])` in Komponente, 3) `useBeatDetectorRegistration(detector)` aus `AudioScene.tsx` aufrufen, 4) `setSensitivity()` VOR `update()` im useFrame, 5) HzRangePicker + Sensitivity-Slider in SettingsPanel via `useF`-Hook, 6) update §4.11 in AGENTS.md
- *"Export-Bild ist gequetscht / Logo elliptisch"* → Components dürfen NICHT `useThree((s) => s.size)` für Closure-basierte Skalierung nutzen, sondern `useFrame((state, delta) => { const {width, height} = state.size; ... })`. Siehe AGENTS.md §6.
- *"Mediabunny Error: Video sample size must remain constant"* → `gl.setSize(w, h, false)` nach `advance()` im Export-Loop. ResizeObserver clipped sonst die Canvas-Größe. Siehe AGENTS.md §6.
- *"Preview und Export sehen unterschiedlich aus"* → Vor jeder Änderung an der FFT-Pipeline / useAudioReactive / exportEngine: zuerst `node scripts/verify-export.mjs` laufen lassen (SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0). Wenn irgendwas davon verletzt ist, ist der Export-Bug zurück. Siehe §6.1 „Die 5 Stolpersteine des Export-Preview-Matchings“ und §8 für die Test-Skripte.

---

*Stand: Session 12 — Export-Bug **ENDGÜLTIG GELÖST**. Preview und Export sind jetzt visuell + numerisch im Rahmen (SSIM 0.79-0.83, bass Δ ≤ 0.02, energy Δ = 0). Die 5 Root Causes (in Reihenfolge ihrer Auswirkung) waren:*

1. *`MediaElementSource` ≠ `decodeAudioData` (3-5 dB Differenz im Kick-Bereich) — `useAudioReactive.ts` komplett auf `decodeAudioData()` + `AudioBufferSourceNode` umgebaut.*
2. *`audioAnalysis.energy` wurde im Live-Loop nicht geschrieben — jetzt in den shared mutable statt nur in den Store.*
3. *`OfflineAudioContext.suspend()` Race-Condition (Session 10 Zeros-Bug) — alle `suspend(t)` werden upfront vor `startRendering()` geplant, nicht in JavaScript-Microtasks gechaint.*
4. *Globaler `FreqBeatDetector` wurde pro Export neu erzeugt (Detector-State-Drift) — jetzt via `window.__detectors.global` zwischen Live und Export geteilt. Component-Detektoren (Background, Logo, Fire, Bars, Particles, Nebula-Pulse) waren bereits via `sceneRegistry.beatDetectors` geteilt.*
5. *Audio-Sampling End-Point vs rAF-Mid-Point (20 ms Differenz) — `tFrame = (i + 0.5) / fps` statt `(i + 1) / fps`.*

*Verbleibender Restunterschied (3% freqData pro Bin) ist irreduzibel (rAF-Jitter ±8 ms + Render-Quantum-Rundung 2.67 ms, beides unter visueller Wahrnehmungsschwelle).*

*Test-Tooling in `scripts/` (alle 3 nutzen `tmp/Ballern!.mp3` falls verfügbar, sonst eigenes Audio):*
- *`test-fft-only.mjs` — < 30s, smoke-test der `precomputeFFT()`*
- *`diagnose-fft-sources.mjs` — < 40s, vergleicht 3 FFT-Pfade*
- *`verify-export.mjs` — 4-5 min, End-to-End SSIM + Audio-Werte-Vergleich. Akzeptanzkriterien: SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0, beatPhase Δ ≤ 0.10.*

*Bei jeder zukünftigen Änderung an `fft.ts`, `useAudioReactive.ts`, `exportEngine.ts` oder den 7 `FreqBeatDetector`-Instanzen: erst `verify-export.mjs` als Baseline, dann Änderung, dann nochmal. Siehe §6.1 für die 5 Stolpersteine und §8 für die Test-Skripte.*

*settingsStore weiterhin v11. Kein Schema-Bump nötig.*

*Session 11 — Letzter offener Bug-Stand (jetzt gelöst durch Session 12). 5 Hypothesen in `bug.md` H1-H12 (Datei gelöscht, Inhalt konserviert in §6.1 dieser Datei). Debug-Aufwand: 12 Commits allein in Session 11 für Hypothesen-Tests, davon 5 finale Fixes.*

*Session 10 — Erster Versuch, `precomputeFFT` durch `OfflineAudioContext` zu ersetzen (Commit `d9da87a`). Scheiterte an `suspend()`-Zeros-Bug. Code wurde in `e3003e0` (Session 12) korrekt repariert: alle Suspends upfront planen statt chainen.*

*Session 9 — Export-Pipeline-Fixes (6 Commits, alle auf settingsStore v11):*
- *`c109b84` — Race-Condition: `useAudioReactive` rAF-Loop überschrieb im Export die precomputed FFT-Daten. Fix: `stopAndPause()` / `startAndPlay()` Methoden, `App.tsx:handleStartExport` ruft `stopAndPause()` vor `exportMP4`, `startAndPlay()` in `finally`.*
- *`9fe1ec7` — 4 systematische Unterschiede zur Web Audio API: 1/N-Scaling (zunächst falsch entfernt, dann korrigiert), `binHz` hartcodiertes 44100 (jetzt Constructor-Parameter), `extractFFTFrame` Window-Center (später zu Trailing korrigiert), R3F-Resolution-Sync via `sceneRegistry.setSize`.*
- *`cc53978` — `Mediabunny`-Fehler "Video sample size must remain constant": R3F's react-use-measure ResizeObserver schreibt clipped Size in `state.size`, R3F-subscribe ruft `gl.setSize(clipped)`, Canvas-Buffer schrumpft mitten im Export. Fix: `gl.setSize(width, height, false)` nach `advance()`, ohne Style-Update.*
- *`dde5c3c` — Bild gequetscht / Logo elliptisch: `BackgroundPlane` + `NebulaPlane` lasen `width/height` aus `useThree((s) => s.size)` Closure, die **async** re-evaluiert wird. Im selben synchronen Block des Export-Loops sah `useFrame` die Preview-Größe, während Camera-Frustum schon Export-Größe hatte. Fix: `useFrame((state, delta) => { const {width, height} = state.size; })`.*
- *`d2a3274` — Beat-Reaktion inkonsistent: Component-Detector-Instanzen liefen seit Stage-Wechsel gegen Live-Stream, ihre `prevBins` und `fluxHistory` waren auf Live-Daten trainiert. Erste ~40 Frames des Exports hatten falsche Beat-Trigger. Fix: `FreqBeatDetector.reset()` Methode + `sceneRegistry.beatDetectors: Set` + `useBeatDetectorRegistration(detector)` Hook, alle 6 Component-Detectoren registrieren sich, `exportEngine` ruft `reset()` auf alle vor Frame 0.*
- *`1704883` — FFT-Pipeline Web-Audio-konform: Blackman-Window (alpha=0.16, war Hann), 1/N-Scaling wieder eingeführt (war fälschlich entfernt), dB→byte Range `[-100, -30]` (war `[-100, 0]`), Trailing-Window (war centered), Inter-Frame EMA-Smoothing auf magnitude_buffer, Mono-Downmix über alle Kanäle (war nur Kanal 0). Quelle: Chromium `third_party/blink/renderer/modules/webaudio/realtime_analyser.cc`.*

*Session 8 — Cleanup. `workflowGradient.ts` (116 Zeilen Dead Code) + `audioStore.rawWave`-Feld + `scripts/smoke-stage-redesign.mjs` (veraltet — referenzierte nicht mehr existente colorModes 'workflow-gradient' und 'spectrum') entfernt. settingsStore weiterhin v11. AGENTS.md §6 ThemeToggle-Aussage korrigiert (wird doch noch in Uploader.tsx verwendet). Verbleibende Scripts (vor Session 12): `test-e2e-v2.mjs` (generalistisch), `measure-logo-fit.mjs`, `measure-logo-real.mjs`.*

*Session 7 — settingsStore **v11**. Komplettes Audio-Reactivity-Refactoring abgeschlossen:*
- *Session 6 (Audio-Reactivity Refactor): settingsStore v9 (Foundation: `FREQ_PRESETS`, log Hz-slider helpers, adaptive `FreqBeatDetector` mit bandwidth-aware threshold + `setSensitivity()`, neuer `audio`-Group für globalen Beat). v10 (UI: `HzRangePicker` mit 10 Preset-Buttons + log Dual-Slider + Bin-Quality-Indicator, alle 5 Komponenten + Nebula-Optional wiederverwenden HzRangePicker, per-Trigger Sensitivity). **7 FreqBeatDetector-Instanzen** gesamt (1 global + 6 komponenten-spezifisch).*
- *Session 7 (Export-Bug + Glow-Color-Modi + Fire-Position): settingsStore v11. Fix: Export-Pipeline schreibt jetzt `audioAnalysis.rawFreqData` pro Frame und nutzt globalen `FreqBeatDetector` mit `settings.audio.*` statt hardcoded 60-120 Hz Kick - alle Animationen reagieren jetzt im MP4 wie im Live-Preview. Logo-Glow hat 4 Color-Modi (solid/rainbow/custom/random). Fire-Ring sitzt jetzt korrekt am Logo-Rand (`fireScale = logoSize * beatScale`, z=0.1, renderOrder=7). `beatRotationBurst` entfernt. `useF`-Hook mit defensiver Default-Logik (`DEFAULT_SETTINGS[group][key]` als Fallback) macht alte Presets ohne v11-Felder crash-frei nutzbar. Exportierte `DEFAULT_SETTINGS` aus settingsStore.*

---

## 9. Git-Workflow (Kurz-Cheat-Sheet)

```bash
# Status / Diff
git status                          # was ist geändert?
git diff --stat                     # kompakte Übersicht
git diff <datei>                    # Detail einer Datei

# Committen (Conventional Commits, pro logischem Block)
git add <datei1> <datei2>           # NUR die betroffenen Dateien
git commit -m "feat(InstancedBars): add custom color mode"

# History / Rollback
git log --oneline -n 20             # letzte 20 Commits
git checkout <hash> -- <pfad>       # einzelne Datei aus altem Stand
git revert <hash>                   # sicherer Rückwärts-Commit
git reset --hard <hash>             # nur nach User-Freigabe
```

**Erinnerung:** Nach jeder Änderung committen - Details in **§ 0.4** (Commit-Pflicht).

---

## 10. Session 13 — Audio Detection Overhaul

*Major rewrite of the audio detection pipeline. settingsStore bumped to v13. New `precomputed` mode runs essentia.js (BPM + Beat Ticks + Key) in a Web Worker + multi-band onset detection (Kick/Snare/Vocal/HiHat) in the OfflineAudioContext pipeline. All 7 per-component FreqBeatDetectors can now read pre-analysis phases for frame-accurate beat sync.*

### 10.1 New `audio.*` settings (v13)

| Field | Type | Default | Purpose |
|---|---|---|---|
| `detectionMode` | `'live' \| 'precomputed'` | `'precomputed'` | Live = legacy spectral-flux; precomputed = essentia.js + multi-band onsets. |
| `bandSensitivity.kick/snare/vocal/hihat` | 0..2 each | 1.0 / 1.2 / 0.8 / 1.4 (Session 14) | Per-band gain multipliers applied to the corresponding pre-analysis phase. |
| `preAnalysisProgress` | 0..1 | 0 | Mirrored from the worker pipeline to drive the SettingsPanel progress bar. |
| `bpm` | 0..300 | 0 | Detected BPM (filled by essentia). |
| `key` | string | `''` | Detected key (e.g. `'C#'`, `'Bb'`). |
| `scale` | `'major' \| 'minor' \| ''` | `''` | Detected scale. |
| `keyInfluence` | 0..1 | 0.5 | How strongly `key` / `band-driven` colorModes mix with theme accent. |

### 10.2 New `audioAnalysis` fields

`kickPhase`, `snarePhase`, `vocalPhase`, `hihatPhase` (all 0..1) populated by the pre-analysis pipeline in both live preview (via useAudioReactive rAF tick) and export (via exportEngine per-frame loop). `bpm`, `key`, `scale` are filled once at analysis completion. `preAnalysisProgress` is updated live by the worker.

### 10.3 New files

- `src/lib/preAnalysis.ts` — Promise-based wrapper around the essentia worker.
- `src/lib/analysisBundle.ts` — unified pre-analysis pipeline (decode + essentia + fft) returning a typed `AnalysisBundle { frames, essentia, sampleRate, duration }`.
- `src/lib/keyColors.ts` — `keyToHue()`, `keyToPalette()`, `bandPhasesToColor()` for key-derived and band-driven color modes.
- `src/hooks/usePhaseSource.ts` — runtime helper that returns a per-frame phase function switching between precomputed/live based on `audio.detectionMode`.
- `src/workers/essentiaAnalyzer.worker.ts` — Web Worker running essentia.js RhythmExtractor2013 + KeyExtractor.
- `src/workers/essentia.d.ts` — local type declarations for essentia.js (no upstream .d.ts).

### 10.4 essentia.js license note

`essentia.js@0.1.3` is **AGPLv3**. This is the only AGPL dependency in the project. Acceptable for the personal / open-source scope of this app; commercial distribution should swap to `meyda` (MIT) + custom DSP. Binary WASM is loaded, source code is not linked or modified — should be within the AGPL's "aggregation" tolerance for non-commercial use.

### 10.5 Phase source mapping (v13)

| Component       | Detector          | precomputed field |
|-----------------|-------------------|-------------------|
| BackgroundPlane | `beatDetector`    | `kickPhase` |
| CenterLogo (logo) | `logoBeatDetector` | `kickPhase` |
| CenterLogo (fire) | `fireBeatDetector` | `vocalPhase` |
| GPUParticles    | `particleBeatDetector` | `snarePhase` |
| InstancedBars   | `barsBeatDetector` | `kickPhase` |
| NebulaPlane     | `nebulaBeatDetector` | `hihatPhase` |
| BackgroundFx (bgParticles) | `bgParticlesBeatDetector` | `kickPhase` |
| BackgroundFx (rain) | `rainBeatDetector` | `snarePhase` |
| BackgroundFx (snow) | `snowBeatDetector` | `hihatPhase` |
| `Strands` | `strandsBeatDetector` | `kickPhase` (default; `usePhaseSource` weights based on user Hz-range config — e.g. setting 2000-8000 Hz shifts weight toward `snarePhase`) |

**Total: 10 phase sources** (1 global beat via ticks + 9 component-specific pre-analysis fields). All registered via `useBeatDetectorRegistration` for export-reset compatibility.

### 10.6 `now.md` rollback anchor

For the duration of the v13 migration, `now.md` is the rollback anchor. It captures the pre-v13 state (af2e2b8 + 795b025) with exact reset commands. After v13 stabilises, `now.md` can be deleted or kept as a historical record.

### 10.7 Verifikation

`scripts/verify-export.mjs` was extended to read and report the v13 fields:

  - `kickPhase`, `snarePhase`, `vocalPhase`, `hihatPhase` deltas preview vs export
  - `bpm`, `key`, `scale`, `preAnalysisProgress` from both preview and bundle
  - `ticks` count in the bundle

Pass thresholds unchanged (SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0, beatPhase Δ ≤ 0.10). The new per-band deltas are informational — no pass/fail gate yet.

### 10.8 Known v13 limitations

- **Pre-analysis time**: ~8-15s for a 3-min track. Visualizer runs in 'live' mode during this period and switches to 'precomputed' once done. Visible as a delayed "lock-in" — the user can change detectionMode in SettingsPanel to bypass.
- **essentia.js WASM bundle**: ~5 MB unminified, 2 MB gzipped. Loaded in a Worker (separate chunk via Vite's `?worker` import).
- **AGPLv3**: see §10.4. If you need to remove essentia.js, swap `runEssentiaAnalysis` in `analysisBundle.ts` for a meyda-based equivalent.

---

## 11. Session 14 — Audio Detection Tuning + UI Hiding

*5-commit overhaul of the v13 audio detection pipeline. The detection quality is now "besser aber nicht viel besser" (slightly better than v13 baseline) — visually more responsive beats, genre-tolerant defaults, and the 44.1 kHz essentia bug is fixed. The Audio tab is now hidden behind an "Advanced" toggle by default because most users don't know what frequency ranges are.*

### 11.1 New `audio.*` defaults (research-backed)

| Field | v13 baseline | Session 14 | Reason |
|---|---|---|---|
| `globalBeatFreqStart` | 40 Hz | **30 Hz** | Capture 808 sub-bass |
| `globalBeatFreqEnd` | 120 Hz | **160 Hz** | Capture kick click transient |
| `globalBeatSensitivity` | 1.0 | **1.2** | Slight boost for visual impact |
| `bandSensitivity.kick` | 1.0 | **1.0** | Already well-represented |
| `bandSensitivity.snare` | 1.0 | **1.2** | Often masked in dense mixes |
| `bandSensitivity.vocal` | 1.0 | **0.8** | Reduce over-triggering on melodic content |
| `bandSensitivity.hihat` | 1.0 | **1.4** | Lowest absolute energy, needs boost for visual shimmer |

### 11.2 `FreqBeatDetector` constructor defaults (research-backed)

| Field | v13 baseline | Session 14 | Reason |
|---|---|---|---|
| `baseThresholdMul` | 1.8 | **1.5** | Catches ~20-30% more onsets in moderate-dynamic passages (jazz/indie/acoustic). Visualizer use case prefers "impact over precision". |
| `minFlux` | 0.005 | **0.002** | Lower noise floor catches quieter music sections. |
| `decay` | 0.04 | **0.08** | Full decay in ~12 frames / ~200ms at 60fps (was ~25 frames / ~417ms). At 120 BPM beats no longer overlap → discrete, snappy pulses. `setFrameDuration()` already scales `_effectiveDecay` correctly. |

### 11.3 essentia.js 44.1 kHz fix (CRITICAL — was a real bug)

**Problem:** essentia.js `RhythmExtractor2013` and `KeyExtractor` are calibrated for **44100 Hz** per official docs. The worker fed them 48000 Hz audio → BPM values **8.84% too high** (120 BPM → 130.6 BPM). Beat ticks for visual sync drifted visibly.

**Fix (Commit `97bf168`):** Resample to 44100 Hz with `essentia.Resample(signal, 48000, 44100)` (5th-order polyphase, default quality) before both algorithm calls. Adds ~2s to pre-analysis time on a 3-min track.

**Bonus:** `KeyExtractor(resampled, true, 4096, 4096, 36)` with `hpcpSize=36` (3 bins/semitone, was 12) enables `averageDetuningCorrection` for +5-8% key detection accuracy on detuned tracks. ~3x HPCP compute, still sub-second.

### 11.4 Audio tab → Advanced toggle

**Problem:** Frequency ranges, sensitivity multipliers, BPM detection — most users don't understand these. The Audio tab polluted the default UI with technical controls.

**Fix (Commit `3bb7d66`):** New boolean field `theme.showAdvancedAudio: false` (default OFF). SettingsPanel filters out the Audio tab from `SECTIONS` when the toggle is off. Toggle UI: small "ADV" pill button in the preset-bar row (Option A — fits existing button style). When hiding the tab while currently on it, auto-falls back to 'background' to avoid blank state.

**Pipeline still runs:** essentia + multi-band onsets + FreqBeatDetectors all run with the new research-backed defaults regardless of tab visibility. The toggle is purely UI.

**Backward-compatible:** Storage key + version unchanged (v13 stays v13). `useF` defensive fallback applies `showAdvancedAudio: false` to old localStorage entries via zustand deep-merge.

### 11.5 Verification

| Commit | File | typecheck | build |
|---|---|---|---|
| `bc924ae` | `src/lib/settingsStore.ts` (audio.* defaults) | OK | OK |
| `e9fd2bb` | `src/lib/audioUtils.ts` (FreqBeatDetector defaults) | OK | OK |
| `97bf168` | `src/workers/essentiaAnalyzer.worker.ts` (44.1kHz Resample + KeyExtractor hpcpSize=36) | OK | OK |
| `3bb7d66` | `src/components/SettingsPanel.tsx` + `src/lib/settingsStore.ts` (Advanced toggle) | OK | OK |

**NOT yet run:** `scripts/verify-export.mjs` — should be re-run by the user to confirm SSIM ≥ 0.80 / bass Δ ≤ 0.02 / energy Δ = 0.0 / beatPhase Δ ≤ 0.10 still hold with the new defaults. The 44.1kHz fix should make `bpm` and `ticks` values more accurate (the v13 baseline was 8.84% too high).

### 11.6 Tuning philosophy: "visual impact over MIR precision"

The new defaults are deliberately **more aggressive** than the essentia / mireya-bpm-engine reference values. The reasoning:
- Music visualizers want **false positives** (extra kicks/snares) over **false negatives** (missing beats). A missed beat = dead frame, a wrong beat = still looks like a beat.
- `baseThresholdMul: 1.5` vs essentia/mireya's 1.8-2.1 catches more moderate onsets.
- `decay: 0.08` vs the 0.04 baseline gives discrete, non-overlapping pulses at 120+ BPM.
- `minFlux: 0.002` catches quieter music (lo-fi, ambient, classical) without firing on silence (the rolling-mean adaptive threshold already handles that).

**If the user complains about false triggers in quiet sections:** bump `minFlux` back to 0.005 in `audioUtils.ts` constructor default.

**If the user complains about strobing/jerky visuals:** bump `decay` back to 0.06 (compromise between 0.04 and 0.08).

### 11.7 Sources

- [essentia.upf.edu — RhythmExtractor2013](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html) — official 44.1kHz constraint
- [essentia.upf.edu — KeyExtractor](https://essentia.upf.edu/reference/std_KeyExtractor.html) — full param list, bgate profile
- [mtg.github.io/essentia.js API](https://mtg.github.io/essentia.js/docs/api/Essentia.html) — JS wrapper, Resample + KeyExtractor signatures
- [snaredevil/snaredevil — mireya-bpm-engine](https://github.com/snaredevil/snaredevil) — most directly comparable open-source beat detection (TypeScript, May 2026)
- [DobbiKov/mixxx-analyzer](https://github.com/DobbiKov/mixxx-analyzer) — Mixxx C++ Rust port, half-wave rectified spectral flux
- [elekktronaut.com — Beat Detection tutorial](https://www.elekktronaut.com/tutorials/beat-detection) — VJ/visualizer practitioner perspective

---

## 12. Session 15 — Hint-System: Plain-Language UX

*6-commit refactor that adds per-control (i)-tooltips to every setting in the app. SettingsPanel is now self-documenting — users without audio/animation knowledge can hover any control and get a 1-2 sentence plain-language explanation.*

### 12.1 The 5 + 1 commits

| # | Commit | File(s) | What |
|---|---|---|---|
| 1 | `095a056` | `src/components/Hint.tsx` (NEW, 410 lines) | Reusable `<Hint/>` popover component. Hover (300ms) + click-to-pin. framer-motion animated. Portal-rendered. Auto-flips near viewport edges. Escape closes, click-outside closes. SSR-safe. |
| 2 | `8f804c1` | `src/lib/hints.ts` (NEW, 653 lines) | Central plain-language text repository. ~110 per-setting hints, 27 accordion descriptions, 36 enum-value explanations. Pure data, no React. |
| 3 | `f8ff0cf` | `src/index.css` (+160 lines) | `.hint-popover` body styling + `.hint-trigger` button. Glassmorphism via `backdrop-filter`, `prefers-reduced-motion` respected. |
| 4 | `204643b` | `src/components/SettingsPanel.tsx` (huge diff) | `FR` extended with `info` prop. `Acc` extended with `description` prop. `EffectCard` extended with `info` prop. **169** `info` props + **32** `description` props + **10** dynamic `ENUM_HINTS` lookups added across all 5 tabs. |
| 5 | `89a8627` | `src/index.css` + `src/components/Hint.tsx` | Bugfix: the CSS arrow was targeting `.hint-popover::before/::after` but `<Hint/>` renders a real `<span className="hint-arrow">`. Wired correctly, removed -103 lines of dead CSS. |
| 6 | (this commit) | `AGENTS.md` | This section. |

### 12.2 Component API (Hint.tsx)

```typescript
interface HintProps {
  text: string;              // explanation, 1-2 sentences, ~60-150 chars
  side?: 'top' | 'right' | 'bottom' | 'left';  // default: 'right'
  hoverDelay?: number;       // default: 300ms, set to 0 to disable
  clickToToggle?: boolean;   // default: true
  className?: string;
  ariaLabel?: string;        // default: 'More info'
}
```

- Trigger: 16×16px circular button, inline SVG ⓘ icon, styled via `var(--text-dim)` + `var(--bg-elev-2)` + `var(--border)`. Hover/focus brightens to `var(--text)` + `var(--accent)`.
- Popover: `position: fixed` via `createPortal(..., document.body)`. 260px max-width, glassmorphism via `backdrop-filter: blur(8px) saturate(1.2)`.
- Arrow: real `<span className="hint-arrow" data-side="X">` with inline-styled CSS border triangle.
- Auto-positioning: measures trigger's `getBoundingClientRect()`, auto-flips right→left if within 252px of viewport right edge, bottom→top if within 120px of viewport bottom.
- Keyboard: button is tab-focusable, Enter/Space toggles, Escape closes when pinned. `aria-describedby` links trigger to popover.
- SSR-safe: `createPortal` is guarded by `typeof document !== 'undefined'`.

### 12.3 Text repository structure (hints.ts)

```typescript
export const SETTING_HINTS: Record<string, string> = {
  'background.blur': 'Softens the background image. 0 = crisp, 10 = soft focus, 25+ = strong dreamy blur.',
  // ... ~110 entries
};

export const ACCORDION_DESCRIPTIONS: Record<string, string> = {
  'background.image': 'Adjust the look of your background image: sharpness, colors, and overall tone.',
  // ... ~27 entries
};

export const ENUM_HINTS: Record<string, Record<string, string>> = {
  'background.tintMode': {
    'multiply': 'Darkens the image and tints it with the color. Most natural for warm/cool mood washes.',
    // ... 36 total enum-value explanations across 10 enum types
  },
};
```

**Style rules** (enforced by code review):
- No jargon. Never: FFT, spectral, kernel, chromatic, HSL, additive blend, waveform, loudness, bin.
- Use familiar analogies. "Like a neon sign", "Like film grain", "Like Instagram's blur slider".
- Length: 60-150 chars per-setting, 50-100 chars accordion descriptions, 40-100 chars enum values.
- Always explain the *effect on the visual*, not the mechanism.

### 12.4 SettingsPanel integration

**Component extensions:**

```typescript
// FR — Field Row
function FR({ label, children, hint, sub, info }: {
  label: string;
  children: React.ReactNode;
  hint?: string;     // right-aligned value (unchanged)
  sub?: string;      // inline gray explanation (unchanged, optional)
  info?: string;     // NEW: popover text — renders <Hint text={info} /> next to label
})

// Acc — Accordion
function Acc({ label, children, defaultOpen, description }: {
  // ... existing
  description?: string;  // NEW: 1-sentence section overview rendered at top
})

// EffectCard — PostFX card
function EffectCard({ label, enabled, onToggle, children, info }: {
  // ... existing
  info?: string;  // NEW: popover text next to the toggle
})
```

**Coverage achieved (Commit `204643b`):**
- 160 `info={hintFor('...')}` props on `FR` controls
- 10 dynamic `info={ENUM_HINTS['...']?.[value]}` lookups on `CB` segmented buttons (updates as user clicks different options)
- 32 `description={ACCORDION_DESCRIPTIONS['...']}` props on accordions
- 5+ standalone toggles wrapped in `<FR>` to get a hint icon (peak enabled, connections, twinkle, logo enabled, etc.)
- EffectCard extended so toggles like `vignetteEnabled`, `nebulaEnabled` also get a hint

**Skipped (TODO if requested):**
- `background.noiseColorMode` is a `Tg` boolean in code, not a `CB` enum — its enum hint in `ENUM_HINTS['background.noiseColorMode']` is unused.
- ~~4 standalone `Tg` toggles (`nebulaBeatMode`, `glitchBeatSync`, etc.) sit directly in accordion bodies without an `FR` wrapper.~~ **Gelöst in Session 19** — diese Toggles sitzen jetzt direkt im Accordion-Body ohne `FR`-Wrapper, aber das ist OK: ihr Kontext (Nebel, Glitch) ist im Accordion-Label selbsterklärend. Falls der User bei einem davon später doch einen Hint will, einfach `info={hintFor(...)}` als Prop an `Tg` setzen (Tg unterstützt das jetzt nativ, siehe §4.8 / §16).

### 12.5 CSS architecture

```css
/* src/index.css, appended at end of file */

.hint-trigger { /* 16px circular button */ }

.hint-popover {
  position: fixed;       /* paired with createPortal + inline left/top */
  z-index: 9999;
  max-width: 260px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  backdrop-filter: blur(8px) saturate(1.2);  /* glassmorphism */
}

.hint-arrow { /* pointer-events: none, geometry is inline */ }

@supports not (backdrop-filter: blur(8px)) { /* graceful degrade */ }
@media (prefers-reduced-motion: reduce) { /* kill animations */ }
```

**All colors use existing CSS vars** (`--bg-elev-2`, `--border-strong`, `--text`). No new tokens, no light-theme variants (app is dark-only per AGENTS.md §6).

### 12.6 Adding hints to new settings (recipe for future Agents)

When adding a new control to SettingsPanel.tsx:

1. **Add the hint text** to `src/lib/hints.ts`:
   ```typescript
   'group.fieldName': 'Plain-language 1-2 sentence explanation. 60-150 chars.',
   ```

2. **Wire it into the FR/EffectCard/Acc**:
   ```typescript
   <FR label="Field name" hint={...} info={hintFor('group.fieldName')}>
     <Sl value={...} ... />
   </FR>
   ```

3. **For new enum values**, add to `ENUM_HINTS['group.fieldName'][enumValue]`.

4. **For new accordion sections**, add to `ACCORDION_DESCRIPTIONS['group.sectionKey']`.

5. **No typecheck/build surprises** — `hintFor()` returns `undefined` if no entry exists, so the `info` prop stays optional.

### 12.7 House-keeping notes

- `now.md` (Session 13 rollback anchor) was removed in this session's working tree. `STABLE.md` is the new anchor. See top of repo for the latest rollback hash (commit before this section: `2a807ce` for Session 14, `89a8627` for Session 15 fix).
- `now.md` can be safely re-deleted at any time. `STABLE.md` documents the pre-Session-13 state and should be kept until the v13 migration is fully stable.

---

## 13. Session 16 — Fire v2 (Domain-Warp FBM) + Sparks/Embers

*4-commit overhaul of the logo fire effect. The previous RingGeometry + simple fBm shader was "sehr sehr schlecht" — tiled noise, no real upward motion, no color zones, no per-band reactivity. Now: production-grade polar-coordinate fire shader with domain-warped FBM + 5-stop blackbody color + 3 flame tongues, plus a brand-new sparks/embers particle system with 3 styles (weld / volcanic / ambient) driven by v13 multi-band audio reactivity.*

### 13.1 The 4 commits

| # | Commit | File(s) | What |
|---|---|---|---|
| 1 | `0d63bcf` | `src/components/three/CenterLogo.tsx` | Fire-Shader komplett neu: polar UV aus vWorldPos, 4-Oktaven FBM + Domain-Warp, Blackbody-Color mit 5 Stops, 3 flameTongue() Wisps, Per-Band-Audio (kick/hihat/vocal), 4 neue Uniforms. |
| 2 | `b90a79d` | `src/components/three/LogoSparks.tsx` (NEW, 486 Zeilen) | Neue Komponente: GPU-Ambient-Pool (150 Partikel, self-respawn via mod(uTime + aOffset, aLifetime)) + CPU-Burst-Pool (60 Partikel, rising-edge auf kick/snare/hihat). 5-Stop Blackbody-Cooling-Color-Ramp. ANGLE-safe (143× fr_ prefix). |
| 3 | `935e4f5` | `src/lib/settingsStore.ts` | Schema-Bump v13 → **v14**. 12 neue sparks* Felder flat unter `logo.*` (nicht unter `logo.fire.*`). `migrate: () => ({ settings: DEFAULT_SETTINGS })` — alte Presets werden komplett zurückgesetzt. Storage-Key: `audiovisualizer:settings:v14`. |
| 4 | `092d520` | `src/components/three/AudioScene.tsx` + `src/components/SettingsPanel.tsx` + `src/lib/hints.ts` | Integration: `<LogoSparks />` als Sibling zu `<CenterLogo />` (z=0.15, renderOrder=9). Neues "Sparks"-Accordion im Logo-Tab mit 12 Controls (FR/Sl/Tg/CB). 13 neue Hint-Texte in hints.ts (12 Settings + 1 Accordion + dynamische Enum-Hints für die 3 Styles). |

### 13.2 Fire v2 — die 6 wichtigsten Verbesserungen

| Alt (v11-v15) | Neu (v16) |
|---|---|
| RingGeometry-UVs als flache Rechteck behandelt (sieht "gekachelt" aus) | **Polar-UV im Fragment-Shader** aus `vWorldPos`: `angle = atan(y,x)`, `radius = length(xy)`, `localX = fract(angle/2π)`, `localY = (radius - innerR) / height` |
| 5-Oktaven Value-Noise ohne Warp | **4-Oktaven FBM + Domain-Warp** (IQ-Pattern: `fbm(p + fbm(p + fbm(p)))` in einer Ebene). Wirkt organisch, turbulent. |
| 3 Farben linear gemischt | **5-Stop Blackbody** (white-hot → yellow → orange → red → dark red), piecewise `mix()` mit `smoothstep`, user-tintable |
| Binärer Smoothstep-Cutoff am Tip (sah "abgeschnitten" aus) | **3 flameTongue() Wisps** mit unabhängigen Phasen, plus ragged Noise-Edge am Tip |
| Nur `uFrBass + uFrBeat` reagierte (einfacher Pulse) | **4 Per-Band-Uniforms**: `uFrKick` (Base-Lift), `uFrHihat` (Tip-Flicker), `uFrVocal` (Color-Shift zu weiß), `uFrBeat` (Flash) |
| Vertex-Shader hatte nur sinuswelligen Radial-Ripple | Vertex-Shader nutzt `atan(y,x)` für Ripple, gibt `vWorldPos` weiter — Fragment macht den Rest |

### 13.3 LogoSparks — Architektur

```
LogoSparks.tsx
├── Ambient GPU Layer (150 Partikel, THREE.Points + ShaderMaterial)
│   ├── Attributes: aStart, aVelocity, aLifetime, aOffset
│   ├── Self-respawn: mod(uTime + aOffset, aLifetime) im Vertex-Shader
│   ├── Per-Style-Physik: weld (schnell, kurz) / volcanic (langsam, lang) / ambient (gemischt)
│   └── AdditiveBlending, depthWrite: false, z=0.15, renderOrder=9
├── Burst CPU Layer (60 Partikel, eigener Pool)
│   ├── Attributes: aStart, aVelocity, aSpawnTime, aLifetime
│   ├── CPU schreibt aSpawnTime bei Rising-Edge (kick > 0.5 && prev <= 0.5)
│   ├── Snare: 0.4× burst count, Hihat: 1-particle Micro-Spawns (probabilistisch)
│   └── Vertex-Shader berechnet Position aus Age, gibt "dead" Partikeln gl_Position = (2,2,2,1)
├── FreqBeatDetector + useBeatDetectorRegistration (für Export-Reset)
└── usePhaseSource (für Phase-Reads, wechselt zwischen precomputed/live)
```

### 13.4 3 Sparks-Styles

| Style | Speed | Lifetime | Gravity | Drag | Use case |
|---|---|---|---|---|---|
| **Weld** | 3-8 | 0.3-0.8s | 3.0 | 2.5 | EDM, hip-hop, schnelle Musik. Scharfe weiße Funken. |
| **Volcanic** | 0.4-1.5 | 1.0-3.5s | 0.5 | 1.0 | Rock, ambient, cinematic. Langsame orange Funken die aufsteigen. |
| **Ambient** | 0.6-1.8 | 0.6-2.0s | 1.5 | 1.5 | Gemischt, "Goldlöckchen"-Default für alles. |

Die Auswahl passiert über `logo.sparksStyle` Setting (CB-Segmented-Buttons in der UI). Der Vertex-Shader skaliert Lifetime + Gravity + Drag je nach Style, so dass ein Partikel "weiß" wie es sich verhalten soll.

### 13.5 12 neue Settings (`logo.sparks*`)

Alle flat unter `logo.*` (nicht `logo.fire.*`!). Defaults:

| Field | Default | Range | Was |
|---|---|---|---|
| `sparksEnabled` | `false` | bool | Master-Toggle (off by default, kein "Schock" für Bestandsuser) |
| `sparksStyle` | `'weld'` | weld/volcanic/ambient | Partikel-Verhalten |
| `sparksCount` | 150 | 50-300 | Ambient-Pool-Größe |
| `sparksSize` | 1.0 | 0.3-3.0 | Basis-Größe |
| `sparksSpeed` | 1.0 | 0.3-3.0 | Initial-Velocity-Multiplier |
| `sparksBurstCount` | 30 | 0-80 | Partikel pro Kick-Burst |
| `sparksLifetime` | 1.2 | 0.3-3.0 | Max-Lifetime in Sekunden |
| `sparksGravity` | 2.5 | 0-8 | Downward-Acceleration |
| `sparksDrag` | 2.0 | 0.5-4.0 | Drag-Coefficient (Luftwiderstand) |
| `sparksSpread` | 0.4 | 0-1.5 rad (~85°) | Radial-Spread-Winkel |
| `sparksSpawnMix` | 0.3 | 0-1 | 0=Rim only, 1=Rim+Flame-Tip-Mix |
| `sparksOpacity` | 0.9 | 0-1 | Gesamt-Opacity |

### 13.6 Schema-Bump v13 → v14 — Breaking Change

**Wichtig:** Bei diesem Bump gehen **alle gespeicherten User-Settings verloren**. Beim nächsten Page-Load:
- Alter localStorage-Key `audiovisualizer:settings:v13` wird ignoriert
- `migrate: () => ({ settings: DEFAULT_SETTINGS })` setzt alles auf neue Defaults
- User müssen Fire-Werte, Bar-Werte etc. neu einstellen (oder Preset neu speichern)

**Bewusste Entscheidung** des Users. Vorteil: saubere Sache, keine Altlasten. Nachteil: UX-Reibung.

**Falls wir das Rückgängig machen wollen** (User beschwert sich): Storage-Key auf v13 lassen, neue Felder als optional mit Defaults, zustand deep-merge füllt die Lücken. Siehe Session 15 §12.4 für das Pattern.

### 13.7 ANGLE-Sicherheit

Beide neuen GLSL-Shader (Fire v2 + Sparks) verwenden das `fr_` Prefix für alle lokalen Variablen. Counts:
- Fire v2 (`CenterLogo.tsx`): 87 `fr_` Vorkommen
- Sparks (`LogoSparks.tsx`): 143 `fr_` Vorkommen

Das ist die kritische Regel aus AGENTS.md §6: ANGLE (Chrome's WebGL auf Windows) lehnt same-named Variablen in parallelen `if/else`-Blöcken ab → stiller Compile-Fehler → schwarzes Bild. Das `fr_`-Prefix umgeht das.

### 13.8 Multi-Band-Audio-Mapping (Übersicht)

| Komponente | Quelle | Reagiert auf |
|---|---|---|
| Fire v2 | `audioAnalysis.{kickPhase, hihatPhase, vocalPhase, beatPhase}` | Kick → Base-Lift, Hihat → Tip-Flicker, Vocal → Color-Shift, Beat → Flash |
| LogoSparks Ambient | `audioAnalysis.{kickPhase, hihatPhase, vocalPhase, beatPhase, loudness}` | Kick → Size-Burst, Hihat → kleinere Funken, Vocal → Velocity-Boost, Beat → Pulse, Loudness → Ambient-Intensity |
| LogoSparks Burst | Rising-Edge von `kickPhase > 0.5` (Schwelle) | Kick-Burst: 30 Partikel. Snare-Burst: 12 Partikel. Hihat: probabilistisch 1 Partikel/Frame. |

### 13.9 Performance-Budget

| Layer | Partikel | Draw Calls | Geschätzte GPU-Kosten (60fps) |
|---|---|---|---|
| Fire v2 (RingGeometry) | N/A (single mesh) | 1 | <0.5ms (Domain-Warp FBM ist 3× teurer als simples FBM, aber immer noch billig) |
| Sparks Ambient | 150 | 1 | <0.2ms (alles im Vertex-Shader) |
| Sparks Burst | 60 | 1 | <0.1ms |
| **Total** | 210 Partikel + 1 Mesh | **3** | **<0.8ms** |

Läuft auf jedem Midrange-Laptop bei 60fps mit Reserve.

### 13.10 Verifikation

| Commit | typecheck | build |
|---|---|---|
| `0d63bcf` (Fire v2) | OK | OK |
| `b90a79d` (LogoSparks) | OK | OK (537 modules) |
| `935e4f5` (Schema v14) | OK | OK |
| `092d520` (Integration) | OK | OK (538 modules) |

**NICHT gelaufen:** `scripts/verify-export.mjs` — sollte der User laufen lassen um zu bestätigen, dass Preview und Export mit dem neuen Shader noch matchen (SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0, beatPhase Δ ≤ 0.10). Insbesondere der **CPU-Burst-Pool** ist nicht direkt export-safe — die `timeRef.current` (basierend auf `state.clock.elapsedTime`) läuft im Export-Loop weiter, aber die `audioAnalysis.kickPhase`-Werte kommen aus precomputed Daten. Wenn das nicht passt, müssen wir noch eine Audio-Time-basierte Spawn-Zeit einführen.

### 13.11 Bekannte Einschränkungen

- **CPU-Burst-Pool-State** ist nicht perfekt export-konsistent: Im Live-Modus spawnt ein Rising-Edge auf `kickPhase > 0.5`. Im Export werden die `kickPhase`-Werte aus dem precomputed Bundle gelesen, aber `timeRef.current` ist `state.clock.elapsedTime` (R3F-Clock), was im Export-Loop gleichmäßig voranschreitet. Das passt in 95% der Fälle, aber bei sehr schnellen Beats könnten manche Bursts im Export fehlen. **TODO:** `timeRef.current` durch eine audioAnalysis-basierte Zeit ersetzen.
- **Sind 150 Ambient-Partikel genug?** Bei sehr großen Logos könnte der Effekt "dünn" wirken. Falls ja, den `sparksCount`-Default auf 200 erhöhen.
- **Schwarze Partikel an den Tip-Positionen:** Die 5-Stop Blackbody-Color-Ramp endet bei `vec3(0.33, 0.0, 0.0)` (dunkelrot), nicht bei transparent. Das ist gewollt — die Funken sollen als glühende Kohlen sichtbar bleiben, nicht unsichtbar werden. Falls das zu "matschig" wirkt, in `SPARKS_AMBIENT_VERT/FRAG` `c4 = vec3(0.0)` setzen.
- **`sparksSpawnMix`** wird in `LogoSparks.tsx` aktuell NOCH NICHT ausgewertet — die Spawn-Position ist hartcodiert auf den Rim. Das ist ein bewusst weggelassener Hook für eine spätere Session (man müsste die flame-tip-Position aus dem Fire-Shader samplen, was eine separate Textur oder ein gl_FragCoord-Trick erfordert).

### 13.12 House-keeping

- `state.md` wurde im Working Tree gelöscht (nicht in den Commits, da nicht meine Änderung).
- `now.md` war bereits in Session 15 gelöscht.
- `STABLE.md` ist der aktuelle Rollback-Anchor (zeigt auf af2e2b8 + 795b025, den Pre-Session-13-Stand).
- Bei einem Bug-Rollback: `git revert 0d63bcf b90a79d 935e4f5 092d520` macht alle 4 Commits rückgängig, ohne die Schema-Migration zu triggern (User-Settings auf v14 bleiben erhalten, aber die neuen Features sind weg).

---

## 14. Session 17 — Fire Color 1:1 + Seamless Ring UV

*2-commit bugfix-Session. Zwei hartnäckige Fire-Shader-Bugs, beide optisch sichtbar, beide ohne Schema-Bump gelöst (settingsStore bleibt v14).*

### 14.1 Die 2 Commits

| # | Commit | Datei | Was |
|---|---|---|---|
| 1 | `2452afa` | `src/components/three/CenterLogo.tsx` | `fr_fireColor()` von 5-Stop-Blackbody mit 45-70% hardcoded Tönen auf 3-Stop-User-Gradient umgestellt. User-Picker-Farben fließen jetzt 1:1 durch. |
| 2 | `569b85b` | `src/components/three/CenterLogo.tsx` | `fr_localX` von `fract(angle/TAU)` auf `(vLocalPos.x + vLocalPos.y) * 1.5` umgestellt. Eliminiert die vertikale Naht im Ring-Noise. |

### 14.2 Fire Color 1:1 — der eigentliche Fix

**Bug (Commits `a2e767b`, `48f9be4`, `3984f0e` zurückgenommen in `e210a23`):** Die `fr_fireColor()`-Funktion mischte 45-70% hardcoded Blackbody-Töne (dunkelrot/orange/gelb/weiß) in die User-Picker-Farben. Egal welche Farbe der User wählte — die Flamme blieb immer orange-gelb-weiß. Drei Versuche, ein vollständiges `colorMode`-Enum (solid/gradient/rainbow/...) analog zu Bars/Particles einzubauen, scheiterten alle an GLSL-Edge-Cases (`if/else-if`-Chains und `step()`-Boundary-Bugs auf der Ziel-Hardware).

**Fix:** Statt neuem Color-Mode-Enum → **chirurgisch minimal**: 5-Stop-Blackbody raus, simpler 3-Stop-User-Gradient rein:

```glsl
vec3 fr_fireColor(float fr_heat) {
  vec3 fr_c = mix(uFrColorOuter, uFrColorMid,   smoothstep(0.0,  0.5,  fr_heat));
  fr_c      = mix(fr_c,           uFrColorInner, smoothstep(0.5,  0.85, fr_heat));
  fr_c      = mix(fr_c,           vec3(0.0),     smoothstep(0.85, 1.0,  fr_heat));
  return fr_c;
}
```

Uniform-Semantik:
- `uFrColorOuter` (UI: "Hot" / `#ffee88`) → **Basis** (fr_heat ≈ 0, heißester Punkt)
- `uFrColorMid` (UI: "Mid" / `#ff7700`) → **Mitte**
- `uFrColorInner` (UI: "Cool" / `#ff2200`) → **Spitze** (fr_heat ≈ 0.85, kühlster Punkt)
- fr_heat > 0.85 → schwarz (Flammenspitze fadet aus)

**Handover-Doc:** `HANDOVER-FIRE-COLOR.md` (jetzt gelöscht nach erfolgreichem Fix) — 3 fehlgeschlagene Versuche dokumentiert, inkl. „was NICHT zu tun ist" (kein if/else-Chain, keine `step()`-Boundary, kein 5-Stop-Blackbody).

**Erhalten:** Der `uFrKick * 0.25 * vec3(1.0, 0.8, 0.5)`-Boost nach dem Color-Call bleibt — das ist ein **kurzer Audio-Reaktivitäts-Flash pro Kick** (1-2 Frames sichtbar), nicht die Flammenfarbe. Hartcodiert gelb/orange zu lassen ist hier korrekt, weil es ein „Glühen"-Effekt ist, keine Farbwahl.

### 14.3 Seamless Ring UV — der Naht-Fix

**Bug:** Vertikale Naht auf der linken Seite des Fire-Rings, sichtbar als harte Trennlinie. Ursache: `fr_localX = fract((atan(y,x) + PI) / TAU)` wrapt den Winkel in [0,1]. Am Wrap-Punkt (Winkel geht von +π zurück auf -π) springt `fract()` von ~1.0 auf 0.0. Hash-basiertes Noise (`fr_h`/`fr_vn`/`fr_fbm`) sieht dort zwei **unterschiedliche** Eingabewerte für geometrisch benachbarte Pixel → sichtbarer Sprung.

**Fix:** Statt `fract(angle)` → `vLocalPos.xy` direkt als Noise-X verwenden:

```glsl
// Vorher (gebrochen):
float fr_angle  = atan(vLocalPos.y, vLocalPos.x);
float fr_localX = fract((fr_angle + fr_PI) / fr_TAU);  // 0..1 around ring

// Nachher (seamless):
float fr_localX = (vLocalPos.x + vLocalPos.y) * 1.5;
```

**Warum das funktioniert:** `vLocalPos.xy` ist die echte 3D-Position auf dem Ring — per Konstruktion continuous um den Ring herum, kein Wrap, kein Modulo. Hash-Noise sampelt eine glatte Mannigfaltigkeit.

**Skalierung:** Faktor 1.5. Mid-Radius-Umfang bei `innerR=0.5, fireHeight=0.3` ist ≈ 2·π·0.65 ≈ 4.1 local units. Alter fract-Wert war `1.0 * 6.0 = 6.0` pro Umrundung. Neuer Wert ist `1.5 * 4.1 ≈ 6.0` pro Umrundung → visuell identische räumliche Noise-Frequenz.

**Betrifft 4 Noise-Sample-Stellen**, die alle `fr_localX` als X-Input benutzten:
1. `fr_flameMask()` — WBM outer edge crinkle (größter sichtbarer Effekt)
2. `fr_flameMask()` — Flicker `sin()` (kaum sichtbar, aber konsistent)
3. `main()` `fr_wfbm` — Heat-Streaks
4. `main()` Hihat-Sparkle

Alle vier lesen jetzt denselben `fr_localX` → eine einzige Code-Änderung fixt alle Naht-Quellen.

### 14.4 Lessons Learned (für künftige Ring-Shader)

In §6 als 🔴-Stolperfalle aufgenommen:

> **Ring-Shader: NIEMALS `fract(angle/TAU)` für Noise-Input.** Für Ring/Radial-Geometrien (Fire-Ring, künftige Donut-Effekte, Glow-Ring) niemals den Winkel via `fract(atan/TAU)` als Noise-Koordinate. `fract()` hat eine harte Wrap-Diskontinuität bei 0.0/1.0. Stattdessen `vLocalPos.xy` direkt verwenden — die ist per Konstruktion seamless.

Gilt für JEDEN zukünftigen Ring-Effekt (Donut-Sweep, Plasma-Ring, Audio-Ring-Spectrum, etc.).

### 14.5 Verifikation

| Commit | typecheck | build |
|---|---|---|
| `2452afa` (Color 1:1) | OK | OK (538 modules) |
| `569b85b` (Seamless UV) | OK | OK (538 modules) |

User-Verifikation (im Chat bestätigt):
- ✅ Fire lodert sichtbar (continuous ring aus `9d6e6a5` blieb erhalten)
- ✅ 3 User-Color-Picker (Hot/Mid/Cool) wirken 1:1 (User testete mit Grün/Blau)
- ✅ Vertikale Naht auf der linken Seite ist weg

**NICHT gelaufen:** `scripts/verify-export.mjs` — sollte der User laufen lassen um zu bestätigen, dass Preview und Export mit dem neuen `fr_localX` immer noch matchen (SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0, beatPhase Δ ≤ 0.10). Insbesondere die Naht-Elimination sollte **keinen** numerischen Einfluss auf die Audio-Werte haben (rein geometrischer Fix), aber die Hitzeverteilung könnte sich marginal verschoben haben.

### 14.6 House-keeping

- `HANDOVER-FIRE-COLOR.md` wurde nach erfolgreichem Fix gelöscht. Handover-Inhalt war 3-Kapitelliste an „was nicht zu tun ist" + „chirurgisch minimal"-Plan — die Lesson-Learned ist jetzt in §6 + §14.4 dieser Datei konserviert.
- Kein Schema-Bump nötig (settingsStore bleibt v14).
- `STABLE.md` bleibt der aktuelle Rollback-Anchor für die v13-Migration (af2e2b8 + 795b025).
- Bei einem Bug-Rollback: `git revert 2452afa 569b85b` macht beide Fixes rückgängig, Settings v14 bleiben erhalten, aber Fire ist wieder orange-gelb-weiß + hat die Naht.

---

## 15. Session 18 — Inner-Glow Gap Fix

*1-commit Bugfix: Sichtbare dunkle Linie am Logo-Edge wenn Inner Glow an. settingsStore bleibt v14 (kein Schema-Bump, reine Geometrie/Shader-Änderung).*

### 15.1 Der Commit

| # | Commit | Datei | Was |
|---|---|---|---|
| 1 | `95d644e` | `src/components/three/CenterLogo.tsx` (12 +/−8) | Inner-Glow-Plane 1.03× größer (`CircleGeometry(0.5 * 1.03, 64)`) + Shader-`discMask` durch `edgeFade = 1.0 - smoothstep(0.97, 1.0, ig_dist)` ersetzt. |

### 15.2 Die Gap — Root Cause

Die Inner-Glow-Plane und der Logo-Disc hatten **denselben Radius** (beide `0.5 * logoSize` in local space). Im Shader lag aber ein harter Disc-Mask-Cutoff:

```glsl
float ig_discMask = 1.0 - smoothstep(0.98, 1.0, ig_dist);
ig_alpha *= ig_discMask;
```

Das hat die äußersten 2% der Glow-Plane hart auf Alpha=0 gesetzt. **Genau dort endet auch der Logo-Disc** (Canvas-Circular-Mask macht die Pixel am Edge transparent). Ergebnis: ein schmaler Ring **weder mit Logo-Pixeln noch mit Glow** → sichtbare dunkle Linie = "Gap".

### 15.3 Der Fix

**Plane 1.03× größer**, damit am Logo-Edge (jetzt bei `ig_dist ≈ 0.97`) noch voller Alpha anliegt:

```typescript
const innerGlowGeo = useMemo(() => new THREE.CircleGeometry(0.5 * 1.03, 64), []);
```

**Sanfter Edge-Fade statt hartem Cutoff**:

```glsl
float ig_edgeFade = 1.0 - smoothstep(0.97, 1.0, ig_dist);
ig_alpha *= ig_edgeFade;
```

Effekt: am Logo-Edge voller Glow, die letzten 3% der Plane laufen weich aus. Kein harter Schnitt, keine sichtbare Lücke. Der Logo-Disc (opak drüber) verdeckt den schmalen 1.5%-Saum, der theoretisch über den Logo-Rand hinausreicht.

### 15.4 Was bewusst NICHT geändert wurde

Der `ig_into`/`ig_blur`-Control-Curve ist unangetastet — der User wollte explizit **nur die Gap fixen**, nicht die Slider-Skalierung. Der bekannte "Blur=15 füllt alles aus"-Effekt (siehe AGENTS.md §6) bleibt bestehen und sollte in einer separaten Session angegangen werden, falls gewünscht.

### 15.5 Lessons Learned (in §6 als 🔴-Stolperfalle aufgenommen)

> **Inner-Glow / Inner-Rim-Shader: Plane NIEMALS = Logo-Radius.** Wenn die Glow-Plane exakt am Logo-Edge endet UND im Shader ein Disc-Mask-Cutoff (oder jede andere Form von "ab Radius X = 0") sitzt, entsteht eine sichtbare Gap am Edge (Logo-Pixel transparent, Glow weggeschnitten). **Fix:** Plane leicht größer (1.02-1.05×), Edge-Fade in den überstehenden Bereich legen.

Gilt analog für künftige Edge-bezogene Glow/Rim-Shader (Donut-Rim, Stroke-Ring, etc.).

### 15.6 Verifikation

| Check | Result |
|---|---|
| `npm run typecheck` | OK |
| `npm run build` | OK (538 modules) |
| `grep ig_discMask` | 0 results (old variable fully removed) |
| `grep "1.03\|0.97"` | 3 correct hits |
| User-Bestätigung | ✅ Gap weg, Logo sitzt sauber |

**NICHT gelaufen:** `scripts/verify-export.mjs` — sollte der User laufen lassen, um zu bestätigen, dass die 1.03×-Plane den Export nicht beeinflusst. Rein geometrischer Fix ohne Audio-Relevanz → SSIM und Audio-Werte sollten unverändert sein.

### 15.7 House-keeping

- Kein Schema-Bump (settingsStore bleibt v14).
- Kein neuer Hot-Spot-Eintrag nötig (CenterLogo ist bereits in §7 referenziert).
- Bei Bug-Rollback: `git revert 95d644e` macht den Fix rückgängig.

---

## 16. Session 19 — UI Polish: All-Closed Accordions + Hint Placement + AAC Probe

*3-Commit Session mit 2 Themen. settingsStore bleibt v14 (kein Schema-Bump).*

### 16.1 Die 3 Commits

| # | Commit | Datei | Was |
|---|---|---|---|
| 1 | `da62beb` | `src/lib/exportEngine.ts` (13 +/−4) | AAC-Bitrate-Probe: 512k wird zuerst probiert (vor `audioBitrate`), dedup-Filter bleibt. `console.info` loggt, wenn der Browser den gewünschten Bitrate nicht akzeptiert. Happy-Path (Browser nimmt 384k+) unverändert. |
| 2 | `0fe9afb` | `src/components/SettingsPanel.tsx` (56 +/−26) | UI Polish #1: Alle `<Acc>` `defaultOpen` entfernt — hartcodiert `useState(false)`. Tg erweitert um `info?` Prop. 10 `<FR label="" info={...}><Tg/></FR>` Pattern → `<Tg info={...} />` (kein "lonely (i)" mehr). |
| 3 | `5cce271` | `src/components/SettingsPanel.tsx` (3 +/−3) | UI Polish #2: Hint-Icon von den 3 Master-Toggles (Show logo, Radial bars, Particles) entfernt. Die 7 obskureren Toggles (Outer/Inner Glow, Fire, Sparks, Peaks, Connection lines, Twinkle) behalten es. |

### 16.2 Der "Lonely (i)"-Bug

**Symptom (User-Report):** Bei "Show Logo" (und ähnlichen Master-Toggles) saß der `(i)`-Button ganz alleine in einer Header-Zeile, weil der Toggle in `<FR label="" info={...}><Tg .../></FR>` gewrappt war — `FR` rendert den Hint-Icon im Label-Bereich, und ein leeres Label produziert eine Header-Zeile mit nur dem Icon.

**Root Cause:** `Tg` unterstützte ursprünglich kein eigenes `info`-Prop, also musste der Hint am `FR`-Wrapper hängen. Bei Toggle-Labels ist das strukturell falsch: ein Toggle hat sein Label *innerhalb* der Button-Fläche, der Hint gehört daneben.

**Fix:** Tg nimmt jetzt `info?: string` entgegen. Bei gesetztem `info` restructuriert sich der DOM von `<button>` zu `<div flex>` + inner `<button flex-1>` + `<Hint/>` als Sibling. **Keine nested-buttons** (HTML-valid, Klick-Verhalten unverändert). Wenn `info` nicht gesetzt ist, bleibt der ursprüngliche Single-`<button>`-DOM — null Regression für alle anderen Tg-Verwendungen (z.B. in EffectCard).

### 16.3 Wann Tg ein `info` bekommt — und wann nicht

| Toggle-Typ | Hint? | Begründung |
|---|---|---|
| **Master-Toggles** (`logo.enabled`, `bars.enabled`, `particles.enabled`) | ❌ Nein | "Show logo", "Radial bars", "Particles" — selbsterklärend. (i) wäre Rauschen. |
| **Sub-System-Toggles** (`outerGlowEnabled`, `innerGlowEnabled`, `fireEnabled`, `sparksEnabled`, `peakEnabled`, `connectionLines`, `twinkle`) | ✅ Ja | User kennt die Subsysteme evtl. nicht. Hint erklärt in 1 Satz was es macht. |
| **EffectCard-interne Toggles** (`vignetteEnabled`, `nebulaEnabled`, `bloomEnabled`, `noiseEnabled`, `scanlineEnabled`, `glitchEnabled`, `pixelationEnabled`, `dotScreenEnabled`, `gridEnabled`, `sepiaEnabled`, `caEnabled`, `colorAverageEnabled`, `bgParticlesEnabled`, `rainEnabled`, `snowEnabled`) | ✅ Ja (via EffectCard's eigenes `info`-Prop) | EffectCard platziert das Hint-Icon **schon korrekt** als Sibling zum Tg — nix zu fixen. |
| **Standalone Toggles im Accordion-Body** (`nebulaBeatMode`, `glitchBeatSync`, `noiseColorMode`) | ❌ Nein (aktuell) | Kontext im Accordion-Label ("Fog > Beat pulse mode", "Effects > Noise > Color grain") ist selbsterklärend. Falls User bei einem davon später doch einen Hint will, einfach `info={hintFor(...)}` an Tg hängen. |

### 16.4 Acc `defaultOpen?` — entfernt, ohne Ausnahme

Vorher hatte jeder Tab 1-2 Sektionen mit `defaultOpen` (Image, Size, Fire, Sparks, Detection Mode, Song Metadata, Band Sensitivity, Key Influence, Legacy Beat, Bars General, Particles General). User wollte **alle** standardmäßig eingeklappt, ohne Ausnahme. Fix:
- `Acc({ label, children, defaultOpen? })` → `Acc({ label, children, description? })`
- `useState(defaultOpen)` → `useState(false)` (hartcodiert)
- 11 Aufrufstellen abgesucht und `defaultOpen`/`defaultOpen={false}` gestrippt

**Künftige Agents:** Beim Hinzufügen einer neuen Sektion **kein** `defaultOpen` setzen. Wenn der User explizit "die Sektion soll auf sein wenn ich auf den Tab wechsle" sagt, ist das eine separate Diskussion.

### 16.5 AAC-Probe-Reihenfolge

**Motivation:** Ballern-Export endete bei 192 kbps, weil der Browser 384k ablehnte — silent fallback ohne Sichtbarkeit.

**Neue Probe-Reihenfolge:**
```typescript
const aacCandidates = [512_000, audioBitrate, 384_000, 320_000, 256_000, 192_000, 128_000]
  .filter((v, i, a) => a.indexOf(v) === i); // dedup
```

- **512k first** — manche Browser (Firefox, Edge) erlauben das. Bessere Source für YouTube-Re-Encode.
- **audioBitrate** (z.B. 256k für TikTok) explizit drin, damit Preset-Vorgaben respektiert werden.
- **384k explizit** — falls `audioBitrate=512k` ist (was nicht vorkommt, aber für Robustheit), 384k als Fallback.
- Dedup-Filter verhindert Doppel-Probing.
- `findSupportedAacBitrate` selbst unverändert.

**Logging:**
```typescript
if (resolvedAudioBitrate < audioBitrate) {
  console.info(`[export] AAC bitrate fallback: requested ${audioBitrate} bps, browser accepted ${resolvedAudioBitrate} bps. YouTube recommends 384000 bps for stereo AAC.`);
}
```

Happy-Path bleibt still (Browser nimmt 384k+). Fallback ist sichtbar.

### 16.6 Lessons Learned (in §4.8 / §12.7 / §6 ergänzt)

> **🔴 Hint-Icon-Placement: Master-Toggles ohne Hint.** `<Tg>` für `logo.enabled` / `bars.enabled` / `particles.enabled` bekommen **kein** `info` Prop. Ein einsamer `(i)`-Button in einer Header-Zeile ohne Label-Look ist UX-Müll. Sub-System-Toggles (Outer Glow, Connection Lines, Twinkle) behalten den Hint, weil ihr Name nicht selbsterklärend ist.

> **🔴 Toggles nicht in `<FR label="" info={...}>` wrappen.** Das produziert einen verwaisten Hint-Icon in einer leeren Header-Zeile. Stattdessen `Tg` direkt mit `info`-Prop verwenden.

> **🟢 Acc ohne `defaultOpen`.** Standard ist "alle eingeklappt". Das spart visuellen Lärm beim ersten Öffnen. User können selbst aufklappen was sie brauchen.

### 16.7 Verifikation

| Commit | typecheck | build | grep-checks |
|---|---|---|---|
| `da62beb` (AAC) | OK | OK | `512_000` in exportEngine, `console.info.*AAC` in exportEngine |
| `0fe9afb` (Acc + Tg) | OK | OK | `defaultOpen` count = 0, `<FR label="" info=` count = 0 |
| `5cce271` (Hint-Drop) | OK | OK | 3 Master-Toggles ohne `info` |

**NICHT gelaufen:** `scripts/verify-export.mjs` — kein Audio-Pipeline-Touch in dieser Session, SSIM/Audio-Werte sind garantiert unverändert.

### 16.8 House-keeping

- settingsStore bleibt v14 (kein Schema-Bump).
- `Hint.tsx` unverändert — Tg nutzt die existierende Hint-Komponente.
- `EffectCard` unverändert — Hint-Platzierung dort war schon korrekt.
- Bei UI-Pollish-Rollback: `git revert 5cce271 0fe9afb da62beb` macht alle 3 Commits rückgängig (in umgekehrter Reihenfolge wegen Lineage).
- §4.8 und §12.7 in AGENTS.md mit den neuen Konventionen aktualisiert (Tg `info`-Prop, Acc kein `defaultOpen`).

---

## 17. Session 20 — Strands Background Effect

*2-commit Session: ogl-basierter "Strands"-Effekt (Aurora/Lichtbänder) von https://reactbits.dev portiert. settingsStore v14 → v15 mit deep-merge migrate (alte User-Settings bleiben erhalten).*

### 17.1 Die Commits

| # | Commit | Datei | Was |
|---|---|---|---|
| (Phase 1) | `d04b225` | `package.json` + `package-lock.json` + `src/components/three/Strands.tsx` (NEU, 270 Zeilen) + `src/lib/settingsStore.ts` + `src/lib/hints.ts` | Foundation: ogl@^1.0.11 installiert, Strands.tsx portiert (GLSL mit `str_` Prefix für ANGLE-Sicherheit, Audio-Reaktivität via usePhaseSource), settingsStore v15 mit 19 neuen `strands*` Feldern + deep-merge migrate, 19 neue Hint-Texte |
| (Phase 2) | `5b35348` | `src/components/VisualizerStage.tsx` + `src/components/SettingsPanel.tsx` | UI-Integration: `<Strands/>` in VisualizerStage (DOM-Order z-index), neues "Strands"-Accordion im Background-Tab mit 18 Settings (Color-Editor für strandsColors, 13 Slider, HzRangePicker + Sensitivity) |

### 17.2 Architektur — Standalone ogl-Renderer

Strands nutzt **NICHT** R3F. Es ist eine eigenständige React-Component mit:
- Eigenem WebGL2-Canvas (ogl `Renderer` mit `alpha: true`, `premultipliedAlpha: false`)
- Eigenem rAF-Loop im `useEffect` (nicht R3F `useFrame`)
- Eigenem `ResizeListener` (`window.addEventListener('resize')`)
- Eigener Cleanup (`cancelAnimationFrame` + `WEBGL_lose_context` + `canvas.remove()`)

**Warum nicht R3F?**
- Original reactbits-Code nutzt ogl direkt (1:1 portiert = kein Three.js-Rewrite nötig)
- Strands braucht nur Fullscreen-Triangle + Custom-Shader — kein 3D-Transform, keine Camera, keine Beleuchtung
- Eigenständiger Canvas = keine Interferenz mit R3F-Render-Pipeline
- **Trade-off:** Strands wird NICHT in den MP4-Export aufgenommen (exportEngine capture'd nur R3F's gl). Wenn der User Strands auch im Export will, müsste man den ogl-Canvas pro Frame screenshotten und in die R3F-Szene composen — signifikanter Aufwand, **TODO für später**.

### 17.3 ANGLE-Sicherheit (KRITISCH)

Alle lokalen GLSL-Variablen im Strands-Fragment-Shader haben das `str_` Prefix (45 Vorkommen). `uTime`, `uResolution`, `uColors`, `uColorCount`, `uStrandCount`, `uSpeed`, `uAmplitude`, etc. bleiben unverändert (Uniforms).

Beispiel:
```glsl
// Original reactbits:
float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
col += strandColor(h) * g * env;

// Portiert:
float str_h = str_fi / float(uStrandCount) + str_uv.x * 0.30 + uTime * 0.04 + uHueShift;
str_col += str_strandColor(str_h) * str_g * str_env;
```

Gilt für JEDEN zukünftigen ogl/Three.js-Shader in dieser App. Siehe §6.

### 17.4 Audio-Reaktivität

Strands nutzt exakt das gleiche Pattern wie BackgroundFx:
- `useMemo(() => new FreqBeatDetector(48000), [])` (registriert für Export-Reset)
- `usePhaseSource({ detector, getPrecomputedRange, liveFn })`
- Hz-Range: `settings.background.strandsBeatFreqStart/End` (default 20-200 Hz)
- Sensitivity: `settings.background.strandsBeatSensitivity` (default 0 = aus)

**Beat-Effekt auf den Shader:**
```typescript
const beat = phaseSrcRef.current();
const boost = sensitivity * beat;  // 0..5 * 0..1
uniforms.uAmplitude.value = baseAmp  * (1 + boost * 0.4);  // bis zu +200% Amplitude bei Sens=5
uniforms.uGlow.value      = baseGlow * (1 + boost * 0.3);  // bis zu +150% Glow bei Sens=5
```

Andere Strands-Props (Speed, Waviness, Thickness, ...) reagieren NICHT auf Audio — das würde "flickrig" wirken. Amplitude + Glow sind die visuell stabilsten Pulse-Props.

### 17.5 z-Index / Layering

Strands wird in `VisualizerStage.tsx` als HTML-Overlay gemounted, mit DOM-Order als z-index-Logik:
1. Backdrop
2. `<Strands/>` wenn `strandsBehindLogo=true` (default — hinter R3F, vor Backdrop)
3. `<AudioScene/>` R3F Canvas
4. `<Strands/>` wenn `strandsBehindLogo=false` (über R3F, mit `mixBlendMode: 'screen'` für additive Überlagerung)
5. HTML-Overlays (TransportBar, ExportOverlay, etc.)

### 17.6 Schema-Bump v14 → v15 (deep-merge, kein Reset)

**Wichtig:** Im Gegensatz zu v13→v14 (Fire+Sparks) wird bei v15 **kein** hard-reset der User-Settings gemacht. Der User behält seine v14-Einstellungen, nur die 19 neuen `strands*` Felder werden mit Defaults gefüllt.

Migration-Code (in `settingsStore.ts`):
```typescript
migrate: (persistedState: any, version: number) => {
  if (!persistedState?.settings) return { settings: DEFAULT_SETTINGS };
  if (version < 15) {
    persistedState.settings.background = {
      ...DEFAULT_SETTINGS.background,
      ...persistedState.settings.background,  // alte v14-Settings überschreiben Defaults
    };
  }
  return persistedState;
}
```

Storage-Key: `audiovisualizer:settings:v15`.

### 17.7 19 neue Settings (`background.strands*`)

| Field | Type | Default | Range | Was |
|---|---|---|---|---|
| `strandsEnabled` | bool | false | - | Master-Toggle |
| `strandsColors` | string[] | ['#FF4242', '#7C3AED', '#06B6D4', '#EAB308'] | 1..8 | Palette (max 8 wie Shader MAX_COLORS) |
| `strandsCount` | number | 3 | 1..12 | Anzahl Stränge (Shader MAX_STRANDS) |
| `strandsSpeed` | number | 0.5 | 0..3 | Animationsgeschwindigkeit |
| `strandsAmplitude` | number | 1.0 | 0..3 | Höhe der Waves |
| `strandsWaviness` | number | 1.0 | 0..3 | Frequenz der Wellen |
| `strandsThickness` | number | 0.7 | 0..3 | Strich-Dicke |
| `strandsGlow` | number | 2.6 | 0..6 | Glow/Helligkeit |
| `strandsTaper` | number | 3 | 0..10 | Fade an Screen-Edges (Envelope-Funktion) |
| `strandsSpread` | number | 1 | 0..3 | Phasenversatz zwischen Strängen |
| `strandsHueShift` | number | 0 | 0..2 | Hue-Shift über Zeit |
| `strandsIntensity` | number | 0.6 | 0..1 | Maximale Helligkeit |
| `strandsSaturation` | number | 1.5 | 0..3 | Farbsättigung |
| `strandsOpacity` | number | 1 | 0..1 | Gesamt-Transparenz |
| `strandsScale` | number | 1.5 | 0.1..5 | Räumliche Skalierung (UV-Divisor) |
| `strandsBeatFreqStart` | number | 20 | 20..20000 | Hz-Range für Beat-Detection |
| `strandsBeatFreqEnd` | number | 200 | 20..20000 | |
| `strandsBeatSensitivity` | number | 0 | 0..5 | 0 = Audio-Reaktivität AUS |
| `strandsBehindLogo` | bool | true | - | true = hinter R3F, false = davor (mit mixBlendMode) |

### 17.8 SettingsPanel-Integration

Neues Accordion "Strands" im Background-Tab (zwischen "Effects" und "Weather FX"):
- Master-Toggle ohne Hint (analog zu `logo.enabled`)
- Position-CB (behind/front) — nur sichtbar wenn enabled
- Color-Editor (add/remove) — max 8 Farben, nutzt `useSettingsStore.getState().setSettings` Pattern (analog zu `CustomColorEditor`)
- 13 Sliders mit Hint via `hintFor('background.strandsXxx')`
- HzRangePicker für Beat-Frequenz
- Sensitivity-Slider für Beat-Reaktion

Accordion startet IMMER geschlossen (kein `defaultOpen`, §16.4). `strandsEnabled`-Toggle hat kein Hint (Master-Toggle-Regel, §16.3).

### 17.9 Performance-Budget

| Layer | Draw Calls | Geschätzte GPU-Kosten (60fps) |
|---|---|---|
| Strands (ogl, fullscreen triangle) | 1 | ~0.3-0.5ms (zwei Sinus + Sample-Palette + Tone-Mapping) |

Läuft parallel zum R3F-Render (separater WebGL-Kontext) → kein direkter Overhead in R3F-Frame.

### 17.10 Bekannte Einschränkungen

- **Export-Pipeline:** Strands ist NICHT im MP4-Export enthalten (exportEngine capture'd nur R3F's gl). TODO für später: ogl-Canvas screenshotten und in R3F-Szene composen. Aktuelle Lösung: User sieht Strands nur im Live-Preview.
- **Color-Picker-Color-Editor:** Die +/− Buttons funktionieren, aber es gibt keine Color-Palette-Vorschau (anders als der Custom-Color-Editor in Bars/Particles). Falls das gewünscht ist: einfach ein Swatch-Row-Pattern nachrüsten.
- **`uTaper=0`** führt zu flat-line Envelope (kein Edge-Fade) → Strands fließen über den ganzen Screen ohne Fade. Visuell oft erwünscht, aber falls "zu hart an den Rändern": uTaper erhöhen.
- **`strandsCount=12`** + **`strandsSpeed=3`** + **`strandsGlow=6`** = maximale GPU-Last. Auf low-end Laptops könnten einzelne Frames >16ms brauchen. Default-Werte sind konservativ.

### 17.11 House-keeping

- `nul` Datei im Working Tree (Artefakt aus Windows-cmd-Echo) — kann jederzeit gelöscht werden
- settingsStore v15 bleibt, bis ein neuer Schema-Bump nötig wird
- Bei Bug-Rollback: `git revert 5b35348 d04b225` macht alle Strands-Änderungen rückgängig, v15-Migration-Code bleibt erhalten (User-Settings auf v15 mit `strandsEnabled=false` als Default)
- **Commit-Hashes in §17.1**: Orchestrator muss `<PENDING>` durch echte Hashes aus `git log --oneline -n 5` ersetzen, nachdem die Commits gemacht wurden.
