/**
 * VisualizerStage — full-screen stage with Three.js scene + HTML overlays
 *
 * R3F Canvas handles all visual layers (including Strands, LightRays,
 * LightPillar — now inside the scene graph for export support).
 * TransportBar and SettingsPanel are HTML overlays rendered on top.
 */

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { AudioScene } from './three/AudioScene';
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
  const stageRef = useRef<HTMLDivElement>(null);

  return (
    <motion.div
      ref={stageRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Three.js Canvas — all visual layers (R3F with alpha:false is opaque) */}
      <AudioScene />

      {/* HTML overlays on top of the canvas */}
      <TransportBar
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onBack={onBack}
        onExport={onExport}
        dragConstraintsRef={stageRef}
      />
      <SettingsPanel />
    </motion.div>
  );
}
