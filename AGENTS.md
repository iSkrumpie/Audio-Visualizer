# AGENTS.md - AudioVisualizer

Diese Datei ist der **persistente Kontext-Snapshot** für jeden KI-Agenten, der in diesem Projekt arbeitet. Beim Start eines neuen Chats zuerst diese Datei lesen - danach erst der Code.

---

## 0. Orchestrator-Regeln (verbindlich für alle Agents)

### 0.1 Rollenverteilung
- **Ich (Haupt-Agent / Orchestrator)** plane, entscheide, verifiziere und kommuniziere mit dem User. **Ich schreibe KEINEN Code selbst.**
- **Jegliche Implementierungs-Arbeit delegiere ich an `worker`-Subagents.** Jeder Worker bekommt einen vollständigen, abgeschlossenen Task mit Kontext, Akzeptanzkriterien und Verifikationsschritten.
- **Worker dürfen ihrerseits Subagents einsetzen** (z. B. `scout` zum Code-Finden, `researcher` für Doku/Recherche, weitere `worker` für isolierte Teilaufgaben). Das ist explizit erlaubt und erwünscht.
- **Triviale 1–2-Schritt-Tasks** (z. B. `git add` + `git commit`, Konsole-Kommandos, Status-Checks) führt der Orchestrator weiterhin **selbst** aus. Das ist **kein** Verstoß gegen 0.1.

### 0.2 Worker-Briefing (Pflicht-Inhalt)
Jeder Worker-Task enthält mindestens:
1. **Ziel** — was genau soll am Ende funktionieren / anders sein.
2. **Betroffene Dateien** — Pfade, ggf. mit Reason "warum" pro Datei.
3. **Constraints** — relevante Regeln aus AGENTS.md (z. B. ANGLE-Prefix-Regel, `frameloop="never"`-Konventionen, Settings-Schema-Bump-Regel).
4. **Verifikation** — wie der Worker **selbst** prüft, dass die Änderung korrekt ist (z. B. `npm run typecheck`, `npm run build`, gezielter `grep`/`read`).
5. **Output-Format** — kurze Zusammenfassung: "geändert: X, Y · verifiziert: typecheck=OK, build=OK · offene Punkte: …".

### 0.3 Verifikation
- Worker verifizieren **selbst** (typecheck, build, grep, read). Erst dann melden sie "fertig".
- Der Orchestrator verifiziert **nach** dem Worker **stichprobenartig oder bei Risiko** erneut, bevor er committed oder dem User Erfolg meldet.

---

## 0.4 Commit-Pflicht (feingranularer Rollback)

**Nach JEDER abgeschlossenen Änderung — egal ob von Orchestrator oder Worker — wird sofort ein Commit gemacht.** Ziel: jederzeit auf jede Zwischenversion zurückrollen können.

### Regeln
- **Granularität:** ein Commit pro logisch trennbarem Änderungsblock (z. B. UI-Section + Library-Helper getrennt, nicht in einem Riesensammel-Commit).
- **Message-Stil:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `perf:`, `test:`. Optional Scope: `feat(InstancedBars): …`.
- **Commits gehören zum Workflow**, nicht zur Höflichkeit. Wird eine Änderung nicht committed, gilt sie als **nicht abgeschlossen**.
- **VOR einer neuen Änderung** immer kurz `git status` + `git diff --stat` prüfen — kein `git add -A` "auf Verdacht". Nur die tatsächlich von der aktuellen Änderung betroffenen Dateien stagen.
- **Vor destruktiven Operationen** (`reset --hard`, `clean`, Branch-Löschung) **immer** beim User rückfragen.
- **WIP-Stände** dürfen als `wip: …`-Commit committed werden, wenn ein Rollback-Punkt gebraucht wird. Vor dem nächsten Feature-Commit dann `git reset --soft HEAD~1` und neu squaschen.

