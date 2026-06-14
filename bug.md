# Export-Bug: Animationen reagieren im MP4 kaum/nicht auf Audio

**Status:** OFFEN — noch nicht gefixt. Zuletzt bearbeitet: Session 11 (aktuell).

---

## Symptom

- **Preview:** Hintergrund pulsiert deutlich mit der Musik. Beat-Effekte (Grid-Pulse, Scanlines, Noise-Boost, Scale-on-Beat etc.) reagieren sichtbar auf den Beat.
- **Export (.mp4):** Selbe Settings → Hintergrund reagiert kaum bis gar nicht. Animations-Unterschied ist stark sichtbar.
- **Canvas hinter Export-Modal:** Auch während des Exports (Canvas sichtbar hinter ExportOverlay) sehen die Animationen falsch aus — das Problem liegt im Rendering, nicht im MP4-Encoding.

---

## Was wir in Session 11 herausgefunden haben (Diagnostik)

### Bestätigte Fakten (via Console-Logs)

**AudioBuffer ist korrekt:**
```
arrayBuffer.byteLength: 5067010        ← File korrekt gelesen
AudioContext state: running             ← kein Autoplay-Problem
AudioBuffer: { length: 10511999, sampleRate: 48000, durationSec: '219.00',
               maxAbsFirst2sec: '0.587298' }   ← PCM-Daten sind valide!
```

**FFT-Daten sind korrekt ab Frame 30:**
```
Frame 0-4:   rawFreqData.max=0   ← Stille (Track-Intro)
Frame 30-60: rawFreqData.max=200-247, bass=0.7-0.8  ← KORREKTE DATEN!
```

**BackgroundPlane.useFrame WIRD aufgerufen:**
```
[BG useFrame] exportFrame=29 beatPhase=0.7600  rawData[0-5]=[0,2,0,0,0,0]
[BG useFrame] exportFrame=30 beatPhase=0.7200  rawData[0-5]=[49,43,25,11,16,14]
[BG useFrame] exportFrame=35 beatPhase=0.5200  rawData[0-5]=[55,24,25,48,56,63]
```

**Kritische Beobachtung:** beatPhase läuft von 0.76 auf 0.0 — er ZERFÄLLT nur, feuert aber keine neuen Beats ab Frame 30+.

---

## Zwei bestätigte Root-Causes (gefixt, aber noch nicht vollständig)

### Bug 1: OfflineAudioContext AnalyserNode = Zeros (GEFIXT, Commit `222289e` + `2fe4030`)

**Bestätigt durch:** `rawFreqData.max=0` für ALLE Frames mit dem OfflineAudioContext-Ansatz (Session 10).

**Ursache:** Chrome's `OfflineAudioContext` + `AnalyserNode.getByteFrequencyData()` gibt immer Zeros zurück. Chrome-Bug/Limitation.

**Fix:** Zurück zur custom Cooley-Tukey FFT (Commit `2fe4030`). Die FFT-Daten sind jetzt korrekt (Frame 30+ zeigt max=200-247).

---

### Bug 2: THREE.Clock delta falsch im Export (GEFIXT, Commit `2fe4030`)

**Ursache:** R3F / `THREE.Clock` benutzt intern `performance.now()` für die delta-Berechnung in `useFrame`. Der timestamp-Parameter von `advance()` wird ignoriert. Im schnellen Export-Loop dauert jeder Frame nur ~1-5ms real-time statt 16.67ms → `delta ≈ 0.001s` statt `0.01667s` → alle zeitbasierten Animationen (noise scroll, scanline speed, grid wave, glitch timing, particle orbit, glow cycle) laufen 16x zu langsam → erscheinen eingefroren.

**Fix:** `performance.now()` temporär überschreiben vor jedem `sceneRegistry.advance()`, sofort danach restoren. THREE.Clock bekommt dadurch exakt `1/fps` als delta.

---

### Bug 3: FreqBeatDetector Adaptive-Threshold-Kalibrierung (AKTUELLER FOKUS, noch nicht verifiziert)

**Das ist der verbleibende Kern-Bug.**

**Was passiert:**

