# AudioVisualizer — How-To: Effekte & Konventionen

> Geladen von `AGENTS.md` bei Bedarf. Enthält Implementierungs-Checklisten und Konventionen.

## Core Patterns — Schnell-Referenz

Diese Patterns werden überall im Projekt genutzt. Kurze Erklärung damit du sie beim Implementieren korrekt einsetzen kannst.

### Pattern 1: `audioAnalysis` mutable (Hot-Path)

```typescript
// src/hooks/useAudioReactive.ts exportiert:
export const audioAnalysis: {
  freqData: Uint8Array;      // 128 bins, visual analyser (smoothed 0.55)
  rawFreqData: Uint8Array;   // 1024 bins, kick analyser (raw, no smoothing)
  bass: number; loudness: number; highs: number; energy: number;
  beatPhase: number;         // global beat phase 0..1
  kickPhase: number; snarePhase: number; vocalPhase: number; hihatPhase: number;
}
```

**Regel:** Three.js-Komponenten lesen NIE per-Frame-Daten aus Zustand-Store. Immer `audioAnalysis` direkt lesen. Für Beat-Detection immer `rawFreqData` (nicht `freqData` — geglättete Daten verschlucken Transienten).

---

### Pattern 2: FreqBeatDetector (Beat-Reaktivität)

```typescript
// In jeder Komponente die auf Beats reagiert:
const myDetector = useMemo(() => new FreqBeatDetector(48000), []);
useBeatDetectorRegistration(myDetector);  // aus './AudioScene' — für Export-Reset

const phaseSrc = usePhaseSource({
  detector: myDetector,
  getPrecomputedRange: () => ({
    startHz: getSettings().background.myBeatFreqStart,
    endHz:   getSettings().background.myBeatFreqEnd,
  }),
  liveFn: () => {
    myDetector.setSensitivity(getSettings().background.myBeatSensitivity);
    return myDetector.update(
      audioAnalysis.rawFreqData,
      getSettings().background.myBeatFreqStart,
      getSettings().background.myBeatFreqEnd,
    );
  },
});

// in useFrame:
const beat = phaseSrc();  // 0..1, decaying
```

**Regeln:** `setSensitivity()` IMMER vor `update()`. `rawFreqData` (1024 bins), NICHT `freqData`. Jede Komponente hat ihre EIGENE Instanz (kein Teilen). `useBeatDetectorRegistration` damit Export-Pipeline vor Frame 0 resetten kann.

---

### Pattern 3: `getSettings()` in Three.js (kein Rerender)

```typescript
// useFrame und Drei.js Komponenten:
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';

useFrame((state, delta) => {
  const { width, height } = state.size;  // aus state.size, NICHT aus useThree()-Closure!
  const bg = getSettings().background;
  const val = bg.myField ?? DEFAULT_SETTINGS.background.myField;  // defensive default!
});
```

**Regel:** Nie `useSettingsStore((s) => s.settings)` in Three.js-Komponenten — das triggert React-Rerenders für jeden Frame-Update. `getSettings()` ist synchron, kein Rerender.

---

### Pattern 4: `useF` in SettingsPanel (UI-Controls)

```typescript
// Nur in SettingsPanel.tsx zulässig:
const [myValue, setMyValue] = useF('background', 'myField');
// Gibt DEFAULT_SETTINGS.background.myField zurück wenn Feld undefined (alte Presets)
```

---

### Pattern 5: `sceneRegistry` (Export-Pipeline-Integration)

```typescript
// src/components/three/AudioScene.tsx exportiert:
export const sceneRegistry = {
  gl, scene, camera, advance,  // werden von SceneCapture-Component befüllt
  setSize: (w, h) => void,     // resize R3F + WebGL gleichzeitig
  beatDetectors: Set<{ reset: () => void }>,  // alle FreqBeatDetector-Instanzen
};
```

**Export-Pipeline liest daraus:** `gl` für Canvas-Capture, `advance(ts)` zum Frame-Rendern, `beatDetectors` für Reset vor Frame 0. Komponenten registrieren ihre Detektoren via `useBeatDetectorRegistration`.

---

### Pattern 6: `useFrame` state.size (R3F-Resize-Safety)

```typescript
useFrame((state, delta) => {
  const { width, height } = state.size;  // ✅ Live aus Callback
  // NICHT: const { width } = useThree((s) => s.size);  // ❌ async Closure-Problem
});
```

**Warum:** `r3fSetSize()` updatet `state.size` synchron, aber der React-Re-Render der `useThree`-Closure ist async. Im Export-Loop (der `advance()` synchron aufruft) würde die Closure noch die alte Preview-Größe sehen.

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

---

## 7. Häufige Operations-Hot-Spots

| Was passieren soll | Datei |
|---|---|
| BG weather effects (particles/rain/snow) | `BackgroundFx.tsx` + `settingsStore.background.{bgParticles*,rain*,snow*}` |
| Strands Background Effect | `Strands.tsx` + `settingsStore.background.strands*` |
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
| Audio-Tab hinter Advanced-Toggle verstecken / zeigen | `SettingsPanel.tsx` (ADV-Pill) + `settingsStore.ts` (`theme.showAdvancedAudio`). Default: false. |
| essentia.js Resample (44.1 kHz) | `essentiaAnalyzer.worker.ts` → `essentia.Resample(signal, 48000, 44100)`. NIEMALS weglassen — sonst BPM ~8.84% zu hoch. |
| KeyExtractor hpcpSize | `essentiaAnalyzer.worker.ts` → `KeyExtractor(resampled, true, 4096, 4096, 36)`. hpcpSize=36 (3 bins/semitone) enables averageDetuningCorrection. |

