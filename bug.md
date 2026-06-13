# Export-Bug: Background, Bars, Particles reagieren im MP4 schwächer als im Preview

**Status:** GELÖST — Commit `d9da87a` (Session 10).

**Symptom (Stand Session nach Commit `1704883`):**
- Preview: Background-Beat-Animationen (Grid-Pulse, Scanline-Beat, Noise-Boost, Glitch-on-Beat, Pixelation, Dot-Scale, Background-Scale) pulsieren sichtbar.
- Export (.mp4): selbe Settings → Background "bewegt sich kaum bzw. nicht mal ansatzweise so viel wie im Preview". Bars und Particles reagieren ebenfalls weniger stark.
- Die im Vorfeld gefixten Bugs (Sample-Rate, FFT-Normalisierung, dB-Mapping, Window-Funktion) sind also nicht die alleinige Ursache — oder es gibt weitere, noch nicht gefundene Abweichungen.

---

## 1. Was bisher gefixt wurde (zur Sicherheit nochmal kurz)

| Commit | Was |
|--------|-----|
| `c109b84` | `useAudioReactive` rAF-Loop wird im Export gestoppt (Race-Condition) |
| `9fe1ec7` | FFT-Normalisierung + Sample-Rate + Resolution-Sync + Window-Center |
| `cc53978` | Canvas-Backing-Buffer pro Frame auf Export-Größe gepinnt |
| `dde5c3c` | `useFrame` liest `state.size` live statt aus Closure |
| `d2a3274` | Component-Detectoren werden vor Export-Start resettet |
| `1704883` | FFT-Pipeline an Web Audio AnalyserNode angeglichen (Blackman + 1/N + [-100,-30] dB + Trailing-Window + Smoothing + Downmix) |

Trotzdem: Background reagiert im MP4 zu schwach.

---

## 2. Verbleibende Hypothesen (in Reihenfolge der Plausibilität)

### H1 (HOCH): `state.size` ist im Export-Loop weiterhin der Preview-Wert

**Vermutung:** Trotz `sceneRegistry.setSize(width, height)` (was `r3fSetSize` ruft) und trotz `state.size` jetzt im useFrame live gelesen wird, ist `state.size` zum Zeitpunkt des useFrame-**Aufrufs** möglicherweise doch noch der Preview-Wert.

**Warum:** `sceneRegistry.setSize` ruft synchron `r3fSetSize(w, h)`, was R3F's `state.size` setzt. R3F-subscribe feuert synchron `gl.setSize(w, h, true)` → setzt CSS-Style. ResizeObserver feuert **asynchron** (microtask) und misst `getBoundingClientRect()`. Wenn der Parent clippt, schreibt Observer `state.size` auf einen **falschen** (clipped) Wert zurück. Der nächste `useFrame`-Aufruf liest diesen clipped Wert.

**Mein Fix `dde5c3c` pinnt `state.size` JEDES Frame VOR `advance()`.** Das sollte funktionieren, **AUSSER** wenn der Resize-Observer **zwischen** `r3fSetSize` und `useFrame` (innerhalb desselben synchronen Blocks) feuert. ResizeObserver ist async (microtask), das geht eigentlich nicht. **Aber:** R3F's `react-use-measure` nutzt eine **eigene** Resize-Mechanik; möglicherweise ist die synchroner als angenommen.

**Test:** Im Export einen `console.log(state.size)` im Background-`useFrame` einbauen und prüfen, ob der Wert die Export-Auflösung hat.

### H2 (HOCH): `audioAnalysis.rawFreqData` wird im Export-Loop mit Werten gefüttert, die im **Byte-Bereich** niedriger sind als Live

**Vermutung:** Selbst mit korrektem Web-Audio-Mapping ist der **durchschnittliche** Byte-Wert im Live-Stream höher als im Export.

