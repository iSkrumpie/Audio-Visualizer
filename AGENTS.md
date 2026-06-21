# AGENTS.md - AudioVisualizer

Diese Datei ist der **persistente Kontext-Snapshot** für jeden KI-Agenten, der in diesem Projekt arbeitet. Beim Start eines neuen Chats zuerst diese Datei lesen — dann die verlinkten `docs/`-Dateien bei Bedarf.

---

## Docs-Verzeichnis (bei Bedarf laden)

| Datei | Inhalt | Wann laden |
|---|---|---|
| `docs/architecture.md` | §4 komplett: Verzeichnis-Layout, State-Machine, R3F Frameloop, Audio-Datenfluss, Export-Pipeline, Settings-Store, Preset-Store, SettingsPanel-Tabs, Komponenten-Details, Z-Layering, FreqBeatDetector-Inventar | Wenn du die App-Struktur brauchst, eine neue Komponente einbaust, oder verstehen willst wie Teile zusammenhängen |
| `docs/stolpersteine.md` | §6 Bekannte Stolpersteine + §6.1 Export-Preview-Matching + §8 Build-Verifikation | **Immer** wenn eine neue Komponente, ein neuer Effekt oder ein neues Feature implementiert wird — und zusätzlich reaktiv wenn du auf einen Bug stößt, den Export anfasst, oder `typecheck`/`build`-Probleme hast |
| `docs/howto-effects.md` | §5 Konventionen + §7 Hot-Spots + Checklisten: neuer R3F-Shader-Effekt, neuer R3F-Standalone-Effekt, neuer ogl-HTML-Overlay-Effekt | Wenn du einen neuen visuellen Effekt implementierst |

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
- Aktuell gesetzt: `Skrumpie <iskrumpie@gmail.com>` (repo-lokal, **nicht** global).
- User kann das jederzeit mit `git config user.email "..."` (repo-lokal) oder `--global` überschreiben.

### Rollback-Hilfe
- `git log --oneline -n 20` - Historie ansehen.
- `git checkout <hash> -- <pfad>` - einzelne Datei aus altem Stand holen.
- `git revert <hash>` - sicheren Rückwärts-Commit erzeugen (Standard für veröffentlichte/push-bare Stände).
- `git reset --hard <hash>` - **nur auf explizite User-Freigabe**. Im jetzt öffentlichen Repo vorher genau prüfen, was auf `origin` liegt.

### Remote / Publish
- Repo ist **öffentlich auf GitHub**: `https://github.com/Skrumpie/Audio-Visualizer` (war zwischenzeitlich unter `iSkrumpie/...`, wurde umbenannt; GitHub redirected).
- Push-Workflow: `git status` + `git diff --stat` → `git add <files>` → `git commit -m "..."` → `git push origin main`. Force-Push (`--force-with-lease`) nur wenn Remote und Local divergieren (z. B. leerer Initial-Commit auf GitHub).
- Author + Email müssen zu einem GitHub-Account passen, sonst werden Commits nicht dem Profil zugeordnet.
- `.gitignore` deckt `tmp/`, `docs/`, `scripts/`, `AGENTS.md`, `node_modules/`, `dist/`, `.env*` und IDE-Files ab — alles ist **lokal-only** und wird nicht gepusht (auch wenn es auf der Platte existiert).

---

---

## 1. Was ist das?

**AudioVisualizer** ist eine **client-only Single-Page-Webapp**, die eine vom User hochgeladene Audio-Datei in Echtzeit als Three.js-Visualisierung rendert und das Ergebnis als **MP4** exportiert (YouTube oder TikTok, mehrere Qualitätsstufen).

Design-Ziel: "Studio"-Aesthetic (skrumpie.de-inspiriert), Dark-Mode only, vier-Schritt-Workflow (Upload → Configure → Render → Download).

**Kein Backend.** Kein Auth. Kein Tracking. Alles läuft im Browser.