Der Export startet bei t=0 (Anfang des Songs). Der Song hat ein leises Intro (~0.5s Stille, Frames 0-29). Irgendwo bei Frame ~24 (0.4s) gibt es einen kurzen Audio-Transient im 20-80 Hz Bereich (sub-bass).

Mit `resetForExport()` (pre-fill = minFlux = 0.005):
1. Threshold ist sehr niedrig (~0.026) → Frame 24 Transient feuert sofort
2. Transient setzt `avgFlux` hoch
3. Ab Frame 30 (echte Musik): flux=0.111-0.140, aber threshold ≈ 0.130-0.160 → **kein Beat feuert mehr!**

Im **Live-Preview**: Detektor hat den ganzen Song gehört → `avgFlux` kalibriert auf die tatsächliche Beat-Intensität → Beats feuern zuverlässig.

**Diagnose-Beweis:**
```
exportFrame=29: beatPhase=0.7600  (beat feuerte bei Frame ~24 wegen kleinem Transient)
exportFrame=30: beatPhase=0.7200  (nur Zerfall, kein neuer Beat trotz rawFreqData.max=240!)
exportFrame=35: beatPhase=0.5200  (immer noch nur Zerfall)
```

**User Settings (aus BG-Log):**
```
beatFxFreq=20-80Hz, sensitivity=3.00, scaleOnBeat=0.02
```

Mit `sensitivity=3.00` ist `effectiveMul = 1.8 × 3.0 = 5.4`. Der Threshold ist besonders hoch und verhindert Beats nach dem initialen Spike.

---

## Was bisher probiert wurde (Session 11 Commits)

| Commit | Was | Ergebnis |
|--------|-----|---------|
| `d9da87a` | OfflineAudioContext + AnalyserNode (Session 10) | rawFreqData.max=0 — Chrome-Bug, funktioniert nicht |
| `222289e` | OfflineAudioContext: silentGain→Serienschaltung | Keine Änderung, OfflineAudioContext grundsätzlich kaputt |
| `2fe4030` | Custom FFT zurück + performance.now() Override für delta | Daten korrekt, delta korrekt — Beats feuern aber immer noch selten |
| `9bc4416` | `FreqBeatDetector.resetForExport()`: pre-fill mit minFlux=0.005 | beatPhase 0.24→0.76 (Verbesserung), aber noch immer kein kontinuierliches Beat-Feuern |
| `3c832a4` | 80-Frame Pre-Warm-Pass aus Song-Mitte + `resetPhaseAndPrevBins()` | **Noch nicht getestet vom User** |

---

## Aktueller Stand (Commit `3c832a4`, noch nicht verifiziert)

### Was der Pre-Warm-Pass macht

```
1. 80 Frames aus Song-Mitte (ca. 50% der Laufzeit) durch advance() schicken
2. useFrame-Callbacks laufen → detector.update() mit echten Mid-Song-Daten
3. fluxHistory kalibriert sich auf die typische Beat-Intensität des Songs
4. resetPhaseAndPrevBins(): nur Phase + prevBins zurücksetzen, fluxHistory behalten
5. Actual Export-Loop startet mit korrekt kalibriertem Detektor
```

**Erwartetes Ergebnis:** beatPhase sollte ab Frame ~30 auf 0.96 springen und dann regelmäßig durch die Musik gefeuert werden.

**Noch zu testen:** User muss Export-Video ansehen und ggf. Console checken.

---

## Was noch unklar ist / mögliche weitere Probleme

### A) Mismatch: Welche Hz-Bins hat der Live-Analyser vs. Export?

**Live-Preview:** `new AudioContext()` ohne sampleRate → System-Default (auf manchen Windows-Systemen 44100 Hz). `binHz = 44100/2048 = 21.53 Hz/bin`.

**Export:** `new AudioContext({ sampleRate: 48000 })` → erzwungen 48000 Hz. `binHz = 48000/2048 = 23.44 Hz/bin`.

Der `FreqBeatDetector` wird mit `new FreqBeatDetector(48000)` instanziiert (hardcoded in allen Komponenten). Er mapped Hz→Bins immer mit 23.44 Hz/bin.

→ **In Live-Preview empfängt der Detektor 44100-Hz-Daten, mapped aber mit 48000-Hz-Bins.** Das führt zu leicht unterschiedlichem Frequenz-Targeting. Für breite Ranges (20-80 Hz) ist der Unterschied gering, könnte aber bei Edge-Cases relevant sein.

