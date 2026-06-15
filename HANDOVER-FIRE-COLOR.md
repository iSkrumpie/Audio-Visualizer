# HANDOVER: Fire Color Tuning — Session 16 Fortsetzung

**Stand:** Letzter funktionierender Fire = Commit `9d6e6a5` (continuous roaring ring).
**Aktueller HEAD:** `e210a23` (Revert der 3 fehlgeschlagenen ColorMode-Versuche).

---

## Was funktioniert (Status quo)

- ✅ **Fire lodert** als kontinuierlicher Ring um das Logo (keine Lücken, bündig am Rand)
- ✅ **Sparks** sind sichtbar mit 3 Color-Pickern (Hot/Mid/Cool) — funktioniert seit dem Commit `3e3c835` (zusammen mit dem Revert in `508a8ca` behalten)
- ✅ **Settings** (Height, Intensity, Speed, Reactivity) wirken sichtbar
- ✅ **Alles baut clean** (typecheck + build)

## Was NICHT funktioniert

- ❌ **Fire-ColorPicker (Hot/Mid/Cool)** wirken nicht wie erwartet — die 3 User-Farben werden 45-55% mit hardcoded Blackbody (orange/gelb/weiß) gemischt. User-Eingaben werden quasi ignoriert. User wollte: User-Farbe wird **direkt** angezeigt, ohne Blackbody-Override.
- ❌ **Color-Mode Enum** (solid/gradient/rainbow/...) analog zu Bars/Particles — 3-mal versucht, alle 3 haben das Feuer unsichtbar gemacht.

## Was passiert ist (die 3 fehlgeschlagenen Versuche)

| # | Commit | Was | Warum kaputt |
|---|---|---|---|
| 1 | `a2e767b` | Komplettes colorMode-Enum eingebaut (6 Modi, if/else-if chain) | Die `if/else-if` chain im GLSL Shader hat auf der Ziel-Hardware nicht zuverlässig funktioniert — alle Modi außer Gradient haben schwarze oder zu dunkle Farben geliefert |
| 2 | `48f9be4` | "Fix" mit brightness boost 1.4× + discard-threshold von 0.004 auf 0.002 | Half-fix. Feuer noch immer zu dunkel oder zu unsichtbar weil die Modi-Logik selbst kaputt war |
| 3 | `3984f0e` | "Fix" mit step()-basiertem mode-switch (no if/else) + brightness floor | Half-fix. `step()`-basierter Mode-Switch hat subtile Boundary-Probleme (z.B. `step(0.5, uFrColorMode) * step(uFrColorMode, 1.5)` evaluiert zu 0 wenn `uFrColorMode == 1.5` exakt). Plus fr_color hatte immer noch den Blackbody-Mix drin. |

Alle 3 reverted in Commit `e210a23`. HEAD ist jetzt **wieder auf 9d6e6a5-Stand**, plus die 3 Sparks-Color-Picker.

## Aktuelle Fire-Color-Implementierung (in `CenterLogo.tsx`, ~Zeile 242-260)

```glsl
vec3 fr_fireColor(float fr_heat) {
  vec3 fr_black  = vec3(0.00, 0.00, 0.00);
  vec3 fr_dkred  = mix(vec3(0.70, 0.04, 0.00), uFrColorOuter, 0.55);  // ← 45% hardcoded!
  vec3 fr_orange = mix(vec3(1.00, 0.32, 0.00), uFrColorMid,   0.45);  // ← 55% hardcoded!
  vec3 fr_yellow = vec3(1.00, 0.86, 0.14);                              // ← 100% hardcoded!
  vec3 fr_white  = mix(vec3(1.00, 0.96, 0.80), uFrColorInner, 0.30);  // ← 70% hardcoded!

  vec3 fr_c = mix(fr_black,  fr_dkred,  smoothstep(0.00, 0.22, fr_heat));
  fr_c      = mix(fr_c,      fr_orange, smoothstep(0.18, 0.48, fr_heat));
  fr_c      = mix(fr_c,      fr_yellow, smoothstep(0.42, 0.72, fr_heat));
  fr_c      = mix(fr_c,      fr_white,  smoothstep(0.66, 0.92, fr_heat));
  return fr_c;
}
```

**Das ist der Bug:** `fr_yellow` ist komplett hardcoded `vec3(1.00, 0.86, 0.14)` — egal welche User-Farben gewählt werden, die mittlere Zone bleibt immer gelb. Plus `fr_white` ist 70% hardcoded weiß.

## Empfohlener Ansatz für die nächste Session

Statt eines kompletten colorMode-Enum-Rewrites, **chirurgisch minimal** vorgehen:

### Schritt 1: User-Farben unverfälscht anzeigen

**Ersetze** die Blackbody-Mischung durch eine **einfache 3-Stop-User-Gradient** ohne Hardcoded-Farben:

