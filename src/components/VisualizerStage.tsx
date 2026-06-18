/**
 * VisualizerStage — full-screen stage with Three.js scene + HTML overlays
 *
 * R3F Canvas handles all visual layers. TransportBar and SettingsPanel
 * are HTML overlays rendered on top of the canvas.
 */

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSettingsStore } from '@/lib/settingsStore';
import { AudioScene } from './three/AudioScene';
import { Strands } from './three/Strands';
import { LightRays } from './three/LightRays';
import { LightPillar } from './three/LightPillar';
import { logoMaskRadiusRef } from './three/CenterLogo';
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
  const logoEnabled = useSettingsStore((s) => s.settings.logo.enabled);

  // Refs for the mask-wrapper divs around each "behind logo" overlay.
  // A single rAF loop reads logoMaskRadiusRef (written by CenterLogo's
  // useFrame) and updates the mask style directly — no DOM write inside
  // the Three.js render loop, no CSS-variable interference.
  const strandsMaskRef    = useRef<HTMLDivElement>(null);
  const lightRaysMaskRef  = useRef<HTMLDivElement>(null);
  const lightPillarMaskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrappers = [strandsMaskRef, lightRaysMaskRef, lightPillarMaskRef];
    let animId: number;
    function tick() {
      animId = requestAnimationFrame(tick);
      const r = logoMaskRadiusRef.current;
      if (r <= 0) return;
      const mask = `radial-gradient(circle ${r}px at 50% 50%, transparent ${r}px, white ${r + 12}px)`;
      for (const ref of wrappers) {
        if (!ref.current) continue;
        ref.current.style.maskImage = mask;
        (ref.current.style as unknown as Record<string, string>).WebkitMaskImage = mask;
      }
    }
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

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
      {strandsEnabled && (
        strandsBehindLogo && logoEnabled
          ? (
            <div ref={strandsMaskRef} style={{ position: 'absolute', inset: 0 }}>
              <Strands />
            </div>
          ) : <Strands />
      )}

      {lightRaysEnabled && (
        lightRaysBehindLogo && logoEnabled
          ? (
            <div ref={lightRaysMaskRef} style={{ position: 'absolute', inset: 0 }}>
              <LightRays />
            </div>
          ) : <LightRays />
      )}

      {lightPillarEnabled && (
        lightPillarBehindLogo && logoEnabled
          ? (
            <div ref={lightPillarMaskRef} style={{ position: 'absolute', inset: 0 }}>
              <LightPillar />
            </div>
          ) : <LightPillar />
      )}

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