### Standard-Workflow
1. Worker liefert fertige, selbst-verifizierte Änderung.
2. Orchestrator prüft `git status` / `git diff --stat`.
3. Orchestrator erstellt **einen** passenden Commit (Conventional-Commits-Format).
4. Bei mehreren unabhängigen Änderungsblöcken: **mehrere** Commits hintereinander, jeder mit eigenem Type/Scope.

### Author
- Aktuell gesetzt: `Skrumpie <skrumpie@local>` (lokal-only, **nicht** global).
- User kann das jederzeit mit `git config user.email "…"` überschreiben (repo-lokal reicht).

### Rollback-Hilfe
- `git log --oneline -n 20` — Historie ansehen.
- `git checkout <hash> -- <pfad>` — einzelne Datei aus altem Stand holen.
- `git revert <hash>` — sicheren Rückwärts-Commit erzeugen (bevorzugt bei veröffentlichtem/push-barem Stand).
- `git reset --hard <hash>` — **nur auf explizite User-Freigabe**, in diesem rein lokalen Repo aber unkritisch.

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
| PostFX         | **BackgroundPlane.tsx Shader** (alle BG-Effekte inline in GLSL) — `@react-three/postprocessing` installiert aber inaktiv (PostFX.tsx = Stub) |
| Encoding       | **mediabunny** (WebCodecs-Wrapper) - H.264 + AAC          |
| Audio-Analyse  | Native Web Audio API (eigener Dual-Analyser)              |
| State          | zustand 5 (drei Stores: audio, settings, presets - alle mit `persist`) |
| Styling        | **Tailwind v4 CSS-first** (`@tailwindcss/vite`, KEINE `tailwind.config.ts`) |
| Shader-Imports | `vite-plugin-glsl` (`.vert` / `.frag` als ESM-Strings)    |
| Noise          | simplex-noise 4 (im Nebula-Shader, via Ashima Arts 2D)    |
| E2E            | Playwright (nur in `scripts/`, keine Test-Framework-Setup) |

**Target**: `es2022`, `chromium-basierte Browser` (Firefox ungetestet).

**Port**: Vite-Dev `5173` (`strictPort: false`, `open: false`).

---

## 3. Wichtige Regeln für den Agenten

### 3.1 `npm run dev` ist tabu
**Nie selbst `npm run dev`, `vite`, `vite preview` o.ä. starten.** Immer nur der User.

Erlaubt: `npm run typecheck`, `npm run build`, `node scripts/*.mjs`, `grep`/`rg`, `cat`/`read`, Git-Kommandos.

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
├── index.css                # Tailwind v4 import, Design-Tokens, Theme-Vars
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
│   └── three/
│       ├── AudioScene.tsx       # <Canvas> frameloop="never", advance() via sceneRegistry
│       ├── BackgroundPlane.tsx  # ALLE Hintergrund-Effekte im GLSL-Shader (nur BG-Layer!):
│       │                        # blur, sharpen, CA, bloom, noise, scanlines, glitch,
│       │                        # pixelation, dot, grid, sepia, colorAvg,
│       │                        # hueShift, brightness, contrast, saturation, vignette, tint
│       ├── InstancedBars.tsx    # Radial-FFT-Bars + optionale Peak-Dots (2. InstancedMesh)
│       ├── GPUParticles.tsx     # THREE.Points + THREE.LineSegments (connection lines)
│       │                        # Shapes: circle/star/diamond, ColorModes: solid/rainbow/custom/random
│       ├── CenterLogo.tsx       # Logo: immer circle, ShaderMaterial Glow-Plane, Fire-Ring (fBm Procedural)
│       ├── NebulaPlane.tsx      # fBM-Simplex-Noise-Fog + nebulaScale/offsetX/offsetY
│       ├── PostFX.tsx           # PERMANENTER STUB — gibt immer null zurück
│       └── shaders/
│           ├── nebula.vert
│           └── nebula.frag
│
├── hooks/
│   ├── useAudioReactive.ts  # Dual-Analyser (visual=256 smoothed, kick=2048 raw)
│   │                        # rAF-Tick ruft sceneRegistry.advance() → treibt R3F-Frame
│   ├── useFileUpload.ts     # Validierung (Audio 2 GB / Image 100 MB) → store
│   └── useTheme.ts          # Mirror settings.theme.mode → document.documentElement.dataset.theme
│
└── lib/
    ├── audioStore.ts        # zustand: Files + Volume + ErrorMessage + Analysis-Felder
    ├── audioUtils.ts        # getFreqRangeEnergy() — Hz→Bin-Mapping
    │                        # FreqBeatDetector — Spectral-Flux Onset-Detection (pro Komponente eine Instanz)
    ├── settingsStore.ts     # zustand + persist(key='audiovisualizer:settings:v8', v=8)
    ├── presetsStore.ts      # zustand + persist(key='audiovisualizer:presets:v1')
    ├── exportEngine.ts      # Mediabunny-MP4-Pipeline + AAC-Bitrate-Probe
    ├── exportPresets.ts     # YouTube + TikTok Preset-Definitionen
    ├── fft.ts               # Offline-Cooley-Tukey-FFT für Export
    ├── workflowGradient.ts  # 4-Stop-Color-Helper (cyan→violet→pink→orange)
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
- `sceneRegistry` hat vier Felder: `gl`, `scene`, `camera`, `advance`.