---

---

## Checkliste: Neuer Background-Effekt

### A) R3F-Shader-Effekt (in BackgroundPlane.tsx)

Für neue Effekte die den gesamten Hintergrund betreffen (Blur, Tint, Bloom, Glitch, etc.):

1. **Settings** in `settingsStore.ts` hinzufügen
   - Felder unter `background.*` (Type-Block + DEFAULT_SETTINGS)
   - Schema-Bump **NUR wenn breaking** — sonst deep-merge `migrate` nutzen
   - Aktueller Key: `audiovisualizer:settings:v15`

2. **Uniform** in `BackgroundPlane.tsx` hinzufügen
   - Uniform in `useMemo([])` erstellen (EINMAL, nicht per Frame neu!)
   - Per Frame via `.value = ...` mutieren

3. **GLSL** in `BackgroundPlane.tsx`
   - **🔴 ANGLE-Prefix-Regel**: Jede lokale Variable MUSS einzigartigen Prefix haben
   - Bestehende Prefixes: `bl`, `sh`, `ca`, `bm`, `ns`, `sc`, `dt`, `gd`, `pix`, `gl_`, `cg`, `tnt`, `vg`
   - Neuen eindeutigen 2-3-Buchstaben-Prefix wählen

4. **SettingsPanel** in `src/components/SettingsPanel.tsx`
   - `useF('background', 'fieldName')` für jeden Wert
   - Accordion-Sektion mit `description={ACCORDION_DESCRIPTIONS['...']}` 
   - Kein `defaultOpen` (§16.4 — alle Accordions starten geschlossen)

5. **Hints** in `src/lib/hints.ts`
   - `'background.fieldName': '60-150 Zeichen, kein Jargon, Effekt beschreiben'`

6. **Verifikation**: `npm run typecheck && npm run build`

7. **AGENTS.md** `docs/architecture.md` §4.6 Background-Gruppe aktualisieren

---

### B) R3F Standalone-Komponente (z.B. neue Partikel, neues Mesh)

Für neue eigenständige Three.js-Komponenten im R3F-Scene-Graph:

1. **Datei** `src/components/three/MeineKomponente.tsx`
   - Settings per Frame via `getSettings()` lesen (NICHT `useSettingsStore` in Three.js!)
   - `useFrame((state, delta) => { const { width, height } = state.size; ... })` — state.size aus Callback, nicht aus Closure!

2. **FreqBeatDetector** (wenn Audio-reaktiv):
   ```ts
   const detector = useMemo(() => new FreqBeatDetector(48000), []);
   useBeatDetectorRegistration(detector); // für Export-Reset
   const phaseSrc = usePhaseSource({ detector, getPrecomputedRange, liveFn });
   // in useFrame: const beat = phaseSrc();
   ```

3. **Z-Layering** in `AudioScene.tsx` eintragen (korrekte Reihenfolge!)
   - Referenz: `docs/architecture.md` §4.10

4. **Settings, SettingsPanel, Hints** wie in A) oben

5. **AGENTS.md** `docs/architecture.md` Tabellen aktualisieren:
   - §4.9 Komponenten-Tabelle
   - §4.10 Z-Layering
   - §4.11 FreqBeatDetector-Inventar

---

### C) Standalone HTML-Overlay-Effekt (ogl / non-R3F, wie Strands)

Für Effekte die NICHT in R3F integriert sind (eigene WebGL-Canvas, eigener rAF):

**🔴 Kritische Stolpersteine aus Session 20 (alle waren aktive Bugs):**

1. **Mounting**: IMMER nach `<AudioScene/>` mounten — R3F-Canvas mit `alpha:false` ist opak und verdeckt alles davor

2. **ogl-Program**: `transparent: true` setzen — ohne das ist Default-BlendFunc `gl.ONE/gl.ZERO` (opak, ignoriert Alpha-Channel)

3. **Vec3-Array-Uniforms**: Als `number[][]` übergeben, NICHT als `Float32Array`
   - ogl `flatten()` prüft `a[0].length` — bei Float32Array ist `a[0]` eine Number (kein `.length`) → uniform wird nie gesetzt → Shader bekommt Null-Werte
   - Fix: `number[][]` (jedes innere Array = ein vec3 Triple)

4. **ANGLE-Prefix**: Alle lokalen GLSL-Variablen mit komponentenspezifischem Prefix (für Strands: `str_`)

5. **Envelope/UV-Reihenfolge**: Falls Fade-Effekte auf Basis der Fragment-Koordinaten berechnet werden — VOR UV-Skalierung berechnen, sonst stimmt der Wertebereich nicht

6. **"Behind Logo" Maske**: CSS `radial-gradient` als `mask-image` nutzen
   ```tsx
   const r  = logoSize / 2 + 15;
   const r2 = r + 4;
   const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
   // style={{ maskImage, WebkitMaskImage: maskImage }}
   ```
   - mix-blend-mode (screen/soft-light) funktioniert NICHT zuverlässig für "hinter Logo aber vor BG"
   - SVG-Mask mit objectBoundingBox hat Koordinaten-Probleme

7. **Settings + SettingsPanel + Hints + AGENTS.md** wie in A/B, plus:
   - `docs/architecture.md` §4.10 HTML-Overlay-Layer-Tabelle
