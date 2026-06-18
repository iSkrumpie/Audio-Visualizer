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

### Pattern 6: Uniform-Updates via `mat.uniforms` (ShaderMaterial) — KRITISCH

```typescript
// ✅ RICHTIG — direkt über matRef.current.uniforms:
const matRef = useRef<THREE.ShaderMaterial>(null);

useFrame((state, delta) => {
  const mat = matRef.current;
  if (!mat) return;
  mat.uniforms.uTime.value += delta;
  mat.uniforms.uColor.value.set('#ff0000');
});

// Initiale Werte in useMemo([]) setzen:
const uniforms = useMemo(() => ({
  uTime:  { value: 0 },
  uColor: { value: new THREE.Color('#ff0000') },
}), []);

// JSX:
<shaderMaterial ref={matRef} uniforms={uniforms} ... />
```

**🔴 NICHT so — stilles Bug:**
```typescript
// ❌ FALSCH — mutiert useMemo-Objekt direkt:
uniforms.uTime.value += delta;  // wirkt NICHT zuverlässig auf den Shader
```

**Warum:** R3F/Three.js kann beim Konstruieren eines `ShaderMaterial` intern eine eigene Kopie der Uniforms anlegen (über `setValues()` + `Object.assign()`). Die entstehenden Shallow-Copy-Strukturen sind nicht identisch mit dem originalen `useMemo`-Objekt. Mutationen am Original kommen ggf. nie beim Shader an.

**Sicheres Pattern:** Immer `matRef.current.uniforms.X.value = ...` verwenden — dann arbeitet man mit dem Objekt, das die GPU tatsächlich liest. Genau so macht es `BackgroundPlane.tsx`.

**Symptom bei Fehler:** Effekt ist sichtbar (initiale Uniform-Werte werden gerendert), aber reagiert nicht auf `useFrame`-Updates und nicht auf Settings-Änderungen. Sieht aus wie ein eingefrorener/statischer Effekt.

---

### Pattern 7: Full-Screen-Quad in orthografischer Kamera

```typescript
// Die Kamera in AudioScene ist orthographic mit zoom=1:
// → 1 world unit = 1 CSS pixel
// → PlaneGeometry(2, 2) ist buchstäblich 2×2 Pixel groß!

// ✅ RICHTIG — in useFrame skalieren:
useFrame((state, delta) => {
  const { width, height } = state.size;  // aus state-Callback, nicht Closure
  if (meshRef.current) meshRef.current.scale.set(width, height, 1);
  // ... rest der Uniform-Updates
});

// ❌ FALSCH — statische Größe:
<mesh scale={[1920, 1080, 1]} ... />  // nur bei DIESER einen Auflösung korrekt
```

**Warum:** `BackgroundPlane` skaliert sich auf `width * 1.16 × height * 1.16` (mit Oversize-Margin für beat-scale). Neue Full-Screen-Komponenten müssen das gleiche tun.

**Symptom bei Fehler:** Effekt erscheint als winziges Rechteck in der Mitte, oder ist gar nicht sichtbar.

---

### Pattern 8: `useFrame` state.size (R3F-Resize-Safety)

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
- Uniforms einmalig in `useMemo([])` **initialisieren**, per-Frame via `matRef.current.uniforms.X.value = ...` mutieren (nie das useMemo-Objekt direkt mutieren — → Pattern 6)

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

---

### ⚡ Schritt 0 — Beat-Reaktivität klären (PFLICHT vor jeder Implementierung)

**Vor dem ersten Commit muss feststehen:**
1. **Was reagiert auf den Beat?** — Mindestens eine visuelle Eigenschaft benennen (siehe Tabelle unten)
2. **Wie reagiert es?** — Kurze Formel: `effektiver Wert = Basiswert * (1 + beat * stärke)`
3. **Eigener Regler im UI?** — Jede Beat-Reaktion bekommt einen eigenen Slider (`*GlowBoost`, `*BurstStrength`, etc.) damit der User sie unabhängig steuern kann
4. **Hints geplant?** — Für jedes Setting-Feld sofort einen Hint-Text formulieren (→ Hints-Regeln weiter unten)
5. **"Position" (Behind Logo / In front)?** — Bei jedem neuen Standalone-HTML-Overlay-Effekt (Typ C) **PFLICHT**: Skrumpie fragen ob ein `*BehindLogo`-Setting eingebaut werden soll (Default: ja). Siehe §C-Punkt 8 für das exakte Implementierungs-Muster.

