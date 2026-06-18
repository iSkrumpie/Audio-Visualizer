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
import { LightRays } from './three/LightRays';
import { LightPillar } from './three/LightPillar';
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
  const strandsEnabled      = useSettingsStore((s) => s.settings.background.strandsEnabled);
  const strandsBehindLogo   = useSettingsStore((s) => s.settings.background.strandsBehindLogo);
  const lightRaysEnabled      = useSettingsStore((s) => s.settings.background.lightRaysEnabled);
  const lightRaysBehindLogo   = useSettingsStore((s) => s.settings.background.lightRaysBehindLogo);
  const lightPillarEnabled    = useSettingsStore((s) => s.settings.background.lightPillarEnabled);
  const lightPillarBehindLogo = useSettingsStore((s) => s.settings.background.lightPillarBehindLogo);
  const logoEnabled         = useSettingsStore((s) => s.settings.logo.enabled);
  const logoSize            = useSettingsStore((s) => s.settings.logo.size);


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
          'Behind logo' uses a CSS radial-gradient mask: transparent circle
          at center (= logo position) hides strands there, opaque outside
          leaves strands fully visible over the background image.
          - true  (default): CSS mask with circular cutout at logo position
          - false: no mask, strands float in front of everything */}
      {strandsEnabled && (() => {
        if (!strandsBehindLogo || !logoEnabled) {
          return <Strands />;
        }
        // Logo is centered in the viewport. Radius in px = half the size
        // setting. Add a small feather (8px) so the cutout edge is soft.
        const r  = logoSize / 2 + 15;
        const r2 = r + 4; // soft feather edge
        const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
        return (
          <Strands
            style={{
              maskImage,
              WebkitMaskImage: maskImage,
            }}
          />
        );
      })()}

      {/* LightRays AFTER Strands in DOM order — same masking pattern as Strands */}
      {lightRaysEnabled && (() => {
        if (!lightRaysBehindLogo || !logoEnabled) {
          return <LightRays />;
        }
        const r  = logoSize / 2 + 15;
        const r2 = r + 4;
        const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
        return (
          <LightRays
            style={{
              maskImage,
              WebkitMaskImage: maskImage,
            }}
          />
        );
      })()}

      {/* LightPillar AFTER LightRays in DOM order — same masking pattern */}
      {lightPillarEnabled && (() => {
        if (!lightPillarBehindLogo || !logoEnabled) {
          return <LightPillar />;
        }
        const r  = logoSize / 2 + 15;
        const r2 = r + 4;
        const maskImage = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r2}px)`;
        return (
          <LightPillar
            style={{
              maskImage,
              WebkitMaskImage: maskImage,
            }}
          />
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
