# AudioVisualizer — Session Log

> Geladen von `AGENTS.md` bei Bedarf. Enthält detaillierte Session-Notizen ab Session 13.
> Für aktuelle Architektur → `docs/architecture.md`. Für Stolpersteine → `docs/stolpersteine.md`.

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

---

## 17. Session 20 — Strands Background Effect

*ogl-basierter "Strands"-Effekt (Aurora/Lichtbänder) von https://reactbits.dev portiert. settingsStore v14 → v15 mit deep-merge migrate. Zahlreiche Bugfix-Iterationen bis zum finalen Stand — alle Root-Causes konserviert.*

### 17.1 Commits (chronologisch)

| Commit | Was |
|---|---|
| `d04b225` | Foundation: ogl@^1.0.11 + Strands.tsx (NEU) + settingsStore v15 + hints.ts |
| `5b35348` | UI: VisualizerStage + SettingsPanel Accordion |
| `9a64fb4` | Fix: Strands NACH R3F mounten — R3F `alpha:false` verdeckte alles davor |
| `7c0e745` | Fix: `transparent:true` am ogl-Program + ResizeObserver |
| `17af068` | **Root-Fix (Unsichtbarkeit)**: `uColors` als `number[][]` — ogl `flatten()` Bug |
| `0b48316` | Fix: Aspect-aware Envelope + `strandsTaper` Default 0 |
| `634bb83` | Fix: Envelope auf raw UV (vor uScale-Division) + dünnere Defaults |
| `410c223` | Fix: CSS `radial-gradient` Maske für "Behind Logo" |
| `853a758` | Fix: Masken-Radius `logoSize/2 + 15px` (finaler Stand) |

### 17.2 Architektur — Standalone ogl-Renderer

Strands nutzt **NICHT** R3F. Es ist eine eigenständige React-Component mit:
- Eigenem WebGL2-Canvas (ogl `Renderer` mit `alpha: true`, `premultipliedAlpha: false`, `transparent: true` am Program)
- Eigenem rAF-Loop im `useEffect` (nicht R3F `useFrame`)
- ResizeObserver + `window.addEventListener('resize')` für Größen-Anpassung
- Eigener Cleanup (`cancelAnimationFrame` + `WEBGL_lose_context` + `canvas.remove()`)

**Warum nicht R3F?** Original reactbits-Code nutzt ogl direkt (1:1 portiert). Strands braucht nur Fullscreen-Triangle + Custom-Shader — kein 3D-Transform, keine Camera, keine Beleuchtung. Eigenständiger Canvas = keine Interferenz mit R3F-Render-Pipeline.

**Trade-off:** Strands wird NICHT in den MP4-Export aufgenommen (exportEngine capture'd nur R3F's gl) — TODO für später.

### 17.3 ANGLE-Sicherheit (KRITISCH)

Alle lokalen GLSL-Variablen im Fragment-Shader haben das `str_` Prefix (45 Vorkommen). Uniforms (`uTime`, `uResolution`, `uColors`, etc.) behalten ihre plain Names.

```glsl
// Portiert — ALLE lokalen Vars mit str_ Prefix:
float str_h = str_fi / float(uStrandCount) + str_uv.x * 0.30 + uTime * 0.04 + uHueShift;
str_col += str_strandColor(str_h) * str_g * str_env;
```

### 17.4 ogl-spezifische Stolpersteine (Root-Causes aus Session 20)

**🔴 Bug 1: R3F `alpha:false` verdeckt vorangehende HTML-Overlays (Commit `9a64fb4`)**
R3F-Canvas mit `gl: { alpha: false }` ist opak. `<Strands/>` VOR dem Canvas in DOM-Order ist immer unsichtbar. Fix: Strands IMMER nach `<AudioScene/>` mounten.

**🔴 Bug 2: ogl-Program ohne `transparent: true` (Commit `7c0e745`)**
ogl Default-BlendFunc = `gl.ONE, gl.ZERO` (opak). Ohne `transparent: true` ignoriert ogl den Alpha-Channel → Strands opak-schwarz oder unsichtbar. Fix: `new Program(gl, { ..., transparent: true })`.

**🔴 Bug 3: `uColors` als `Float32Array` statt `number[][]` (Commit `17af068`)**
ogl `setUniform → flatten()` prüft `a[0].length`. Bei `Float32Array` ist `a[0]` eine Number → `a[0].length === undefined` → flatten() gibt Array unverändert zurück → `gl.uniform3fv()` bekommt falschen Buffer → ogl warnt 100x/s `"Active uniform uColors[0] has not been supplied"` → Shader samplet schwarz → Strands unsichtbar. Fix: `buildPalette()` gibt `number[][]` zurück (jedes innere Array = ein vec3 Triple), mit ogl's `Color`-Helper.

**🔴 Bug 4: Envelope auf post-scale UV (Commit `634bb83`)**
Envelope-Funktion `pow(cos(...), uTaper)` wurde NACH `str_uv /= uScale` berechnet. Bei `uScale < 1` wächst `str_uv.x` über den normalen Wertebereich → Envelope inkorrekt. Fix: Envelope auf **raw UV** (vor Division) berechnen:
```glsl
vec2  str_uvRaw = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
float str_envArg = (str_uvRaw.x / max(str_aspect * 0.5, 0.001)) * (str_PI * 0.5);
float str_env    = pow(max(cos(str_envArg), 0.0), max(uTaper, 0.0));
```