**Warum:** 
- Live: `getByteFrequencyData` liefert Werte aus `[0, 255]`, die dem Web-Audio-dB-Mapping entsprechen.
- Export: `extractFFTFrame` macht das theoretisch auch.
- **ABER:** Web Audio's `AnalyserNode` arbeitet auf einem **Live-Ring-Buffer** mit 2× `kMaxFFTSize` (65536) Samples. Die letzten `fftSize` Samples werden für die FFT genommen — also trailing. Mein Code macht das auch.
- **ABER:** Im **Live-Stream** kommen kontinuierlich Samples in den Ring-Buffer, sodass `getByteFrequencyData` zu **jedem** Zeitpunkt ein "frisches" Spektrum hat. Im **Export** wird `audioBuffer.getChannelData(c)` direkt gesampelt — keine Ring-Buffer-Mechanik. Wenn der Sample `time = 0` ist, ist `endSample = 0`, `startSample = -fftSize`, alle Samples sind 0 → Spektrum ist 0. **Frame 0 hat ein "leeres" Spektrum** (im Web-Audio-Sinn).
- Bei Frame 1 (`time = 1/60s`): `endSample = 800`, `startSample = -1248` (für fftSize=2048). Samples `[0..800]` aus Audio, davor 0. Spektrum hat Inhalt, aber **die ersten 1248 Samples sind 0** → asymmetrisches Spektrum mit DC-Bias.

**Konsequenz:** Der **erste Frame** hat ein "leeres" Spektrum. Die nächsten ~21 ms (fftSize/2 bei 48kHz) haben ein asymmetrisches Spektrum. Das könnte den **durchschnittlichen** Magnitude-Level drücken.

**Test:** Im Export `audioAnalysis.rawFreqData` über die ersten 100 Frames loggen und mit Live-Werten vergleichen.

### H3 (MITTEL): `FreqBeatDetector.update()` adaptive Threshold ist auf den Live-Stream-Mittelwert trauriert, nicht auf Precomputed

**Vermutung:** Der `fluxHistory` Rolling-Average ist ein EMA auf 40 Frames. Nach meinem `d2a3274`-Fix wird er resettet. Aber **die ersten ~40 Frames** des Exports haben einen anderen Statistik-Mittelwert als der Live-Stream nach längerem Hören.

**Warum:** Wenn das Audio leise Passagen am Anfang hat (typisch für Musik), ist `flux` klein. Detector triggert nicht oder selten. Erst wenn laute Passagen kommen, normalisiert sich das.

**Test:** `globalBeatDetector.fluxHistory` loggen, vergleichen mit typischen Live-Werten.

### H4 (MITTEL): `useFrame` läuft im Export mit `delta = 1/fps = 16.67ms` konstant, im Preview ist `delta` variabel

**Vermutung:** Im Live-Preview ist `delta` variabel je nach Browser-Load (14-22ms typisch). Das beeinflusst:
- `uTime`-Akkumulation: variabel vs. konstant
- Smooth-Decay-Rate (z.B. `phase -= 0.04` pro Frame, unabhängig von `delta`)

**Konsequenz:** Falls der Browser im Preview dropped frames, läuft `useFrame` seltener, `phase` decay'd **seltener**, `uTime` wächst langsamer. Im Export deterministisch.

**ABER:** Bei 60fps sind beide ähnlich. Marginaler Effekt.

**Test:** Preview `delta` über 100 Frames loggen.

### H5 (MITTEL): Das `globalBeatDetector`-Singleton in `useAudioReactive` läuft weiterhin im Live-Stream — auch im Export

**Vermutung:** Nach `stopAndPause()` in `App.tsx:handleStartExport` ist der rAF-Loop gestoppt. Aber der **`globalBeatDetector` Singleton auf Module-Level** (`useAudioReactive.ts:39`) lebt weiter. Er hat noch Live-trainierten State.

**Im Export-Loop:** `exportEngine.ts:179` erstellt eine **neue** `globalBeatDetector`-Instanz. Die schreibt `audioAnalysis.beatPhase`. Die Module-Level-Instanz wird im Export nicht benutzt (rAF-Loop ist gestoppt).

**ABER:** Components lesen `audioAnalysis.beatPhase` im useFrame und nutzen das für `glowUniforms.uGwBeat.value`, etc. Das wird im Export-Loop korrekt gesetzt. OK.

**Test:** Im Export prüfen, ob `audioAnalysis.beatPhase` Werte hat (nicht 0).

### H6 (NIEDRIG): Unterschiedliche R3F-Clock-Initialisierung

