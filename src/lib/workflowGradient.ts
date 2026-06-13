/**
 * Workflow-Gradient — die 4 Step-Farben aus dem Studio-Design.
 *
 * Wird an mehreren Stellen wiederverwendet:
 *  - Bars: Mapping pro Index auf den 4-Farben-Gradient
 *  - BackgroundPlane: subtiler 5%-Opacity Verlauf als Stage-Hintergrund
 *  - Zukünftige Step-Indikatoren / Header-Stripes
 *
 * Dark = heller (cyan-400, purple-500, pink-500, orange-500)
 * Light = dunkler (cyan-700, purple-700, pink-700, orange-700)
 *
 * Wir lesen den aktuellen Theme-Mode aus dem Settings-Store, damit
 * Light-Theme automatisch die dunkleren Schattierungen bekommt.
 */

import { getSettings } from './settingsStore';

export type WorkflowColor = { name: 'step-1' | 'step-2' | 'step-3' | 'step-4'; cssVar: string };

/**
 * Liefert die 4 Step-Farben als konkrete Hex-Strings (für Three.js).
 * Liest zur Laufzeit das aktuelle Theme aus dem Store, damit Light-Theme
 * automatisch die dunkleren Schattierungen bekommt.
 */
export function getWorkflowColors(): [string, string, string, string] {
  // Wir greifen direkt auf CSS-Vars zu — das ist die Source of Truth.
  // Im Light-Mode liefert getComputedStyle die --step-N (dunkler),
  // im Dark-Mode die helleren cyan/purple/pink/orange.
  // Touch getSettings() so that this helper is only called after
  // the settings store is initialized; the actual mode-aware values
  // come from CSS via the [data-theme] attribute.
  void getSettings().theme.mode;
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const v = (n: number) => styles.getPropertyValue(`--step-${n}`).trim();
  return [v(1), v(2), v(3), v(4)];
}

/**
 * Mappt einen Index [0..count) auf den Workflow-Gradient.
 * Index 0 → step-1 (cyan), Index count-1 → step-4 (orange).
 * Interpoliert gleichmäßig über alle 4 Stop-Points.
 *
 * Wird vom InstancedBars verwendet: colorMode = 'workflow-gradient'.
 */
export function workflowColorAt(index: number, count: number, out: { setHex: (h: string) => void } | { set: (s: string) => void } | any): void {
  if (count <= 0) {
    out.set('#6366F1');
    return;
  }
  const [c1, c2, c3, c4] = getWorkflowColors();
  // Position 0..1 entlang des 4-Stop-Gradient
  const t = (index / Math.max(count - 1, 1)) * 3; // 0..3
  const seg = Math.min(Math.floor(t), 2);
  const localT = t - seg;
  let a: string, b: string;
  if (seg === 0) { a = c1; b = c2; }
  else if (seg === 1) { a = c2; b = c3; }
  else { a = c3; b = c4; }
  out.set(lerpHex(a, b, localT));
}

/**
 * Linear-interpolation zwischen zwei Hex-Farben.
 * Erwartet Format '#RRGGBB'. Gibt '#RRGGBB' zurück.
 */
export function lerpHex(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bb = Math.round(a[2] + (b[2] - a[2]) * t);
  return '#' + [r, g, bb].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Subtiler Workflow-Gradient für die Stage-Hintergrund.
 * Rendert 4-Farben-Gradient als CSS-Hintergrund mit niedriger Opacity,
 * die zur Theme-BG passt.
 *
 * Wird in BackgroundPlane.tsx verwendet, wenn KEIN User-Image geladen ist.
 */
export function buildWorkflowBackgroundCSS(): string {
  const [c1, c2, c3, c4] = getWorkflowColors();
  // Diagonaler Verlauf (oben-links → unten-rechts) für mehr Tiefe.
  // Die Opacity wird über das alpha-Argument der rgba()-Form kontrolliert.
  const alpha = 0.07; // sehr subtil, ~5-7% je nach Farbe
  return (
    `linear-gradient(135deg,` +
    ` ${hexToRgba(c1, alpha)} 0%,` +
    ` ${hexToRgba(c2, alpha * 0.8)} 33%,` +
    ` ${hexToRgba(c3, alpha * 0.8)} 66%,` +
    ` ${hexToRgba(c4, alpha)} 100%)`
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
