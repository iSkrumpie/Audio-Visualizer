/**
 * Uploader — Studio layout for file uploads + play/export
 *
 * Design: two-column app shell
 *   - Left:  brand + theme toggle + status (240px fixed)
 *   - Right: upload header + 3 drop zones + play action
 *
 * v3: redesigned for Studio aesthetic (replaces centered Jungle layout).
 */

import { motion } from 'framer-motion';
import { DropZone } from './DropZone';
import { ThemeToggle } from './ThemeToggle';
import { useAudioStore } from '@/lib/audioStore';

type UploaderProps = {
  onPlay: () => void;
  canPlay: boolean;
};

export function Uploader({ onPlay, canPlay }: UploaderProps) {
  const audioFile = useAudioStore((s) => s.audioFile);
  const logoFile = useAudioStore((s) => s.logoFile);
  const bgFile = useAudioStore((s) => s.bgFile);
  const logoObjectUrl = useAudioStore((s) => s.logoObjectUrl);
  const bgObjectUrl = useAudioStore((s) => s.bgObjectUrl);
  const audioObjectUrl = useAudioStore((s) => s.audioObjectUrl);
  const errorMessage = useAudioStore((s) => s.errorMessage);
  const audioMetadata = useAudioStore((s) => s.audioMetadata);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="grid h-full w-full"
      style={{
        gridTemplateColumns: '300px 1fr',
        background: 'var(--bg-base)',
      }}
    >
      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside
        className="flex h-full flex-col justify-between border-r p-6"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Audio Visualizer"
              className="brand-mark"
            />
            <div className="font-display text-xl font-semibold leading-tight" style={{ color: 'var(--text)' }}>
              Audio<br />Visualizer
            </div>
          </div>
          {/* Workflow palette hint under brand block — same width as the nav items below */}
          <div
            className="mt-4 h-0.5 w-full rounded-full"
            style={{ background: 'var(--workflow-gradient)' }}
            aria-hidden
          />

          <nav className="mt-10 flex flex-col gap-2.5">
            <NavItem step={1} icon={<UploadIcon />} label="Upload" active hint="Drop your audio, logo & background" />
            <NavItem step={2} icon={<WandIcon />} label="Configure" disabled hint="Tweak visuals and styles" />
            <NavItem step={3} icon={<FilmIcon />} label="Render" disabled hint="Render the Video" />
            <NavItem step={4} icon={<DownloadIcon />} label="Download" disabled hint="Save the final video" />
          </nav>
        </div>

        <div className="flex items-center justify-between">
          <ThemeToggle />
        </div>
      </aside>

      {/* ── Main ───────────────────────────────────────────────── */}
      <main className="flex h-full flex-col overflow-y-auto p-10">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mx-auto flex w-full max-w-3xl flex-col gap-8"
        >
          {/* Header */}
          <header>
            <h1
              className="font-display text-3xl font-semibold"
              style={{ color: 'var(--text)' }}
            >
              Upload your assets
            </h1>
            <p
              className="mt-1.5 font-ui text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Drop an audio file, your logo, and a background. Hit play to launch the visualizer.
            </p>
            {/* Workflow accent stripe — full content width, visual hint of the 4-step palette */}
            <div
              className="mt-4 h-px w-full rounded-full"
              style={{ background: 'var(--workflow-gradient)' }}
              aria-hidden
            />
          </header>

          {/* Step 1: Audio */}
          <Section step={1} title="Audio" subtitle="MP3, WAV, OGG, or WebM — up to 2 GB">
            <DropZone
              kind="audio"
              label="Audio file"
              hint={audioFile ? 'ready' : 'drop or click'}
              accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/*"
              previewUrl={audioObjectUrl}
              previewIcon={<AudioIconLarge />}
            />
          </Section>

          {/* Step 2: Logo */}
          <Section step={2} title="Logo" subtitle="Centered overlay — PNG, JPG, WebP, SVG">
            <DropZone
              kind="logo"
              label="Logo"
              hint={logoFile ? 'ready' : 'drop or click'}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              previewUrl={logoObjectUrl}
              previewAlt="logo preview"
              previewIcon={<LogoIconLarge />}
            />
          </Section>

          {/* Step 3: Background */}
          <Section step={3} title="Background" subtitle="Full-bleed behind the visualizer — PNG, JPG, WebP">
            <DropZone
              kind="background"
              label="Background image"
              hint={bgFile ? 'ready' : 'drop or click'}
              accept="image/png,image/jpeg,image/webp"
              previewUrl={bgObjectUrl}
              previewAlt="background preview"
              previewIcon={<ImageIconLarge />}
            />
          </Section>

          {/* Error */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 rounded-lg border px-4 py-3 font-ui text-sm"
              style={{
                background: 'rgba(248, 113, 113, 0.08)',
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
              }}
            >
              <AlertIcon />
              <span>{errorMessage}</span>
            </motion.div>
          )}

          {/* Action bar — Step 4 */}
          <div
            className="flex items-center justify-between rounded-xl border p-4"
            style={{
              background: 'var(--bg-elev-1)',
              borderColor: canPlay ? 'var(--step-4)' : 'var(--border)',
              boxShadow: canPlay ? '0 0 0 1px var(--step-4-glow)' : 'none',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                style={{
                  background: 'var(--step-4-soft)',
                  color: 'var(--step-4)',
                  border: '1px solid var(--step-4-glow)',
                }}
              >
                04
              </span>
              <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                {canPlay
                  ? `Ready · ${audioMetadata ? formatDuration(audioMetadata.duration) : '—'}`
                  : 'Upload an audio file to enable playback'}
              </div>
            </div>
            <motion.button
              type="button"
              disabled={!canPlay}
              onClick={onPlay}
              whileHover={canPlay ? { y: -1 } : {}}
              whileTap={canPlay ? { scale: 0.98 } : {}}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 font-display text-sm font-semibold transition-colors"
              style={{
                background: canPlay ? 'var(--step-4)' : 'var(--bg-elev-2)',
                color: canPlay ? 'var(--text-inverse)' : 'var(--text-dim)',
                cursor: canPlay ? 'pointer' : 'not-allowed',
                border: '1px solid',
                borderColor: canPlay ? 'var(--step-4)' : 'var(--border)',
                boxShadow: canPlay ? '0 4px 16px var(--step-4-glow)' : 'none',
              }}
            >
              <PlayIcon />
              <span>Play &amp; Visualize</span>
            </motion.button>
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Section({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <span
          className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
          style={{
            background: `var(--step-${step}-soft)`,
            color: `var(--step-${step})`,
            border: `1px solid var(--step-${step}-glow)`,
          }}
        >
          {String(step).padStart(2, '0')}
        </span>
        <h2
          className="font-display text-lg font-semibold"
          style={{ color: 'var(--text)' }}
        >
          {title}
        </h2>
        {subtitle && (
          <span className="font-ui text-xs" style={{ color: 'var(--text-muted)' }}>
            — {subtitle}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function NavItem({
  step,
  icon,
  label,
  active = false,
  disabled = false,
  hint,
}: {
  step: number;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const stepColor = `var(--step-${step})`;
  const stepBg = `var(--step-${step}-bg)`;
  const stepSoft = `var(--step-${step}-soft)`;
  const stepGlow = `var(--step-${step}-glow)`;

  return (
    <div
      className="flex flex-col rounded-md px-2.5 py-2"
      style={{
        background: active ? stepBg : stepSoft,
        cursor: disabled ? 'not-allowed' : 'default',
        borderLeft: `${active ? '3px' : '2px'} solid ${stepColor}`,
        boxShadow: active ? `0 0 0 1px ${stepGlow}` : 'none',
        transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          style={{
            color: stepColor,
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <span
          className="font-display text-3xl font-bold leading-none"
          style={{ color: stepColor }}
        >
          {step}
        </span>
        <span
          className="font-ui text-lg font-semibold leading-none"
          style={{ color: 'var(--text)' }}
        >
          {label}
        </span>
      </div>
      {hint && (
        <span
          className="mt-1.5 pl-9 font-ui text-[11px] leading-snug"
          style={{ color: 'var(--text-muted)' }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

// ── Icons (inline SVG, no external dep) ───────────────────────────────────


function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function WandIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.21 1.21 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72Z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 4 20 12 6 20" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function AudioIconLarge() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function LogoIconLarge() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ImageIconLarge() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