**Vermutung:** `state.clock` wird in R3F irgendwann initialisiert. Im Export könnte `state.clock.elapsedTime` einen anderen Startwert haben.

**Test:** `state.clock.elapsedTime` vor dem ersten Export-Frame loggen.

---

## 3. Konkrete Debug-Schritte für die nächste Session

### 3.1 Smoke-Test: Werte direkt vergleichen

Bau einen Debug-Modus in `exportEngine.ts` ein, der im Browser-Console für die ersten 10 Frames folgende Werte ausgibt:

```ts
console.log(`[EXPORT Frame ${i}]`, {
  rawFreqData_max: Math.max(...frame.rawFreqData),       // Live: ~250
  rawFreqData_avg: frame.rawFreqData.reduce((a,b)=>a+b,0) / 1024, // Live: ~50-150
  bass: frame.bass,
  loudness: frame.loudness,
  globalBeat: audioAnalysis.beatPhase,
  stateSize: { w: ??, h: ?? }, // muss im useFrame geloggt werden
  r3fStateSize_w: gl.getSize(new THREE.Vector2()).x,     // sollte = width sein
});
```

Dasselbe im Live-`useAudioReactive`-Tick loggen. Werte vergleichen.

### 3.2 Wenn `rawFreqData_avg` im Export deutlich niedriger ist als Live

→ **Bug bestätigt: das Spektrum ist im Export leiser.** Mögliche Ursachen:
- Trailing-Window sampelt teilweise "leere" Regionen am Anfang des Audio (H2)
- `audioBuffer.getChannelData(c)` liefert PCM-Samples in `[-1, 1]`, aber das **sind nicht die gleichen Samples, die der Web-Audio-Stream** zur Zeit `t` hat (anders resampled, andere Decoding-Pipeline)
- Blackman-Window in meinem Code hat andere Koeffizienten als Chromium (BUG in meinem Code?)

**Aktion:** Web-Audio-resampling im Export replizieren. Idealerweise die `AudioContext.sampleRate` benutzen (48000) und das Audio-Buffer mit dieser Rate resamplen, BEVOR `precomputeFFT` läuft. Aktuell wird das Audio mit der **Original-Sample-Rate** des Files (z.B. 44100) decodiert, was zu anderer FFT-Auflösung führt.

### 3.3 Wenn `stateSize` im Export-Loop die Preview-Größe hat