---

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
| E2E            | Playwright (Smoke-/Debug-Skripte in `scripts/`, **lokal-only** — Ordner ist via `.gitignore` ausgeschlossen). Voraussetzung: `npm run dev` läuft auf :5173 + echtes `tmp/Logo.png` für `measure-logo-real.mjs`. Externe Contributors sehen diese Skripte nicht. |

**Target**: `es2022`, `chromium-basierte Browser` (Firefox ungetestet).

**Port**: Vite-Dev `5173` (`strictPort: false`, `open: false`).

---

---

## 3. Wichtige Regeln für den Agenten

### 3.1 `npm run dev` ist tabu
**Nie selbst `npm run dev`, `vite`, `vite preview` o.ä. starten.** Immer nur der User.

Erlaubt: `npm run typecheck`, `npm run build`, `node scripts/*.mjs` (lokal vorhandene Skripte: `test-e2e-v2.mjs`, `measure-logo-fit.mjs`, `measure-logo-real.mjs`, `verify-export.mjs`, `test-fft-only.mjs`, `diagnose-fft-sources.mjs`, `debug-strands.mjs`), `grep`/`rg`, `cat`/`read`, Git-Kommandos.

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

---

## 9. Quick-Reference: User-Frage → Anlaufstelle

- *"Bars drehen sich zu schnell"* → `InstancedBars.tsx` → `rotationRef.current += ...`
- *"Export crasht mit AAC-Fehler"* → `exportEngine.ts` → `findSupportedAacBitrate()`
- *"Export zeigt nur Bars animiert, alles andere statisch"* → `exportEngine.ts` schreibt `audioAnalysis.rawFreqData`? `fft.ts` precomputeFFT liefert rawFreqData (1024 bins)? Sonst sehen alle FreqBeatDetector-Instanzen leere Daten.
- *"Neuer Effekt erscheint im Live-Preview aber nicht im Export"* → Effekt läuft als DOM-Overlay außerhalb des R3F Canvas. Export erfasst nur `gl.domElement`. Fix: Effekt als R3F-Komponente in `AudioScene.tsx` einbauen (Pattern: `MagicRings.tsx`). Kein eigenständiger `WebGLRenderer` / `ogl.Renderer` erlaubt.
- *"Behind Logo funktioniert nicht (Effekt immer vorne/hinten egal wie eingestellt)"* → `mesh.position.z` hat bei `depthTest:false`-Materialien keinen Effekt. Fix: `mesh.renderOrder = behindLogo ? 4 : 9` in `useFrame`. renderOrder=4 = vor Logo-Layern (5-8), renderOrder=9 = nach allem.
- *"In Front zeigt rechteckigen Kasten / Box um das Logo"* → `depthTest:false` fehlt am Material. Logo-Plane schreibt Depth-Buffer (Rechteck); später gerenderter Effekt (renderOrder=9) schlägt Depth-Test im Logo-Rechteck fehl. Fix: `depthTest={false}` zum JSX-ShaderMaterial hinzufügen, bei `useMemo`-Materials `depthTest: false` im Konstruktor. Betraf Session 21: MagicRings + alle drei BackgroundFx-Materials.
- *"`behindLogo`-Toggle hat keinen Effekt (Effekt bleibt immer auf einer Seite)"* → `renderOrder` ist noch im JSX hartkodiert (`<mesh renderOrder={9}>`). React-Reconciler überschreibt den per-Frame gesetzten Wert bei Re-Renders. Fix: `renderOrder` komplett aus JSX entfernen, nur in `useFrame` setzen. Betraf Session 21: alle 6 Overlay-Effekte.
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
- *"FaultyTerminal zeigt nur Schwarz (Shader)"* → `FaultyTerminal.tsx` → `precision mediump float;` führt in WebGL2/GLSL-ES-3.0 zu Precision-Mismatch. Fix: `precision highp float;` — wie alle anderen Shader im Projekt.
- *"FaultyTerminal zeigt nur Schwarz (Digits)"* → `faultyTerminalNoiseAmp` zu niedrig (< ~0.75). Default: 2.0. FBM-Domain-Warping braucht ausreichend Amplitude um Digit-Threshold von 0.1 zu überschreiten.

