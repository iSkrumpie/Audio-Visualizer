# Now.md — Rollback Anchor vor "Audio Detection Overhaul"

**Erstellt:** 2026-06-14
**Zweck:** Falls die kommende große Änderung (verbesserte Audio-Erkennung mit Multi-Band Onsets + essentia.js) fehlschlägt, kannst du mit einem einzigen Befehl exakt zu diesem Stand zurückkehren.

---

## Aktueller Zustand (Stand jetzt)

- **Branch:** `main`
- **Working Tree:** clean (nur `nul` als untracked Windows-Artefakt — siehe Hinweis unten)
- **Letzter Commit:** `af2e2b8 docs(AGENTS.md): fix stale glow references after v12 split`
- **Session:** 12 ist final abgeschlossen (Export-Preview-Matching endgültig gelöst, SSIM ≥ 0.80)

## Die 5 letzten Commits (relevant für Rollback-Verständnis)

```
af2e2b8 docs(AGENTS.md): fix stale glow references after v12 split
97403e3 fix(logo): inner + outer glow planes now scale with beatScale
591d05e fix(logo): align inner glow slider range and default with new semantics
d118015 fix(logo): inner glow now starts at rim and decays inward
4c347f3 docs(AGENTS.md): document v12 changes — outer/inner glow, weather FX
f56b2ee feat(settings-panel): split Glow into Outer/Inner, add Weather fx section
49d1517 feat(background): new BackgroundFx component with particles, rain, snow
25c6aa7 feat(logo): split glow into outer + inner with soft falloff
321d2c4 feat(settings): bump to v12, rename glow → outerGlow, add innerGlow + 3 weather FX groups
2cf35f8 docs(AGENTS.md): Session 12 — final cleanup + 5 export-preview Stolpersteine
```

## Rollback-Befehle

### Sanft: Working-Tree-Verwerfung + Reset auf af2e2b8

```bash
# Wenn du im Working-Tree nichts behalten willst:
cd "C:\Users\tflag\Documents\AntiGravity\AudioVisualizer"
git reset --hard af2e2b8
```

Danach bist du EXAKT auf dem Stand vor Beginn der "Audio Detection Overhaul"-Arbeit.

### Sicherer: Revert-Commits erzeugen (für Push-Historie)

```bash
# Erzeugt N Commits, die alles rückgängig machen
git revert --no-commit af2e2b8..HEAD
# oder die letzten N Commits:
git revert --no-commit HEAD~10..HEAD
git commit -m "revert: rollback to pre-audio-detection-overhaul state"
```

## Was du nach dem Rollback hast

Komplette Funktionalität von Session 12:
- ✅ Export-Preview-Matching (SSIM ≥ 0.80, bass Δ ≤ 0.02, energy Δ = 0.0)
- ✅ 7 FreqBeatDetector-Instanzen (1 global + 6 komponenten-spezifisch) laufen live
- ✅ settingsStore v12 (Outer/Inner Glow, Weather FX, alle HzRangePicker-Picker)
- ✅ OfflineAudioContext-basierte precomputeFFT() für Export
- ✅ decodeAudioData() + AudioBufferSourceNode im Live-Stream
- ✅ Mid-Point Sampling, 1/N-Scaling, Blackman-Window, EMA-Smoothing
- ✅ sceneRegistry.beatDetectors-Reset vor Export
- ✅ useF defensive defaults für alte Presets

## Was du NICHT hast (wenn zurückgerollt)

- ❌ Multi-Band Onset-Detection (Kick/Snare/Vocal/HiHat separat)
- ❌ essentia.js Integration (BPM, Beat-Ticks, Key)
- ❌ Beat-Sync via Pre-computed ticks[] (perfekter Phase-Sync)
- ❌ Neue audioAnalysis-Felder (kickPhase, snarePhase, vocalPhase, hihatPhase, beatPhase from ticks)

---

## Was war der Auslöser für die "Audio Detection Overhaul"?

User-Feedback (2026-06-14, deutsch):
> "ich möchte nicht nur einen quick win ich möchte komplett die erkennung der audio verbessern um die animationen passender zum beat / audio zu machen. daher alles was du für nötig hälst."

Aktuelle Schwächen (aus §1 der Recherche):
1. Live-AnalyserNode sieht immer nur aktuelles 2048-Sample-Fenster (~46ms) — keine Song-weite Adaption
2. Double-Kicks bei 160+ BPM werden als ein Beat erkannt (42ms rAF vs. 8ms Kick-Abstand)
3. Kick vs. Bassline nicht unterscheidbar (gleicher Frequenzbereich, unterschiedliche Transienten-Charakteristik)
4. Kein Vocal-spezifischer Reaktionskanal
5. Kein Beat-Tick-basiertes Phase-Sync (nur reaktive Onset-Detection mit Latenz)

## Geplante Verbesserungen (zur Erinnerung)

Wenn du nach erfolgreichem Rollback **neu starten** willst, hier die Roadmap aus der Planung:

1. **Essentia.js Web-Worker** (lazy-loaded, ~2MB WASM) → BPM + Beat-Ticks + Key
2. **Multi-Band Onset-Detection** in `precomputeFFT()` (4 Bänder parallel über OfflineAudioContext + BiquadFilter)
3. **`audioAnalysis` erweitern** um `kickPhase`, `snarePhase`, `vocalPhase`, `hihatPhase`, `beatPhase` (tick-basiert)
4. **7 FreqBeatDetector-Instanzen migrieren** auf Pre-Analyse-Daten-Lookup (statt Live-Spectral-Flux)
5. **Settings-Schema-Bump auf v13** — `audio.beatMode`: 'live' | 'precomputed' (default 'precomputed')
6. **Key-basierte Auto-Farbpalette** als optionaler colorMode ('key-based') für Bars/Particles
7. **scripts/verify-export.mjs erweitern** um Pre-Analyse-Deltas (kickPhase Δ, snarePhase Δ, beatPhase Δ aus ticks)

## Hinweis zu `nul` im Working Tree

Datei `nul` (119 Bytes, CRLF Text) ist ein Windows-Artefakt — vermutlich von einem fehlgeleiteten Redirect (z.B. `echo foo > nul` statt `> /dev/null`). **Wird vor dem ersten Audio-Overhaul-Commit entfernt.**

---

## Bei Fragen

Wenn der Rollback aus irgendeinem Grund nicht funktioniert oder du eine Variante brauchst (z.B. nur Code, nicht AGENTS.md zurücksetzen), gib Bescheid.
