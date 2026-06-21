/**
 * TransportBar — Player (Timebar + Play/Pause + Volume + Export)
 *
 * Studio aesthetic: hairline-bordered surface, no glow, neutral.
 *
 * v2 — Studio-Player redesign:
 *  - Linear Studio slider (via global CSS in index.css)
 *  - Subtle workflow-stripe along the top (1px gradient hint)
 *  - Play-button matches the step-1 cyan action-style from the Uploader
 *  - Volume is icon-only with a popover (cleaner) — but here as inline slider
 *  - Smaller hit areas, tighter padding, more breathing room
 */

import { useCallback } from 'react';
import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { useAudioStore } from '@/lib/audioStore';
import { useSettingsStore } from '@/lib/settingsStore';
import { formatTime } from '@/lib/utils';


type TransportBarProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBack: () => void;
  onExport: () => void;
  dragConstraintsRef?: React.RefObject<HTMLDivElement | null>;
};

export function TransportBar({ isPlaying, onTogglePlay, onBack, onExport, dragConstraintsRef }: TransportBarProps) {
  const dragControls = useDragControls();

  // ── Drag position persistence ──────────────────────────────────────────
  const STORAGE_KEY = 'audiovisualizer:player-pos';
  const savedPos = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as { x: number; y: number };
    } catch {}
    return { x: 0, y: 0 };
  })();
  const motionX = useMotionValue(savedPos.x);
  const motionY = useMotionValue(savedPos.y);

  // ── Autoplay ───────────────────────────────────────────────────────────
  const autoplay = useSettingsStore((s) => s.settings.theme.autoplay);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const toggleAutoplay = useCallback(() =>
    setSettings((prev) => ({
      ...prev,
      theme: { ...prev.theme, autoplay: !prev.theme.autoplay },
    })),
    [setSettings],
  );

  const currentTime = useAudioStore((s) => s.currentTime);
  const volume = useAudioStore((s) => s.volume);
  const setVolume = useAudioStore((s) => s.setVolume);
  const duration = useAudioStore((s) => s.audioMetadata?.duration ?? 0);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    useAudioStore.getState().setCurrentTime(time);
    window.dispatchEvent(new CustomEvent('audiovisualizer:seek', { detail: { time } }));
  }, []);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const volPct = volume * 100;

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={dragConstraintsRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
      onDragEnd={() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: motionX.get(), y: motionY.get() }));
        } catch {}
      }}
      className="absolute bottom-6 left-1/2 flex w-[min(680px,calc(100%-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border"
      style={{
        x: motionX,
        y: motionY,
        background: 'var(--bg-overlay)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        cursor: 'default',
      }}
    >
      {/* Drag handle — initiates drag on pointer down */}
      <div
        className="flex cursor-grab items-center justify-center py-1 active:cursor-grabbing select-none"
        onPointerDown={(e) => dragControls.start(e)}
        style={{ touchAction: 'none' }}
        aria-label="Drag to reposition"
      >
        <svg
          width="20"
          height="6"
          viewBox="0 0 20 6"
          fill="none"
          aria-hidden
        >
          <circle cx="6" cy="1.5" r="1" fill="var(--border-strong)" />
          <circle cx="10" cy="1.5" r="1" fill="var(--border-strong)" />
          <circle cx="14" cy="1.5" r="1" fill="var(--border-strong)" />
          <circle cx="6" cy="4.5" r="1" fill="var(--border-strong)" />
          <circle cx="10" cy="4.5" r="1" fill="var(--border-strong)" />
          <circle cx="14" cy="4.5" r="1" fill="var(--border-strong)" />
        </svg>
      </div>

      {/* Hairline workflow-stripe — same 4 colors as the Uploader.
          Subtle visual hint that the player is part of the same app. */}
      <div
        className="h-px w-full"
        style={{ background: 'var(--workflow-gradient)', opacity: 0.6 }}
        aria-hidden
      />

      {/* Seek row */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {formatTime(currentTime)}
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full"
            style={{
              background: `linear-gradient(to right, var(--step-1) 0%, var(--step-1) ${progress}%, var(--border-strong) ${progress}%, var(--border-strong) 100%)`,
              borderRadius: 0,
            }}
            aria-label="Seek"
          />
        </div>
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{ color: 'var(--text-dim)' }}
        >
          {formatTime(duration)}
        </span>
      </div>

      {/* Hairline divider between seek-row and controls */}
      <div className="h-px w-full" style={{ background: 'var(--border)' }} aria-hidden />

      {/* Controls row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-ui text-xs font-medium transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
            e.currentTarget.style.background = 'var(--bg-elev-2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.background = 'transparent';
          }}
          aria-label="Back to uploader"
        >
          <BackIcon />
          <span>Upload</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Autoplay toggle — left of Play/Pause */}
          <div className="flex items-center gap-1.5">
            <span className="font-ui text-xs" style={{ color: 'var(--text-muted)' }}>Autoplay</span>
            <button
              type="button"
              onClick={toggleAutoplay}
              className="flex h-8 min-w-[2.5rem] items-center justify-center rounded-md border px-2 font-ui text-xs font-semibold transition-all"
              style={{
                background: autoplay ? 'var(--accent)' : 'transparent',
                borderColor: autoplay ? 'var(--accent)' : 'var(--border)',
                color: autoplay ? 'var(--bg-base)' : 'var(--text-dim)',
              }}
              aria-label={autoplay ? 'Autoplay enabled' : 'Autoplay disabled'}
              aria-pressed={autoplay}
            >
              {autoplay ? 'ON' : 'OFF'}
            </button>
          </div>

          <button
            type="button"
            onClick={onTogglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-all"
            style={{
              background: isPlaying ? 'var(--bg-elev-2)' : 'var(--step-1)',
              color: isPlaying ? 'var(--text)' : 'var(--text-inverse)',
              border: '1px solid',
              borderColor: isPlaying ? 'var(--border-strong)' : 'var(--step-1)',
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <div
            className="flex items-center gap-2 rounded-md px-2 py-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <VolumeIcon muted={volume === 0} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-16"
              style={{
                background: `linear-gradient(to right, var(--step-1) 0%, var(--step-1) ${volPct}%, var(--border-strong) ${volPct}%, var(--border-strong) 100%)`,
                borderRadius: 0,
              }}
              aria-label="Volume"
            />
          </div>
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-ui text-xs font-semibold transition-colors"
            style={{
              background: 'transparent',
              borderColor: 'var(--border-strong)',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elev-2)';
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border-strong)';
              e.currentTarget.style.color = 'var(--text)';
            }}
          >
            <DownloadIcon />
            <span>Export MP4</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Icons (inline SVG, no external dep) ───────────────────────────────────

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 4 20 12 6 20" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}
