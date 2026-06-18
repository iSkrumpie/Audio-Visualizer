# AudioVisualizer — Stolpersteine & Build-Verifikation

> Geladen von `AGENTS.md` bei Bedarf. Enthält bekannte Bugs/Fallen + Build-Skripte.

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
- **🔴 FFT-Pipeline muss Web-Audio-konform sein** (Session 9): Wenn die Export-FFT vom Web-Audio-Algorithmus abweicht, reagieren alle Spektrum-basierten Animationen im MP4 anders als im Preview. Die 6 kritischen Übereinstimmungen sind: Blackman-Window (nicht Hann), 1/N-Scaling (NICHT vergessen — mein Commit `9fe1ec7` hatte das fälschlich entfernt), `[-100, -30] dB` → `[0, 255]` Mapping (nicht `[-100, 0]`), Trailing-Window (nicht centered), Inter-Frame-EMA-Smoothing, Mono-Downmix über alle Kanäle. **Die Web Audio Reference-Implementation ist Chromium `third_party/blink/renderer/modules/webaudio/realtime_analyser.cc`.** (→ docs/stolpersteine.md §6.1)
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