Diesen Block **immer in den Worker-Brief aufnehmen** — der Worker soll diese Entscheidungen NICHT selbst treffen.

#### Beat-Reaktivitäts-Referenz: Was kann für welchen Effekttyp reagieren?

| Effekttyp | Typische Beat-Targets | Beispiel aus dem Projekt |
|---|---|---|
| **Shader-Ringe / Kreise** | Attenuation ↓ (= Ring breiter/glühender), Helligkeit ↑, Koordinaten-Scale (Zoom), Radius | MagicRings: `uGlowBeat` → Attenuation × `(1 - beat·strength)`, `uBurst` → Zoom + Helligkeit |
| **Ribbon / Strands** | Amplitude ↑ (Ausschlag), Glow ↑ (Leuchten), Thickness, Speed | Strands: `uAmplitude * (1 + boost*0.4)`, `uGlow * (1 + boost*glowBoost)` |
| **Partikel** | Spawn-Burst (neue Partikel), Size ↑, Speed ↑, Orbit-Radius ↑ | GPUParticles: `kickBurstStrength` → schiesst neue Partikel aus |
| **Logo / Mesh** | Scale ↑ (Punch), Glow-Intensität ↑, Rotation-Burst | CenterLogo: `beatScaleStrength`, Fire-Ring: `fireReactivity` |
| **Hintergrund-Plane** | Vignette ↑, Blur ↑/↓, Helligkeit ↑, Color-Shift | BackgroundPlane: `scaleOnBeat` (leichtes Zoom), `beatFxSensitivity` |
| **Bars / FFT-Visual** | Bar-Höhe ↑, Peak-Amplitude, Rotation-Speed | InstancedBars: `beatFreq*` + `beatSensitivity` → `barH += beat * 25 * scale` |
| **Fog / Nebula** | Pulsierend aufleuchten, Drift-Speed ↑ | NebulaPlane: `nebulaBeatMode` → `uAudioPulse` |
| **Partikel-Linien** | Connection-Opacity ↑, Line-Thickness ↑ | GPUParticles connectionLines |

**Merkhilfe — jeder Effekt hat mindestens 2 Beat-Targets:**
- Ein **primäres**: das Offensichtliche (Größe, Helligkeit, Ausschlag)
- Ein **sekundäres**: etwas Atmosphärisches (Glow, Unschärfe-Halo, Color-Shift)

Beispiel MagicRings: primär = Burst (Zoom + Helligkeit), sekundär = Glow (Attenuation-Reduktion → Ringe blühen breiter).

---

### A) R3F-Shader-Effekt (in BackgroundPlane.tsx)

Für neue Effekte die den gesamten Hintergrund betreffen (Blur, Tint, Bloom, Glitch, etc.):

> **⚡ Schritt 0 zuerst:** Beat-Reaktivität mit Skrumpie klären (primäres + sekundäres Target), dann erst umsetzen.

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
   - **🔴 Jedes `<FR>` MUSS `info={hintFor('group.field')}` haben** — kein FR ohne Hint-Eintrag

5. **Hints** in `src/lib/hints.ts` — **Vollständig und Pflicht**
   - **Jedes** Settings-Feld bekommt einen eigenen Eintrag (keine Ausnahmen, auch nicht `*Enabled`)
   - Format: `'background.fieldName': 'Klartext, 60–150 Zeichen, was der Effekt visuell tut'`
   - Kein Jargon (nicht "FFT-Bin" oder "Uniform"), immer aus User-Perspektive
   - Beat-Settings-Template: `'Lowest/Highest frequency that triggers X'` / `'How strongly a beat affects X. 0 = no reaction; 2 = strong Y.'`
   - **Verifikation**: `grep -c 'hintFor' src/components/SettingsPanel.tsx` ≈ Anzahl der neuen FR-Elemente

6. **Verifikation**: `npm run typecheck && npm run build`

7. **AGENTS.md** `docs/architecture.md` §4.6 Background-Gruppe aktualisieren

---

### B) R3F Standalone-Komponente (z.B. neue Partikel, neues Mesh)

Für neue eigenständige Three.js-Komponenten im R3F-Scene-Graph:

> **⚡ Schritt 0 zuerst:** Beat-Reaktivität mit Skrumpie klären (primäres + sekundäres Target), dann erst umsetzen.