---

*Stand: Session 24 — FerrofluidEffect + TransportBar-Drag. (1) Neuer R3F Background-Effekt `FerrofluidEffect.tsx` (Domain-distorted Value-Noise Shader, simuliert Ferrofluid-Spitzen; Prefix `ff_`). 3 Farben (`ferrofluidColor0/1/2`), Flow-Direction, Speed, Scale, Turbulence, Fluidity, Rim Width, Sharpness, Shimmer, Glow, Opacity, Behind Logo, Blend Mode, Beat-Reaktivität (Glow-Burst primär, Speed-Burst sekundär). settingsStore v21→v22: 20 neue `ferrofluid*`-Felder. (2) TransportBar: `background: var(--bg-overlay)` + `backdropFilter: blur(16px)` (Design-Match zum SettingsPanel), Draggable via framer-motion `useDragControls` — dedizierter 6-Dot-Grip-Handle initiiert Drag, Seek-Slider und Buttons bleiben normal klickbar, Constraints auf Stage-Container. typecheck + build: OK. Commits: `ea92b80` (TransportBar), `6995b04` (Ferrofluid).*

*Stand: Session 23 — SettingsPanel-Redesign (UI-only, kein Schema-Bump). 4 Änderungen: (1) Panel-Hintergrund auf `background: var(--bg-overlay)` + `backdropFilter: blur(16px)` umgestellt → Canvas scheint beim Einstellen durch. (2) Neuer **Overlays**-Tab zwischen Background und Logo — enthält die 8 vormals in Background-Tab eingebetteten 3D-Overlay-Effekte: Strands, Light Rays, Light Pillar, Lightning, Magic Rings, Weather FX, Hyperspeed, Faulty Terminal. Background-Tab enthält jetzt nur noch Shader/Hintergrund-Optionen: Image, Tint, Beat FX, Vignette, Fog, Glow, Color, Effects. (3) Neue interne Komponente `OverlayCard` in `SettingsPanel.tsx`: zeigt Accent-Border wenn aktiv, Status-Dot, Inline-Toggle, Expand-Chevron — Settings nur sichtbar wenn `expanded && enabled`. Ersetzt `Acc`+`Tg`-Muster für alle 8 Overlay-Effekte. Weather FX als Sonderfall: Master-Toggle schaltet alle 3 Sub-Flags gemeinsam, innen weiterhin 3 `EffectCard`s. (4) Active-Count-Badges auf Tab-Buttons (Pill mit Zahl wenn > 0, Accent-farbig wenn Tab aktiv). Background und Overlays zeigen exakte Anzahl aktiver Effekte; Logo/Bars/Particles zeigen `1` wenn enabled. Keinerlei Änderungen an settingsStore, R3F-Komponenten oder Export-Pipeline. typecheck + build: OK. Commit: `27c9dad`.*

*Stand: Session 22 — FaultyTerminal-Effekt + zwei Bugs gefixt. Neuer R3F Background-Effekt `FaultyTerminal.tsx` (CRT-Terminal-Shader mit prozeduralen Digits, Scanlines, Glitch, Barrel-Distortion; Prefix `ft_`). settingsStore v20→v21: 16 neue `faultyTerminal*`-Felder. Bug 1: `precision mediump float;` im Fragment-Shader → in WebGL 2 / GLSL ES 3.0 Precision-Mismatch mit Three.js's `out highp vec4 pc_fragColor;` → stiller Shader-Kompilierungsfehler → schwarzes Bild. Fix: `precision highp float;`. Bug 2: `faultyTerminalNoiseAmp: 0.5` als Default zu niedrig — FBM-Domain-Warping lieferte Pattern-Werte < 0.1 Digit-Threshold. Fix: Default 2.0, v21-Migration. Beide Bugs in AGENTS.md §9 Quick-Reference dokumentiert. typecheck + build: OK.*