### 4.4 Datendfluss Audio

```
User-Upload → audioStore.setAudio(file) → useAudioReactive-useEffect
  → createMediaElementSource
    ├─→ AnalyserNode (fft 256, smooth 0.55) → "visual"
    │     → audioAnalysis.freqData    (128 bins, ~172 Hz/Bin) → Bars, Particles (Farben)
    │     → audioAnalysis.bass/loudness/highs
    └─→ AnalyserNode (fft 2048, smooth 0.0) → "kick"
          → audioAnalysis.rawFreqData (1024 bins, ~21.5 Hz/Bin) → FreqBeatDetector
          → audioAnalysis.beatPhase   (decaying 0..1, hardcoded 60-120Hz kick)

Jeder rAF-Tick:
  → schreibt in audioAnalysis (mutable, von useFrame gelesen)
  → ruft sceneRegistry.advance() → R3F-Frame
```

**Three.js-Komponenten lesen NIE aus zustand für per-Frame-Daten.** Immer `audioAnalysis` direkt + `getSettings()`.

**`audioAnalysis.rawFreqData`** — WICHTIG: Immer für `FreqBeatDetector.update()` verwenden, NICHT `freqData`. Die geglätteten `freqData` (smoothing=0.55) verschlucken Transienten → Beat-Detection feuert nie.

### 4.5 Export-Pipeline (`src/lib/exportEngine.ts`)

```
exportMP4(file, options)
  1. AAC-Bitrate-Probe  → AudioEncoder.isConfigSupported() mit [audioBitrate, 320k, 256k, 192k, 128k]
  2. decode   → AudioBuffer (48kHz)
  3. analyze  → precomputeFFT() → Array<{freqData, bass, loudness, highs}> (1/frame)
  4. Renderer resize auf Zielauflösung, Camera anpassen
  5. render   → pro Frame: audioAnalysis setzen + sceneRegistry.advance(timestamp)
                videoSource.add(timestamp, 1/fps)
  6. audio    → audioSource.add(audioBuffer)
  7. finalize → output.finalize() → Blob
  8. restore  → Renderer-Size + Camera zurücksetzen
```

**Export-Presets** (`src/lib/exportPresets.ts`):
- YouTube: 1080p@60 (12Mbps), 1080p@30 (8Mbps), 1440p@60 (24Mbps), 1440p@30 (16Mbps), 4K@30 (45Mbps)
- TikTok: 1080×1920 Portrait @60 (10Mbps), @30 (10Mbps)

### 4.6 Settings-Store (localStorage)

- Key: `audiovisualizer:settings:v8`
- `version: 8`, `migrate: () => DEFAULT_SETTINGS` → bei Schema-Bump alles wipen
- **Gruppen:**