**Möglicher Fix:** Live-AudioContext auch auf 48000 Hz zwingen (`new AudioContext({ sampleRate: 48000 })` in `useAudioReactive.ts`) — oder Export-AudioContext mit system-default Rate erstellen.

### B) scaleOnBeat = 0.02 ist sehr klein

Der User hat `scaleOnBeat=0.02`. Das ist nur 2% Zoom auf Beat — sehr subtil. Falls der User primär diesen Effekt meint, könnte der Effekt im Export technisch korrekt sein, aber visuell kaum wahrnehmbar (besonders im 1080p Video vs. kleinerem Preview-Viewport).

→ **Mögliche Folgefrage:** Welche Beat-Effekte sieht der User im Preview genau? Ist es wirklich scaleOnBeat, oder Grid/Noise/Scanlines?

### C) rawData[0-5] in BackgroundPlane ist schwach

Während `rawFreqData.max=240` im Export-Log irgendwo bei hohen Frequenzen liegt, sind die Bins 0-5 (20-117 Hz) in BackgroundPlane's useFrame nur 11-67. Die starke Energie ist bei HÖHEREN Frequenzen.

→ **Wenn der Song wenig Sub-Bass (20-80 Hz) hat**, kann kein Beat bei dieser Frequenz-Einstellung feuern. Weder im Export noch im Preview. Falls der User beatFxFreq auf 20-200 Hz oder breitere Range erweitert, würden mehr Bins einbezogen → höhere Flux-Werte → mehr Beat-Trigger.

---

## Debugging-Plan für morgen

### Schritt 1: Pre-Warm verifizieren (Commit `3c832a4`)

Export starten, Console checken:
```
[BG useFrame] exportFrame=30 beatPhase=???
```
- Wenn `beatPhase ≥ 0.90` bei Frame 30 → Pre-Warm hat kalibriert, neuer Beat gefeuert ✅
- Wenn `beatPhase < 0.80` und weiter Zerfall → Kalibrierung hat nicht geholfen, weiter debuggen

### Schritt 2: Falls Pre-Warm nicht hilft — rawData[0-5] live vs. export vergleichen

In `useAudioReactive.ts` im rAF-Tick temporär loggen:
```typescript
if (audioCtxRef.current && Math.random() < 0.01) { // 1% der Frames
  console.log('[LIVE rawData[0-5]]', Array.from(kickDataRef.current.slice(0,6)));
}
```

Vergleich mit Export-Log (`rawData[0-5]=[49,43,25,11,16,14]`). Wenn Live-Werte deutlich höher → sub-bass spectrum genuinely different.

### Schritt 3: Falls Sub-Bass schwach in beiden (Live + Export) → User Settings prüfen

User sollte beatFxFreq von 20-80 Hz auf z.B. "Bass: 20-250 Hz" oder "Kick: 40-120 Hz" ändern. Die meisten Songs haben mehr Energie bei 40-200 Hz als bei 20-80 Hz.

### Schritt 4: LiveAudioContext sample rate mit Export angleichen

In `useAudioReactive.ts`:
```typescript
const ctx = new Ctor({ sampleRate: 48000 }); // Anstatt new Ctor()
```
→ Gleiche Binauflösung in Live und Export → gleicher Frequenz-Targeting.

### Schritt 5: Falls immer noch falsch — Vollständiger Pre-Warm durch alle Frames

Statt 80 Frames aus Mitte: alle totalFrames durch Pre-Warm schicken (dauert länger, kalibriert aber exakt).

---

## Alle relevanten Dateien

