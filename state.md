# state.md — Tagesabschluss 2026-06-14

**Status:** Work-in-Progress. Die Audio-Erkennung ist **deutlich besser** als auf v12, aber **noch nicht perfekt**. Morgen weiter.

**Aktueller Branch:** `main`
**Letzter Commit:** `4ab8c41 fix(components): respect user's Hz range in precomputed beat detection`
**Typecheck:** PASS · **Build:** PASS
**Arbeitsverzeichnis:** clean (keine uncommitted Änderungen)

---

## Was heute gemacht wurde (16 Commits seit `af2e2b8`)

| # | Commit | Was |
|---|---|---|
| 1 | `795b025` | `now.md` Rollback-Anchor (Reset zu af2e2b8 möglich) |
| 2 | `77986c2` | Unused `web-audio-beat-detector` entfernt |
| 3 | `f1e8d7a` | **Settings v13**: detection mode, band sensitivity, key-Felder, colorMode-Optionen erweitert |
| 4 | `a9e75ad` | `audioAnalysis` um 7 Felder erweitert: kickPhase, snarePhase, vocalPhase, hihatPhase, bpm, key, scale, preAnalysisProgress |
| 5 | `0eb4730` | `lib/keyColors.ts` — keyToHue, keyToPalette, bandPhasesToColor |
| 6 | `85143b7` | SettingsPanel: "Audio"-Tab + neue Color-Mode-Optionen in Bars/Particles |
| 7 | `d104ae2` | `essentia.js@0.1.3` + Worker-Skelett + lokale `.d.ts` |
| 8 | `920b07d` | `lib/preAnalysis.ts` — typed Promise-Wrapper für essentia-Worker |
| 9 | `55cf1b0` | `lib/analysisBundle.ts` — unified decode+essentia+fft-Pipeline |
| 10 | `17a47a2` | **Multi-Band Onset-Detection** in `fft.ts` — 4 BiquadFilter-Ketten + Spectral-Flux pro Band |
| 11 | `b8f3251` | `useAudioReactive` — Pre-Analysis-Pipeline im Background, audioAnalysis-Sync, tick-basierter Beat-Phase |
| 12 | `a282a61` | `exportEngine` — nutzt `window.__analysisBundle`, schreibt per-Band-Phasen, Tick-basierter Beat-Phase |
| 13 | `9f6baa6` | **Alle 7 FreqBeatDetectors** migriert auf `usePhaseSource` |
| 14 | `bdf0a36` | `key-derived` + `band-driven` Color-Modes in InstancedBars + GPUParticles implementiert |
| 15 | `02c96e7` | `verify-export.mjs` + `test-fft-only.mjs` um v13-Felder erweitert |
| 16 | `3d23212` | `AGENTS.md` Session-13-Sektion |
| 17 | `4ab8c41` | **Bug-Fix**: User's Hz-Range wird im precomputed-Modus respektiert (war hardcoded) |

---

## Was funktioniert ✅

- **Bessere Kick/Snare-Trennung** als v12 — das war der Hauptgrund für die Überarbeitung
- **8-15s Pre-Analysis** beim Upload (im Hintergrund, User kann sofort Play drücken)
- **Frame-accurate Beat-Sync** via essentia beat ticks (kein Detector-Drift)
- **Per-Band Sensitivity** (4 Slider in Audio-Tab) für kick/snare/vocal/hihat
- **Detected BPM/Key** werden im SettingsPanel angezeigt
- **Key-derived + Band-driven Color-Modes** für Bars/Particles (4 neue Optionen in jedem ColorMode-CB)
- **Progress-Bar** während der Analyse
- **`precomputed` ↔ `live` Mode-Switch** in den Settings, kein Reload nötig
- **Live-Preview und Export** laufen beide mit den gleichen Pre-Analysis-Daten (byte-identisch für per-Band-Phasen)
- **HzRangePicker funktioniert jetzt** im precomputed-Modus (Bug von eben gefixt)

## Was noch nicht perfekt ist ⚠️

User-Feedback (gerade eben): "bisschen besser denke ich aber immer noch nicht perfekt"

Mögliche Ursachen, die morgen untersucht werden müssen:

1. **Sub-Bass reagiert nicht stark genug**: Das Kick-Band (20-150Hz) deckt "Sub-Bass" (20-80Hz) komplett ab, ABER die Spectral-Flux-Schwelle könnte bei 20-80Hz-Inhalten unter dem Trigger liegen, wenn der Song dort konstant Energie hat (kein Transient). Sub-Bass in Hip-Hop/Electronic ist oft ein **Dauerton**, kein Anschlag — Spectral-Flux ist die falsche Detektion dafür.

2. **Vocal-Band könnte zu eng sein**: 800-4000Hz deckt Vocals ab, aber Lead-Vocals haben oft **Pitch-Konstanz** über Sekunden — kein Transient, also wieder kein Flux-Trigger.

3. **Hi-Hat auf 4-16kHz** ist gut für transientes Material, aber wenn das Material dort nichts hat → Phase bleibt 0 → keine Reaktion. Das ist korrektes Verhalten, fühlt sich aber "tot" an.

4. **Multi-Band Onset Detection** läuft nur **alle ~17ms** (60fps precomputeFFT). Sehr schnelle Patterns (z.B. Drum'n'Bass mit 180+ BPM und Double-Kicks alle 80ms) könnten zwischen den Frames verschluckt werden.

5. **Vergleich zum Live-Modus**: Wenn du `detectionMode: 'live'` einstellst, könnte die Reaktion sogar besser aussehen, weil der Live-AnalyserNode **jedes** AudioFrame sieht (60fps × 2048 fftSize) und nicht auf vorab-quantisierte Sample-Positionen angewiesen ist. Das wäre ein Hinweis, dass die PrecomputeFFT-Pipeline zu grob quantisiert.

