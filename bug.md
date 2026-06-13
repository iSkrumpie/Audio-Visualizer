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
