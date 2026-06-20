/**
 * ExportOverlay — fullscreen modal for export preset selection + progress.
 *
 * Two screens:
 *   'picking'  — platform tabs (YouTube / TikTok) + preset cards
 *   'running'  — progress bar + phase label
 *
 * Studio aesthetic: hairline border, no glow, neutral surface.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ExportProgress } from '@/lib/exportEngine';
import {
  EXPORT_PRESETS,
  PLATFORM_META,
  type ExportPlatform,
  type ExportPreset,
} from '@/lib/exportPresets';

type ExportOverlayProps = {
  mode: 'idle' | 'picking' | 'running';
  progress: ExportProgress | null;
  onStart: (preset: ExportPreset) => void;
  onCancel: () => void;
};

const PHASE_LABELS: Record<string, string> = {
  decoding: 'Decoding audio',
  analyzing: 'Analyzing audio',
  rendering: 'Rendering frames',
  finalizing: 'Finalizing MP4',
  done: 'Done',
  error: 'Error',
};

// ── Preset Picker ────────────────────────────────────────────────────────────

function PresetPicker({
  onStart,
  onCancel,
}: {
  onStart: (preset: ExportPreset) => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = useState<ExportPlatform>('youtube');
  const [selected, setSelected] = useState<string>('yt-1080p-60');

  const presets = EXPORT_PRESETS.filter((p) => p.platform === platform);
  const selectedPreset = EXPORT_PRESETS.find((p) => p.id === selected);

  const platforms = Object.entries(PLATFORM_META) as [
    ExportPlatform,
    { label: string; description: string },
  ][];

  const handlePlatformSwitch = (p: ExportPlatform) => {
    setPlatform(p);
    // Auto-select the recommended preset for the new platform
    const recommended = EXPORT_PRESETS.find((pr) => pr.platform === p && pr.recommended);
    if (recommended) setSelected(recommended.id);
  };

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h2
          className="font-display text-lg font-semibold"
          style={{ color: 'var(--text)' }}
        >
          Export MP4
        </h2>
        <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text-dim)' }}>
          Choose a platform and quality preset
        </p>
      </div>

      {/* Platform Tabs */}
      <div
        className="mb-4 flex gap-1 rounded-md p-0.5"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        {platforms.map(([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => handlePlatformSwitch(key)}
            className="flex flex-1 flex-col items-center gap-0.5 rounded px-3 py-2 transition-all"
            style={{
              background: platform === key ? 'var(--bg-elev-1)' : 'transparent',
              border: platform === key ? '1px solid var(--border)' : '1px solid transparent',
              boxShadow: platform === key ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <span
              className="font-ui text-sm font-semibold"
              style={{ color: platform === key ? 'var(--text)' : 'var(--text-muted)' }}
            >
              {meta.label}
            </span>
            <span
              className="font-mono text-[10px]"
              style={{ color: platform === key ? 'var(--text-dim)' : 'var(--text-muted)' }}
            >
              {meta.description}
            </span>
          </button>
        ))}
      </div>

      {/* Preset Cards */}
      <div className="mb-5 flex flex-col gap-2">
        {presets.map((preset) => {
          const isSelected = preset.id === selected;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelected(preset.id)}
              className="flex w-full items-center justify-between rounded-md border px-3.5 py-2.5 text-left transition-all"
              style={{
                background: isSelected ? 'var(--accent-subtle)' : 'var(--bg-elev-2)',
                borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="font-ui text-sm font-semibold"
                    style={{ color: isSelected ? 'var(--accent)' : 'var(--text)' }}
                  >
                    {preset.label}
                  </span>
                  {preset.recommended && (
                    <span
                      className="rounded px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider"
                      style={{
                        background: isSelected ? 'var(--accent)' : 'var(--border-strong)',
                        color: isSelected ? 'var(--text-inverse)' : 'var(--text-dim)',
                      }}
                    >
                      Recommended
                    </span>
                  )}
                </div>
                <span
                  className="font-mono text-[11px]"
                  style={{ color: isSelected ? 'var(--accent-dim)' : 'var(--text-muted)' }}
                >
                  {preset.sublabel}
                </span>
              </div>

              {/* Selected indicator */}
              <div
                className="ml-3 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-all"
                style={{
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border-strong)',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                }}
              >
                {isSelected && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <polyline
                      points="1.5 4 3 5.5 6.5 2"
                      stroke="var(--text-inverse)"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* TikTok portrait note */}
      {platform === 'tiktok' && (
        <div
          className="mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5"
          style={{
            background: 'rgba(250, 204, 21, 0.06)',
            borderColor: 'rgba(250, 204, 21, 0.25)',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-px flex-shrink-0"
            style={{ color: 'rgb(250, 204, 21)' }}
            aria-hidden
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            Renders in 9:16 portrait (1080×1920). The visual composition will be centered
            vertically. Preview is always landscape — portrait only in the exported file.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-2 font-ui text-sm transition-colors"
          style={{
            background: 'transparent',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
            e.currentTarget.style.background = 'var(--bg-elev-2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => selectedPreset && onStart(selectedPreset)}
          disabled={!selectedPreset}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 font-ui text-sm font-semibold transition-colors"
          style={{
            background: 'var(--accent)',
            borderColor: 'var(--accent)',
            color: 'var(--text-inverse)',
            opacity: selectedPreset ? 1 : 0.4,
          }}
        >
          <ExportIcon />
          Start Export
        </button>
      </div>
    </>
  );
}

// ── Progress View ────────────────────────────────────────────────────────────

function ProgressView({
  progress,
  onCancel,
}: {
  progress: ExportProgress | null;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="mb-4">
        <h2
          className="font-display text-lg font-semibold"
          style={{ color: 'var(--text)' }}
        >
          Exporting…
        </h2>
        <p className="mt-0.5 font-mono text-xs" style={{ color: 'var(--text-dim)' }}>
          H.264 · AAC-LC · MP4
        </p>
      </div>

      {progress && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-ui text-sm font-medium" style={{ color: 'var(--text)' }}>
              {PHASE_LABELS[progress.phase] ?? progress.phase}
            </span>
            <span
              className="font-mono text-xs tabular-nums"
              style={{ color: 'var(--accent)' }}
            >
              {Math.round(progress.progress * 100)}%
            </span>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--accent)' }}
              initial={{ width: 0 }}
              animate={{ width: `${progress.progress * 100}%` }}
              transition={{ duration: 0.25 }}
            />
          </div>

          <p className="mt-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {progress.message}
          </p>

          {progress.phase === 'error' && (
            <div
              className="mt-3 rounded-md border px-3 py-2"
              style={{
                background: 'rgba(248, 113, 113, 0.08)',
                borderColor: 'var(--danger)',
              }}
            >
              <p className="font-mono text-xs" style={{ color: 'var(--danger)' }}>
                {progress.message}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex gap-2">
        {progress?.phase !== 'finalizing' && progress?.phase !== 'done' && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border px-3 py-2 font-ui text-sm transition-colors"
            style={{
              background: 'transparent',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--danger)';
              e.currentTarget.style.color = 'var(--danger)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-strong)';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            Cancel
          </button>
        )}
        {progress?.phase === 'done' && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border px-3 py-2 font-ui text-sm font-medium"
            style={{
              background: 'var(--accent)',
              borderColor: 'var(--accent)',
              color: 'var(--text-inverse)',
            }}
          >
            Close
          </button>
        )}
      </div>
    </>
  );
}

// ── Root Component ───────────────────────────────────────────────────────────

export function ExportOverlay({ mode, progress, onStart, onCancel }: ExportOverlayProps) {
  const visible = mode !== 'idle';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[100] flex items-center justify-center"
          style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)' }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-xl border p-6"
            style={{
              background: 'var(--bg-elev-1)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <AnimatePresence mode="wait">
              {mode === 'picking' ? (
                <motion.div
                  key="picker"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.18 }}
                >
                  <PresetPicker onStart={onStart} onCancel={onCancel} />
                </motion.div>
              ) : (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                >
                  <ProgressView progress={progress} onCancel={onCancel} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function ExportIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