*Stand: Session 21 — Lightning-Effekt, Blend Modes + behindLogo für alle Background-Effekte. Neuer Effekt: `LightningEffect.tsx` (FBM-Noise-Blitz-Shader, Prefix `ltg_`, beat-reaktiv via Intensity-Burst + Scale-Pulse). settingsStore v19: exportierter `BlendMode`-Typ (`'normal'|'add'|'screen'|'multiply'|'darken'|'lighten'|'subtract'`), 12 neue Felder für alle 6 Effekte (Strands/MagicRings/LightRays/LightPillar/Lightning/WeatherFX). Neue Utility `src/lib/blendMode.ts` mit `applyBlendMode(mat, mode)` + `BLEND_MODE_OPTIONS` — per `prevBlendRef` in `useFrame` nur bei Änderung angewendet. SettingsPanel: `<BlendSel>`-Dropdown-Komponente, Position-CB + Blend-Mode-Dropdown in allen 6 Effekt-Accordions. MagicRings + WeatherFX-Partikel/Regen/Schnee bekamen `behindLogo` neu. LightPillar-BlendMode war im Store vorhanden aber nie an die Komponente angebunden — jetzt gefixt. Zwei systemische Bugs gefixt und als Stolpersteine dokumentiert: (1) `depthTest:false` fehlte bei MagicRings und allen drei BackgroundFx-Materials → rechteckiger Box-Cutout um Logo bei `renderOrder>Logo`. (2) `renderOrder` war in JSX hartkodiert bei allen 6 Effekten → React-Reconciler konnte per-Frame-Wert überschreiben. Beide Patterns jetzt in `docs/howto-effects.md` Checkliste B und `docs/stolpersteine.md` dokumentiert. howto-effects.md Schritt 0 um Blend-Mode-Frage erweitert. Commits: feat Lightning (v18), feat blend modes+behindLogo (v19), 3× fix renderOrder/depthTest. typecheck + build: OK.*

*Stand: Session 20 — Export-Fix für DOM-Overlay-Effekte. `LightPillar`, `LightRays` und `Strands` waren standalone DOM-Overlays mit eigenem WebGL-Context (Three.js / ogl). Export-Engine erfasst nur `gl.domElement` (R3F Canvas) → alle drei waren im MP4 unsichtbar. Fix: alle drei in den R3F SceneGraph portiert (Pattern: MagicRings.tsx). `behindLogo`-Verhalten: CSS-Mask-Approach entfernt, jetzt via `mesh.renderOrder` in `useFrame` (depthTest:false macht position.z wirkungslos). renderOrder=4 (vor Logo-Layern 5-8) vs. renderOrder=9 (nach allem). VisualizerStage.tsx: DOM-Overlay-Code, Mask-Refs, rAF-Mask-Loop, logoMaskRadiusRef-Import entfernt. typecheck + build: OK. Release v1.0.0 auf GitHub erstellt.*

*Stand: Session 13 — Erstveröffentlichung auf GitHub. README, LICENSE (MIT), `package.json`-Metadaten erstellt; `.gitignore` deckt `tmp/`, `docs/`, `scripts/`, `AGENTS.md` ab (alle lokal-only). Remote: `https://github.com/Skrumpie/Audio-Visualizer` (war zeitweise `iSkrumpie/...`, GitHub redirected). Author: `Skrumpie <iskrumpie@gmail.com>`. 4 Screenshots in `assets/screenshots/` committed; YouTube-Demo-Links in README. Keine Code-Änderungen am App-Verhalten.*

*Session 12 — Export-Bug **ENDGÜLTIG GELÖST**. Preview und Export sind jetzt visuell + numerisch im Rahmen (SSIM 0.79-0.83, bass Δ ≤ 0.02, energy Δ = 0). Die 5 Root Causes (in Reihenfolge ihrer Auswirkung) waren:*

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