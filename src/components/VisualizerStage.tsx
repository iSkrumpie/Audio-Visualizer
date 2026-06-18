/**
 * VisualizerStage — full-screen stage with Three.js scene + HTML overlays
 *
 * R3F Canvas handles all visual layers. TransportBar and SettingsPanel
 * are HTML overlays rendered on top of the canvas.
 */

import { motion } from 'framer-motion';
import { useSettingsStore } from '@/lib/settingsStore';
import { AudioScene } from './three/AudioScene';
import { Strands } from './three/Strands';
import { TransportBar } from './TransportBar';
import { SettingsPanel } from './SettingsPanel';

type VisualizerStageProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBack: () => void;
  onExport: () => void;
};

export function VisualizerStage({
  isPlaying,
  onTogglePlay,
  onBack,
  onExport,
}: VisualizerStageProps) {
  const strandsEnabled    = useSettingsStore((s) => s.settings.background.strandsEnabled);
  const strandsBehindLogo = useSettingsStore((s) => s.settings.background.strandsBehindLogo);
  const logoEnabled       = useSettingsStore((s) => s.settings.logo.enabled);
  const logoSize          = useSettingsStore((s) => s.settings.logo.size);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Three.js Canvas — all visual layers (R3F with alpha:false is opaque) */}
      <AudioScene />

      {/* Strands AFTER R3F canvas in DOM order. R3F is opaque (alpha:false),
          so strands can never appear *behind* it in the strict DOM sense.
          The `behindLogo` setting uses an SVG mask to punch a hole where
          the logo sits — strands render fully visible everywhere else
          but are hidden behind the logo circle, mimicking a true
          background-layer effect.
          - true  (default): masked-out logo circle; strands look like
            they're behind the logo but visible over the background image.
          - false: full coverage — strands float in front of everything. */}
      {strandsEnabled && (() => {
        // Compute mask: full white = visible, full black = hidden.
        // We want strands visible EVERYWHERE except inside the logo disc.
        // The logo sits at center with diameter = logoSize (px), so radius
        // = logoSize/2 in normalized space (50% = half the smaller axis).
        if (!strandsBehindLogo || !logoEnabled) {
          return <Strands />;
        }
        // Logo radius as % of half the smaller viewport axis (since the
        // SVG mask uses objectBoundingBox which is a 0..1 box).
        const radiusPct = (logoSize / 2) / Math.min(window.innerWidth, window.innerHeight);
        const maskId = 'strands-logo-mask';
        return (
          <>
            <svg
              width="0"
              height="0"
              style={{ position: 'absolute', pointerEvents: 'none' }}
              aria-hidden
            >
              <defs>
                <mask id={maskId} maskUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
                  {/* White = visible, black = hidden. The mask covers the
                      full area (white) but with a black circle cut out
                      where the logo is, centered. */}
                  <rect x="0" y="0" width="1" height="1" fill="white" />
                  <circle
                    cx="0.5"
                    cy="0.5"
                    r={Math.min(radiusPct, 0.5)}
                    fill="black"
                  />
                </mask>
              </defs>
            </svg>
            <Strands style={{ mask: `url(#${maskId})`, WebkitMask: `url(#${maskId})` }} />
          </>
        );
      })()}

      {/* HTML overlays on top of the canvas */}
      <TransportBar
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onBack={onBack}
        onExport={onExport}
      />
      <SettingsPanel />
    </motion.div>
  );
}