| Datei | Relevanz |
|-------|---------|
| `src/lib/exportEngine.ts` | Export-Loop, FFT-Precompute, Pre-Warm, Detector-Reset |
| `src/lib/fft.ts` | Custom Cooley-Tukey FFT (korrekt, produziert Daten) |
| `src/lib/audioUtils.ts` | `FreqBeatDetector` mit `reset()`, `resetForExport()`, `resetPhaseAndPrevBins()` |
| `src/hooks/useAudioReactive.ts` | Live-rAF-Loop, AudioContext-Erstellung (wichtig: sample rate!) |
| `src/components/three/AudioScene.tsx` | `sceneRegistry`, `useBeatDetectorRegistration`, Typen |
| `src/components/three/BackgroundPlane.tsx` | Lokaler `beatDetector`, `uBeatPhase` Uniform |
| `src/components/three/InstancedBars.tsx` | `barsBeatDetector` |
| `src/components/three/GPUParticles.tsx` | `particleBeatDetector` |
| `src/components/three/CenterLogo.tsx` | `logoBeatDetector`, `fireBeatDetector` |
| `src/components/three/NebulaPlane.tsx` | `nebulaBeatDetector` |

---

## Git-Log der relevanten Session-11-Commits

```
3c832a4  fix(export): beat-detector pre-warm pass                    ← ZULETZT, UNGETESTET
9bc4416  fix(FreqBeatDetector): resetForExport() pre-fills fluxHistory
1601e05  debug: BackgroundPlane.useFrame BG-Diagnostic
ade406b  debug: comprehensive AudioBuffer + frame diagnostics
2fe4030  fix(export): custom FFT zurück + performance.now() delta override
222289e  fix(fft): OfflineAudioContext-Routing (silentGain→series)  ← hilft nicht
d9da87a  feat(export): OfflineAudioContext+AnalyserNode (Session 10) ← Zeros, broken
```

---

## Wichtige Diagnostic-Logs (Referenz für morgen)

### Console-Output mit `resetForExport()` (vor Pre-Warm, Stand Commit `9bc4416`)

```
[EXPORT DEBUG] AudioBuffer: { maxAbsFirst2sec: '0.587298', length: 10511999, sampleRate: 48000 }
[EXPORT DEBUG] Frame 30: rawFreqData.max=240 freqData.max=236 bass=0.700
[BG useFrame] exportFrame=29 beatPhase=0.7600 rawData[0-5]=[0,2,0,0,0,0] beatFxFreq=20-80Hz sensitivity=3.00 scaleOnBeat=0.02
[BG useFrame] exportFrame=30 beatPhase=0.7200 rawData[0-5]=[49,43,25,11,16,14] beatFxFreq=20-80Hz sensitivity=3.00 scaleOnBeat=0.02
[BG useFrame] exportFrame=35 beatPhase=0.5200 rawData[0-5]=[55,24,25,48,56,63] beatFxFreq=20-80Hz sensitivity=3.00 scaleOnBeat=0.02
```

**Fazit aus diesem Log:**
- Daten kommen an (rawData ist non-zero ab Frame 30) ✅
- useFrame wird aufgerufen ✅
- beatPhase zerfällt nur (0.76→0.52 über Frames 29-35), kein neues Feuern ❌
- Grund: Transient bei Frame ~24 hat avgFlux so erhöht dass flux=0.111 (Frame 30) < threshold ≈ 0.130

---

## Noch offene Debug-Ausgaben im Code (entfernen wenn Bug gefixt)

- `src/lib/exportEngine.ts`: `[EXPORT DEBUG]` Logs für Frames 0-4 und 30-60
- `src/components/three/BackgroundPlane.tsx`: `[BG useFrame]` Log für Frames 29-35
- `src/lib/exportEngine.ts`: `window.__exportFrameIdx` global flag

---

## Weitere Ursachen-Hypothesen (Skrumpie, Session 11.5)

Bug 3 (FreqBeatDetector Adaptive-Threshold) ist plausibel, erklärt aber nur die **Beat-Phasen-basierten Animationen** (Background-`uBeatPhase`, Logo-Glow, Fire-Ring, Nebula-Pulse, Bars-Beat-Boost). User-Beobachtung "alle Animationen reagieren schwächer" umfasst aber auch **kontinuierliche** Animationen, die `audioAnalysis.bass/loudness/highs/energy/freqData` lesen — die gar nicht durch den Detektor laufen. Hier die Verdachtsmomente, die `bug.md` noch nicht systematisch prüft:

### H1) `bass`/`loudness`/`highs` werden im Live-Loop zusätzlich manipuliert, im Export aber roh übernommen