→ **Bug bestätigt: meine `sceneRegistry.setSize` läuft nicht synchron.** Aktion:
- Sicherstellen, dass R3F-subscribe-Block NICHT von selbst `gl.setSize(w, h, true)` mit Style-Update ruft
- Alternative: `state.size` direkt in R3F-Store mutieren ohne subscribe zu triggern (Hack via `getRootState().setState({ size: {...} })` ohne R3F's `setSize` Wrapper)

### 3.4 Wenn `globalBeat` im Export konstant 0 ist

→ Detector triggert nicht. Aktion:
- `fluxHistory` der Component-Detectoren loggen nach dem `reset()` + ersten 5 `update()`-Calls
- Wenn `flux` konstant ~0 ist: Magnitude-Spektrum zu leise (siehe 3.2)
- Wenn `flux` oszilliert aber `avgFlux` mitwächst: Threshold passt nicht, Sensitivity zu hoch

---

## 4. Hinweise zur Codebase

### 4.1 Kritische Dateien
- `src/lib/fft.ts` — Offline-FFT-Pipeline, muss Web-Audio-kompatibel sein
- `src/lib/audioUtils.ts` — `FreqBeatDetector`, `getFreqRangeEnergy`
- `src/lib/exportEngine.ts` — Export-Loop, schreibt `audioAnalysis` pro Frame
- `src/hooks/useAudioReactive.ts` — Live-rAF-Loop, schreibt `audioAnalysis` im Live
- `src/components/three/AudioScene.tsx` — `sceneRegistry`, `useBeatDetectorRegistration`
- `src/components/three/BackgroundPlane.tsx` — nutzt `uBeatPhase` in 7+ Shader-Pfaden
- `src/components/three/InstancedBars.tsx`, `GPUParticles.tsx`, `CenterLogo.tsx`, `NebulaPlane.tsx` — Beat-Detector-Instanzen, werden im Export resettet

### 4.2 Audio-Pipeline im Live-Modus
```
<audio> → createMediaElementSource
  ├─→ AnalyserNode "visual" (fft=256, smooth=0.55) → freqData (128 bins)
  └─→ AnalyserNode "kick"   (fft=2048, smooth=0.0)  → rawFreqData (1024 bins)
       └─→ globalBeatDetector → audioAnalysis.beatPhase

rAF-Tick:
  - schreibt audioAnalysis.{bass,loudness,highs,freqData,rawFreqData,beatPhase}
  - ruft sceneRegistry.advance() → useFrame-Callbacks aller Komponenten
```

### 4.3 Audio-Pipeline im Export-Modus
```
audioFile → AudioContext.decodeAudioData → audioBuffer
  → precomputeFFT(audioBuffer, fps) → Array<{freqData, rawFreqData, ...}>
  → pro Frame: audioAnalysis.{freqData, rawFreqData, bass, loudness, highs} setzen
  → globalBeatDetector (NEUE Instanz) → audioAnalysis.beatPhase
  → Component-Detectoren (useMemo, werden resettet) → uBeatPhase etc.
  → sceneRegistry.advance(timestamp) → useFrame-Callbacks
```

### 4.4 Alle Detector-Instanzen (Reset-Liste)
- `useAudioReactive.ts:39` — `globalBeatDetector` (Modul-Singleton, für `audioAnalysis.beatPhase`)
- `BackgroundPlane.tsx:494` — `beatDetector` (Background-Beat, `bg.beatFxFreq*`)
- `CenterLogo.tsx:271-272` — `logoBeatDetector`, `fireBeatDetector` (Logo-Beat, Fire-Beat)
- `GPUParticles.tsx:152` — `particleBeatDetector` (Particle-Kick, `sp.reactiveFreq*`)
- `InstancedBars.tsx:30` — `barsBeatDetector` (Bar-Beat-Boost, `b.beatFreq*`)
- `NebulaPlane.tsx:18` — `nebulaBeatDetector` (Nebula-Pulse, `bg.nebulaBeatFreq*`)

Alle 6 Component-Detectoren werden via `useBeatDetectorRegistration` im `sceneRegistry.beatDetectors` Set registriert. `exportEngine.ts` ruft `reset()` auf alle vor Frame 0.

---

## 5. AGENTS.md Updates (nötig?)

Aktuell ist AGENTS.md auf **Session 7 (settingsStore v11)** Stand und referenziert die "Export-Pipeline schreibt `audioAnalysis.rawFreqData` pro Frame und nutzt globalen `FreqBeatDetector` mit `settings.audio.*`". Das ist **noch korrekt**.

Seitdem hinzugekommen (in AGENTS.md nicht dokumentiert):
- `useAudioReactive.stopAndPause()` / `startAndPlay()` (Commit `c109b84`)
- `sceneRegistry.setSize` (Commit `9fe1ec7`)
- `canvas`-Resize-Loop-Fix (Commit `cc53978`)
- `useFrame` `state.size` live lesen in BackgroundPlane + NebulaPlane (Commit `dde5c3c`)
- `FreqBeatDetector.reset()` + `useBeatDetectorRegistration` (Commit `d2a3274`)
- FFT-Pipeline komplett überarbeitet: Blackman, 1/N, [-100,-30] dB, Trailing-Window, Smoothing, Downmix (Commit `1704883`)

**Empfehlung für die nächste Session:** Bevor weiter debugged wird, AGENTS.md auf den aktuellen Stand bringen (Commit-Liste oben eintragen, neue Hooks dokumentieren). Dann ist der Kontext für den nächsten Agenten klar.

---

## 6. Nicht vergessen

- **Commit-Hygiene:** Alle bisherigen Fixes sind committed. Vor weiteren Änderungen `git status` + `git diff --stat`.
- **Verifikation:** Nach jedem Fix `npm run typecheck` + `npm run build` (muss grün sein). Browser-Test ist Sache des Users.
- **AGENTS.md § 0.4 Commit-Pflicht:** Granularer Commit pro logischem Änderungsblock.
- **Settings-Schema:** v11 ist aktuell, kein Bump nötig. `useF`-defensive-Defaults bleiben aktiv.