```glsl
vec3 fr_fireColor(float fr_heat) {
  // 3-stop user gradient: hot (base) -> mid (middle) -> cool (tip)
  // Black tip = vec3(0) so fr_heat=0 → invisible (correct, flame tip fades)
  vec3 fr_c = mix(uFrColorHot, uFrColorMid,  smoothstep(0.0, 0.5, fr_heat));
  fr_c      = mix(fr_c,        uFrColorCool, smoothstep(0.5, 0.85, fr_heat));
  fr_c      = mix(fr_c,        vec3(0.0),   smoothstep(0.85, 1.0, fr_heat));
  return fr_c;
}
```

**Wichtig:** KEIN if/else, KEIN colorMode-Enum, KEINE neuen Uniforms. Nur die `fr_yellow` Zeile löschen und die Mix-Werte ändern.

### Schritt 2 (optional): Brightness-Boost für dunkle User-Farben

```glsl
fr_c *= 1.5;  // boost because additive blending against dark bg
```

### Schritt 3 (optional): Color-Mode "Solid" als EINZIGEN zusätzlichen Modus

Falls der User zusätzlich zu den 3 Picker-Pickern einen **Solid-Modus** haben will (1 Farbe für die ganze Flamme), dann:

```glsl
uniform float uFrIsSolid;  // 0.0 oder 1.0
uniform vec3  uFrSolidColor;

vec3 fr_userGrad = mix(uFrColorHot, uFrColorMid,  smoothstep(0.0, 0.5, fr_heat));
fr_userGrad      = mix(fr_userGrad, uFrColorCool, smoothstep(0.5, 0.85, fr_heat));
fr_userGrad      = mix(fr_userGrad, vec3(0.0),   smoothstep(0.85, 1.0, fr_heat));

// Mode-Switch via simple lerp (no if/else, no step boundaries):
return mix(fr_userGrad, uFrSolidColor * fr_heat, uFrIsSolid);
```

Im JS in `useFrame`:
```typescript
fireUniforms.uFrIsSolid.value = s.fireColorMode === 'solid' ? 1.0 : 0.0;
```

## Was beim nächsten Mal NICHT zu tun ist

- ❌ **Kein if/else-if chain** in GLSL fragment shader für mode-switching
- ❌ **Keine step(uFrColorMode, X) * step(X, Y)** Kombinationen (Boundary-Bugs)
- ❌ **Keine 5-stop Blackbody-Color mit hardcoded Werten** — der User will die User-Farben 1:1 sehen
- ❌ **Nicht den ganzen Shader neu schreiben** in einem Commit — stattdessen iterativ: erst nur die Color-Funktion ändern, dann testen, dann ggf. mehr

## Was auf jeden Fall behalten werden soll

- ✅ **Continuous Roaring Ring** (Commit `9d6e6a5`) — das ist der aktuelle Fire-Look
- ✅ **Inner-cut Fix** (in Commit `508a8ca`) — kein Spalt zwischen Logo und Fire
- ✅ **Sparks 3-Color-Picker** (aus `3e3c835` / `508a8ca`) — funktioniert einwandfrei
- ✅ **SettingsPanel Fire-Accordion mit Info-Icons** (Hint-Texte vorhanden in `hints.ts`)

## Test-Protokoll nach dem Fix

1. Build clean (`npm run typecheck && npm run build`)
2. Starte `npm run dev` (User macht das)
3. Lade ein Audio-File hoch
4. Aktiviere Fire
5. Setze alle 3 Color-Picker auf **reines Grün** (#00ff00)
6. **Erwartet:** Das Feuer sollte **grün lodern** (nicht gelb/orange/weiß)
7. Setze alle 3 auf **reines Blau** (#0000ff)
8. **Erwartet:** Das Feuer sollte **blau lodern**
9. Falls das funktioniert: optional den Solid-Mode (Schritt 3) hinzufügen

## Datei-Übersicht (was zu ändern ist)

| Datei | Zeile (ungefähr) | Was zu tun |
|---|---|---|
| `src/components/three/CenterLogo.tsx` | ~242-260 | `fr_fireColor` neu schreiben (siehe Schritt 1 oben) |
| `src/components/three/CenterLogo.tsx` | ~344 | `vec3 fr_color = fr_fireColor(fr_heat)` (nur Argument prüfen, sollte 2-arg sein) |
| `src/lib/settingsStore.ts` | (nichts) | NICHT ändern — schema bleibt v14 |
| `src/lib/hints.ts` | (nichts) | NICHT ändern |
| `src/components/SettingsPanel.tsx` | (nichts) | NICHT ändern |

## Letzter Commit vor diesem Handover

`e210a23 Revert 3 broken fire colorMode attempts (a2e767b, 48f9be4, 3984f0e)`

HEAD zeigt auf den funktionierenden Stand. Die 3 Color-Picker im UI bleiben sichtbar (das ist OK — sie sind im Default-Zustand, sehen also orange aus, was zu "Fire" passt).