**`useAudioReactive.ts:140-141` (Live-Preview):**
```typescript
store.bass = bass;
store.loudness = loudness;
store.highs = highs;
store.energy = Math.min(1, bass * 2 + loudness * 1 + highs * 0.5);
```

**`fft.ts:227` (Export-`precomputeFFT`):**
```typescript
const energy = Math.min(1, bass * 2 + loudness + highs * 0.5);
```

**Unterschied:** Live hat `loudness * 1`, Export hat `loudness` (ohne `*1` — semantisch identisch, OK). ABER: `useAudioReactive.ts:124-126` schreibt zusätzlich `audioAnalysis.bass = bass` etc. — das ist OK für den direkten Three.js-Pfad.

**Wirklich verdächtig:** Im Live-Loop werden `--audio-bright-boost` und `--audio-sat-boost` als CSS-Custom-Properties gesetzt (Zeilen 129-130):
```typescript
const brightBoost = Math.pow(bass, 2.0) * 0.45 + Math.pow(loudness, 2.0) * 0.15;
const satBoost = Math.pow(bass, 1.6) * 1.2 + Math.pow(loudness, 1.6) * 0.4;
```

Das wirkt nur auf CSS-Konsumenten, nicht auf die Three.js-Shader. Trotzdem — **prüfen, ob im Export-Code-Pfad CSS-Vars für irgendwas konsumiert werden, das auf den Canvas durchschlägt** (z.B. wenn die SettingsPanel-CSS-Vars `--accent` etc. den Theme-Tint beeinflusst, der im Shader landet).

### H2) Live-AudioContext nutzt System-Sample-Rate, alle `FreqBeatDetector`-Instanzen sind hardcoded auf 48000

**Code-Beleg:**
- `useAudioReactive.ts:65` — `const Ctor = window.AudioContext || ...; const ctx = new Ctor();` — **kein** `sampleRate`-Argument.
- `BackgroundPlane.tsx:484` — `new FreqBeatDetector(48000)` (hardcoded).
- `CenterLogo.tsx` (vermutlich gleich), `InstancedBars.tsx:74`, `GPUParticles.tsx`, `NebulaPlane.tsx` — alle hardcoded 48000.
- `exportEngine.ts:240` — `new FreqBeatDetector(audioBuffer.sampleRate)` — nutzt die *tatsächliche* Sample-Rate (typisch 48000, weil `new AudioContext({ sampleRate: 48000 })` in Zeile 78 erzwungen wird).

**Was passiert, wenn der User in Windows-System-Sample-Rate 44100 hat:**
- Live: `AnalyserNode` läuft mit 44100 Hz → `binHz = 21.53 Hz/bin` → tatsächliche Frequenz in Bin 4 = 86 Hz
- Detector: `binHz = 48000/2048 = 23.44 Hz/bin` → erwartet in Bin 4 = 94 Hz
- **Detector liest 5-6 Bins zu hoch** → falsche Frequenz wird analysiert → andere Bass-Spitzen, andere Beat-Cadence

**Test:** In Chrome DevTools auf `chrome://media-internals/` die Audio-Rate checken. Wenn != 48000, ist das die Ursache für **mismatchende Beat-Trigger** zwischen Live und Export. Der Export ist korrekt, der Live-Preview ist falsch — oder umgekehrt, je nach Song.

**Fix:** `useAudioReactive.ts:65` → `const ctx = new Ctor({ sampleRate: 48000 });`

### H3) `dpr={Math.min(window.devicePixelRatio, 2)}` schlägt unterschiedlich durch

`AudioScene.tsx:117` setzt das DPR. Im Preview wirkt DPR=2 (typisch auf HiDPI) → Canvas-Backing-Buffer ist 2× so groß wie CSS-Größe. Im Export wird `gl.setPixelRatio(1)` (exportEngine.ts:144) gesetzt.

**Unterschiedliche Konsequenzen:**
- **Shader-Sampling:** `uResolution` uniform wird in `useFrame` mit `state.size` (= CSS-Pixel) gesetzt (BackgroundPlane.tsx:537). Texel-Berechnungen mit `1.0/uResolution` rechnen also in CSS-Pixeln → konsistent.
- **Geometry-Skalierung:** Ortho-Camera-Frustum in CSS-Pixeln, alle Meshes in CSS-Pixeln → konsistent.