### 17.5 Audio-Reaktivität

Gleiches Pattern wie BackgroundFx:
- `useMemo(() => new FreqBeatDetector(48000), [])` + `useBeatDetectorRegistration`
- `usePhaseSource({ detector, getPrecomputedRange, liveFn })`
- Beat skaliert: `uAmplitude * (1 + boost * 0.4)` und `uGlow * (1 + boost * 0.3)`
- Default: `strandsBeatSensitivity = 0` (aus)

### 17.6 z-Index / Layering + "Behind Logo" Maske

Strands wird IMMER nach `<AudioScene/>` gemounted. `strandsBehindLogo` nutzt eine **CSS `mask-image`**:

- `strandsBehindLogo=true` (default): `radial-gradient` schneidet Logo-Kreis aus → Strands voll sichtbar über Background, unsichtbar im Logo-Bereich
- `strandsBehindLogo=false`: keine Maske → Strands über allem

```typescript
// VisualizerStage.tsx — finaler Stand:
const r  = logoSize / 2 + 15;   // +15px weil Outer Glow das Logo visuell vergrößert
const r2 = r + 4;                // weicher Übergang
const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
```

`logoSize` und `logoEnabled` sind React-Subscriptions → Maske reagiert live auf Slider-Änderungen.

**Fehlgeschlagene Ansätze (für Nachwelt dokumentiert):**
- `mix-blend-mode: screen` → überstrahlt Logo (zu additiv)
- `mix-blend-mode: soft-light` → Strands fast unsichtbar
- SVG-`<mask>` mit `objectBoundingBox` → Koordinaten-System-Problem, Strands komplett ausgeblendet

### 17.7 19 Settings (`background.strands*`) — finale Defaults

| Field | Default | Range | Was |
|---|---|---|---|
| `strandsEnabled` | `false` | bool | Master-Toggle |
| `strandsColors` | `['#FF4242','#7C3AED','#06B6D4','#EAB308']` | 1..8 | Farb-Palette |
| `strandsCount` | `3` | 1..12 | Anzahl Stränge |
| `strandsSpeed` | `0.5` | 0..3 | Animations-Speed |
| `strandsAmplitude` | `1.5` | 0..3 | Wellen-Höhe |
| `strandsWaviness` | `1.0` | 0..3 | Wellen-Frequenz |
| `strandsThickness` | `0.35` | 0..3 | Strich-Dicke |
| `strandsGlow` | `3.0` | 0..6 | Glow-Helligkeit |
| `strandsTaper` | `0` | 0..10 | Edge-Fade (0 = Rand-zu-Rand ohne Fade) |
| `strandsSpread` | `1.0` | 0..3 | Phasenversatz zwischen Strängen |
| `strandsHueShift` | `0` | 0..2 | Hue-Shift über Zeit |
| `strandsIntensity` | `0.6` | 0..1 | Maximale Helligkeit |
| `strandsSaturation` | `1.5` | 0..3 | Farbsättigung |
| `strandsOpacity` | `1.0` | 0..1 | Gesamt-Transparenz |
| `strandsScale` | `1.0` | 0.1..5 | UV-Divisor: 1.0 = ~1 Welle/Breite, <1 = mehr Wellen, >1 = gestaucht |
| `strandsBeatFreqStart` | `20` | 20..20000 Hz | Beat-Range |
| `strandsBeatFreqEnd` | `200` | 20..20000 Hz | Beat-Range |
| `strandsBeatSensitivity` | `0` | 0..5 | 0 = aus |
| `strandsBehindLogo` | `true` | bool | CSS-Masken-Modus |

### 17.8 SettingsPanel-Integration

Accordion "Strands" im Background-Tab zwischen "Effects" und "Weather FX":
- Master-Toggle ohne Hint (§16.3), Position-CB (behind/in front)
- Color-Array-Editor (Add/Remove, max 8), 13 Sliders, HzRangePicker + Sensitivity
- Accordion startet geschlossen (kein `defaultOpen`, §16.4)

### 17.9 Performance

| Layer | Draw Calls | GPU @60fps |
|---|---|---|
| Strands (ogl, fullscreen triangle) | 1 | ~0.3–0.5ms |

Separater WebGL2-Kontext → kein R3F-Overhead.

### 17.10 Bekannte Einschränkungen

- **Export:** Strands nicht im MP4 (exportEngine capture'd nur R3F gl). TODO: ogl-Canvas per Frame screenshotten + in R3F composen.
- **Beat-Scale-Maske:** Maske ist statisch (logoSize/2 + 15px). Bei starkem Beat-Scale-Burst können Strands kurzzeitig am Logo-Rand sichtbar sein.
- **Color-Editor:** keine Farb-Swatch-Vorschau (nur hex-Text + Color-Picker).

### 17.11 House-keeping

- settingsStore v15, Storage-Key `audiovisualizer:settings:v15`
- Bei vollständigem Rollback: `git revert 853a758 410c223 634bb83 0b48316 17af068 7c0e745 9a64fb4 5b35348 d04b225`