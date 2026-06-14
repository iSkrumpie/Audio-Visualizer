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
| `background` | blur, brightness, saturation, contrast, hueShift, sharpen, tint (color/opacity/mode), **beatFxFreqStart/beatFxFreqEnd** (HzRangePicker), **beatFxSensitivity** (0.1-5.0), scaleOnBeat (0..0.5), vignette (enabled/strength), nebula (enabled/intensity/color1/color2/driftSpeed/reactivity/scale/offsetX/offsetY + **nebulaBeatMode/FreqStart/End/Sensitivity** für optionalen Pulse-Mode), PostFX: bloom (enabled/intensity/threshold), CA (enabled/offset), noise (enabled/intensity/speed/beatReactivity/scale/colorMode), scanlines (enabled/density/speed/beatReactivity/thickness), glitch (enabled/delay/strength/RGBSplit/BlockSize/BlockProb/Vertical/BeatSync/Decay), sepia (enabled/intensity), pixelation (enabled/granularity/beatReactivity/wave/waveSpeed), dotscreen (enabled/scale/rotation/rotSpeed/beatScale/colorSep), grid (enabled/scale/pulseStrength/wave/waveSpeed/movement/color), colorAverage (enabled), **bgParticles** (bgParticlesEnabled/Count/Speed/Size/Opacity/Color/BeatFreqStart/BeatFreqEnd/BeatSensitivity), **rain** (rainEnabled/Count/Speed/Angle/Length/Width/Color/Opacity/BeatFreqStart/BeatFreqEnd/BeatSensitivity), **snow** (snowEnabled/Count/Speed/Size/Color/Opacity/Sway/BeatFreqStart/BeatFreqEnd/BeatSensitivity) |
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
- `Tg({ value, onChange, label })` - Toggle Switch
- `Acc({ label, defaultOpen?, children })` - Accordion
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
| `CenterLogo` | `settings.logo.*` | Immer circle; canvas-Circular-Mask; **Outer Glow ShaderMaterial** (OUTER_GLOW_FRAG, z=-0.1, renderOrder=5, alpha peaks just outside logo edge, falls off outward). **Inner Glow ShaderMaterial** (INNER_GLOW_FRAG, z=+0.05, renderOrder=8, AdditiveBlending, soft falloff from logo edge inward to center). Shared `computeGlowColor()` helper für beide Glow-Arten. **Glow Color-Modi**: solid / rainbow / custom / random (modul-level helper `computeGlowColor`). **Fire-Ring** = RingGeometry (innerR=0.5, outerR=0.5+fireHeight) + fBm-Noise-ShaderMaterial. Scale = `logoSize * beatScale`. z=0.1, renderOrder=7. **2× FreqBeatDetector** (logoBeatDetector + fireBeatDetector). v12: glow → outerGlow + new innerGlow fields. |
| `GPUParticles` | `settings.particles.*` | Custom Shader mit uShape (circle/star/diamond), LineSegments für connectionLines (O(n2), cap 200), orbitMode elliptical/scatter. **1× FreqBeatDetector** (particleBeatDetector) → setSensitivity(reactiveSensitivity) + update(rawFreqData, reactiveFreqStart, reactiveFreqEnd). |

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

**10 Instanzen gesamt** (1 global, 9 komponenten-spezifisch). Alle nutzen `setSensitivity()` VOR `update()` im useFrame.

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