**Wahrscheinlich nicht das Problem**, aber **nicht ausgeschlossen**, dass DPR-abhängige Render-Targets oder Postprocessing-Pass-Auflösungen anders samplen. Würde aber normalerweise Schärfe-Unterschiede produzieren, nicht Reaktions-Unterschiede.

### H4) `useFrame`-Callbacks werden in der Reihenfolge registriert — könnte `audioAnalysis.beatPhase` vs. `audioAnalysis.freqData` Race auslösen

`exportEngine.ts:300-307` setzt **pro Frame**:
1. `audioAnalysis.freqData.set(...)` (Zeile 268)
2. `audioAnalysis.rawFreqData.set(...)` (Zeile 269)
3. `audioAnalysis.bass/loudness/highs/energy` (Zeile 270-273)
4. **Globalen** `FreqBeatDetector.update()` (Zeile 287-292) → schreibt `audioAnalysis.beatPhase`
5. `sceneRegistry.advance(timestamp)` (Zeile 312) → triggert alle `useFrame`s

**Reihenfolge im `useFrame` der Komponenten** (ungewiss, weil R3F-Internes):
- **Background-`useFrame`**: ruft `beatDetector.update()` (Component-Instanz, NICHT global) → liest `rawFreqData`, schreibt `uBeatPhase` Uniform. **Nutzt `audioAnalysis.beatPhase` NICHT.**
- **CenterLogo-`useFrame`**: 2 Component-Detectoren → lesen `rawFreqData`, schreiben Logo-Uniforms. **Nutzt `audioAnalysis.beatPhase` NICHT.**
- **InstancedBars-`useFrame`**: `barsBeatDetector.update()` → `barH += beat * 25 * scale`. **Nutzt Component-Phase, nicht global.**
- **GPUParticles-`useFrame`**: `particleBeatDetector.update()` → lesen `rawFreqData`, schreiben Particle-Uniforms. **Nutzt Component-Phase.**

**Aha:** Die 4 Komponenten mit Component-Detektoren hängen **gar nicht** am globalen `audioAnalysis.beatPhase`! Sie haben eigene Phasen.

Der globale `audioAnalysis.beatPhase` wird nirgendwo in einer `useFrame` gelesen (suche-bestätigt: nur in `useAudioReactive.ts:165` als Self-Assignment). Er wird in `useAudioStore.getState().beatPhase` gespiegelt — aber kein Konsument außer dem Debug-Log.

**Konsequenz für Bug 3:** Selbst wenn der globale Detector perfekt funktioniert, **rettet er nicht** Background, Logo, Fire, Bars, Particles. Jeder Component-Detektor hat sein eigenes `prevBins` und `fluxHistory`, sein eigenes `resetForExport()`/`resetPhaseAndPrevBins()`. Bug 3 ist also **6 separate Bugs**, einer pro Detector-Instanz.

**Pre-Warm deckt das schon ab** (Commit `3c832a4`) — wenn er funktioniert, profitieren alle 6 Detektoren. Wenn nicht, muss man pro Detector debuggen.

### H5) `useFrame` schreibt Uniforms aus `getSettings()` — ABER: Settings-Lookup passiert pro Frame, nicht pro Mount

In jeder `useFrame` wird `getSettings()` neu aufgerufen (BackgroundPlane.tsx:502, alle anderen gleich). Das ist OK und kein Re-Render — `getSettings()` ist ein direkter Store-Read.

**ABER:** Es gibt **keinen Re-Subscribe** auf Settings-Änderungen. Wenn der User während des Exports eine Sensitivity ändert, wird sie beim nächsten Frame übernommen. Das ist gewollt.

**Mögliches Problem:** Wenn eine Sensitivity **zwischen dem Zeitpunkt des `precomputeFFT` und dem `useFrame`-Read geändert wird** (z.B. das Settings-Panel ist während des Exports offen), liest der Detector einen anderen Wert als der, mit dem `precomputeFFT` lief. Das beeinflusst nur die Schwellenwert-Logik, nicht die FFT-Daten — also nur Beat-Trigger, nicht kontinuierliche Animationen. **Wahrscheinlich nicht relevant.**

