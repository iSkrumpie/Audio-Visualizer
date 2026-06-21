# UPDATE.md — Settings Panel Redesign

**Lies diese Datei komplett bevor du anfängst. Alle Infos die du brauchst sind hier.**

---

## 0. Kontext & Rollback

- **Projekt**: AudioVisualizer · `C:/Users/tflag/Documents/AntiGravity/AudioVisualizer`
- **Rollback-Commit**: `d1388f1` — falls alles schiefläuft: `git reset --hard d1388f1`
- **Tech-Stack**: React 19, R3F, Tailwind v4 CSS-first, zustand 5, framer-motion 12
- **Haupt-Datei für alle Änderungen**: `src/components/SettingsPanel.tsx` (2745 Zeilen)

---

## 1. Was zu tun ist (4 Aufgaben, in dieser Reihenfolge)

### Aufgabe 1 — Panel-Hintergrund: Backdrop-Blur statt Opaque

**Warum**: Das Panel liegt bereits als absolutes Overlay über dem Canvas (Canvas hat `position: absolute, inset: 0`). Aber der Panel-Hintergrund ist komplett opaque (`var(--bg-elev-1)`), sodass man den Canvas dahinter nicht sieht. Mit Backdrop-Blur + semi-transparentem Hintergrund bleibt der Visualizer auch beim Einstellen sichtbar.

**Was ändern in `SettingsPanel.tsx`** (um Zeile 96):

```tsx
// VORHER:
style={{
  background: 'var(--bg-elev-1)',
  borderLeft: '1px solid var(--border)',
  boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.25)',
}}

// NACHHER:
style={{
  background: 'var(--bg-overlay)',       // CSS-Var: rgba(11,13,16,0.88) dark / rgba(245,246,248,0.88) light
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderLeft: '1px solid var(--border)',
  boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.35)',
}}
```

Die `--bg-overlay` CSS-Var ist bereits in `src/index.css` definiert:
- Dark: `rgba(11, 13, 16, 0.85)`
- Light: `rgba(245, 246, 248, 0.85)`

Du kannst sie leicht dunkler machen (`0.90` statt `0.85`) wenn gewünscht — passe direkt in `index.css` an.

---

### Aufgabe 2 — Neuer "Overlays" Tab

**Warum**: Der Background-Tab hat 16 Accordions — halb davon sind Shader-Effekte (Tint, Blur, etc.), halb sind standalone 3D-Overlay-Effekte (Strands, Lightning etc.). Das sind konzeptuell verschiedene Dinge.

**Welche Effekte kommen in den neuen Overlays-Tab:**
1. Strands
2. Light Rays
3. Light Pillar
4. Lightning
5. Magic Rings
6. Weather FX (Background Particles + Rain + Snow — bleiben als Gruppe)
7. Hyperspeed
8. Faulty Terminal

**Was im Background-Tab BLEIBT (nicht anfassen!):**
- Image, Tint, Beat FX, Vignette, Fog, Glow, Color, Effects (Noise/Scanlines/Glitch/etc.)

**Schritte:**

**2a. TABS-Array erweitern** (Zeile 20–23 in SettingsPanel.tsx):

```typescript
// VORHER:
const TABS = [
  { id: 'background', label: 'Background' },
  { id: 'logo',       label: 'Logo' },
  { id: 'bars',       label: 'Bars' },
  { id: 'particles',  label: 'Particles' },
] as const;
type Section = typeof TABS[number]['id'] | 'audio';

// NACHHER:
const TABS = [
  { id: 'background', label: 'Background' },
  { id: 'overlays',   label: 'Overlays' },
  { id: 'logo',       label: 'Logo' },
  { id: 'bars',       label: 'Bars' },
  { id: 'particles',  label: 'Particles' },
] as const;
type Section = typeof TABS[number]['id'] | 'audio';
```

**2b. Section-Switch erweitern** (Zeile ~254):

```tsx
// Hinzufügen:
{section === 'overlays'    && <OverlaysSection />}
```

**2c. Neue `OverlaysSection`-Funktion erstellen.**

Extrahiere aus `BackgroundSection` folgende `useF`-Hooks + JSX-Blöcke:

| Effect | useF-Hooks (Zeilennummern ca.) | Accordion-Block (Zeilennummern ca.) |
|--------|-------------------------------|-------------------------------------|
| Strands | ~747–795 | ~1181–1276 |
| Light Rays | ~795–818 | ~1277–1352 |
| Light Pillar | ~801–819 | ~1353–1417 |
| Lightning | ~819–883 | ~1418–1472 |
| Magic Rings | ~767–795 | ~1473–1544 |
| Weather FX | ~848–890 | ~1545–1674 |
| Hyperspeed | ~891–965 | ~1675–1763 |
| Faulty Terminal | ~913–965 | ~1764–1882 |

Diese Hooks + JSX vollständig aus `BackgroundSection` herausnehmen und in `OverlaysSection` einsetzen.

---

### Aufgabe 3 — Overlay-Effekte als OverlayCard (neue UI-Komponente)