1. **Datei** `src/components/three/MeineKomponente.tsx`
   - Settings per Frame via `getSettings()` lesen (NICHT `useSettingsStore` in Three.js!)
   - `useFrame((state, delta) => { const { width, height } = state.size; ... })` — state.size aus Callback, nicht aus Closure!
   - **ShaderMaterial-Uniforms** IMMER via `mat.uniforms.X.value` updaten, NIE via `useMemo`-Objekt direkt (→ Pattern 6)
   - **Full-Screen-Quad** muss in `useFrame` auf `width × height` skaliert werden (→ Pattern 7)

2. **FreqBeatDetector** (wenn Audio-reaktiv):
   ```ts
   const detector = useMemo(() => new FreqBeatDetector(48000), []);
   useBeatDetectorRegistration(detector); // für Export-Reset
   const phaseSrc = usePhaseSource({ detector, getPrecomputedRange, liveFn });
   // in useFrame: const beat = phaseSrc();
   ```

3. **Z-Layering** in `AudioScene.tsx` eintragen (korrekte Reihenfolge!)
   - Referenz: `docs/architecture.md` §4.10

4. **Settings + SettingsPanel + Hints** — wie in A) oben, alle drei Punkte vollständig:
   - Jedes `<FR>` bekommt `info={hintFor('group.field')}`
   - Jedes Settings-Feld bekommt einen Hint-Eintrag in `hints.ts`

5. **AGENTS.md** `docs/architecture.md` Tabellen aktualisieren:
   - §4.9 Komponenten-Tabelle
   - §4.10 Z-Layering
   - §4.11 FreqBeatDetector-Inventar

---

### C) Standalone HTML-Overlay-Effekt (ogl / non-R3F, wie Strands)

Für Effekte die NICHT in R3F integriert sind (eigene WebGL-Canvas, eigener rAF):

> **⚡ Schritt 0 zuerst:** Beat-Reaktivität mit Skrumpie klären (primäres + sekundäres Target), dann erst umsetzen.

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

7. **Settings + SettingsPanel + Hints + AGENTS.md** — wie in A) vollständig, plus:
   - `docs/architecture.md` §4.10 HTML-Overlay-Layer-Tabelle
   - Jedes `<FR>` bekommt `info={hintFor(...)}`, jedes Feld einen Hint in `hints.ts`

8. **"Position" (Behind Logo / In front) — Pflicht-Muster** (wenn vom User bestätigt, Default: ja):

   **a) settingsStore.ts** — neues Boolean-Feld `*BehindLogo: boolean` (Default: `true`):
   ```typescript
   myEffectBehindLogo: boolean;   // default true
   // DEFAULT_SETTINGS:
   myEffectBehindLogo: true,
   ```

   **b) VisualizerStage.tsx** — gleiche Masken-Logik wie Strands, NACH dem Strands-Block:
   ```tsx
   const myEffectEnabled    = useSettingsStore((s) => s.settings.background.myEffectEnabled);
   const myEffectBehindLogo = useSettingsStore((s) => s.settings.background.myEffectBehindLogo);

   {myEffectEnabled && (() => {
     if (!myEffectBehindLogo || !logoEnabled) {
       return <MyEffect />;
     }
     const r  = logoSize / 2 + 15;
     const r2 = r + 4;
     const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
     return (
       <MyEffect
         style={{ maskImage, WebkitMaskImage: maskImage }}
       />
     );
   })()}
   ```

   **c) SettingsPanel.tsx** — "Position"-Row als **erstes Setting** nach dem Master-Toggle (exakt wie Strands):
   ```tsx
   <Tg value={myEffectEnabled} onChange={setMyEffectEnabled} label="Show My Effect" />
   {myEffectEnabled && (
     <>
       {/* ← HIER als ERSTES — wie bei Strands */}
       <FR label="Position" info={hintFor('background.myEffectBehindLogo')}>
         <CB
           value={(myEffectBehindLogo as boolean) ? 'behind' : 'front'}
           options={[
             { value: 'behind', label: 'Behind logo' },
             { value: 'front',  label: 'In front'    },
           ]}
           onChange={(v) => setMyEffectBehindLogo(v === 'behind')}
         />
       </FR>
       {/* ... rest der Settings */}
     </>
   )}
   ```

   **d) hints.ts** — Hint-Text nach dem Strands-Muster:
   ```typescript
   'background.myEffectBehindLogo':
     'When set to "Behind logo", the effect is masked out at the logo position. "In front" lets it cover everything including the logo.',
   ```

   **Wichtig:** FR-Label ist immer **"Position"** (nicht "Behind Logo" oder ähnliches) — identisch zu Strands.
   **Wichtig:** Der "Position"-Block kommt immer **als erstes Setting** nach dem Master-Toggle — identisch zu Strands.