### H6) Hardcoded Reaktivitäts-Faktoren in Shadern sind statisch, nicht aus Settings gelesen

Suche in `BackgroundPlane.tsx` zeigt Faktoren wie `* 0.5`, `* 0.45`, `* 0.3` etc. — das sind Hardcoded Mixer im Shader zwischen `uBeatPhase` (0..1) und der visuellen Größe. Diese sind in **beiden** Pfaden identisch.

ABER: Wenn `uBeatPhase` im Export niedrigere Maximalwerte erreicht als im Live (wegen Bug 3 oder H2), sehen alle so gemixten Effekte im Export schwächer aus — **ohne dass ein Sensitivity-Regler hilft**, weil die Mixer statisch sind.

**Test:** Wenn `audioAnalysis.beatPhase` im Live konstant 0.5-0.95 erreicht, im Export aber nur 0.1-0.4, ist der visuelle Effekt zwangsläufig 2-3x schwächer. Bug 3 fixen sollte das beheben.

### H7) `audioAnalysis.energy` wird im Live-Loop mit anderer Formel berechnet als im Export

**Live (`useAudioReactive.ts:139`):**
```typescript
store.energy = Math.min(1, bass * 2 + loudness * 1 + highs * 0.5);
```

**Export (`fft.ts:227`):**
```typescript
const energy = Math.min(1, bass * 2 + loudness + highs * 0.5);
```

Mathematisch identisch (`loudness * 1` == `loudness`). **Kein Bug, nur Toter Code im Live-Loop.**

### H8) `useAudioReactive` schreibt `--audio-bright-boost` und `--audio-sat-boost` als CSS-Vars, im Export NICHT

Live: Zeilen 129-134 setzen CSS-Custom-Properties auf `document.documentElement`. Diese werden von der **SettingsPanel** (und möglicherweise anderen UI-Elementen) konsumiert.

Export: exportEngine schreibt diese CSS-Vars **nicht**. Während des Exports ist die SettingsPanel vom Export-Overlay überdeckt, also fällt das nicht auf. ABER: wenn die SettingsPanel weiterhin gerendert wird und z.B. **Vignette-Strength** oder **Tint** aus den CSS-Vars liest, könnte das einen subtilen visuellen Unterschied im Modal-Bereich erzeugen.

**Wahrscheinlich nicht relevant für den Canvas-Render.**

### H9) `BackgroundPlane` setzt `uBeatPhase` aus dem Component-Detector, NICHT aus dem globalen

Code-Beleg (BackgroundPlane.tsx:503-504):
```typescript
const beatPhase = beatDetector.update(audioAnalysis.rawFreqData, bg.beatFxFreqStart, bg.beatFxFreqEnd);
// ...mat.uniforms.uBeatPhase.value = beatPhase; (später in der Funktion)
```

Das ist der **Background-spezifische** Beat, frequenzlimitiert auf `bg.beatFxFreqStart/End` und mit `bg.beatFxSensitivity` kalibriert. **Vollständig unabhängig** vom globalen `audioAnalysis.beatPhase`.

**Konsequenz:** Bug 3 betrifft jeden Detector einzeln. Der Pre-Warm-Pass in `exportEngine.ts:227-247` schickt 80 Frames aus Song-Mitte durch `sceneRegistry.advance()` — das ruft **alle** `useFrame`s auf, also aktualisieren sich **alle** Component-Detectoren. Das ist der korrekte Fix-Pfad. Wenn er nicht hilft, dann ist H2 (sample rate) wahrscheinlicher.

### H10) `--beat-glow` CSS-Var wird im Live-Loop gesetzt, im Export NICHT

`useAudioReactive.ts:160-163` setzt `--beat-glow` basierend auf dem globalen `beatPhase`. Im Export schreibt `exportEngine.ts:294` den globalen `beatPhase` in `useAudioStore.getState().beatPhase`, aber **nicht** in die CSS-Var.

**Konsequenz:** Falls irgendein UI-Element `--beat-glow` für Styling nutzt (z.B. die SettingsPanel-Buttons für Beat-Sensitivity), ist das im Export statisch auf seinem letzten Live-Wert. **Wahrscheinlich nicht relevant für den Canvas-Render.**