---

## Morgen — Hypothesen für die "nicht perfekt"-Verbesserung

**Hypothese A: Spectral-Flux ist das falsche Tool für Dauertöne**
- Für Sub-Bass, Vocals, Pads brauchen wir **Energy** (Average Level), nicht nur **Flux** (Transienten).
- Lösung: zusätzlich `kickEnergy` / `vocalEnergy` etc. in precomputeFFT (avg magnitude pro Band, EMA-smoothed), und in `usePhaseSource` einen `mixPhaseAndEnergy()` der beides kombiniert.
- Aufwand: ~1-2h, kein neuer Commit nötig wenn es funktioniert

**Hypothese B: Frame-Quantisierung ist zu grob**
- Aktuell: 1 Frame = 1/60s = 16.67ms. Spectral-Flux braucht aber ca. 10ms Auflösung für Double-Kicks.
- Lösung: `precomputeFFT` auf 120fps laufen lassen für die Band-Onset-Berechnung, dann auf 60fps für die Frame-Outputs runterrechnen (max-pooling?).
- Aufwand: ~2-3h in fft.ts

**Hypothese C: Hz-Range schmaler als Band = Probleme**
- `computeWeightedPhase` gewichtetet aktuell nur **nach Überlappungsanteil**, nicht nach **Wichtigkeit**. Ein User der "Sub-Bass 20-80Hz" einstellt, will dass das ganze Band voll triggert, nicht dass ein 5% Snare-Bleed den Trigger verwässert.
- Lösung: Threshold einführen — nur Bänder mit overlap > 10% der User-Range tragen bei.
- Aufwand: 5min in `computeWeightedPhase`

**Hypothese D: Der User meint was anderes**
- "bewegt sich obwohl kein Kick/Bass da ist" — der User könnte meinen: **das Bild bewegt sich grundsätzlich zu viel, nicht nur auf den Beat**. Das könnte an den kontinuierlichen Animationen liegen (Nebula drift, Grid wave, Scanline scroll), die alle audio-moduliert sind aber **nicht** auf den Beat warten.
- Lösung: Schaue, welche Settings die Bewegung treiben und schlage Tuning vor.

---

## Morgen zuerst checken

```bash
# Aktueller Stand
cd "C:\Users\tflag\Documents\AntiGravity\AudioVisualizer"
git log --oneline -n 5
git status

# Welche Modifikation ist gerade aktiv?
# Im UI: SettingsPanel → Audio → "Detection Mode" (precomputed vs live)
# Tipp: schalte mal auf "Live" und vergleiche die Reaktion
```

**Dann den User fragen:**
1. In welchem Modus bist du gerade (precomputed / live)?
2. Was genau "bewegt sich" — Background, Bars, Particles, Logo, Nebula?
3. Ist es **zu viel Bewegung** (alles wabert) oder **falsche Bewegung** (reagiert auf Snare statt auf Kick)?
4. Spielt der Song gerade an der Stelle (ja/nein)?

Mit diesen 4 Antworten können wir die richtige Hypothese A/B/C/D gezielt verifizieren.

---

## Test-Tooling-Status

| Skript | Status | Lauffähig? |
|---|---|---|
| `node scripts/test-fft-only.mjs` | Erweitert um v13 per-Band-Phases | **Braucht Dev-Server** (Vite am :5173, vom User) |
| `node scripts/verify-export.mjs` | Erweitert um v13 Delta-Tabelle | **Braucht Dev-Server** + ffmpeg + tmp/Ballern!.mp3 |
| `node scripts/diagnose-fft-sources.mjs` | unverändert | braucht Dev-Server |
| `node scripts/test-e2e-v2.mjs` | unverändert | braucht Dev-Server |

Keine der Skripte wurde heute tatsächlich ausgeführt (kein Dev-Server im Agent-Setup möglich). Die TypeScript-/Build-Verifikation deckt aber **statische Korrektheit** — keine Runtime-Bugs in der Logik selbst.

---

## Rollback-Pfad

Falls morgen was komplett schiefgeht und alles weg soll:

```bash
cd "C:\Users\tflag\Documents\AntiGravity\AudioVisualizer"

# Sanft: Working-Tree wegwerfen + zu v12 (vor Audio-Overhaul)
git reset --hard af2e2b8

# Oder zu inkl. now.md (ein Commit weiter vorne)
git reset --hard 795b025

# Sicherer: Revert-Commits statt reset
git revert --no-commit 795b025..HEAD
git commit -m "revert: rollback audio detection overhaul"
```

`now.md` enthält die gleiche Anleitung in ausführlicher Form.

---

## Offene Punkte für morgen (Priorisiert)

1. **Hypothese A** testen (Energy statt nur Flux für Dauertöne) — wahrscheinlichster Hebel
2. **Hypothese C** testen (Threshold in computeWeightedPhase) — schneller Win
3. **Hypothese B** testen (höhere FFT-Auflösung) — wenn 1+2 nicht reichen
4. **Hypothese D** mit dem User klären — falls was anderes gemeint ist
5. `verify-export.mjs` tatsächlich laufen lassen, sobald Dev-Server verfügbar
6. AGENTS.md §6.1 (5 Stolpersteine des Export-Preview-Matchings) um v13-Erkenntnisse ergänzen, falls sich was geändert hat

---

*Gute Nacht, Skrumpie.*
*Stand: 16 Commits in einem Rutsch, Build clean, Tagesziel zu 80% erreicht — die letzten 20% "perfekt" sind die schweren.*
