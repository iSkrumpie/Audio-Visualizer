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
          so strands can never appear *behind* it. The `behindLogo` setting
          controls visual integration via blend mode:
          - true  (default): mix-blend-mode: screen — strands add bright color
            to the canvas; the logo and background show through where strands
            are dark. Looks like strands are 'under' the logo/background.
          - false: normal alpha-blend — strands fully cover whatever is
            underneath them in the visible region. */}
      {strandsEnabled && (
        <Strands style={strandsBehindLogo ? { mixBlendMode: 'screen' } : undefined} />
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