| Gruppe | Inhalt |
|--------|--------|
| `theme` | `mode`, `accent`, `secondary` (Palette-Farben, kein eigener Tab) |
| `background` | blur, brightness, saturation, contrast, hueShift, sharpen, tint (color/opacity/mode), **beatFxFreqStart/beatFxFreqEnd** (Hz-Slider, ersetzt altes beatFxSource-Enum), scaleOnBeat (0..0.5), vignette (enabled/strength), nebula (enabled/intensity/color1/color2/driftSpeed/reactivity/**scale/offsetX/offsetY**), PostFX: bloom (enabled/intensity/threshold), CA (enabled/offset), noise (enabled/intensity/**speed/beatReactivity**), scanlines (enabled/density/**speed/beatReactivity**), **glitch (enabled/delay/strength/beatReactivity)**, sepia (enabled/intensity), pixelation (enabled/granularity/**beatReactivity**), dotscreen (enabled/scale/**speed/beatReactivity**), grid (enabled/scale/**speed/beatReactivity**), colorAvg (enabled) — **kein hueSat, kein BC** (=doppelt mit Image-Reglern, entfernt) |
| `logo` | enabled, size (80-**1600**), opacity, beatScaleStrength, glow (enabled/intensity/color/size/**glowBlur**), **fire (enabled/intensity/color1/color2/speed/beatReactivity)** — shape/cornerRadius/rotation/ring entfernt, Logo ist immer circle |
| `bars` | enabled, count, thickness, lengthScale, innerRadius, rotationSpeed, rotationOnBeat, colorMode (**solid/rainbow/custom/random**), solidColor, **customColors** (string[]), **customFreqBoundaries** (number[]), reactivity, freqStart, freqEnd, opacity, minHeight, gapSize, smoothing, peakEnabled, peakDecay — mirror entfernt |
| `particles` | enabled, count, size, orbitRadius, speed, spread, kickBurstStrength, opacity, sizeOnBeat, colorMode (**solid/rainbow/custom/random**), **solidColor**, **customColors** (string[]), **customFreqBoundaries** (number[]), orbitMode (circular/elliptical/scatter), ellipseRatio, **reactiveFreqStart/reactiveFreqEnd** (Hz-Slider, ersetzt reactiveAxis-Enum), particleShape (circle/star/diamond), blendMode, connectionLines, connectionDistance, connectionOpacity, twinkle, twinkleSpeed — monoColor/reactiveAxis entfernt |

### 4.7 Preset-Store (localStorage)

- Key: `audiovisualizer:presets:v1`
- Jedes Preset: `{ id, name, createdAt, settings: Settings }`
- UI: Dropdown (auto-load bei Auswahl) + "Save"-Button (expandiert Name-Input) + Trash-Icon

### 4.8 SettingsPanel - Tab-Struktur

**4 Tabs**: Background · Logo · Bars · Particles

Jeder Tab nutzt **Accordion-Sections** (`<Acc label="...">`) - nur eine auf einmal aufklappbar.

| Tab | Accordions |
|-----|-----------|
| Background | Image · Tint · Beat FX (**freqStart/freqEnd Hz-Slider**) · Vignette · Nebula/Fog (Scale+Offset) · Glow FX · Color FX (CA, Sepia, ColorAvg) · Stylize (Noise+anim, Scanlines+anim, Glitch+Controls+beatReactivity, Pixelation+beatReactivity, DotScreen+anim, Grid+anim) |
| Logo | Size · Glow (mit glowBlur) · **Fire Ring** · Animation |
| Bars | General · Shape · Frequency · Animation · Size & Radius · Peaks · **Custom Colors** (bei colorMode=custom) |
| Particles | General · Shape & Size · Orbit · Physics (**reactiveFreqStart/End Hz-Slider**) · Connections · Flicker · **Custom Colors** (bei colorMode=custom) |

**Preset-Bar** sitzt zwischen Header und Tabs: `[Dropdown ▼] [🗑] [Save]` + optionales Name-Input.

**UI-Primitives** in SettingsPanel.tsx (alle intern, nicht exportiert):
- `FR({ label, hint?, sub?, children })` - Field Row
- `Sl({ value, min, max, step, onChange })` - Range Slider
- `CP({ value, onChange })` - Color Picker mit EyeDropper-Button (Chrome 95+)
- `CB<T>({ value, options, onChange })` - Segmented Buttons
- `Tg({ value, onChange, label })` - Toggle Switch
- `Acc({ label, defaultOpen?, children })` - Accordion
- `EffectCard({ label, enabled, onToggle, children? })` - PostFX-Card mit Toggle
- `CustomColorEditor({ colors, boundaries, onChange })` - Editor für custom Farb-Zonen (Bars + Particles)
- `useF(group, key)` - gibt `[value, setter]` zurück, kein Rerender-overhead für Three.js

### 4.9 Three.js Komponenten - Was macht was

| Komponente | Liest Settings aus | Besonderheiten |
|-----------|-------------------|----------------|
| `BackgroundPlane` | `settings.background.*`, `settings.theme.mode` | Alle Hintergrund-Effekte im GLSL-Shader. NUR Hintergrund betroffen. useFrame hat `delta` für `uTime` (Noise/Glitch). ANGLE-Variablen-Prefix-Regel! **1× FreqBeatDetector** (useMemo) für Beat FX → liest rawFreqData. Bloom: 9×9 2D Gaussian Kernel, 1-Texel-Stride. |
| `NebulaPlane` | `settings.background.nebula*` | fBM-Simplex-Fog, 2 Farben, audio-reaktiv, **nebulaScale + nebulaOffsetX/Y** |
| `PostFX` | — | **Permanenter Stub**, immer `null`. Kein EffectComposer. |
| `InstancedBars` | `settings.bars.*` | MAX_BARS=256, 2. InstancedMesh für Peak-Dots, freqStart/freqEnd remappt FFT-Bins; colorMode custom/random per-Bar-Color via Instanced Attribute. Beat via `audioAnalysis.beatPhase` (hardcoded Kick). |
| `CenterLogo` | `settings.logo.*` | Immer circle; canvas-Circular-Mask; **ShaderMaterial Glow-Plane** (CircleGeometry 64seg, radial falloff + edge-fade smoothstep, glowBlur uniform); **Fire-Ring** = RingGeometry + fBm-Noise-ShaderMaterial. **2× FreqBeatDetector** (logoBeatDetector + fireBeatDetector) → lesen rawFreqData. |
| `GPUParticles` | `settings.particles.*` | Custom Shader mit uShape (circle/star/diamond), LineSegments für connectionLines (O(n2), cap 200), orbitMode elliptical/scatter. **1× FreqBeatDetector** (particleBeatDetector) → liest rawFreqData für reactiveFreqStart/End. |

### 4.10 Z-Layering (von hinten nach vorne)

```
-10  BackgroundPlane   (alle BG-Effekte im Shader)
 -8  NebulaPlane
 -5  InstancedBars (renderOrder=3)
-3.1 GPUParticles LineSegments (renderOrder=3)
 -3  GPUParticles Points (renderOrder=4)
  0  CenterLogo mesh (renderOrder=6)
 -0.05 Glow-Plane ShaderMaterial (radial falloff, renderOrder=5)
  0.05 Fire-Ring RingGeometry ShaderMaterial (renderOrder=7)
     PostFX = stub, kein EffectComposer
```

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
- **Aktueller Storage-Key**: `audiovisualizer:settings:v8` — bei nächster Schema-Änderung auf `v9` bumpen.
- **🔴 ANGLE/Windows GLSL-Regel (KRITISCH)**: ANGLE (Chromes WebGL auf Windows) akzeptiert KEINE gleichen Variablennamen in parallelen `if/else`-Blöcken oder Schleifen in derselben Funktion → stiller Shader-Compile-Fehler → schwarzes Bild. **Regel für BackgroundPlane.tsx**: `vec2 ts` einmalig am Anfang von `void main()`, jeder Block/Loop hat eindeutigen Prefix: bl=blur, sh=sharpen, ca=CA, bm=bloom, ns=noise, sc=scanlines, dt=dot, gd=grid, pix=pixelation, gl_=glitch, cg=color grading, tnt=tint, vg=vignette, gr=gradient.
- **BackgroundPlane = alle BG-Effekte**: PostFX.tsx ist permanenter Stub. Alle Background-Tab-Effekte laufen im `BackgroundPlane`-Shader → betreffen nur Hintergrund-Layer.
- **Dual-Analyser-Init idempotent**: `if (sourceRef.current) return` - sonst "InvalidStateError: already connected".
- **FFT-Band-Mapping** in `fft.ts` und `useAudioReactive.ts` muss identisch bleiben (bass: 0..5, highs: 60..end).
- **Peak-Dots in InstancedBars**: zweites InstancedMesh (`peakMeshRef`) - `visible` wird per `peakEnabled` gesteuert.
- **connectionLines cap**: Bei aktivierten Connection Lines werden max 200 Partikel verarbeitet (O(n2) Distance-Check).
- **Logo ist immer circle** — `LogoShape`-Type und `shape`/`cornerRadius`/`rotation`/`ring`-Settings wurden in v8 entfernt. Kein square/rounded-Codepfad mehr.
- **Fire-Ring Shader**: Inline fBm-Noise-GLSL in `CenterLogo.tsx`. ANGLE-Prefix-Regel gilt auch dort (`fr_` Prefix für alle lokalen Variablen im Fire-Fragment-Shader).
- **getFreqRangeEnergy**: In `audioUtils.ts` — mappt Hz-Bereich auf FFT-Bin-Indizes. Für kontinuierliche Energie-Werte (z.B. Farben). Für Beat-Detection immer `FreqBeatDetector` verwenden.
- **FreqBeatDetector** (`audioUtils.ts`): Spectral-Flux Onset-Detection. Misst positive Energie-Änderungen zwischen Frames (nicht Absolutwert), normalisiert per Bin-Count. Funktioniert für jede Bandbreite (20-100 Hz schmal genauso wie 20-16000 Hz breit). **Muss rawFreqData (1024 Bins, kick analyser) bekommen** — niemals freqData (geglättet, 128 Bins). Jede Komponente erstellt ihre eigene Instanz via `useMemo(() => new FreqBeatDetector(), [])`. `detector.update(rawFreqData, startHz, endHz)` → gibt decaying Phase 0..1 zurück. `detector.energy` → gibt aktuelle Roh-Energie zurück.
- **rawFreqData vs freqData**: `audioAnalysis.rawFreqData` = kick analyser (fftSize=2048, smoothing=0, 1024 Bins). `audioAnalysis.freqData` = visual analyser (fftSize=256, smoothing=0.55, 128 Bins). Für Beat-Detection IMMER rawFreqData — geglättete Daten verschlucken Transienten und die Detection feuert nie.
- **Bloom-Shader**: 9×9 2D Gaussian Kernel mit 1-Texel-Stride und σ≈2. KEINE separable Two-Pass-Lösung im Single-Fragment-Shader — das erzeugt Kreuz/Linien-Artefakte.
- **Glow-Plane**: CircleGeometry (64 Segmente) statt PlaneGeometry — verhindert sichtbare Rechtecks-Kanten. Shader hat zusätzlich `smoothstep(0.7, 1.0, dist)` Edge-Fade.
- **ThemeToggle.tsx** existiert noch als Datei, wird aber nirgends mehr verwendet (weder in TransportBar noch in Uploader). Kann irgendwann gelöscht werden.
- **`workflowColorAt` liest CSS-Vars** — wird nicht mehr in Bars/Particles verwendet (colorMode 'workflow-gradient' entfernt), noch in workflowGradient.ts vorhanden.
- **EyeDropper-API**: Typ-Deklaration in `vite-env.d.ts` (nicht in TypeScript DOM lib enthalten). Nur Chrome 95+.

---

## 7. Häufige Operations-Hot-Spots

| Was passieren soll | Datei |
|---|---|
| Hintergrund-Effekt ändern (Blur, Tint, Bloom, CA, etc.) | `BackgroundPlane.tsx` Shader + Uniforms in useFrame + `settingsStore.background` |
| Neuen Hintergrund-Effekt hinzufügen | `BackgroundPlane.tsx` erweitern — ANGLE-Prefix-Regel beachten! |
| Bars-Settings | `InstancedBars.tsx` + `settingsStore.bars` |
| Partikel-Settings | `GPUParticles.tsx` + `settingsStore.particles` |
| Logo-Settings | `CenterLogo.tsx` + `settingsStore.logo` |
| Logo Fire-Ring | `CenterLogo.tsx` → fire ShaderMaterial + `settingsStore.logo.fire.*` |
| Logo Glow (ShaderMaterial) | `CenterLogo.tsx` → glow ShaderMaterial + `settingsStore.logo.glow.glowBlur` |
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
node scripts/<name>.mjs   # Playwright-Smoketest (braucht laufenden Dev-Server vom User)
```

---

## 9. Quick-Reference: User-Frage → Anlaufstelle

- *"Bars drehen sich zu schnell"* → `InstancedBars.tsx` → `rotationRef.current += ...`
- *"Export crasht mit AAC-Fehler"* → `exportEngine.ts` → `findSupportedAacBitrate()`
- *"Export zeigt statisches Bild"* → `exportEngine.ts` → `sceneRegistry.advance(timestamp)` vorhanden? Canvas `frameloop="never"` korrekt?
- *"Beat trifft nicht (hardcoded Kick)"* → `useAudioReactive.ts` (HISTORY_LEN, 1.6×, 0.12 threshold)
- *"Konfigurierbarer Beat reagiert nicht"* → Prüfen: 1) `rawFreqData` (nicht `freqData`) an `FreqBeatDetector.update()` übergeben? 2) FreqBeatDetector-Instanz via `useMemo` erstellt (nicht inline new)? 3) Hz-Range sinnvoll (zu breit → Spectral Flux verdünnt, zu eng → zu wenige Bins)?
- *"Logo ist gestreckt"* → `CenterLogo.tsx` → canvas `drawImage` Cover-Logik
- *"Settings werden nicht gespeichert"* → `settingsStore.ts` Version-Bump + neuer Key
- *„Blur sieht kachelig aus“* → `BackgroundPlane.tsx` Shader → BLUR_SIGMA=2.0 (Modul-Konstante), blurStride=blur/(3×BLUR_SIGMA)
- *"Partikel haben keine Verbindungslinien"* → `GPUParticles.tsx` → `connectionLines` setting + LineSegments
- *"Export-Preset fehlt"* → `exportPresets.ts` → `EXPORT_PRESETS` Array

---

*Stand: Session 5 — settingsStore v8. Alle Hz-basierten Beat-Effekte auf `FreqBeatDetector` (Spectral-Flux Onset-Detection) umgestellt. `audioAnalysis.rawFreqData` (kick analyser, 1024 Bins, smoothing=0) exponiert und als einzige Datenquelle für Beat-Detection verwendet. `FreqBeatDetector`-Instanzen: 1× BackgroundPlane, 2× CenterLogo (logo + fire), 1× GPUParticles. Bloom-Shader auf korrekten 9×9 2D-Gaussian-Kernel (1-Texel-Stride) korrigiert. Glow-Plane auf CircleGeometry (64 Seg) + Edge-Fade umgestellt. Session 4: settingsStore v8, Hz-Slider, Logo-Vereinfachung, Fire-Ring, Custom Colors, Stylize-Animationen.*

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

**Erinnerung:** Nach jeder Änderung committen — Details in **§ 0.4** (Commit-Pflicht).