**Warum**: Statt flacher Accordions (alle sehen gleich aus, man sieht nicht was aktiv ist) sollen die Overlay-Effekte als visuelle Cards erscheinen die sofort zeigen was enabled ist.

**Neue Komponente `OverlayCard`** in SettingsPanel.tsx hinzufügen (z.B. neben `EffectCard`):

```tsx
function OverlayCard({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="mb-2 overflow-hidden rounded-lg border transition-colors"
      style={{
        borderColor: enabled ? 'var(--accent)' : 'var(--border)',
        background: 'var(--bg-elev-2)',
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Active indicator dot */}
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full transition-colors"
          style={{ background: enabled ? 'var(--accent)' : 'var(--border-strong)' }}
        />
        {/* Effect name */}
        <span
          className="flex-1 font-ui text-xs font-semibold"
          style={{ color: enabled ? 'var(--text)' : 'var(--text-muted)' }}
        >
          {label}
        </span>
        {/* Toggle */}
        <Tg value={enabled} onChange={onToggle} />
        {/* Expand button — only if there are settings */}
        {children && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label={expanded ? 'Collapse settings' : 'Expand settings'}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
      {/* Settings — only when expanded AND enabled */}
      {expanded && enabled && children && (
        <div
          className="border-t px-3 pb-3 pt-3"
          style={{ borderColor: 'var(--border)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

**OverlaysSection nutzt OverlayCard statt Acc+Tg:**

```tsx
function OverlaysSection() {
  // ... alle useF-Hooks für die 8 Effekte ...

  return (
    <div className="space-y-0">
      <OverlayCard label="Strands" enabled={stE as boolean} onToggle={sStE}>
        {/* Bisheriger Inhalt des Strands-Accordions OHNE den äußeren Tg-Toggle */}
        {/* Also: Position-CB, Colors, alle Slider, HzRangePicker, BlendSel */}
      </OverlayCard>

      <OverlayCard label="Light Rays" enabled={lrE as boolean} onToggle={sLrE}>
        {/* Bisheriger Inhalt ohne Toggle */}
      </OverlayCard>

      {/* ... alle 8 Effekte analog ... */}

      <OverlayCard label="Weather FX" enabled={bgPE as boolean || rnE as boolean || snE as boolean} onToggle={(v) => { sBgPE(v); sRnE(v); sSnE(v); }}>
        {/* Weather FX ist ein Sonderfall: 3 Sub-Effekte */}
        {/* Zeige 3 EffectCards darin wie bisher */}
      </OverlayCard>
    </div>
  );
}
```

**Wichtige Detailregel für OverlaysSection:**

Das bisherige Muster in BackgroundSection für jeden Effekt war:
```tsx
<Acc label="Strands" description={...}>
  <Tg value={stE} onChange={sStE} label="Show strands" />   ← dieser Toggle entfällt
  {(stE as boolean) && (
    <>
      {/* settings */}
    </>
  )}
</Acc>
```

In OverlaysSection wird daraus:
```tsx
<OverlayCard label="Strands" enabled={stE as boolean} onToggle={sStE}>
  {/* Direkt die settings, OHNE äußeren enabled-Check — OverlayCard macht das intern */}
  <FR label="Position" info={...}>...</FR>
  {/* alle weiteren FRs */}
</OverlayCard>
```

**Weather FX Sonderfall** — hier gibt es 3 separate Toggles (bgParticles, rain, snow). OverlayCard-Header-Toggle schaltet alle 3 gemeinsam; innen weiterhin 3 EffectCards:

```tsx
const weatherEnabled = (bgPE as boolean) || (rnE as boolean) || (snE as boolean);
<OverlayCard
  label="Weather FX"
  enabled={weatherEnabled}
  onToggle={(v) => { sBgPE(v); sRnE(v); sSnE(v); }}
>
  <EffectCard label="Background particles" enabled={bgPE as boolean} onToggle={sBgPE} info={...}>
    {/* bisheriger Inhalt */}
  </EffectCard>
  <EffectCard label="Rain" enabled={rnE as boolean} onToggle={sRnE} info={...}>
    {/* bisheriger Inhalt */}
  </EffectCard>
  <EffectCard label="Snow" enabled={snE as boolean} onToggle={sSnE} info={...}>
    {/* bisheriger Inhalt */}
  </EffectCard>
</OverlayCard>
```

---

### Aufgabe 4 — Active-Count-Badge auf Tab-Buttons

**Warum**: Mit vielen Tabs und Effekten soll auf einen Blick erkennbar sein was aktiv ist.

**Wie**: Kleines Badge (Pill) neben dem Tab-Label das die Anzahl aktiver Effekte zeigt. Nur sichtbar wenn > 0.

**Werte berechnen im Haupt-SettingsPanel-Component** (wo die Tab-Buttons gerendert werden, ~Zeile 138–250):

```tsx
// Am Anfang der SettingsPanel-Funktion (nach den bestehenden useState/etc.):
const activeOverlays = useSettingsStore((s) => {
  const bg = s.settings.background;
  return [
    bg.strandsEnabled,
    bg.lightRaysEnabled,
    bg.lightPillarEnabled,
    bg.lightningEnabled,
    bg.magicRingsEnabled,
    bg.bgParticlesEnabled || bg.rainEnabled || bg.snowEnabled,
    bg.hyperspeedEnabled,
    bg.faultyTerminalEnabled,
  ].filter(Boolean).length;
});