### H11) `InstancedBars`-Reactivity und `GPUParticles`-Reactivity

`InstancedBars.tsx:75` — `barsBeatDetector.setSensitivity(b.beatSensitivity ?? 1.0)` — das ist der **Beat-Boost**, nicht die kontinuierliche Height-Reaktivität. Die Height-Mapping-Logik (`freqStart/freqEnd` + `reactivity`) liest `audioAnalysis.freqData` direkt, NICHT den Detektor.

**`GPUParticles.tsx:238`** — gleiche Struktur: `particleBeatDetector` für Beat-Boost, `audioAnalysis.freqData`/Orbit-Logik separat.

Diese Komponenten sind also **doppelt exponiert**:
1. **Beat-Boost** (geht durch `FreqBeatDetector` → betroffen von Bug 3 + H2)
2. **Kontinuierliche Animation** (geht durch `freqData`/`bass`/`loudness` → **nicht** betroffen von Bug 3)

**Wenn nur die Beat-Boost-Effekte schwach sind, die kontinuierlichen aber OK → Bug 3 ist die Ursache.**
**Wenn beide schwach sind → H2 (sample rate) oder eine Bug-Variante, die `freqData`/`bass`/`loudness` mitbetreffen würde.**

### H12) Mögliche stille Verfälschung: `live.update()` wird durchschnittlich häufiger aufgerufen als `export.update()`

**Live:** rAF-Tick ≈ 60-120 Hz je nach Refresh-Rate. Manche Browser-Setups throttle rAF auf 60 Hz. Detector bekommt **60 Updates/sec**.

**Export:** `sceneRegistry.advance()` wird mit `fps=60` (oder 30 für manche Presets) aufgerufen → **60 Updates/sec** bei 1080p60, **30 Updates/sec** bei 1080p30.

**Problem:** Der Detektor wurde mit `historyLen=40` (≈ 0.67s bei 60 fps) kalibriert. Bei 30 fps wären 40 Frames = 1.33s. Detector merkt sich `historyLen` als Frame-Count, nicht als Zeit-Count. Das heißt:
- 30-fps-Export mit `historyLen=40` schaut **doppelt so weit in die Vergangenheit** wie der Live-Preview
- `avgFlux` basiert auf einem anderen Zeit-Fenster → andere Beats feuern

**Test:** Welche fps hat der User eingestellt? Wenn 30, ist das ein **echter Bug**. Wenn 60, ist es OK.

**Fix:** `historyLen` müsste zeitbasiert sein, nicht frame-basiert — `Math.round(0.67 * fps)`.

---

## Verdachts-Ranking (was zuerst prüfen)

| # | Hypothese | Wahrscheinlichkeit | Aufwand | Test |
|---|-----------|-------------------|---------|------|
| 1 | H4 (Bug 3 × 6 Detektoren) | **HOCH** | Niedrig (Pre-Warm testen) | Console-Log bei Frame 30 nach Commit `3c832a4` |
| 2 | H2 (sample rate mismatch) | MITTEL | Niedrig (1-Zeilen Fix) | `chrome://media-internals/` checken |
| 3 | H12 (fps-abhängige `historyLen`) | MITTEL bei 30-fps-Export | Mittel | User nach fps fragen |
| 4 | H1/H7/H10 (CSS-Var + `energy` Differenzen) | NIEDRIG | Niedrig | irrelevant für Canvas-Render |
| 5 | H3 (DPR-Mismatch) | NIEDRIG | Niedrig | irrelevant für Reaktivität, nur Schärfe |

**Empfohlene Reihenfolge:**
1. **Pre-Warm verifizieren** (Schritt 1 in `bug.md`). Wenn `beatPhase ≥ 0.90` bei Frame 30 → H4 bestätigt als Hauptursache, alle 6 Detektoren profitieren.
2. Falls Pre-Warm nicht hilft: **H2 testen** (sample rate fixen) und **H12 prüfen** (welche fps).
3. Falls immer noch schwach: **H11-Differenzierung** — fragt den User, ob nur die "Beat-Pulse"-Effekte schwach sind (Background-Pulse, Glow-Pulse, Fire-Ring) oder auch die kontinuierlichen (Bars-Höhe, Particle-Speed, Background-Helligkeit).