const activeBackground = useSettingsStore((s) => {
  const bg = s.settings.background;
  return [
    bg.nebulaEnabled,
    bg.vignetteEnabled,
    bg.bloomEnabled,
    bg.caEnabled,
    bg.noiseEnabled,
    bg.scanlineEnabled,
    bg.glitchEnabled,
    bg.pixelationEnabled,
    bg.dotScreenEnabled,
    bg.gridEnabled,
    bg.sepiaEnabled,
    bg.colorAverageEnabled,
  ].filter(Boolean).length;
});

const logoEnabled = useSettingsStore((s) => s.settings.logo.enabled);
const barsEnabled = useSettingsStore((s) => s.settings.bars.enabled);
const particlesEnabled = useSettingsStore((s) => s.settings.particles.enabled);
```

**Badge-Rendering** — die Tab-Buttons rendern bereits ein Label. Erweitere auf:

```tsx
// Mapping Tab-ID → count (0 = kein Badge)
const tabCounts: Record<string, number> = {
  background: activeBackground,
  overlays: activeOverlays,
  logo: logoEnabled ? 1 : 0,
  bars: barsEnabled ? 1 : 0,
  particles: particlesEnabled ? 1 : 0,
};

// Im Tab-Button-Render (bestehende map über TABS):
<button key={s.id} ...>
  {s.label}
  {(tabCounts[s.id] ?? 0) > 0 && (
    <span
      className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-ui text-[9px] font-bold tabular-nums"
      style={{
        background: section === s.id ? 'var(--accent)' : 'var(--accent-muted, var(--border-strong))',
        color: section === s.id ? 'var(--bg-base)' : 'var(--text-muted)',
      }}
    >
      {tabCounts[s.id]}
    </span>
  )}
</button>
```

Für Logo/Bars/Particles zeigt das Badge `1` wenn enabled (nicht die Anzahl der Sub-Effekte). Für Background und Overlays zeigt es die genaue Anzahl aktiver Effekte.

---

## 2. Was NICHT geändert wird

- **Beat FX Accordion bleibt in Background** (explizit gewünscht)
- **Logo, Bars, Particles, Audio Tabs** — keine strukturellen Änderungen
- **settingsStore.ts** — keine Änderungen (kein Schema-Bump nötig)
- **Alle R3F-Komponenten** — keine Änderungen
- **AGENTS.md / docs/** — nach Fertigstellung updaten

---

## 3. Verifikations-Checkliste

Nach jeder Aufgabe:
```bash
npm run typecheck   # 0 Errors
npm run build       # ✓ built
```

Visuelle Checks (User öffnet Browser auf localhost:5173):
- [ ] Panel öffnen → Backdrop-Blur sichtbar, Canvas schemenhaft dahinter erkennbar
- [ ] "Overlays" Tab vorhanden zwischen Background und Logo
- [ ] Background-Tab: nur noch Image/Tint/Beat FX/Vignette/Fog/Glow/Color/Effects
- [ ] Overlays-Tab: 8 EffektCards (Strands, Light Rays, Light Pillar, Lightning, Magic Rings, Weather FX, Hyperspeed, Faulty Terminal)
- [ ] OverlayCard: Toggle schaltet Effekt, Expand-Pfeil zeigt Settings, aktiver Effekt hat Accent-Border
- [ ] Tab-Badges zeigen korrekte Zahlen
- [ ] Alle bestehenden Settings noch vorhanden und funktionsfähig

---

## 4. Commit-Strategie

Separate Commits für jede Aufgabe:
```
style(SettingsPanel): panel backdrop-blur overlay
feat(SettingsPanel): add Overlays tab, extract overlay effects
feat(SettingsPanel): OverlayCard component for overlay effects
feat(SettingsPanel): active count badges on tab headers
```

---

## 5. Fallstricke

**TypeScript**: `section` hat Typ `typeof TABS[number]['id'] | 'audio'`. Nach dem TABS-Update wird `'overlays'` automatisch valide.

**WeatherFX**: Hat drei separate enable-Flags. Der OverlayCard-Master-Toggle schaltet alle drei; trotzdem bleiben innen drei separate EffectCards für individuelle Kontrolle.

**useF-Hook-Scope**: Die useF-Hooks für die 8 Overlay-Effekte müssen aus `BackgroundSection` entfernt und in `OverlaysSection` verschoben werden. Sie dürfen NICHT in beiden Funktionen gleichzeitig existieren (doppelter useSettingsStore-Aufruf mit identischem Selector ist unproblematisch, aber unnötig und verwirrend).

**Backdrop-Filter Browser-Support**: `backdrop-filter` braucht `-webkit-backdrop-filter` als Fallback für ältere Chromium. Beide setzen.

**OverlayCard + children immer undefined-safe**: `{children && ...}` reicht, kein TS-Error.

---

*Erstellt am Ende von Session 22. Rollback: `git reset --hard d1388f1`*
