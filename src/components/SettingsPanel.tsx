/**
 * SettingsPanel — side-drawer for live-tuning the visualizer
 *
 * v3: redesigned for Studio aesthetic. Theme-aware via CSS variables.
 * All hardcoded green colors removed — uses var(--accent), var(--text), etc.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore, getSettings, type Settings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import { usePresetsStore } from '@/lib/presetsStore';
import { HzRangePicker } from '@/components/HzRangePicker';
import { Hint } from '@/components/Hint';
import { SETTING_HINTS, ACCORDION_DESCRIPTIONS, ENUM_HINTS } from '@/lib/hints';
import { BLEND_MODE_OPTIONS } from '@/lib/blendMode';

type Section = 'background' | 'overlays' | 'logo' | 'bars' | 'particles' | 'audio';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'background', label: 'Background' },
  { id: 'overlays',   label: 'Overlays' },
  { id: 'logo',       label: 'Logo' },
  { id: 'bars',       label: 'Bars' },
  { id: 'particles',  label: 'Particles' },
  { id: 'audio',      label: 'Audio' },
];

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('background');
  const resetToDefault = useSettingsStore((s) => s.resetToDefault);
  const { presets, savePreset, deletePreset } = usePresetsStore();
  const setSettings = useSettingsStore((s) => s.setSettings);

  // Preset bar state
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');

  // ── Advanced audio toggle (persisted via theme group) ──────────────────────
  // useF has a defensive fallback for old localStorage entries → default false
  const [showAdv, setShowAdv] = useF('theme', 'showAdvancedAudio');
  const visibleSections = useMemo(
    () => (showAdv ? SECTIONS : SECTIONS.filter((sec) => sec.id !== 'audio')),
    [showAdv],
  );
  const toggleAdvanced = () => {
    const next = !showAdv;
    setShowAdv(next);
    // If the audio tab was active and we're hiding it, fall back to Background
    if (!next && section === 'audio') setSection('background');
  };

  // ── Active count selectors for tab badges ─────────────────────────────────
  const activeOverlays = useSettingsStore((s) => {
    const bg = s.settings.background;
    return [
      bg.strandsEnabled,
      bg.lightRaysEnabled,
      bg.lightPillarEnabled,
      bg.lightningEnabled,
      bg.magicRingsEnabled,
      bg.bgParticlesEnabled,
      bg.rainEnabled,
      bg.snowEnabled,
      bg.hyperspeedEnabled,
      bg.faultyTerminalEnabled,
      bg.ferrofluidEnabled,
    ].filter(Boolean).length;
  });

  const activeBackground = useSettingsStore((s) => {
    const bg = s.settings.background;
    return [
      bg.nebulaEnabled,
      bg.vignetteEnabled,
      bg.bloomEnabled,
      bg.caEnabled,
      bg.noiseEnabled,
      bg.scanlineEnabled,
      bg.glitchEnabled,
      bg.pixelationEnabled,
      bg.dotScreenEnabled,
      bg.gridEnabled,
      bg.sepiaEnabled,
      bg.colorAverageEnabled,
    ].filter(Boolean).length;
  });

  const logoEnabled = useSettingsStore((s) => s.settings.logo.enabled);
  const barsEnabled = useSettingsStore((s) => s.settings.bars.enabled);
  const particlesEnabled = useSettingsStore((s) => s.settings.particles.enabled);

  const handlePresetChange = (id: string) => {
    setSelectedId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) setSettings(() => preset.settings);
  };

  const handleSave = () => {
    if (!saving) { setSaving(true); setSaveName(''); return; }
    const preset = savePreset(saveName || 'My Preset', getSettings());
    setSelectedId(preset.id);
    setSaving(false);
    setSaveName('');
  };

  const tabCounts: Record<string, number> = {
    background: activeBackground,
    overlays: activeOverlays,
    logo: logoEnabled ? 1 : 0,
    bars: barsEnabled ? 1 : 0,
    particles: particlesEnabled ? 1 : 0,
  };

  return (
    <>
      {/* Toggle button — moves left when panel is open */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{ right: open ? 392 : 16 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="absolute top-4 z-50 flex h-9 w-9 items-center justify-center rounded-md transition-colors"
        style={{
          background: 'var(--bg-elev-1)',
          border: '1px solid var(--border)',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          boxShadow: 'var(--shadow-md)',
        }}
        aria-label="Settings"
      >
        <SettingsIcon />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 376, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 376, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            className="absolute right-0 top-0 z-40 flex h-full w-[376px] flex-col"
            style={{
              background: 'var(--bg-overlay)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderLeft: '1px solid var(--border)',
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.35)',
            }}
          >
            <Header onClose={() => setOpen(false)} onReset={resetToDefault} />

            {/* ── Preset bar ─────────────────────────────────── */}
            <div
              className="flex flex-col gap-2 border-b px-3 py-2.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                {/* Dropdown */}
                <div className="relative flex-1">
                  <select
                    value={selectedId}
                    onChange={(e) => handlePresetChange(e.target.value)}
                    className="w-full appearance-none rounded-md border px-2.5 py-1.5 pr-7 font-ui text-xs outline-none transition-colors"
                    style={{
                      background: 'var(--bg-elev-2)',
                      borderColor: 'var(--border)',
                      color: selectedId ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >
                    <option value="">— select preset —</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {/* Chevron */}
                  <span
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>

                {/* Delete button — only when a preset is selected */}
                {selectedId && (
                  <button
                    type="button"
                    onClick={() => { deletePreset(selectedId); setSelectedId(''); }}
                    title="Delete preset"
                    className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md border transition-colors"
                    style={{ background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(248,113,113,0.08)';
                      e.currentTarget.style.borderColor = 'var(--danger)';
                      e.currentTarget.style.color = 'var(--danger)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    <TrashIcon />
                  </button>
                )}

                {/* Save / New button */}
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex h-[30px] flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-ui text-xs font-semibold transition-colors"
                  style={{
                    background: saving ? 'var(--accent)' : 'transparent',
                    borderColor: saving ? 'var(--accent)' : 'var(--border-strong)',
                    color: saving ? 'var(--text-inverse)' : 'var(--text)',
                  }}
                >
                  <SaveIcon />
                  {saving ? 'Confirm' : 'Save'}
                </button>

                {/* Advanced audio toggle — reveals the Audio tab */}
                <button
                  type="button"
                  onClick={toggleAdvanced}
                  title={showAdv ? 'Hide Audio tab' : 'Show Audio tab (advanced)'}
                  className="flex h-[30px] flex-shrink-0 items-center justify-center rounded-md border px-2 font-ui text-[10px] font-medium transition-colors"
                  style={{
                    background: showAdv ? 'var(--bg-elev-2)' : 'transparent',
                    borderColor: showAdv ? 'var(--accent)' : 'var(--border)',
                    color: showAdv ? 'var(--accent)' : 'var(--text-dim)',
                  }}
                >
                  ADV
                </button>
              </div>

              {/* Inline name input — shown when saving */}
              {saving && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex gap-2"
                >
                  <input
                    autoFocus
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave();
                      if (e.key === 'Escape') { setSaving(false); setSaveName(''); }
                    }}
                    placeholder="Preset name…"
                    className="flex-1 rounded-md border px-2.5 py-1.5 font-ui text-xs outline-none transition-colors"
                    style={{
                      background: 'var(--bg-elev-2)',
                      borderColor: 'var(--accent)',
                      color: 'var(--text)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => { setSaving(false); setSaveName(''); }}
                    className="rounded-md border px-2 py-1.5 font-mono text-xs transition-colors"
                    style={{ background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    ✕
                  </button>
                </motion.div>
              )}
            </div>

            {/* Section nav */}
            <div
              className="flex flex-wrap gap-1 border-b px-3 py-2"
              style={{ borderColor: 'var(--border)' }}
            >
              {visibleSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className="rounded-md px-2.5 py-1 font-ui text-xs font-medium transition-colors"
                  style={{
                    background: section === s.id ? 'var(--bg-elev-2)' : 'transparent',
                    color: section === s.id ? 'var(--text)' : 'var(--text-muted)',
                    border: '1px solid',
                    borderColor: section === s.id ? 'var(--border-strong)' : 'transparent',
                  }}
                >
                  {s.label}
                  {(tabCounts[s.id] ?? 0) > 0 && (
                    <span
                      className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 font-ui text-[9px] font-bold tabular-nums"
                      style={{
                        background: section === s.id ? 'var(--accent)' : 'var(--accent-muted, var(--border-strong))',
                        color: section === s.id ? 'var(--bg-base)' : 'var(--text-muted)',
                      }}
                    >
                      {tabCounts[s.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {section === 'background' && <BackgroundSection />}
              {section === 'overlays'   && <OverlaysSection />}
              {section === 'logo'       && <LogoSection_ />}
              {section === 'bars'       && <BarsSection />}
              {section === 'particles'  && <ParticlesSection />}
              {section === 'audio'      && <AudioSection />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Shared ─────────────────────────────────────────────────────────────────

function Header({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  return (
    <div
      className="flex items-center justify-between border-b px-4 py-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <div>
        <h2
          className="font-display text-base font-semibold"
          style={{ color: 'var(--text)' }}
        >
          Settings
        </h2>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
          Live preview
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (confirm('Reset all settings to default?')) onReset();
          }}
          className="rounded-md px-2.5 py-1 font-ui text-xs transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-elev-2)';
            e.currentTarget.style.color = 'var(--text)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function FR({ label, children, hint, sub, info }: { label: string; children: React.ReactNode; hint?: string; sub?: string; info?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 font-ui text-xs font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
          {info && <Hint text={info} />}
        </span>
        {hint && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
            {hint}
          </span>
        )}
      </div>
      {sub && (
        <p className="mb-1.5 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}

function Sl({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full"
          style={{
            background: `linear-gradient(to right, var(--step-1) 0%, var(--step-1) ${pct}%, var(--border-strong) ${pct}%, var(--border-strong) 100%)`,
            borderRadius: 2,
          }}
        />
      </div>
      <span
        className="w-12 text-right font-mono text-[10px] tabular-nums"
        style={{ color: 'var(--text-muted)' }}
      >
        {value.toFixed(step < 0.01 ? 4 : 2)}
      </span>
    </div>
  );
}

const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

function CP({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const handleEyeDropper = async () => {
    try {
      const picker = new EyeDropper();
      const result = await picker.open();
      onChange(result.sRGBHex);
    } catch {
      // User cancelled or API unavailable — no-op
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Native colour swatch */}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Color picker"
        title="Open color picker"
      />
      {/* Eyedropper (Chrome 95+) */}
      {supportsEyeDropper && (
        <button
          type="button"
          onClick={() => { void handleEyeDropper(); }}
          title="Pick color from screen"
          aria-label="Pick color from screen"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-elev-2)';
            e.currentTarget.style.color = 'var(--text)';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <EyeDropperIcon />
        </button>
      )}
      {/* Hex input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-md border px-2 py-1 font-mono text-xs outline-none transition-colors"
        style={{
          background: 'var(--bg-elev-2)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}

function EyeDropperIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.5 2.5-1.5 3.5L6 18l-4 1 1-4 8.5-8.5C12.5 5.5 12 4 12 2z" />
      <path d="M14.5 5.5l4 4" />
      <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Tg({
  value,
  onChange,
  label,
  info,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  info?: string;
}) {
  if (info) {
    return (
      <div className="mb-3 flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(!value)}
          className="flex flex-1 items-center justify-between rounded-md px-2.5 py-1.5 font-ui text-xs font-medium transition-colors"
          style={{
            background: value ? 'var(--bg-elev-2)' : 'transparent',
            color: value ? 'var(--text)' : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          <span>{label}</span>
          <span
            className="flex h-4 w-7 items-center rounded-full transition-colors"
            style={{ background: value ? 'var(--accent)' : 'var(--border-strong)' }}
          >
            <span
              className="h-3 w-3 rounded-full transition-transform"
              style={{
                background: 'var(--bg-elev-1)',
                transform: value ? 'translateX(15px)' : 'translateX(2px)',
              }}
            />
          </span>
        </button>
        <Hint text={info} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 font-ui text-xs font-medium transition-colors"
      style={{
        background: value ? 'var(--bg-elev-2)' : 'transparent',
        color: value ? 'var(--text)' : 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      <span>{label}</span>
      <span
        className="flex h-4 w-7 items-center rounded-full transition-colors"
        style={{ background: value ? 'var(--accent)' : 'var(--border-strong)' }}
      >
        <span
          className="h-3 w-3 rounded-full transition-transform"
          style={{
            background: 'var(--bg-elev-1)',
            transform: value ? 'translateX(15px)' : 'translateX(2px)',
          }}
        />
      </span>
    </button>
  );
}

/** Blend mode dropdown — reusable for all effects */
function BlendSel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'var(--bg-elev-2)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '12px',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      {BLEND_MODE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function CB<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="flex-1 rounded-md px-2 py-1.5 font-ui text-xs font-medium transition-colors"
          style={{
            background: value === o.value ? 'var(--bg-elev-2)' : 'transparent',
            color: value === o.value ? 'var(--text)' : 'var(--text-muted)',
            border: '1px solid',
            borderColor: value === o.value ? 'var(--border-strong)' : 'var(--border)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function useF<K extends keyof Settings>(group: K, key: keyof Settings[K]) {
  const value = useSettingsStore((s) => {
    // Defensive: presets saved before a schema bump may be missing the requested field.
    // Fall back to the current default so the UI never sees `undefined` and crashes
    // (e.g. CB receiving `value={undefined}` breaks button highlight state, and
    // `arr.map()` on undefined throws).
    const field = (s.settings[group] as Record<string, unknown>)[key as string];
    if (field === undefined) {
      return (DEFAULT_SETTINGS[group] as Record<string, unknown>)[key as string];
    }
    return field;
  });
  const setSettings = useSettingsStore((s) => s.setSettings);
  const set = (v: unknown) =>
    setSettings((prev) => ({ ...prev, [group]: { ...prev[group], [key]: v } }));
  return [value, set] as const;
}

/**
 * Look up a plain-language hint for a setting.
 * Returns undefined if no hint exists (so the (i) icon won\'t render).
 */
function hintFor(...pathParts: string[]): string | undefined {
  return SETTING_HINTS[pathParts.join('.')];
}

// ── Sections ───────────────────────────────────────────────────────────────

// ── Accordion ────────────────────────────────────────────────────────────────

function Acc({ label, children, description }: {
  label: string;
  children: React.ReactNode;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev-2)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2"
      >
        <span className="font-ui text-xs font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center" style={{ color: 'var(--text-muted)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="border-t px-3 pb-3 pt-3" style={{ borderColor: 'var(--border)' }}>
          {description && (
            <p className="mb-2 font-ui text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {description}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ── Background Section ────────────────────────────────────────────────────────

function BackgroundSection() {

  const [blur,     sBlur]     = useF('background', 'blur');
  const [bright,   sBright]   = useF('background', 'brightness');
  const [sat,      sSat]      = useF('background', 'saturation');
  const [cont,     sCont]     = useF('background', 'contrast');
  const [hue,      sHue]      = useF('background', 'hueShift');
  const [sharp,    sSharp]    = useF('background', 'sharpen');
  const [tintC,    sTintC]    = useF('background', 'tintColor');
  const [tintO,    sTintO]    = useF('background', 'tintOpacity');
  const [tintM,    sTintM]    = useF('background', 'tintMode');
  const [beat,     sBeat]     = useF('background', 'scaleOnBeat');
  const [beatFS,   sBeatFS]   = useF('background', 'beatFxFreqStart');
  const [beatFE,   sBeatFE]   = useF('background', 'beatFxFreqEnd');
  const [beatSens, sBeatSens] = useF('background', 'beatFxSensitivity');
  const [vigE,     sVigE]     = useF('background', 'vignetteEnabled');
  const [vigS,     sVigS]     = useF('background', 'vignetteStrength');
  const [nebE,     sNebE]     = useF('background', 'nebulaEnabled');
  const [nebI,     sNebI]     = useF('background', 'nebulaIntensity');
  const [nebC1,    sNebC1]    = useF('background', 'nebulaColor1');
  const [nebC2,    sNebC2]    = useF('background', 'nebulaColor2');
  const [nebD,     sNebD]     = useF('background', 'nebulaDriftSpeed');
  const [nebR,     sNebR]     = useF('background', 'nebulaReactivity');
  const [nebSc,    sNebSc]    = useF('background', 'nebulaScale');
  const [nebOX,    sNebOX]    = useF('background', 'nebulaOffsetX');
  const [nebOY,    sNebOY]    = useF('background', 'nebulaOffsetY');
  const [nebBM,    sNebBM]    = useF('background', 'nebulaBeatMode');
  const [nebBFS,   sNebBFS]   = useF('background', 'nebulaBeatFreqStart');
  const [nebBFE,   sNebBFE]   = useF('background', 'nebulaBeatFreqEnd');
  const [nebBSens, sNebBSens] = useF('background', 'nebulaBeatSensitivity');
  const [bloom,    sBloom]    = useF('background', 'bloomEnabled');
  const [bloomI,   sBloomI]   = useF('background', 'bloomIntensity');
  const [bloomT,   sBloomT]   = useF('background', 'bloomThreshold');
  const [ca,       sCa]       = useF('background', 'caEnabled');
  const [caO,      sCaO]      = useF('background', 'caOffset');
  const [noise,    sNoise]    = useF('background', 'noiseEnabled');
  const [noiseI,   sNoiseI]   = useF('background', 'noiseIntensity');
  const [scan,     sScan]     = useF('background', 'scanlineEnabled');
  const [scanD,    sScanD]    = useF('background', 'scanlineDensity');
  const [glitch,   sGlitch]   = useF('background', 'glitchEnabled');
  const [glitchD,  sGlitchD]  = useF('background', 'glitchDelay');
  const [glitchS,  sGlitchS]  = useF('background', 'glitchStrength');
  const [sepia,    sSepia]    = useF('background', 'sepiaEnabled');
  const [sepiaI,   sSepiaI]   = useF('background', 'sepiaIntensity');
  const [pixel,    sPixel]    = useF('background', 'pixelationEnabled');
  const [pixelG,   sPixelG]   = useF('background', 'pixelGranularity');
  const [dot,      sDot]      = useF('background', 'dotScreenEnabled');
  const [dotS,     sDotS]     = useF('background', 'dotScale');
  const [grid,     sGrid]     = useF('background', 'gridEnabled');
  const [gridS,    sGridS]    = useF('background', 'gridScale');
  const [colAvg,   sColAvg]   = useF('background', 'colorAverageEnabled');
  // Noise animation
  const [noiseSp,  sNoiseSp]  = useF('background', 'noiseSpeed');
  const [noiseSc,  sNoiseSc]  = useF('background', 'noiseScale');
  const [noiseCM,  sNoiseCM]  = useF('background', 'noiseColorMode');
  const [noiseBB,  sNoiseBB]  = useF('background', 'noiseBeatBoost');
  // Scanline animation
  const [scanSS,   sScanSS]   = useF('background', 'scanScrollSpeed');
  const [scanTh,   sScanTh]   = useF('background', 'scanThickness');
  const [scanBO,   sScanBO]   = useF('background', 'scanBeatOpacity');
  const [scanBD,   sScanBD]   = useF('background', 'scanBeatDensity');
  // Glitch animation
  const [glRGB,    sGlRGB]    = useF('background', 'glitchRGBSplit');
  const [glBlock,  sGlBlock]  = useF('background', 'glitchBlockSize');
  const [glProb,   sGlProb]   = useF('background', 'glitchBlockProb');
  const [glVert,   sGlVert]   = useF('background', 'glitchVertical');
  const [glSync,   sGlSync]   = useF('background', 'glitchBeatSync');
  const [glDecay,  sGlDecay]  = useF('background', 'glitchDecay');
  // Pixelation animation
  const [pixBS,    sPixBS]    = useF('background', 'pixelBeatSize');
  const [pixW,     sPixW]     = useF('background', 'pixelWave');
  const [pixWS,    sPixWS]    = useF('background', 'pixelWaveSpeed');
  // Dot animation
  const [dotRot,   sDotRot]   = useF('background', 'dotRotation');
  const [dotRS,    sDotRS]    = useF('background', 'dotRotSpeed');
  const [dotBS,    sDotBS]    = useF('background', 'dotBeatScale');
  const [dotCS,    sDotCS]    = useF('background', 'dotColorSep');
  // Grid animation
  const [gridPS,   sGridPS]   = useF('background', 'gridPulseStrength');
  const [gridW,    sGridW]    = useF('background', 'gridWave');
  const [gridWS,   sGridWS]   = useF('background', 'gridWaveSpeed');
  const [gridMv,   sGridMv]   = useF('background', 'gridMovement');
  const [gridCl,   sGridCl]   = useF('background', 'gridColor');

  return (
    <div className="flex flex-col gap-2">
      <Acc label="Image" description={ACCORDION_DESCRIPTIONS['background.image']}>
        <FR label="Blur" hint={`${blur}px`} info={hintFor('background.blur')}>
          <Sl value={blur as number} min={0} max={40} step={1} onChange={sBlur} />
        </FR>
        <FR label="Sharpen" hint={`${(sharp as number).toFixed(1)}`} info={hintFor('background.sharpen')}>
          <Sl value={sharp as number} min={0} max={2} step={0.1} onChange={sSharp} />
        </FR>
        <FR label="Brightness" hint={`${(bright as number).toFixed(2)}`} info={hintFor('background.brightness')}>
          <Sl value={bright as number} min={0.2} max={2.0} step={0.05} onChange={sBright} />
        </FR>
        <FR label="Saturation" hint={`${(sat as number).toFixed(2)}`} info={hintFor('background.saturation')}>
          <Sl value={sat as number} min={0} max={2.0} step={0.05} onChange={sSat} />
        </FR>
        <FR label="Contrast" hint={`${(cont as number).toFixed(2)}`} info={hintFor('background.contrast')}>
          <Sl value={cont as number} min={0.2} max={2.0} step={0.05} onChange={sCont} />
        </FR>
        <FR label="Hue shift" hint={`${Math.round(hue as number)}°`} info={hintFor('background.hueShift')}>
          <Sl value={hue as number} min={0} max={360} step={1} onChange={sHue} />
        </FR>
      </Acc>

      <Acc label="Tint" description={ACCORDION_DESCRIPTIONS['background.tint']}>
        <FR label="Tint color" info={hintFor('background.tintColor')}>
          <CP value={tintC as string} onChange={sTintC} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((tintO as number) * 100)}%`} info={hintFor('background.tintOpacity')}>
          <Sl value={tintO as number} min={0} max={1} step={0.01} onChange={sTintO} />
        </FR>
        <FR label="Blend mode" info={ENUM_HINTS['background.tintMode']?.[tintM as string]}>
          <CB
            value={tintM as string}
            options={[
              { value: 'multiply',   label: 'Multiply' },
              { value: 'overlay',    label: 'Overlay' },
              { value: 'soft-light', label: 'Soft' },
              { value: 'screen',     label: 'Screen' },
            ]}
            onChange={sTintM as (v: string) => void}
          />
        </FR>
      </Acc>

      <Acc label="Beat FX" description={ACCORDION_DESCRIPTIONS['background.beatFx']}>
        <p className="mb-2 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>React to energy in this Hz range</p>
        <HzRangePicker
          startHz={beatFS as number}
          endHz={beatFE as number}
          onChangeStart={sBeatFS}
          onChangeEnd={sBeatFE}
        />
        <div className="mt-3">
          <FR label="Scale amount" hint={`${((beat as number) * 100).toFixed(0)}%`} info={hintFor('background.scaleOnBeat')}>
            <Sl value={beat as number} min={0} max={0.5} step={0.005} onChange={sBeat} />
          </FR>
          <FR label="Sensitivity" hint={`${(beatSens as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.beatFxSensitivity')}>
            <Sl value={beatSens as number} min={0.1} max={5.0} step={0.05} onChange={sBeatSens} />
          </FR>
        </div>
      </Acc>

      <Acc label="Vignette" description={ACCORDION_DESCRIPTIONS['background.vignette']}>
        <Tg value={vigE as boolean} onChange={sVigE} label="Enabled" />
        {!!vigE && (
          <div className="mt-3">
            <FR label="Strength" hint={`${Math.round((vigS as number) * 100)}%`} info={hintFor('background.vignetteStrength')}>
              <Sl value={vigS as number} min={0} max={1} step={0.02} onChange={sVigS} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Fog" description={ACCORDION_DESCRIPTIONS['background.fog']}>
        <Tg value={nebE as boolean} onChange={sNebE} label="Enabled" />
        {!!nebE && (
          <div className="mt-3 space-y-2">
            <FR label="Intensity" hint={`${Math.round((nebI as number) * 100)}%`} info={hintFor('background.nebulaIntensity')}>
              <Sl value={nebI as number} min={0} max={1} step={0.01} onChange={sNebI} />
            </FR>
            <FR label="Color 1" info={hintFor('background.nebulaColor1')}><CP value={nebC1 as string} onChange={sNebC1} /></FR>
            <FR label="Color 2" info={hintFor('background.nebulaColor2')}><CP value={nebC2 as string} onChange={sNebC2} /></FR>
            <FR label="Drift speed" info={hintFor('background.nebulaDriftSpeed')}>
              <Sl value={nebD as number} min={0.1} max={3} step={0.05} onChange={sNebD} />
            </FR>
            <FR label="Reactivity" info={hintFor('background.nebulaReactivity')}>
              <Sl value={nebR as number} min={0} max={3} step={0.05} onChange={sNebR} />
            </FR>
            <FR label="Scale" hint={`${(nebSc as number).toFixed(2)}×`} sub="1.0 fills screen" info={hintFor('background.nebulaScale')}>
              <Sl value={nebSc as number} min={0.1} max={3.0} step={0.05} onChange={sNebSc} />
            </FR>
            <FR label="Offset X" hint={`${(nebOX as number).toFixed(2)}`} info={hintFor('background.nebulaOffsetX')}>
              <Sl value={nebOX as number} min={-1} max={1} step={0.05} onChange={sNebOX} />
            </FR>
            <FR label="Offset Y" hint={`${(nebOY as number).toFixed(2)}`} sub="Negative = down" info={hintFor('background.nebulaOffsetY')}>
              <Sl value={nebOY as number} min={-1} max={1} step={0.05} onChange={sNebOY} />
            </FR>
            <div className="mt-3 rounded-md border p-2" style={{ borderColor: 'var(--border)' }}>
              <Tg value={nebBM as boolean} onChange={sNebBM} label="Beat pulse mode" />
              {!!nebBM && (
                <div className="mt-2 space-y-2">
                  <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Pulse on detected beats in this range</p>
                  <HzRangePicker
                    startHz={nebBFS as number}
                    endHz={nebBFE as number}
                    onChangeStart={sNebBFS}
                    onChangeEnd={sNebBFE}
                  />
                  <FR label="Sensitivity" hint={`${(nebBSens as number).toFixed(2)}×`} info={hintFor('background.nebulaBeatSensitivity')}>
                    <Sl value={nebBSens as number} min={0.1} max={5.0} step={0.05} onChange={sNebBSens} />
                  </FR>
                </div>
              )}
            </div>
          </div>
        )}
      </Acc>

      <Acc label="Glow" description={ACCORDION_DESCRIPTIONS['background.glow']}>
        <EffectCard label="Bloom" enabled={bloom as boolean} onToggle={sBloom} info={hintFor('background.bloomEnabled')}>
          <FR label="Intensity" info={hintFor('background.bloomIntensity')}>
            <Sl value={bloomI as number} min={0} max={3} step={0.05} onChange={sBloomI} />
          </FR>
          <FR label="Threshold" info={hintFor('background.bloomThreshold')}>
            <Sl value={bloomT as number} min={0} max={1} step={0.01} onChange={sBloomT} />
          </FR>
        </EffectCard>
      </Acc>

      <Acc label="Color" description={ACCORDION_DESCRIPTIONS['background.color']}>
        <EffectCard label="Chromatic aberration" enabled={ca as boolean} onToggle={sCa} info={hintFor('background.caEnabled')}>
          <FR label="Offset" info={hintFor('background.caOffset')}>
            <Sl value={caO as number} min={0} max={0.02} step={0.0005} onChange={sCaO} />
          </FR>
        </EffectCard>
        <EffectCard label="Sepia" enabled={sepia as boolean} onToggle={sSepia} info={hintFor('background.sepiaEnabled')}>
          <FR label="Intensity" info={hintFor('background.sepiaIntensity')}>
            <Sl value={sepiaI as number} min={0} max={1} step={0.01} onChange={sSepiaI} />
          </FR>
        </EffectCard>
        <EffectCard label="Color average" enabled={colAvg as boolean} onToggle={sColAvg} info={hintFor('background.colorAverageEnabled')} />
      </Acc>

      <Acc label="Effects" description={ACCORDION_DESCRIPTIONS['background.effects']}>
        <EffectCard label="Noise / grain" enabled={noise as boolean} onToggle={sNoise} info={hintFor('background.noiseEnabled')}>
          <FR label="Intensity" info={hintFor('background.noiseIntensity')}>
            <Sl value={noiseI as number} min={0} max={1} step={0.01} onChange={sNoiseI} />
          </FR>
          <FR label="Speed" info={hintFor('background.noiseSpeed')}>
            <Sl value={noiseSp as number} min={0} max={10} step={0.5} onChange={sNoiseSp} />
          </FR>
          <FR label="Scale" info={hintFor('background.noiseScale')}>
            <Sl value={noiseSc as number} min={0.5} max={5} step={0.1} onChange={sNoiseSc} />
          </FR>
          <FR label="Beat boost" info={hintFor('background.noiseBeatBoost')}>
            <Sl value={noiseBB as number} min={0} max={3} step={0.1} onChange={sNoiseBB} />
          </FR>
          <Tg value={noiseCM as boolean} onChange={sNoiseCM} label="Color grain" />
        </EffectCard>
        <EffectCard label="Scanlines" enabled={scan as boolean} onToggle={sScan} info={hintFor('background.scanlineEnabled')}>
          <FR label="Density" info={hintFor('background.scanDensity')}>
            <Sl value={scanD as number} min={0.5} max={5} step={0.1} onChange={sScanD} />
          </FR>
          <FR label="Scroll speed" info={hintFor('background.scanScrollSpeed')}>
            <Sl value={scanSS as number} min={-5} max={5} step={0.1} onChange={sScanSS} />
          </FR>
          <FR label="Thickness" info={hintFor('background.scanThickness')}>
            <Sl value={scanTh as number} min={0.1} max={0.9} step={0.05} onChange={sScanTh} />
          </FR>
          <FR label="Beat opacity" info={hintFor('background.scanBeatOpacity')}>
            <Sl value={scanBO as number} min={0} max={2} step={0.1} onChange={sScanBO} />
          </FR>
          <FR label="Beat density" info={hintFor('background.scanBeatDensity')}>
            <Sl value={scanBD as number} min={0} max={3} step={0.1} onChange={sScanBD} />
          </FR>
        </EffectCard>
        <EffectCard label="Glitch" enabled={glitch as boolean} onToggle={sGlitch} info={hintFor('background.glitchEnabled')}>
          <FR label="Delay" hint={`${(glitchD as number).toFixed(1)}s`} sub="Time between glitches" info={hintFor('background.glitchDelay')}>
            <Sl value={glitchD as number} min={0.5} max={10} step={0.5} onChange={sGlitchD} />
          </FR>
          <FR label="Strength" hint={`${(glitchS as number).toFixed(2)}`} info={hintFor('background.glitchStrength')}>
            <Sl value={glitchS as number} min={0.01} max={0.5} step={0.01} onChange={sGlitchS} />
          </FR>
          <FR label="RGB split" info={hintFor('background.glitchRGBSplit')}>
            <Sl value={glRGB as number} min={0} max={0.05} step={0.001} onChange={sGlRGB} />
          </FR>
          <FR label="Block size" info={hintFor('background.glitchBlockSize')}>
            <Sl value={glBlock as number} min={4} max={64} step={1} onChange={sGlBlock} />
          </FR>
          <FR label="Block probability" info={hintFor('background.glitchBlockProb')}>
            <Sl value={glProb as number} min={0} max={1} step={0.05} onChange={sGlProb} />
          </FR>
          <FR label="Vertical mix" info={hintFor('background.glitchVertical')}>
            <Sl value={glVert as number} min={0} max={1} step={0.05} onChange={sGlVert} />
          </FR>
          <FR label="Decay speed" info={hintFor('background.glitchDecay')}>
            <Sl value={glDecay as number} min={0.5} max={8} step={0.5} onChange={sGlDecay} />
          </FR>
          <Tg value={glSync as boolean} onChange={sGlSync} label="Beat sync" />
        </EffectCard>
        <EffectCard label="Pixelation" enabled={pixel as boolean} onToggle={sPixel} info={hintFor('background.pixelationEnabled')}>
          <FR label="Granularity" info={hintFor('background.pixelGranularity')}>
            <Sl value={pixelG as number} min={1} max={30} step={1} onChange={sPixelG} />
          </FR>
          <FR label="Beat size boost" info={hintFor('background.pixelBeatSize')}>
            <Sl value={pixBS as number} min={0} max={200} step={5} onChange={sPixBS} />
          </FR>
          <FR label="Wave distortion" info={hintFor('background.pixelWave')}>
            <Sl value={pixW as number} min={0} max={1} step={0.05} onChange={sPixW} />
          </FR>
          <FR label="Wave speed" info={hintFor('background.pixelWaveSpeed')}>
            <Sl value={pixWS as number} min={0} max={3} step={0.1} onChange={sPixWS} />
          </FR>
        </EffectCard>
        <EffectCard label="Dot screen" enabled={dot as boolean} onToggle={sDot} info={hintFor('background.dotScreenEnabled')}>
          <FR label="Scale" info={hintFor('background.dotScale')}>
            <Sl value={dotS as number} min={0.1} max={3} step={0.05} onChange={sDotS} />
          </FR>
          <FR label="Rotation" info={hintFor('background.dotRotation')}>
            <Sl value={dotRot as number} min={0} max={45} step={1} onChange={sDotRot} />
          </FR>
          <FR label="Rotation speed" info={hintFor('background.dotRotSpeed')}>
            <Sl value={dotRS as number} min={0} max={2} step={0.05} onChange={sDotRS} />
          </FR>
          <FR label="Beat scale" info={hintFor('background.dotBeatScale')}>
            <Sl value={dotBS as number} min={0} max={2} step={0.1} onChange={sDotBS} />
          </FR>
          <FR label="Color separation" info={hintFor('background.dotColorSep')}>
            <Sl value={dotCS as number} min={0} max={1} step={0.05} onChange={sDotCS} />
          </FR>
        </EffectCard>
        <EffectCard label="Grid" enabled={grid as boolean} onToggle={sGrid} info={hintFor('background.gridEnabled')}>
          <FR label="Scale" info={hintFor('background.gridScale')}>
            <Sl value={gridS as number} min={0.1} max={5} step={0.1} onChange={sGridS} />
          </FR>
          <FR label="Color" info={hintFor('background.gridColor')}><CP value={gridCl as string} onChange={sGridCl} /></FR>
          <FR label="Pulse strength" info={hintFor('background.gridPulseStrength')}>
            <Sl value={gridPS as number} min={0} max={3} step={0.1} onChange={sGridPS} />
          </FR>
          <FR label="Wave distortion" info={hintFor('background.gridWave')}>
            <Sl value={gridW as number} min={0} max={1} step={0.05} onChange={sGridW} />
          </FR>
          <FR label="Wave speed" info={hintFor('background.gridWaveSpeed')}>
            <Sl value={gridWS as number} min={0} max={5} step={0.1} onChange={sGridWS} />
          </FR>
          <FR label="Movement" info={hintFor('background.gridMovement')}>
            <Sl value={gridMv as number} min={0} max={2} step={0.05} onChange={sGridMv} />
          </FR>
        </EffectCard>
      </Acc>

    </div>
  );
}

// ── OverlayCard ───────────────────────────────────────────────────────────────

function OverlayCard({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="overflow-hidden rounded-lg border transition-colors"
      style={{
        borderColor: enabled ? 'var(--accent)' : 'var(--border)',
        background: 'var(--bg-elev-2)',
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="h-2 w-2 flex-shrink-0 rounded-full transition-colors"
          style={{ background: enabled ? 'var(--accent)' : 'var(--border-strong)' }}
        />
        <span
          className="flex-1 font-ui text-xs font-semibold"
          style={{ color: enabled ? 'var(--text)' : 'var(--text-muted)' }}
        >
          {label}
        </span>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className="flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors"
          style={{ background: enabled ? 'var(--accent)' : 'var(--border-strong)' }}
          aria-label={enabled ? 'Disable' : 'Enable'}
        >
          <span
            className="h-3 w-3 rounded-full transition-transform"
            style={{
              background: 'var(--bg-elev-1)',
              transform: enabled ? 'translateX(15px)' : 'translateX(2px)',
            }}
          />
        </button>
        {children && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label={expanded ? 'Collapse settings' : 'Expand settings'}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
      {expanded && children && (
        <div
          className="border-t px-3 pb-3 pt-3"
          style={{ borderColor: 'var(--border)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── Overlays Section ──────────────────────────────────────────────────────────

function OverlaysSection() {
  // Strands
  const [stE,     sStE]     = useF('background', 'strandsEnabled');
  const [stBL,    sStBL]    = useF('background', 'strandsBehindLogo');
  const [stCnt,   sStCnt]   = useF('background', 'strandsCount');
  const [stSp,    sStSp]    = useF('background', 'strandsSpeed');
  const [stAmp,   sStAmp]   = useF('background', 'strandsAmplitude');
  const [stWav,   sStWav]   = useF('background', 'strandsWaviness');
  const [stThk,   sStThk]   = useF('background', 'strandsThickness');
  const [stGlw,   sStGlw]   = useF('background', 'strandsGlow');
  const [stTap,   sStTap]   = useF('background', 'strandsTaper');
  const [stSpr,   sStSpr]   = useF('background', 'strandsSpread');
  const [stHue,   sStHue]   = useF('background', 'strandsHueShift');
  const [stInt,   sStInt]   = useF('background', 'strandsIntensity');
  const [stSat,   sStSat]   = useF('background', 'strandsSaturation');
  const [stOp,    sStOp]    = useF('background', 'strandsOpacity');
  const [stScl,   sStScl]   = useF('background', 'strandsScale');
  const [stBFS,   sStBFS]   = useF('background', 'strandsBeatFreqStart');
  const [stBFE,   sStBFE]   = useF('background', 'strandsBeatFreqEnd');
  const [stBSen,  sStBSen]  = useF('background', 'strandsBeatSensitivity');
  const [stGlwB,  sStGlwB]  = useF('background', 'strandsGlowBoost');
  const [stBM,    sStBM]    = useF('background', 'strandsBlendMode');
  // Magic Rings
  const [mrE,      sMrE]      = useF('background', 'magicRingsEnabled');
  const [mrC,      sMrC]      = useF('background', 'magicRingsColor');
  const [mrC2,     sMrC2]     = useF('background', 'magicRingsColorTwo');
  const [mrSp,     sMrSp]     = useF('background', 'magicRingsSpeed');
  const [mrCnt,    sMrCnt]    = useF('background', 'magicRingsCount');
  const [mrAtt,    sMrAtt]    = useF('background', 'magicRingsAttenuation');
  const [mrThk,    sMrThk]    = useF('background', 'magicRingsThickness');
  const [mrBR,     sMrBR]     = useF('background', 'magicRingsBaseRadius');
  const [mrRS,     sMrRS]     = useF('background', 'magicRingsRadiusStep');
  const [mrSR,     sMrSR]     = useF('background', 'magicRingsScaleRate');
  const [mrOp,     sMrOp]     = useF('background', 'magicRingsOpacity');
  const [mrNoise,  sMrNoise]  = useF('background', 'magicRingsNoiseAmount');
  const [mrRot,    sMrRot]    = useF('background', 'magicRingsRotation');
  const [mrGap,    sMrGap]    = useF('background', 'magicRingsRingGap');
  const [mrBFS,    sMrBFS]    = useF('background', 'magicRingsBeatFreqStart');
  const [mrBFE,    sMrBFE]    = useF('background', 'magicRingsBeatFreqEnd');
  const [mrBSen,   sMrBSen]   = useF('background', 'magicRingsBeatSensitivity');
  const [mrBurst,  sMrBurst]  = useF('background', 'magicRingsBurstStrength');
  const [mrGlwStr, sMrGlwStr] = useF('background', 'magicRingsGlowStrength');
  const [mrBL,    sMrBL]    = useF('background', 'magicRingsBehindLogo');
  const [mrBM,    sMrBM]    = useF('background', 'magicRingsBlendMode');
  // Light Rays
  const [lrE,    sLrE]    = useF('background', 'lightRaysEnabled');
  const [lrOr,   sLrOr]   = useF('background', 'lightRaysOrigin');
  const [lrCol,  sLrCol]  = useF('background', 'lightRaysColor');
  const [lrSp,   sLrSp]   = useF('background', 'lightRaysSpeed');
  const [lrSpr,  sLrSpr]  = useF('background', 'lightRaysSpread');
  const [lrLen,  sLrLen]  = useF('background', 'lightRaysLength');
  const [lrOp,   sLrOp]   = useF('background', 'lightRaysOpacity');
  const [lrFd,   sLrFd]   = useF('background', 'lightRaysFadeDistance');
  const [lrBL,   sLrBL]   = useF('background', 'lightRaysBehindLogo');
  const [lrBFS,  sLrBFS]  = useF('background', 'lightRaysBeatFreqStart');
  const [lrBFE,  sLrBFE]  = useF('background', 'lightRaysBeatFreqEnd');
  const [lrBSen, sLrBSen] = useF('background', 'lightRaysBeatSensitivity');
  const [lrBInt, sLrBInt] = useF('background', 'lightRaysBeatIntensity');
  const [lrBM,    sLrBM]    = useF('background', 'lightRaysBlendMode');
  // Light Pillar
  const [lpE,      sLpE]      = useF('background', 'lightPillarEnabled');
  const [lpBL,     sLpBL]     = useF('background', 'lightPillarBehindLogo');
  const [lpTopCol, sLpTopCol] = useF('background', 'lightPillarTopColor');
  const [lpBotCol, sLpBotCol] = useF('background', 'lightPillarBottomColor');
  const [lpInt,    sLpInt]    = useF('background', 'lightPillarIntensity');
  const [lpRotSpd, sLpRotSpd] = useF('background', 'lightPillarRotationSpeed');
  const [lpW,      sLpW]      = useF('background', 'lightPillarWidth');
  const [lpH,      sLpH]      = useF('background', 'lightPillarHeight');
  const [lpGlow,   sLpGlow]   = useF('background', 'lightPillarGlowAmount');
  const [lpNoise,  sLpNoise]  = useF('background', 'lightPillarNoiseIntensity');
  const [lpRot,    sLpRot]    = useF('background', 'lightPillarRotation');
  const [lpBFS,    sLpBFS]    = useF('background', 'lightPillarBeatFreqStart');
  const [lpBFE,    sLpBFE]    = useF('background', 'lightPillarBeatFreqEnd');
  const [lpBSen,   sLpBSen]   = useF('background', 'lightPillarBeatSensitivity');
  const [lpBInt,   sLpBInt]   = useF('background', 'lightPillarBeatIntensity');
  const [lpBW,     sLpBW]     = useF('background', 'lightPillarBeatWidthBoost');
  const [lpBM,     sLpBM]     = useF('background', 'lightPillarBlendMode');
  // Lightning
  const [ltnE,    sLtnE]    = useF('background', 'lightningEnabled');
  const [ltnBL,   sLtnBL]   = useF('background', 'lightningBehindLogo');
  const [ltnHue,  sLtnHue]  = useF('background', 'lightningHue');
  const [ltnXOff, sLtnXOff] = useF('background', 'lightningXOffset');
  const [ltnSp,   sLtnSp]   = useF('background', 'lightningSpeed');
  const [ltnInt,  sLtnInt]  = useF('background', 'lightningIntensity');
  const [ltnSz,   sLtnSz]   = useF('background', 'lightningSize');
  const [ltnOp,   sLtnOp]   = useF('background', 'lightningOpacity');
  const [ltnBFS,  sLtnBFS]  = useF('background', 'lightningBeatFreqStart');
  const [ltnBFE,  sLtnBFE]  = useF('background', 'lightningBeatFreqEnd');
  const [ltnBSen, sLtnBSen] = useF('background', 'lightningBeatSensitivity');
  const [ltnBInt, sLtnBInt] = useF('background', 'lightningBeatIntensity');
  const [ltnBScl, sLtnBScl] = useF('background', 'lightningBeatScale');
  const [ltnBM,   sLtnBM]   = useF('background', 'lightningBlendMode');
  // strandsColors
  const strandsColors = useSettingsStore((s) => s.settings.background.strandsColors);
  const setStrandsColors = (newColors: string[]) =>
    useSettingsStore.getState().setSettings((prev) => ({
      ...prev,
      background: { ...prev.background, strandsColors: newColors },
    }));
  const updateStrandColor = (i: number, v: string) => {
    const nc = [...strandsColors]; nc[i] = v; setStrandsColors(nc);
  };
  const addStrandColor = () => {
    if (strandsColors.length < 8) setStrandsColors([...strandsColors, '#ffffff']);
  };
  const removeStrandColor = (i: number) => {
    if (strandsColors.length > 1) setStrandsColors(strandsColors.filter((_, idx) => idx !== i));
  };
  // Weather FX
  const [bgPE,    sBgPE]    = useF('background', 'bgParticlesEnabled');
  const [bgPCnt,  sBgPCnt]  = useF('background', 'bgParticlesCount');
  const [bgPSp,   sBgPSp]   = useF('background', 'bgParticlesSpeed');
  const [bgPSz,   sBgPSz]   = useF('background', 'bgParticlesSize');
  const [bgPOp,   sBgPOp]   = useF('background', 'bgParticlesOpacity');
  const [bgPCl,   sBgPCl]   = useF('background', 'bgParticlesColor');
  const [bgPFS,   sBgPFS]   = useF('background', 'bgParticlesBeatFreqStart');
  const [bgPFE,   sBgPFE]   = useF('background', 'bgParticlesBeatFreqEnd');
  const [bgPSen,  sBgPSen]  = useF('background', 'bgParticlesBeatSensitivity');
  const [bgPBL,   sBgPBL]   = useF('background', 'bgParticlesBehindLogo');
  const [bgPBM,   sBgPBM]   = useF('background', 'bgParticlesBlendMode');
  const [rnE,     sRnE]     = useF('background', 'rainEnabled');
  const [rnCnt,   sRnCnt]   = useF('background', 'rainCount');
  const [rnSp,    sRnSp]    = useF('background', 'rainSpeed');
  const [rnAng,   sRnAng]   = useF('background', 'rainAngle');
  const [rnLen,   sRnLen]   = useF('background', 'rainLength');
  const [rnWid,   sRnWid]   = useF('background', 'rainWidth');
  const [rnCl,    sRnCl]    = useF('background', 'rainColor');
  const [rnOp,    sRnOp]    = useF('background', 'rainOpacity');
  const [rnFS,    sRnFS]    = useF('background', 'rainBeatFreqStart');
  const [rnFE,    sRnFE]    = useF('background', 'rainBeatFreqEnd');
  const [rnSen,   sRnSen]   = useF('background', 'rainBeatSensitivity');
  const [rnBL,    sRnBL]    = useF('background', 'rainBehindLogo');
  const [rnBM,    sRnBM]    = useF('background', 'rainBlendMode');
  const [snE,     sSnE]     = useF('background', 'snowEnabled');
  const [snCnt,   sSnCnt]   = useF('background', 'snowCount');
  const [snSp,    sSnSp]    = useF('background', 'snowSpeed');
  const [snSz,    sSnSz]    = useF('background', 'snowSize');
  const [snCl,    sSnCl]    = useF('background', 'snowColor');
  const [snOp,    sSnOp]    = useF('background', 'snowOpacity');
  const [snSw,    sSnSw]    = useF('background', 'snowSway');
  const [snFS,    sSnFS]    = useF('background', 'snowBeatFreqStart');
  const [snFE,    sSnFE]    = useF('background', 'snowBeatFreqEnd');
  const [snSen,   sSnSen]   = useF('background', 'snowBeatSensitivity');
  const [snBL,    sSnBL]    = useF('background', 'snowBehindLogo');
  const [snBM,    sSnBM]    = useF('background', 'snowBlendMode');
  // Hyperspeed
  const [hspE,    sHspE]    = useF('background', 'hyperspeedEnabled');
  const [hspBL,   sHspBL]   = useF('background', 'hyperspeedBehindLogo');
  const [hspOp,   sHspOp]   = useF('background', 'hyperspeedOpacity');
  const [hspDist, sHspDist] = useF('background', 'hyperspeedDistortion');
  const [hspSpd,  sHspSpd]  = useF('background', 'hyperspeedSpeed');
  const [hspLanes,sHspLanes]= useF('background', 'hyperspeedLanesPerRoad');
  const [hspRW,   sHspRW]   = useF('background', 'hyperspeedRoadWidth');
  const [hspFov,  sHspFov]  = useF('background', 'hyperspeedFov');
  const [hspLC1,  sHspLC1]  = useF('background', 'hyperspeedLeftCarColor1');
  const [hspLC2,  sHspLC2]  = useF('background', 'hyperspeedLeftCarColor2');
  const [hspLC3,  sHspLC3]  = useF('background', 'hyperspeedLeftCarColor3');
  const [hspRC1,  sHspRC1]  = useF('background', 'hyperspeedRightCarColor1');
  const [hspRC2,  sHspRC2]  = useF('background', 'hyperspeedRightCarColor2');
  const [hspRC3,  sHspRC3]  = useF('background', 'hyperspeedRightCarColor3');
  const [hspSC,   sHspSC]   = useF('background', 'hyperspeedSticksColor');
  const [hspBB,   sHspBB]   = useF('background', 'hyperspeedBeatBrightness');
  const [hspBFS,  sHspBFS]  = useF('background', 'hyperspeedBeatFreqStart');
  const [hspBFE,  sHspBFE]  = useF('background', 'hyperspeedBeatFreqEnd');
  const [hspBSen, sHspBSen] = useF('background', 'hyperspeedBeatSensitivity');
  const [hspBM,   sHspBM]   = useF('background', 'hyperspeedBlendMode');
  // FaultyTerminal
  const [ftE,    sFtE]    = useF('background', 'faultyTerminalEnabled');
  const [ftBL,   sFtBL]   = useF('background', 'faultyTerminalBehindLogo');
  const [ftTint, sFtTint] = useF('background', 'faultyTerminalTint');
  const [ftBri,  sFtBri]  = useF('background', 'faultyTerminalBrightness');
  const [ftSc,   sFtSc]   = useF('background', 'faultyTerminalScale');
  const [ftScan, sFtScan] = useF('background', 'faultyTerminalScanlineIntensity');
  const [ftGl,   sFtGl]   = useF('background', 'faultyTerminalGlitchAmount');
  const [ftFl,   sFtFl]   = useF('background', 'faultyTerminalFlickerAmount');
  const [ftNA,   sFtNA]   = useF('background', 'faultyTerminalNoiseAmp');
  const [ftCv,   sFtCv]   = useF('background', 'faultyTerminalCurvature');
  const [ftSp,   sFtSp]   = useF('background', 'faultyTerminalSpeed');
  const [ftBFS,  sFtBFS]  = useF('background', 'faultyTerminalBeatFreqStart');
  const [ftBFE,  sFtBFE]  = useF('background', 'faultyTerminalBeatFreqEnd');
  const [ftBSen, sFtBSen] = useF('background', 'faultyTerminalBeatSensitivity');
  const [ftBGB,  sFtBGB]  = useF('background', 'faultyTerminalBeatGlitchBoost');
  const [ftBM,   sFtBM]   = useF('background', 'faultyTerminalBlendMode');

  // Ferrofluid
  const [ffE,    sffE]   = useF('background', 'ferrofluidEnabled');
  const [ffBL,   sffBL]  = useF('background', 'ferrofluidBehindLogo');
  const [ffBM,   sffBM]  = useF('background', 'ferrofluidBlendMode');
  const [ffC0,   sffC0]  = useF('background', 'ferrofluidColor0');
  const [ffC1,   sffC1]  = useF('background', 'ferrofluidColor1');
  const [ffC2,   sffC2]  = useF('background', 'ferrofluidColor2');
  const [ffSpd,  sffSpd] = useF('background', 'ferrofluidSpeed');
  const [ffScl,  sffScl] = useF('background', 'ferrofluidScale');
  const [ffTrb,  sffTrb] = useF('background', 'ferrofluidTurbulence');
  const [ffFld,  sffFld] = useF('background', 'ferrofluidFluidity');
  const [ffRW,   sffRW]  = useF('background', 'ferrofluidRimWidth');
  const [ffShp,  sffShp] = useF('background', 'ferrofluidSharpness');
  const [ffShm,  sffShm] = useF('background', 'ferrofluidShimmer');
  const [ffGlw,  sffGlw] = useF('background', 'ferrofluidGlow');
  const [ffFlow, sffFlow]= useF('background', 'ferrofluidFlowDirection');
  const [ffOp,   sffOp]  = useF('background', 'ferrofluidOpacity');
  const [ffBFS,  sffBFS] = useF('background', 'ferrofluidBeatFreqStart');
  const [ffBFE,  sffBFE] = useF('background', 'ferrofluidBeatFreqEnd');
  const [ffBS,   sffBS]  = useF('background', 'ferrofluidBeatSensitivity');
  const [ffGB,   sffGB]  = useF('background', 'ferrofluidGlowBoost');

  return (
    <div className="flex flex-col gap-2">
      <OverlayCard label="Strands" enabled={stE as boolean} onToggle={sStE}>
        <FR label="Position" info={hintFor('background.strandsBehindLogo')}>
          <CB
            value={(stBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sStBL(v === 'behind')}
          />
        </FR>
        <FR label="Colors" info={hintFor('background.strandsColors')}>
          <div className="flex flex-col gap-1 w-full">
            {strandsColors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <CP value={c} onChange={(v) => updateStrandColor(i, v)} />
                {strandsColors.length > 1 && (
                  <button
                    onClick={() => removeStrandColor(i)}
                    className="text-xs px-1 rounded"
                    style={{ color: 'var(--text-dim)', background: 'var(--bg-elev-2)' }}
                  >×</button>
                )}
              </div>
            ))}
            {strandsColors.length < 8 && (
              <button
                onClick={addStrandColor}
                className="mt-1 text-xs px-2 py-0.5 rounded self-start"
                style={{ color: 'var(--accent)', background: 'var(--bg-elev-2)' }}
              >+ Add color</button>
            )}
          </div>
        </FR>
        <FR label="Strand count" hint={`${stCnt}`} info={hintFor('background.strandsCount')}>
          <Sl value={stCnt as number} min={1} max={12} step={1} onChange={sStCnt} />
        </FR>
        <FR label="Speed" hint={`${(stSp as number).toFixed(2)}`} info={hintFor('background.strandsSpeed')}>
          <Sl value={stSp as number} min={0} max={3} step={0.05} onChange={sStSp} />
        </FR>
        <FR label="Amplitude" hint={`${(stAmp as number).toFixed(2)}`} info={hintFor('background.strandsAmplitude')}>
          <Sl value={stAmp as number} min={0} max={3} step={0.05} onChange={sStAmp} />
        </FR>
        <FR label="Waviness" hint={`${(stWav as number).toFixed(2)}`} info={hintFor('background.strandsWaviness')}>
          <Sl value={stWav as number} min={0} max={3} step={0.05} onChange={sStWav} />
        </FR>
        <FR label="Thickness" hint={`${(stThk as number).toFixed(2)}`} info={hintFor('background.strandsThickness')}>
          <Sl value={stThk as number} min={0} max={3} step={0.05} onChange={sStThk} />
        </FR>
        <FR label="Glow" hint={`${(stGlw as number).toFixed(1)}`} info={hintFor('background.strandsGlow')}>
          <Sl value={stGlw as number} min={0} max={6} step={0.1} onChange={sStGlw} />
        </FR>
        <FR label="Taper" hint={`${(stTap as number).toFixed(1)}`} info={hintFor('background.strandsTaper')}>
          <Sl value={stTap as number} min={0} max={10} step={0.1} onChange={sStTap} />
        </FR>
        <FR label="Spread" hint={`${(stSpr as number).toFixed(2)}`} info={hintFor('background.strandsSpread')}>
          <Sl value={stSpr as number} min={0} max={3} step={0.05} onChange={sStSpr} />
        </FR>
        <FR label="Hue shift" hint={`${(stHue as number).toFixed(2)}`} info={hintFor('background.strandsHueShift')}>
          <Sl value={stHue as number} min={0} max={2} step={0.01} onChange={sStHue} />
        </FR>
        <FR label="Intensity" hint={`${Math.round((stInt as number) * 100)}%`} info={hintFor('background.strandsIntensity')}>
          <Sl value={stInt as number} min={0} max={1} step={0.01} onChange={sStInt} />
        </FR>
        <FR label="Saturation" hint={`${(stSat as number).toFixed(2)}`} info={hintFor('background.strandsSaturation')}>
          <Sl value={stSat as number} min={0} max={3} step={0.05} onChange={sStSat} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((stOp as number) * 100)}%`} info={hintFor('background.strandsOpacity')}>
          <Sl value={stOp as number} min={0} max={1} step={0.01} onChange={sStOp} />
        </FR>
        <FR label="Scale" hint={`${(stScl as number).toFixed(1)}×`} info={hintFor('background.strandsScale')}>
          <Sl value={stScl as number} min={0.1} max={5} step={0.1} onChange={sStScl} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={stBFS as number} endHz={stBFE as number} onChangeStart={sStBFS} onChangeEnd={sStBFE} />
          <div className="mt-2">
            <FR label="Beat sensitivity" hint={`${(stBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.strandsBeatSensitivity')}>
              <Sl value={stBSen as number} min={0} max={5} step={0.1} onChange={sStBSen} />
            </FR>
            <FR label="Glow on beat" hint={`${(stGlwB as number).toFixed(2)}`} info={hintFor('background.strandsGlowBoost')}>
              <Sl value={stGlwB as number} min={0} max={2} step={0.05} onChange={sStGlwB} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.strandsBlendMode')}>
          <BlendSel value={stBM as string} onChange={sStBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Light Rays" enabled={lrE as boolean} onToggle={sLrE}>
        <FR label="Position" info={hintFor('background.lightRaysBehindLogo')}>
          <CB
            value={(lrBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sLrBL(v === 'behind')}
          />
        </FR>
        <FR label="Origin" info={hintFor('background.lightRaysOrigin')}>
          <select value={lrOr as string} onChange={(e) => sLrOr(e.target.value)}
            style={{ width: '100%', background: 'var(--bg-elev-2)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '0.85rem' }}>
            <option value="top-center">Top Center</option>
            <option value="top-left">Top Left</option>
            <option value="top-right">Top Right</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="bottom-center">Bottom Center</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </FR>
        <FR label="Color" info={hintFor('background.lightRaysColor')}><CP value={lrCol as string} onChange={sLrCol} /></FR>
        <FR label="Speed" hint={`${(lrSp as number).toFixed(2)}`} info={hintFor('background.lightRaysSpeed')}>
          <Sl value={lrSp as number} min={0.1} max={3} step={0.1} onChange={sLrSp} />
        </FR>
        <FR label="Spread" hint={`${(lrSpr as number).toFixed(2)}`} info={hintFor('background.lightRaysSpread')}>
          <Sl value={lrSpr as number} min={0.1} max={3} step={0.1} onChange={sLrSpr} />
        </FR>
        <FR label="Length" hint={`${(lrLen as number).toFixed(2)}`} info={hintFor('background.lightRaysLength')}>
          <Sl value={lrLen as number} min={0.5} max={3} step={0.1} onChange={sLrLen} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((lrOp as number) * 100)}%`} info={hintFor('background.lightRaysOpacity')}>
          <Sl value={lrOp as number} min={0} max={1} step={0.05} onChange={sLrOp} />
        </FR>
        <FR label="Fade Distance" hint={`${(lrFd as number).toFixed(2)}`} info={hintFor('background.lightRaysFadeDistance')}>
          <Sl value={lrFd as number} min={0.1} max={2} step={0.1} onChange={sLrFd} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={lrBFS as number} endHz={lrBFE as number} onChangeStart={sLrBFS} onChangeEnd={sLrBFE} />
          <div className="mt-2">
            <FR label="Beat Sensitivity" hint={`${(lrBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.lightRaysBeatSensitivity')}>
              <Sl value={lrBSen as number} min={0} max={5} step={0.1} onChange={sLrBSen} />
            </FR>
            <FR label="Beat Intensity" hint={`${(lrBInt as number).toFixed(2)}`} info={hintFor('background.lightRaysBeatIntensity')}>
              <Sl value={lrBInt as number} min={0} max={2} step={0.1} onChange={sLrBInt} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.lightRaysBlendMode')}>
          <BlendSel value={lrBM as string} onChange={sLrBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Light Pillar" enabled={lpE as boolean} onToggle={sLpE}>
        <FR label="Position" info={hintFor('background.lightPillarBehindLogo')}>
          <CB
            value={(lpBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sLpBL(v === 'behind')}
          />
        </FR>
        <FR label="Top Color" info={hintFor('background.lightPillarTopColor')}><CP value={lpTopCol as string} onChange={sLpTopCol} /></FR>
        <FR label="Bottom Color" info={hintFor('background.lightPillarBottomColor')}><CP value={lpBotCol as string} onChange={sLpBotCol} /></FR>
        <FR label="Intensity" hint={`${(lpInt as number).toFixed(2)}`} info={hintFor('background.lightPillarIntensity')}>
          <Sl value={lpInt as number} min={0.1} max={3} step={0.1} onChange={sLpInt} />
        </FR>
        <FR label="Rotation Speed" hint={`${(lpRotSpd as number).toFixed(2)}`} info={hintFor('background.lightPillarRotationSpeed')}>
          <Sl value={lpRotSpd as number} min={0} max={2} step={0.05} onChange={sLpRotSpd} />
        </FR>
        <FR label="Pillar Width" hint={`${(lpW as number).toFixed(2)}`} info={hintFor('background.lightPillarWidth')}>
          <Sl value={lpW as number} min={0.5} max={8} step={0.1} onChange={sLpW} />
        </FR>
        <FR label="Pillar Height" hint={`${(lpH as number).toFixed(2)}`} info={hintFor('background.lightPillarHeight')}>
          <Sl value={lpH as number} min={0.1} max={2} step={0.05} onChange={sLpH} />
        </FR>
        <FR label="Glow Amount" hint={`${(lpGlow as number).toFixed(4)}`} info={hintFor('background.lightPillarGlowAmount')}>
          <Sl value={lpGlow as number} min={0.001} max={0.02} step={0.001} onChange={sLpGlow} />
        </FR>
        <FR label="Noise" hint={`${(lpNoise as number).toFixed(2)}`} info={hintFor('background.lightPillarNoiseIntensity')}>
          <Sl value={lpNoise as number} min={0} max={1} step={0.05} onChange={sLpNoise} />
        </FR>
        <FR label="Pillar Rotation" hint={`${Math.round(lpRot as number)}°`} info={hintFor('background.lightPillarRotation')}>
          <Sl value={lpRot as number} min={0} max={360} step={1} onChange={sLpRot} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={lpBFS as number} endHz={lpBFE as number} onChangeStart={sLpBFS} onChangeEnd={sLpBFE} />
          <div className="mt-2">
            <FR label="Beat Sensitivity" hint={`${(lpBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.lightPillarBeatSensitivity')}>
              <Sl value={lpBSen as number} min={0} max={5} step={0.1} onChange={sLpBSen} />
            </FR>
            <FR label="Beat Intensity" hint={`${(lpBInt as number).toFixed(2)}`} info={hintFor('background.lightPillarBeatIntensity')}>
              <Sl value={lpBInt as number} min={0} max={2} step={0.1} onChange={sLpBInt} />
            </FR>
            <FR label="Beat Width Boost" hint={`${(lpBW as number).toFixed(2)}`} info={hintFor('background.lightPillarBeatWidthBoost')}>
              <Sl value={lpBW as number} min={0} max={1} step={0.05} onChange={sLpBW} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.lightPillarBlendMode')}>
          <BlendSel value={lpBM as string} onChange={sLpBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Lightning" enabled={ltnE as boolean} onToggle={sLtnE}>
        <FR label="Position" info={hintFor('background.lightningBehindLogo')}>
          <CB
            value={(ltnBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sLtnBL(v === 'behind')}
          />
        </FR>
        <FR label="Hue" hint={`${Math.round(ltnHue as number)}°`} info={hintFor('background.lightningHue')}>
          <Sl value={ltnHue as number} min={0} max={360} step={1} onChange={sLtnHue} />
        </FR>
        <FR label="X Offset" hint={`${(ltnXOff as number).toFixed(2)}`} info={hintFor('background.lightningXOffset')}>
          <Sl value={ltnXOff as number} min={-1} max={1} step={0.01} onChange={sLtnXOff} />
        </FR>
        <FR label="Speed" hint={`${(ltnSp as number).toFixed(1)}`} info={hintFor('background.lightningSpeed')}>
          <Sl value={ltnSp as number} min={0.1} max={3} step={0.1} onChange={sLtnSp} />
        </FR>
        <FR label="Intensity" hint={`${(ltnInt as number).toFixed(1)}`} info={hintFor('background.lightningIntensity')}>
          <Sl value={ltnInt as number} min={0.1} max={3} step={0.1} onChange={sLtnInt} />
        </FR>
        <FR label="Size" hint={`${(ltnSz as number).toFixed(1)}`} info={hintFor('background.lightningSize')}>
          <Sl value={ltnSz as number} min={0.1} max={3} step={0.1} onChange={sLtnSz} />
        </FR>
        <FR label="Opacity" hint={`${(ltnOp as number).toFixed(2)}`} info={hintFor('background.lightningOpacity')}>
          <Sl value={ltnOp as number} min={0} max={1} step={0.01} onChange={sLtnOp} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={ltnBFS as number} endHz={ltnBFE as number} onChangeStart={sLtnBFS} onChangeEnd={sLtnBFE} />
          <div className="mt-2">
            <FR label="Beat Sensitivity" hint={`${(ltnBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.lightningBeatSensitivity')}>
              <Sl value={ltnBSen as number} min={0} max={5} step={0.1} onChange={sLtnBSen} />
            </FR>
            <FR label="Beat Intensity Boost" hint={`${(ltnBInt as number).toFixed(1)}`} info={hintFor('background.lightningBeatIntensity')}>
              <Sl value={ltnBInt as number} min={0} max={2} step={0.1} onChange={sLtnBInt} />
            </FR>
            <FR label="Beat Scale Boost" hint={`${(ltnBScl as number).toFixed(2)}`} info={hintFor('background.lightningBeatScale')}>
              <Sl value={ltnBScl as number} min={0} max={1} step={0.05} onChange={sLtnBScl} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.lightningBlendMode')}>
          <BlendSel value={ltnBM as string} onChange={sLtnBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Magic Rings" enabled={mrE as boolean} onToggle={sMrE}>
        <FR label="Position" info={hintFor('background.magicRingsBehindLogo')}>
          <CB
            value={(mrBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sMrBL(v === 'behind')}
          />
        </FR>
        <FR label="Color 1" info={hintFor('background.magicRingsColor')}><CP value={mrC as string} onChange={sMrC} /></FR>
        <FR label="Color 2" info={hintFor('background.magicRingsColorTwo')}><CP value={mrC2 as string} onChange={sMrC2} /></FR>
        <FR label="Speed" hint={`${(mrSp as number).toFixed(2)}`} info={hintFor('background.magicRingsSpeed')}>
          <Sl value={mrSp as number} min={0.1} max={3.0} step={0.05} onChange={sMrSp} />
        </FR>
        <FR label="Ring count" hint={`${mrCnt}`} info={hintFor('background.magicRingsCount')}>
          <Sl value={mrCnt as number} min={1} max={10} step={1} onChange={sMrCnt} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((mrOp as number) * 100)}%`} info={hintFor('background.magicRingsOpacity')}>
          <Sl value={mrOp as number} min={0} max={1} step={0.01} onChange={sMrOp} />
        </FR>
        <FR label="Thickness" hint={`${(mrThk as number).toFixed(1)}`} info={hintFor('background.magicRingsThickness')}>
          <Sl value={mrThk as number} min={0.5} max={5} step={0.1} onChange={sMrThk} />
        </FR>
        <FR label="Attenuation" hint={`${(mrAtt as number).toFixed(1)}`} info={hintFor('background.magicRingsAttenuation')}>
          <Sl value={mrAtt as number} min={2} max={30} step={0.5} onChange={sMrAtt} />
        </FR>
        <FR label="Base radius" hint={`${(mrBR as number).toFixed(2)}`} info={hintFor('background.magicRingsBaseRadius')}>
          <Sl value={mrBR as number} min={0.1} max={0.8} step={0.01} onChange={sMrBR} />
        </FR>
        <FR label="Radius step" hint={`${(mrRS as number).toFixed(2)}`} info={hintFor('background.magicRingsRadiusStep')}>
          <Sl value={mrRS as number} min={0.02} max={0.3} step={0.01} onChange={sMrRS} />
        </FR>
        <FR label="Scale rate" hint={`${(mrSR as number).toFixed(2)}`} info={hintFor('background.magicRingsScaleRate')}>
          <Sl value={mrSR as number} min={0} max={0.5} step={0.01} onChange={sMrSR} />
        </FR>
        <FR label="Noise amount" hint={`${(mrNoise as number).toFixed(3)}`} info={hintFor('background.magicRingsNoiseAmount')}>
          <Sl value={mrNoise as number} min={0} max={0.5} step={0.005} onChange={sMrNoise} />
        </FR>
        <FR label="Rotation" hint={`${Math.round(mrRot as number)}°`} info={hintFor('background.magicRingsRotation')}>
          <Sl value={mrRot as number} min={0} max={360} step={1} onChange={sMrRot} />
        </FR>
        <FR label="Ring gap" hint={`${(mrGap as number).toFixed(2)}`} info={hintFor('background.magicRingsRingGap')}>
          <Sl value={mrGap as number} min={1.0} max={3.0} step={0.05} onChange={sMrGap} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={mrBFS as number} endHz={mrBFE as number} onChangeStart={sMrBFS} onChangeEnd={sMrBFE} />
          <div className="mt-2">
            <FR label="Beat sensitivity" hint={`${(mrBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.magicRingsBeatSensitivity')}>
              <Sl value={mrBSen as number} min={0.1} max={5.0} step={0.05} onChange={sMrBSen} />
            </FR>
            <FR label="Burst strength" hint={`${(mrBurst as number).toFixed(2)}`} info={hintFor('background.magicRingsBurstStrength')}>
              <Sl value={mrBurst as number} min={0} max={2.0} step={0.05} onChange={sMrBurst} />
            </FR>
            <FR label="Glow on beat" hint={`${(mrGlwStr as number).toFixed(2)}`} info={hintFor('background.magicRingsGlowStrength')}>
              <Sl value={mrGlwStr as number} min={0} max={1.0} step={0.05} onChange={sMrGlwStr} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.magicRingsBlendMode')}>
          <BlendSel value={mrBM as string} onChange={sMrBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Background Particles" enabled={bgPE as boolean} onToggle={sBgPE}>
          <FR label="Position" info={hintFor('background.bgParticlesBehindLogo')}>
            <CB
              value={(bgPBL as boolean) ? 'behind' : 'front'}
              options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
              onChange={(v) => sBgPBL(v === 'behind')}
            />
          </FR>
          <FR label="Count" hint={`${bgPCnt}`} info={hintFor('background.bgParticlesCount')}>
            <Sl value={bgPCnt as number} min={0} max={500} step={10} onChange={sBgPCnt} />
          </FR>
          <FR label="Speed" info={hintFor('background.bgParticlesSpeed')}>
            <Sl value={bgPSp as number} min={0} max={3} step={0.05} onChange={sBgPSp} />
          </FR>
          <FR label="Size" hint={`${(bgPSz as number).toFixed(1)}px`} info={hintFor('background.bgParticlesSize')}>
            <Sl value={bgPSz as number} min={0.5} max={10} step={0.1} onChange={sBgPSz} />
          </FR>
          <FR label="Opacity" hint={`${Math.round((bgPOp as number) * 100)}%`} info={hintFor('background.bgParticlesOpacity')}>
            <Sl value={bgPOp as number} min={0} max={1} step={0.01} onChange={sBgPOp} />
          </FR>
          <FR label="Color" info={hintFor('background.bgParticlesColor')}><CP value={bgPCl as string} onChange={sBgPCl} /></FR>
          <div className="mt-2">
            <HzRangePicker
              startHz={bgPFS as number}
              endHz={bgPFE as number}
              onChangeStart={sBgPFS}
              onChangeEnd={sBgPFE}
            />
            <div className="mt-2">
              <FR label="Sensitivity" hint={`${(bgPSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.bgParticlesBeatSensitivity')}>
                <Sl value={bgPSen as number} min={0.1} max={5.0} step={0.05} onChange={sBgPSen} />
              </FR>
            </div>
          </div>
          <FR label="Blend mode" info={hintFor('background.bgParticlesBlendMode')}>
            <BlendSel value={bgPBM as string} onChange={sBgPBM as (v: string) => void} />
          </FR>
      </OverlayCard>

      <OverlayCard label="Rain" enabled={rnE as boolean} onToggle={sRnE}>
          <FR label="Position" info={hintFor('background.rainBehindLogo')}>
            <CB
              value={(rnBL as boolean) ? 'behind' : 'front'}
              options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
              onChange={(v) => sRnBL(v === 'behind')}
            />
          </FR>
          <FR label="Count" hint={`${rnCnt}`} info={hintFor('background.rainCount')}>
            <Sl value={rnCnt as number} min={0} max={1000} step={20} onChange={sRnCnt} />
          </FR>
          <FR label="Speed" info={hintFor('background.rainSpeed')}>
            <Sl value={rnSp as number} min={0} max={5} step={0.1} onChange={sRnSp} />
          </FR>
          <FR label="Angle" hint={`${Math.round(rnAng as number)}°`} info={hintFor('background.rainAngle')}>
            <Sl value={rnAng as number} min={-45} max={45} step={1} onChange={sRnAng} />
          </FR>
          <FR label="Streak length" hint={`${(rnLen as number).toFixed(1)}`} info={hintFor('background.rainLength')}>
            <Sl value={rnLen as number} min={0.5} max={8} step={0.1} onChange={sRnLen} />
          </FR>
          <FR label="Width" hint={`${(rnWid as number).toFixed(1)}`} info={hintFor('background.rainWidth')}>
            <Sl value={rnWid as number} min={0.1} max={3} step={0.1} onChange={sRnWid} />
          </FR>
          <FR label="Opacity" hint={`${Math.round((rnOp as number) * 100)}%`} info={hintFor('background.rainOpacity')}>
            <Sl value={rnOp as number} min={0} max={1} step={0.01} onChange={sRnOp} />
          </FR>
          <FR label="Color" info={hintFor('background.rainColor')}><CP value={rnCl as string} onChange={sRnCl} /></FR>
          <div className="mt-2">
            <HzRangePicker
              startHz={rnFS as number}
              endHz={rnFE as number}
              onChangeStart={sRnFS}
              onChangeEnd={sRnFE}
            />
            <div className="mt-2">
              <FR label="Sensitivity" hint={`${(rnSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.rainBeatSensitivity')}>
                <Sl value={rnSen as number} min={0.1} max={5.0} step={0.05} onChange={sRnSen} />
              </FR>
            </div>
          </div>
          <FR label="Blend mode" info={hintFor('background.rainBlendMode')}>
            <BlendSel value={rnBM as string} onChange={sRnBM as (v: string) => void} />
          </FR>
      </OverlayCard>

      <OverlayCard label="Snow" enabled={snE as boolean} onToggle={sSnE}>
          <FR label="Position" info={hintFor('background.snowBehindLogo')}>
            <CB
              value={(snBL as boolean) ? 'behind' : 'front'}
              options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
              onChange={(v) => sSnBL(v === 'behind')}
            />
          </FR>
          <FR label="Count" hint={`${snCnt}`} info={hintFor('background.snowCount')}>
            <Sl value={snCnt as number} min={0} max={600} step={10} onChange={sSnCnt} />
          </FR>
          <FR label="Speed" info={hintFor('background.snowSpeed')}>
            <Sl value={snSp as number} min={0} max={3} step={0.05} onChange={sSnSp} />
          </FR>
          <FR label="Size" hint={`${(snSz as number).toFixed(1)}px`} info={hintFor('background.snowSize')}>
            <Sl value={snSz as number} min={0.5} max={8} step={0.1} onChange={sSnSz} />
          </FR>
          <FR label="Sway" hint={`${(snSw as number).toFixed(1)}`} info={hintFor('background.snowSway')}>
            <Sl value={snSw as number} min={0} max={3} step={0.1} onChange={sSnSw} />
          </FR>
          <FR label="Opacity" hint={`${Math.round((snOp as number) * 100)}%`} info={hintFor('background.snowOpacity')}>
            <Sl value={snOp as number} min={0} max={1} step={0.01} onChange={sSnOp} />
          </FR>
          <FR label="Color" info={hintFor('background.snowColor')}><CP value={snCl as string} onChange={sSnCl} /></FR>
          <div className="mt-2">
            <HzRangePicker
              startHz={snFS as number}
              endHz={snFE as number}
              onChangeStart={sSnFS}
              onChangeEnd={sSnFE}
            />
            <div className="mt-2">
              <FR label="Sensitivity" hint={`${(snSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.snowBeatSensitivity')}>
                <Sl value={snSen as number} min={0.1} max={5.0} step={0.05} onChange={sSnSen} />
              </FR>
            </div>
          </div>
          <FR label="Blend mode" info={hintFor('background.snowBlendMode')}>
            <BlendSel value={snBM as string} onChange={sSnBM as (v: string) => void} />
          </FR>
      </OverlayCard>

      <OverlayCard label="Hyperspeed" enabled={hspE as boolean} onToggle={sHspE}>
        <FR label="Position" info={hintFor('background.hyperspeedBehindLogo')}>
          <CB
            value={(hspBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sHspBL(v === 'behind')}
          />
        </FR>
        <FR label="Blend Mode" info={hintFor('background.hyperspeedBlendMode')}>
          <BlendSel value={hspBM as string} onChange={sHspBM as (v: string) => void} />
        </FR>
        <FR label="Opacity" info={hintFor('background.hyperspeedOpacity')}>
          <Sl value={hspOp as number} min={0} max={1} step={0.01} onChange={sHspOp} />
        </FR>
        <FR label="Distortion" info={hintFor('background.hyperspeedDistortion')}>
          <select value={hspDist as string} onChange={(e) => sHspDist(e.target.value)}
            style={{ background: 'var(--bg-elev-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer', width: '100%' }}>
            <option value="turbulentDistortion">Turbulent</option>
            <option value="mountainDistortion">Mountain</option>
            <option value="xyDistortion">XY Wave</option>
            <option value="LongRaceDistortion">Long Race</option>
            <option value="deepDistortion">Deep</option>
            <option value="turbulentDistortionStill">Turbulent Still</option>
            <option value="deepDistortionStill">Deep Still</option>
          </select>
        </FR>
        <FR label="Speed" info={hintFor('background.hyperspeedSpeed')}>
          <Sl value={hspSpd as number} min={0.1} max={5} step={0.1} onChange={sHspSpd} />
        </FR>
        <FR label="Lanes" info={hintFor('background.hyperspeedLanesPerRoad')}>
          <Sl value={hspLanes as number} min={1} max={5} step={1} onChange={sHspLanes} />
        </FR>
        <FR label="Road Width" info={hintFor('background.hyperspeedRoadWidth')}>
          <Sl value={hspRW as number} min={5} max={25} step={1} onChange={sHspRW} />
        </FR>
        <FR label="FOV" info={hintFor('background.hyperspeedFov')}>
          <Sl value={hspFov as number} min={60} max={150} step={1} onChange={sHspFov} />
        </FR>
        <FR label="Left Cars" info={hintFor('background.hyperspeedLeftCarColor1')}>
          <div className="flex gap-1">
            <CP value={hspLC1 as string} onChange={sHspLC1 as (v: string) => void} />
            <CP value={hspLC2 as string} onChange={sHspLC2 as (v: string) => void} />
            <CP value={hspLC3 as string} onChange={sHspLC3 as (v: string) => void} />
          </div>
        </FR>
        <FR label="Right Cars" info={hintFor('background.hyperspeedRightCarColor1')}>
          <div className="flex gap-1">
            <CP value={hspRC1 as string} onChange={sHspRC1 as (v: string) => void} />
            <CP value={hspRC2 as string} onChange={sHspRC2 as (v: string) => void} />
            <CP value={hspRC3 as string} onChange={sHspRC3 as (v: string) => void} />
          </div>
        </FR>
        <FR label="Side Sticks" info={hintFor('background.hyperspeedSticksColor')}>
          <CP value={hspSC as string} onChange={sHspSC as (v: string) => void} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={hspBFS as number} endHz={hspBFE as number} onChangeStart={sHspBFS} onChangeEnd={sHspBFE} />
          <div className="mt-2">
            <FR label="Beat Sensitivity" hint={`${(hspBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.hyperspeedBeatSensitivity')}>
              <Sl value={hspBSen as number} min={0.1} max={5} step={0.1} onChange={sHspBSen} />
            </FR>
            <FR label="Beat Brightness" hint={`${(hspBB as number).toFixed(1)}`} info={hintFor('background.hyperspeedBeatBrightness')}>
              <Sl value={hspBB as number} min={0} max={3} step={0.1} onChange={sHspBB} />
            </FR>
          </div>
        </div>
      </OverlayCard>

      <OverlayCard label="Faulty Terminal" enabled={ftE as boolean} onToggle={sFtE}>
        <FR label="Position" info={hintFor('background.faultyTerminalBehindLogo')}>
          <CB
            value={(ftBL as boolean) ? 'behind' : 'front'}
            options={[{ value: 'behind', label: 'Behind logo' }, { value: 'front', label: 'In front' }]}
            onChange={(v) => sFtBL(v === 'behind')}
          />
        </FR>
        <FR label="Tint" info={hintFor('background.faultyTerminalTint')}><CP value={ftTint as string} onChange={sFtTint} /></FR>
        <FR label="Brightness" hint={`${(ftBri as number).toFixed(1)}`} info={hintFor('background.faultyTerminalBrightness')}>
          <Sl value={ftBri as number} min={0.1} max={3} step={0.05} onChange={sFtBri} />
        </FR>
        <FR label="Scale" hint={`${(ftSc as number).toFixed(1)}`} info={hintFor('background.faultyTerminalScale')}>
          <Sl value={ftSc as number} min={0.5} max={4} step={0.1} onChange={sFtSc} />
        </FR>
        <FR label="Scanline Intensity" hint={`${(ftScan as number).toFixed(1)}`} info={hintFor('background.faultyTerminalScanlineIntensity')}>
          <Sl value={ftScan as number} min={0} max={2} step={0.05} onChange={sFtScan} />
        </FR>
        <FR label="Glitch Amount" hint={`${(ftGl as number).toFixed(1)}`} info={hintFor('background.faultyTerminalGlitchAmount')}>
          <Sl value={ftGl as number} min={0} max={5} step={0.1} onChange={sFtGl} />
        </FR>
        <FR label="Flicker Amount" hint={`${(ftFl as number).toFixed(1)}`} info={hintFor('background.faultyTerminalFlickerAmount')}>
          <Sl value={ftFl as number} min={0} max={2} step={0.05} onChange={sFtFl} />
        </FR>
        <FR label="Noise Amplitude" hint={`${(ftNA as number).toFixed(1)}`} info={hintFor('background.faultyTerminalNoiseAmp')}>
          <Sl value={ftNA as number} min={0} max={4} step={0.05} onChange={sFtNA} />
        </FR>
        <FR label="CRT Curvature" hint={`${(ftCv as number).toFixed(2)}`} info={hintFor('background.faultyTerminalCurvature')}>
          <Sl value={ftCv as number} min={0} max={0.5} step={0.01} onChange={sFtCv} />
        </FR>
        <FR label="Speed" hint={`${(ftSp as number).toFixed(1)}`} info={hintFor('background.faultyTerminalSpeed')}>
          <Sl value={ftSp as number} min={0.1} max={3} step={0.1} onChange={sFtSp} />
        </FR>
        <div className="mt-2">
          <HzRangePicker startHz={ftBFS as number} endHz={ftBFE as number} onChangeStart={sFtBFS} onChangeEnd={sFtBFE} />
          <div className="mt-2">
            <FR label="Beat Sensitivity" hint={`${(ftBSen as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('background.faultyTerminalBeatSensitivity')}>
              <Sl value={ftBSen as number} min={0} max={5} step={0.1} onChange={sFtBSen} />
            </FR>
            <FR label="Beat Glitch Boost" hint={`${(ftBGB as number).toFixed(1)}`} info={hintFor('background.faultyTerminalBeatGlitchBoost')}>
              <Sl value={ftBGB as number} min={0} max={3} step={0.1} onChange={sFtBGB} />
            </FR>
          </div>
        </div>
        <FR label="Blend mode" info={hintFor('background.faultyTerminalBlendMode')}>
          <BlendSel value={ftBM as string} onChange={sFtBM as (v: string) => void} />
        </FR>
      </OverlayCard>

      <OverlayCard label="Ferrofluid" enabled={ffE as boolean} onToggle={sffE}>
        <FR label="Position" info={hintFor('background.ferrofluidBehindLogo')}>
          <CB
            value={(ffBL as boolean) ? 'behind' : 'front'}
            options={[
              { value: 'behind', label: 'Behind logo' },
              { value: 'front',  label: 'In front'    },
            ]}
            onChange={(v) => sffBL(v === 'behind')}
          />
        </FR>
        <FR label="Blend mode" info={hintFor('blendMode')}>
          <BlendSel value={ffBM as string} onChange={sffBM as (v: string) => void} />
        </FR>
        <FR label="Color 1" info={hintFor('background.ferrofluidColor0')}><CP value={ffC0 as string} onChange={sffC0} /></FR>
        <FR label="Color 2" info={hintFor('background.ferrofluidColor1')}><CP value={ffC1 as string} onChange={sffC1} /></FR>
        <FR label="Color 3" info={hintFor('background.ferrofluidColor2')}><CP value={ffC2 as string} onChange={sffC2} /></FR>
        <FR label="Flow direction" info={hintFor('background.ferrofluidFlowDirection')}>
          <CB
            value={ffFlow as string}
            options={[
              { value: 'up',    label: '↑' },
              { value: 'down',  label: '↓' },
              { value: 'left',  label: '←' },
              { value: 'right', label: '→' },
            ]}
            onChange={sffFlow}
          />
        </FR>
        <FR label="Speed" info={hintFor('background.ferrofluidSpeed')}>
          <Sl value={ffSpd as number} min={0} max={3} step={0.05} onChange={sffSpd} />
        </FR>
        <FR label="Scale" info={hintFor('background.ferrofluidScale')}>
          <Sl value={ffScl as number} min={0.3} max={4} step={0.05} onChange={sffScl} />
        </FR>
        <FR label="Turbulence" info={hintFor('background.ferrofluidTurbulence')}>
          <Sl value={ffTrb as number} min={0} max={3} step={0.05} onChange={sffTrb} />
        </FR>
        <FR label="Fluidity" info={hintFor('background.ferrofluidFluidity')}>
          <Sl value={ffFld as number} min={0.01} max={1} step={0.01} onChange={sffFld} />
        </FR>
        <FR label="Rim width" info={hintFor('background.ferrofluidRimWidth')}>
          <Sl value={ffRW as number} min={0.05} max={0.6} step={0.01} onChange={sffRW} />
        </FR>
        <FR label="Sharpness" info={hintFor('background.ferrofluidSharpness')}>
          <Sl value={ffShp as number} min={0.5} max={6} step={0.1} onChange={sffShp} />
        </FR>
        <FR label="Shimmer" info={hintFor('background.ferrofluidShimmer')}>
          <Sl value={ffShm as number} min={0} max={4} step={0.05} onChange={sffShm} />
        </FR>
        <FR label="Glow" info={hintFor('background.ferrofluidGlow')}>
          <Sl value={ffGlw as number} min={0} max={6} step={0.1} onChange={sffGlw} />
        </FR>
        <FR label="Opacity" info={hintFor('background.ferrofluidOpacity')}>
          <Sl value={ffOp as number} min={0} max={1} step={0.01} onChange={sffOp} />
        </FR>
        <HzRangePicker startHz={ffBFS as number} endHz={ffBFE as number} onChangeStart={sffBFS} onChangeEnd={sffBFE} />
        <FR label="Beat sensitivity" info={hintFor('background.ferrofluidBeatSensitivity')}>
          <Sl value={ffBS as number} min={0.1} max={5} step={0.1} onChange={sffBS} />
        </FR>
        <FR label="Glow boost" info={hintFor('background.ferrofluidGlowBoost')}>
          <Sl value={ffGB as number} min={0} max={5} step={0.1} onChange={sffGB} />
        </FR>
      </OverlayCard>
    </div>
  );
}

// ── Logo Section ──────────────────────────────────────────────────────────────

function LogoSection_() {
  const [en,    sEn]    = useF('logo', 'enabled');
  const [size,  sSize]  = useF('logo', 'size');
  const [op,    sOp]    = useF('logo', 'opacity');
  const [bsc,   sBsc]   = useF('logo', 'beatScaleStrength');
  const [bFS,   sBFS]   = useF('logo', 'beatFxFreqStart');
  const [bFE,   sBFE]   = useF('logo', 'beatFxFreqEnd');
  const [bSens, sBSens] = useF('logo', 'beatFxSensitivity');
  const [gE,    sGE]    = useF('logo', 'outerGlowEnabled');
  const [gI,    sGI]    = useF('logo', 'outerGlowIntensity');
  const [gC,    sGC]    = useF('logo', 'outerGlowColor');
  const [gS,    sGS]    = useF('logo', 'outerGlowSize');
  const [gB,    sGB]    = useF('logo', 'outerGlowBlur');
  const [gCM,   sGCM]  = useF('logo', 'outerGlowColorMode');
  const [gCS,   sGCS]  = useF('logo', 'outerGlowCycleSpeed');
  const [gCC,   sGCC]  = useF('logo', 'outerGlowCustomColors');
  const [igE,   sIgE]   = useF('logo', 'innerGlowEnabled');
  const [igI,   sIgI]   = useF('logo', 'innerGlowIntensity');
  const [igC,   sIgC]   = useF('logo', 'innerGlowColor');
  const [igS,   sIgS]   = useF('logo', 'innerGlowSize');
  const [igB,   sIgB]   = useF('logo', 'innerGlowBlur');
  const [igCM,  sIgCM]  = useF('logo', 'innerGlowColorMode');
  const [igCS,  sIgCS]  = useF('logo', 'innerGlowCycleSpeed');
  const [igCC,  sIgCC]  = useF('logo', 'innerGlowCustomColors');
  const [fireE,  sFireE]  = useF('logo', 'fireEnabled');
  const [fireI,  sFireI]  = useF('logo', 'fireIntensity');
  const [fireH,  sFireH]  = useF('logo', 'fireHeight');
  const [fireSp, sFireSp] = useF('logo', 'fireSpeed');
  const [fireCI, sFireCI] = useF('logo', 'fireColorInner');
  const [fireCM, sFireCM] = useF('logo', 'fireColorMid');
  const [fireCO, sFireCO] = useF('logo', 'fireColorOuter');
  const [fireR,  sFireR]  = useF('logo', 'fireReactivity');
  const [fireFS, sFireFS] = useF('logo', 'fireFreqStart');
  const [fireFE, sFireFE] = useF('logo', 'fireFreqEnd');
  const [fireSn, sFireSn] = useF('logo', 'fireSensitivity');
  const [sparksE,    sSparksE]    = useF('logo', 'sparksEnabled');
  const [sparksCount, sSparksCount] = useF('logo', 'sparksCount');
  const [sparksSize,  sSparksSize]  = useF('logo', 'sparksSize');
  const [sparksSpeed, sSparksSpeed] = useF('logo', 'sparksSpeed');
  const [sparksBurst, sSparksBurst] = useF('logo', 'sparksBurstCount');
  const [sparksLife,  sSparksLife]  = useF('logo', 'sparksLifetime');
  const [sparksGrav,  sSparksGrav]  = useF('logo', 'sparksGravity');
  const [sparksDrag,  sSparksDrag]  = useF('logo', 'sparksDrag');
  const [sparksSpread,sSparksSpread]= useF('logo', 'sparksSpread');
  const [sparksOp,    sSparksOp]    = useF('logo', 'sparksOpacity');
  const [sparksCHot,  sSparksCHot]  = useF('logo', 'sparksColorHot');
  const [sparksCMid,  sSparksCMid]  = useF('logo', 'sparksColorMid');
  const [sparksCCool, sSparksCCool] = useF('logo', 'sparksColorCool');

  return (
    <div className="flex flex-col gap-2">
      <Tg value={en as boolean} onChange={sEn} label="Show logo" />

      <Acc label="Size" description={ACCORDION_DESCRIPTIONS['logo.size']}>
        <FR label="Size" hint={`${size}px`} info={hintFor('logo.size')}>
          <Sl value={size as number} min={80} max={1600} step={8} onChange={sSize} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((op as number) * 100)}%`} info={hintFor('logo.opacity')}>
          <Sl value={op as number} min={0} max={1} step={0.01} onChange={sOp} />
        </FR>
      </Acc>

      <Acc label="Outer Glow" description={ACCORDION_DESCRIPTIONS['logo.outerGlow']}>
        <Tg value={gE as boolean} onChange={sGE} label="Enabled" info={hintFor('logo.outerGlowEnabled')} />
        {!!gE && (
          <div className="mt-3 space-y-2">
            <FR label="Color mode" info={ENUM_HINTS['logo.outerGlowColorMode']?.[gCM as string]}>
              <CB
                value={gCM as string}
                options={[
                  { value: 'solid',   label: 'Solid' },
                  { value: 'rainbow', label: 'Rainbow' },
                  { value: 'custom',  label: 'Custom' },
                  { value: 'random',  label: 'Random' },
                ]}
                onChange={sGCM as (v: string) => void}
              />
            </FR>
            {(gCM as string) === 'solid' && (
              <FR label="Color" info={hintFor('logo.outerGlowColor')}><CP value={gC as string} onChange={sGC} /></FR>
            )}
            {((gCM as string) === 'rainbow') && (
              <FR label="Cycle speed" hint={`${(gCS as number).toFixed(2)}×`} info={hintFor('logo.outerGlowCycleSpeed')}>
                <Sl value={gCS as number} min={0} max={2} step={0.05} onChange={sGCS} />
              </FR>
            )}
            {((gCM as string) === 'custom') && (
              <div className="mt-2 space-y-1">
                <p className="font-ui text-xs" style={{ color: 'var(--text-muted)' }}>Colors (cycled)</p>
                {((gCC as string[] | undefined) ?? []).map((col, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CP
                      value={col}
                      onChange={(v) => {
                        const next = [...((gCC as string[] | undefined) ?? [])];
                        next[idx] = v;
                        sGCC(next);
                      }}
                    />
                    {((gCC as string[] | undefined) ?? []).length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = ((gCC as string[] | undefined) ?? []).filter((_, i) => i !== idx);
                          sGCC(next);
                        }}
                        className="rounded px-1.5 py-0.5 font-ui text-xs"
                        style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}
                      >−</button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => sGCC([...((gCC as string[] | undefined) ?? []), '#ffffff'])}
                  className="mt-1 rounded px-2 py-1 font-ui text-xs"
                  style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}
                >+ Add color</button>
                <FR label="Cycle speed" hint={`${(gCS as number).toFixed(2)}×`} info={hintFor('logo.outerGlowCycleSpeed')}>
                  <Sl value={gCS as number} min={0} max={2} step={0.05} onChange={sGCS} />
                </FR>
              </div>
            )}
            <FR label="Intensity" hint={`${gI}%`} info={hintFor('logo.outerGlowIntensity')}>
              <Sl value={gI as number} min={0} max={100} step={1} onChange={sGI} />
            </FR>
            <FR label="Size" hint={`${(gS as number).toFixed(2)}×`} info={hintFor('logo.outerGlowSize')}>
              <Sl value={gS as number} min={1.0} max={5.0} step={0.05} onChange={sGS} />
            </FR>
            <FR label="Blur" hint={`${gB}px`} info={hintFor('logo.outerGlowBlur')}>
              <Sl value={gB as number} min={0} max={50} step={1} onChange={sGB} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Inner Glow" description={ACCORDION_DESCRIPTIONS['logo.innerGlow']}>
        <Tg value={igE as boolean} onChange={sIgE} label="Enabled" info={hintFor('logo.innerGlowEnabled')} />
        {!!igE && (
          <div className="mt-3 space-y-2">
            <FR label="Color mode" info={ENUM_HINTS['logo.innerGlowColorMode']?.[igCM as string]}>
              <CB
                value={igCM as string}
                options={[
                  { value: 'solid',   label: 'Solid' },
                  { value: 'rainbow', label: 'Rainbow' },
                  { value: 'custom',  label: 'Custom' },
                  { value: 'random',  label: 'Random' },
                ]}
                onChange={sIgCM as (v: string) => void}
              />
            </FR>
            {(igCM as string) === 'solid' && (
              <FR label="Color" info={hintFor('logo.innerGlowColor')}><CP value={igC as string} onChange={sIgC} /></FR>
            )}
            {((igCM as string) === 'rainbow') && (
              <FR label="Cycle speed" hint={`${(igCS as number).toFixed(2)}×`} info={hintFor('logo.innerGlowCycleSpeed')}>
                <Sl value={igCS as number} min={0} max={2} step={0.05} onChange={sIgCS} />
              </FR>
            )}
            {((igCM as string) === 'custom') && (
              <div className="mt-2 space-y-1">
                <p className="font-ui text-xs" style={{ color: 'var(--text-muted)' }}>Colors (cycled)</p>
                {((igCC as string[] | undefined) ?? []).map((col, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CP
                      value={col}
                      onChange={(v) => {
                        const next = [...((igCC as string[] | undefined) ?? [])];
                        next[idx] = v;
                        sIgCC(next);
                      }}
                    />
                    {((igCC as string[] | undefined) ?? []).length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = ((igCC as string[] | undefined) ?? []).filter((_, i) => i !== idx);
                          sIgCC(next);
                        }}
                        className="rounded px-1.5 py-0.5 font-ui text-xs"
                        style={{ color: 'var(--danger)', border: '1px solid var(--border)' }}
                      >−</button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => sIgCC([...((igCC as string[] | undefined) ?? []), '#ffffff'])}
                  className="mt-1 rounded px-2 py-1 font-ui text-xs"
                  style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}
                >+ Add color</button>
                <FR label="Cycle speed" hint={`${(igCS as number).toFixed(2)}×`} info={hintFor('logo.innerGlowCycleSpeed')}>
                  <Sl value={igCS as number} min={0} max={2} step={0.05} onChange={sIgCS} />
                </FR>
              </div>
            )}
            <FR label="Intensity" hint={`${igI}%`} info={hintFor('logo.innerGlowIntensity')}>
              <Sl value={igI as number} min={0} max={100} step={1} onChange={sIgI} />
            </FR>
            <FR label="Reach" hint={`${Math.round((igS as number) * 100)}%`} sub="How far the glow extends inward from the logo edge" info={hintFor('logo.innerGlowSize')}>
              <Sl value={igS as number} min={0.0} max={1.0} step={0.01} onChange={sIgS} />
            </FR>
            <FR label="Blur" hint={`${igB}px`} info={hintFor('logo.innerGlowBlur')}>
              <Sl value={igB as number} min={0} max={50} step={1} onChange={sIgB} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Fire" description={ACCORDION_DESCRIPTIONS['logo.fire']}>
        <Tg value={fireE as boolean} onChange={sFireE} label="Enabled" info={hintFor('logo.fireEnabled')} />
        {!!fireE && (
          <div className="mt-3 space-y-2">
            <FR label="Intensity" info={hintFor('logo.fireIntensity')}>
              <Sl value={fireI as number} min={0} max={2} step={0.05} onChange={sFireI} />
            </FR>
            <FR label="Height" info={hintFor('logo.fireHeight')}>
              <Sl value={fireH as number} min={0} max={2} step={0.05} onChange={sFireH} />
            </FR>
            <FR label="Speed" info={hintFor('logo.fireSpeed')}>
              <Sl value={fireSp as number} min={0} max={3} step={0.1} onChange={sFireSp} />
            </FR>
            <FR label="Reactivity" info={hintFor('logo.fireReactivity')}>
              <Sl value={fireR as number} min={0} max={3} step={0.1} onChange={sFireR} />
            </FR>
            <FR label="Inner color" info={hintFor('logo.fireColorInner')}><CP value={fireCI as string} onChange={sFireCI} /></FR>
            <FR label="Mid color" info={hintFor('logo.fireColorMid')}><CP value={fireCM as string} onChange={sFireCM} /></FR>
            <FR label="Outer color" info={hintFor('logo.fireColorOuter')}><CP value={fireCO as string} onChange={sFireCO} /></FR>
            <div className="mt-2">
              <HzRangePicker
                startHz={fireFS as number}
                endHz={fireFE as number}
                onChangeStart={sFireFS}
                onChangeEnd={sFireFE}
              />
              <div className="mt-2">
                <FR label="Sensitivity" hint={`${(fireSn as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('logo.fireSensitivity')}>
                  <Sl value={fireSn as number} min={0.1} max={5.0} step={0.05} onChange={sFireSn} />
                </FR>
              </div>
            </div>
          </div>
        )}
      </Acc>

      <Acc label="Sparks" description={ACCORDION_DESCRIPTIONS['logo.sparks']}>
        <Tg value={sparksE as boolean} onChange={sSparksE} label="Enabled" info={hintFor('logo.sparksEnabled')} />
        {Boolean(sparksE) && (
          <div className="mt-3 space-y-2">
            <FR label="Count" hint={`${sparksCount}`} info={hintFor('logo.sparksCount')}>
              <Sl value={sparksCount as number} min={30} max={300} step={10} onChange={sSparksCount} />
            </FR>
            <FR label="Size" hint={`${(sparksSize as number).toFixed(2)}×`} info={hintFor('logo.sparksSize')}>
              <Sl value={sparksSize as number} min={0.3} max={3.0} step={0.05} onChange={sSparksSize} />
            </FR>
            <FR label="Speed" hint={`${(sparksSpeed as number).toFixed(2)}×`} info={hintFor('logo.sparksSpeed')}>
              <Sl value={sparksSpeed as number} min={0.3} max={3.0} step={0.05} onChange={sSparksSpeed} />
            </FR>
            <FR label="Burst count" hint={`${sparksBurst}`} info={hintFor('logo.sparksBurstCount')}>
              <Sl value={sparksBurst as number} min={0} max={100} step={1} onChange={sSparksBurst} />
            </FR>
            <FR label="Lifetime" hint={`${(sparksLife as number).toFixed(2)}s`} info={hintFor('logo.sparksLifetime')}>
              <Sl value={sparksLife as number} min={0.3} max={3.0} step={0.05} onChange={sSparksLife} />
            </FR>
            <FR label="Gravity" hint={`${(sparksGrav as number).toFixed(1)}`} info={hintFor('logo.sparksGravity')}>
              <Sl value={sparksGrav as number} min={0} max={8} step={0.1} onChange={sSparksGrav} />
            </FR>
            <FR label="Drag" hint={`${(sparksDrag as number).toFixed(1)}`} info={hintFor('logo.sparksDrag')}>
              <Sl value={sparksDrag as number} min={0.5} max={4.0} step={0.1} onChange={sSparksDrag} />
            </FR>
            <FR label="Spread" hint={`${((sparksSpread as number) * 57.3).toFixed(0)}°`} info={hintFor('logo.sparksSpread')}>
              <Sl value={sparksSpread as number} min={0} max={1.5} step={0.05} onChange={sSparksSpread} />
            </FR>
            <FR label="Hot color" info={hintFor('logo.sparksColorHot')}>
              <CP value={sparksCHot as string} onChange={sSparksCHot} />
            </FR>
            <FR label="Mid color" info={hintFor('logo.sparksColorMid')}>
              <CP value={sparksCMid as string} onChange={sSparksCMid} />
            </FR>
            <FR label="Cool color" info={hintFor('logo.sparksColorCool')}>
              <CP value={sparksCCool as string} onChange={sSparksCCool} />
            </FR>
            <FR label="Opacity" hint={`${((sparksOp as number) * 100).toFixed(0)}%`} info={hintFor('logo.sparksOpacity')}>
              <Sl value={sparksOp as number} min={0} max={1} step={0.01} onChange={sSparksOp} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Animation" description={ACCORDION_DESCRIPTIONS['logo.animation']}>
        <FR label="Beat scale" hint={`${Math.round((bsc as number) * 100)}%`} info={hintFor('logo.beatScaleStrength')}>
          <Sl value={bsc as number} min={0} max={1} step={0.05} onChange={sBsc} />
        </FR>
        <div className="mt-2">
          <HzRangePicker
            startHz={bFS as number}
            endHz={bFE as number}
            onChangeStart={sBFS}
            onChangeEnd={sBFE}
          />
          <div className="mt-2">
            <FR label="Sensitivity" hint={`${(bSens as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('logo.beatFxSensitivity')}>
              <Sl value={bSens as number} min={0.1} max={5.0} step={0.05} onChange={sBSens} />
            </FR>
          </div>
        </div>
      </Acc>
    </div>
  );
}

// ── Custom Color Editor ─────────────────────────────────────────────────────────

function CustomColorEditor({ group }: { group: 'bars' | 'particles' }) {
  const colors = useSettingsStore((s) => s.settings[group].customColors);
  const boundaries = useSettingsStore((s) => s.settings[group].customFreqBoundaries);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const setColor = (idx: number, color: string) => {
    setSettings((prev) => {
      const newColors = [...prev[group].customColors];
      newColors[idx] = color;
      return { ...prev, [group]: { ...prev[group], customColors: newColors } };
    });
  };

  const setBoundary = (idx: number, hz: number) => {
    setSettings((prev) => {
      const newBounds = [...prev[group].customFreqBoundaries];
      newBounds[idx] = hz;
      return { ...prev, [group]: { ...prev[group], customFreqBoundaries: newBounds } };
    });
  };

  const addColor = () => {
    setSettings((prev) => {
      const newColors = [...prev[group].customColors, '#ffffff'];
      const lastBound = prev[group].customFreqBoundaries[prev[group].customFreqBoundaries.length - 1] || 8000;
      const newBounds = [...prev[group].customFreqBoundaries, Math.min(lastBound + 2000, 20000)];
      return { ...prev, [group]: { ...prev[group], customColors: newColors, customFreqBoundaries: newBounds } };
    });
  };

  const removeColor = (idx: number) => {
    if (colors.length <= 2) return;
    setSettings((prev) => {
      const newColors = prev[group].customColors.filter((_, i) => i !== idx);
      const newBounds = prev[group].customFreqBoundaries
        .filter((_, i) => i !== idx && i !== idx - 1)
        .slice(0, newColors.length - 1);
      return { ...prev, [group]: { ...prev[group], customColors: newColors, customFreqBoundaries: newBounds } };
    });
  };

  return (
    <div className="mt-2 space-y-2">
      {colors.map((color, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <CP value={color} onChange={(v) => setColor(idx, v)} />
          {idx < colors.length - 1 && (
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>→</span>
              <input
                type="number"
                value={boundaries[idx] ?? 0}
                onChange={(e) => setBoundary(idx, parseInt(e.target.value) || 0)}
                className="w-16 rounded border px-1.5 py-0.5 font-mono text-[10px]"
                style={{ background: 'var(--bg-elev-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
                min={20} max={20000} step={100}
              />
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>Hz</span>
            </div>
          )}
          {colors.length > 2 && (
            <button
              type="button"
              onClick={() => removeColor(idx)}
              className="flex h-5 w-5 items-center justify-center rounded text-[10px]"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addColor}
        className="w-full rounded-md border px-2 py-1 font-ui text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        + Add color
      </button>
    </div>
  );
}

// ── Audio Section (v13: pre-analysis pipeline) ──────────────────────────────────
function AudioSection() {
  // Detection mode toggle (Live / Precomputed)
  const [detMode, sDetMode]   = useF('audio', 'detectionMode');
  // Per-band gain (kick / snare / vocal / hihat)
  const [kickG,   sKickG]     = useF('audio', 'bandSensitivity');
  const [snareG,  sSnareG]    = useF('audio', 'bandSensitivity');
  const [vocalG,  sVocalG]    = useF('audio', 'bandSensitivity');
  const [hihatG,  sHihatG]    = useF('audio', 'bandSensitivity');
  // Key influence for 'key-derived' / 'band-driven' colorModes
  const [keyInf,  sKeyInf]    = useF('audio', 'keyInfluence');
  // Detected song metadata (filled by pre-analysis pipeline)
  const [bpm]                 = useF('audio', 'bpm');
  const [key]                 = useF('audio', 'key');
  const [scale]               = useF('audio', 'scale');
  const [progress]            = useF('audio', 'preAnalysisProgress');

  // Legacy global beat knobs (always available for both modes)
  const [gbStart, sGbStart]   = useF('audio', 'globalBeatFreqStart');
  const [gbEnd,   sGbEnd]     = useF('audio', 'globalBeatFreqEnd');
  const [gbSens,  sGbSens]    = useF('audio', 'globalBeatSensitivity');

  const isPrecomputed = (detMode as string) === 'precomputed';
  const hasResults    = bpm as number > 0;

  return (
    <div className="flex flex-col gap-2">
      <Acc label="Detection Mode" description={ACCORDION_DESCRIPTIONS['audio.detection']}>
        <FR label="Mode" hint={isPrecomputed ? 'Pre-analysed' : 'Live spectral flux'} info={ENUM_HINTS['audio.detectionMode']?.[detMode as string]}>
          <CB value={detMode as string}
            options={[
              { value: 'precomputed', label: 'Pre-analysed' },
              { value: 'live',        label: 'Live' },
            ]}
            onChange={sDetMode as (v: string) => void}
          />
        </FR>
        <FR label="" hint="Pre-analysed runs essentia.js (BPM, Beat-Ticks, Key) + 4-band onset detection in a Web Worker. Live uses the legacy FreqBeatDetector running on raw FFT.">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Pre-analysed mode is more accurate (frame-accurate beat sync, separate
            kick/snare/vocal/hihat phases) but adds ~5-10s to first audio load.
            Live is instant but less accurate on complex beats.
          </div>
        </FR>
        {isPrecomputed && (
          <FR label="Progress" hint={(progress as number) < 1 ? `${Math.round((progress as number) * 100)}%` : 'Done'}>
            <div className="h-2 w-full overflow-hidden rounded" style={{ background: 'var(--bg-elev-2)' }}>
              <div
                style={{
                  width: `${(progress as number) * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 200ms ease',
                }}
              />
            </div>
          </FR>
        )}
      </Acc>

      {isPrecomputed && hasResults && (
        <Acc label="Detected Song Metadata" description={ACCORDION_DESCRIPTIONS['audio.metadata']}>
          <FR label="Tempo" hint={`${(bpm as number).toFixed(1)} BPM`}>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Detected via essentia.js RhythmExtractor2013 (multifeature).
              Used for tick-based beat phase synchronisation.
            </div>
          </FR>
          <FR label="Key" hint={(key as string) && (scale as string)
              ? `${key} ${scale}`
              : (key as string) || '—'}>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Detected via essentia.js KeyExtractor. Used by colorMode='Key'
              on bars and particles to color-shift with the song's emotional centre.
            </div>
          </FR>
        </Acc>
      )}

      {isPrecomputed && (
        <Acc label="Band Sensitivity" description={ACCORDION_DESCRIPTIONS['audio.bands']}>
          <FR label="Kick" hint={`×${(kickG as any).kick?.toFixed(2) ?? '1.00'}`} info={hintFor('audio', 'bandSensitivity.kick')}>
            <Sl value={(kickG as any).kick as number} min={0} max={2} step={0.05}
              onChange={(v) => sKickG({ ...(kickG as any), kick: v })} />
          </FR>
          <FR label="Snare" hint={`×${(snareG as any).snare?.toFixed(2) ?? '1.00'}`} info={hintFor('audio', 'bandSensitivity.snare')}>
            <Sl value={(snareG as any).snare as number} min={0} max={2} step={0.05}
              onChange={(v) => sSnareG({ ...(snareG as any), snare: v })} />
          </FR>
          <FR label="Vocal" hint={`×${(vocalG as any).vocal?.toFixed(2) ?? '1.00'}`} info={hintFor('audio', 'bandSensitivity.vocal')}>
            <Sl value={(vocalG as any).vocal as number} min={0} max={2} step={0.05}
              onChange={(v) => sVocalG({ ...(vocalG as any), vocal: v })} />
          </FR>
          <FR label="Hi-Hat" hint={`×${(hihatG as any).hihat?.toFixed(2) ?? '1.00'}`} info={hintFor('audio', 'bandSensitivity.hihat')}>
            <Sl value={(hihatG as any).hihat as number} min={0} max={2} step={0.05}
              onChange={(v) => sHihatG({ ...(hihatG as any), hihat: v })} />
          </FR>
          <FR label="" hint="Per-band gain applied to the 4 onset-phase signals. 1.0 = neutral, >1 = amplify, <1 = dampen. Affects all components that read the per-band phases in pre-analysed mode.">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              The bars/particles colorMode='Bands' uses these phases directly
              (kick=red, snare=yellow, vocal=blue, hihat=cyan), and logo/background
              beat reactivity uses them for layer-specific triggers.
            </div>
          </FR>
        </Acc>
      )}

      <Acc label="Key Influence" description={ACCORDION_DESCRIPTIONS['audio.keyInfluence']}>
        <FR label="Key → Color blend" hint={`${((keyInf as number) * 100).toFixed(0)}%`} info={hintFor('audio.keyInfluence')}>
          <Sl value={keyInf as number} min={0} max={1} step={0.05} onChange={sKeyInf as (v: number) => void} />
        </FR>
        <FR label="" hint="How strongly the detected key shifts bars/particles when colorMode='Key' or 'Bands'. 0 = no effect (uses neutral hue), 1 = pure key colour.">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            At 50% the key colour is blended 50/50 with the theme accent.
            At 100% the bars/particles are pure-key coloured regardless of theme.
          </div>
        </FR>
      </Acc>

      <Acc label="Legacy Global Beat" description={ACCORDION_DESCRIPTIONS['audio.legacy']}>
        <FR label="" hint="These settings apply in both modes (Live always uses them, Precomputed uses them for the global beatPhase driver — logo pulse, glow, etc.)">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            The 7 per-component FreqBeatDetectors (Background, Logo, Fire, Particles,
            Bars, Nebula-Pulse) read their own per-component sensitivity in Precomputed
            mode — but the GLOBAL beatPhase fed to <code>--beat-glow</code> and
            <code>audioAnalysis.beatPhase</code> is driven by THIS range. Adjust
            to e.g. emphasise snares (150-800 Hz) over kicks (40-120 Hz).
          </div>
        </FR>
        <FR label="Freq start (Hz)" hint={`${gbStart} Hz`} info={hintFor('audio.globalBeatFreqStart')}>
          <Sl value={gbStart as number} min={20} max={20000} step={10} onChange={sGbStart as (v: number) => void} />
        </FR>
        <FR label="Freq end (Hz)" hint={`${gbEnd} Hz`} info={hintFor('audio.globalBeatFreqEnd')}>
          <Sl value={gbEnd as number} min={20} max={20000} step={10} onChange={sGbEnd as (v: number) => void} />
        </FR>
        <FR label="Sensitivity" hint={`×${(gbSens as number).toFixed(2)}`} info={hintFor('audio.globalBeatSensitivity')}>
          <Sl value={gbSens as number} min={0.1} max={5} step={0.05} onChange={sGbSens as (v: number) => void} />
        </FR>
      </Acc>
    </div>
  );
}

// ── Bars Section ──────────────────────────────────────────────────────────────

function BarsSection() {
  const [en,    sEn]   = useF('bars', 'enabled');
  const [cnt,   sCnt]  = useF('bars', 'count');
  const [cm,    sCm]   = useF('bars', 'colorMode');
  const [sc,    sSc]   = useF('bars', 'solidColor');
  const [th,    sTh]   = useF('bars', 'thickness');
  const [gap,   sGap]  = useF('bars', 'gapSize');
  const [mh,    sMh]   = useF('bars', 'minHeight');
  const [op,    sOp]   = useF('bars', 'opacity');
  const [fs,    sFs]   = useF('bars', 'freqStart');
  const [fe,    sFe]   = useF('bars', 'freqEnd');
  const [rs,    sRs]   = useF('bars', 'rotationSpeed');
  const [rob,   sRob]  = useF('bars', 'rotationOnBeat');
  const [sm,    sSm]   = useF('bars', 'smoothing');
  const [ir,    sIr]   = useF('bars', 'innerRadius');
  const [ls,    sLs]   = useF('bars', 'lengthScale');
  const [re,    sRe]   = useF('bars', 'reactivity');
  const [pe,    sPe]   = useF('bars', 'peakEnabled');
  const [pd,    sPd]   = useF('bars', 'peakDecay');
  const [bbtFS, sBbtFS] = useF('bars', 'beatFreqStart');
  const [bbtFE, sBbtFE] = useF('bars', 'beatFreqEnd');
  const [bbtSn, sBbtSn] = useF('bars', 'beatSensitivity');

  const binToHz = (bin: number) => Math.round((bin / 128) * 22050);

  return (
    <div className="flex flex-col gap-2">
      <Tg value={en as boolean} onChange={sEn} label="Radial bars" />

      <Acc label="General" description={ACCORDION_DESCRIPTIONS['bars.general']}>
        <FR label="Count" hint={`${cnt}`} info={hintFor('bars.count')}>
          <Sl value={cnt as number} min={8} max={256} step={8} onChange={sCnt} />
        </FR>
        <FR label="Color mode" info={ENUM_HINTS['bars.colorMode']?.[cm as string]}>
          <CB value={cm as string}
            options={[
              { value: 'rainbow', label: 'Rainbow' },
              { value: 'custom',  label: 'Custom' },
              { value: 'random',  label: 'Random' },
              { value: 'solid',   label: 'Solid' },
              { value: 'key-derived', label: 'Key' },
              { value: 'band-driven',  label: 'Bands' },
            ]}
            onChange={sCm as (v: string) => void}
          />
        </FR>
        {(cm as string) === 'solid' && (
          <FR label="Color" info={hintFor('bars.solidColor')}><CP value={sc as string} onChange={sSc} /></FR>
        )}
        {(cm as string) === 'custom' && <CustomColorEditor group="bars" />}
      </Acc>

      <Acc label="Shape" description={ACCORDION_DESCRIPTIONS['bars.shape']}>
        <FR label="Thickness" hint={`${th}px`} info={hintFor('bars.thickness')}>
          <Sl value={th as number} min={1} max={12} step={0.5} onChange={sTh} />
        </FR>
        <FR label="Gap" hint={`${Math.round((gap as number) * 100)}%`} info={hintFor('bars.gapSize')}>
          <Sl value={gap as number} min={0} max={0.9} step={0.05} onChange={sGap} />
        </FR>
        <FR label="Min height" hint={`${mh}px`} info={hintFor('bars.minHeight')}>
          <Sl value={mh as number} min={0} max={10} step={0.5} onChange={sMh} />
        </FR>
        <FR label="Opacity" hint={`${Math.round((op as number) * 100)}%`} info={hintFor('bars.opacity')}>
          <Sl value={op as number} min={0} max={1} step={0.01} onChange={sOp} />
        </FR>
      </Acc>

      <Acc label="Frequency range" description={ACCORDION_DESCRIPTIONS['bars.frequency']}>
        <FR label="Low cut" hint={`~${(binToHz(fs as number) / 1000).toFixed(1)} kHz`} info={hintFor('bars.freqStart')}>
          <Sl value={fs as number} min={0} max={120} step={1} onChange={sFs} />
        </FR>
        <FR label="High cut" hint={`~${(binToHz(fe as number) / 1000).toFixed(1)} kHz`} info={hintFor('bars.freqEnd')}>
          <Sl value={fe as number} min={8} max={128} step={1} onChange={sFe} />
        </FR>
      </Acc>

      <Acc label="Animation" description={ACCORDION_DESCRIPTIONS['bars.animation']}>
        <FR label="Rotation speed" info={hintFor('bars.rotationSpeed')}>
          <Sl value={rs as number} min={0} max={2} step={0.05} onChange={sRs} />
        </FR>
        <FR label="Rotation burst on beat" info={hintFor('bars.rotationOnBeat')}>
          <Sl value={rob as number} min={0} max={5} step={0.1} onChange={sRob} />
        </FR>
        <FR label="Smoothing" hint={`${(sm as number).toFixed(2)}`} sub="Lower = slower/smoother" info={hintFor('bars.smoothing')}>
          <Sl value={sm as number} min={0.05} max={0.5} step={0.01} onChange={sSm} />
        </FR>
      </Acc>

      <Acc label="Size & Radius" description={ACCORDION_DESCRIPTIONS['bars.sizeRadius']}>
        <FR label="Inner radius" hint={`${ir}px`} info={hintFor('bars.innerRadius')}>
          <Sl value={ir as number} min={60} max={400} step={5} onChange={sIr} />
        </FR>
        <FR label="Length scale" hint={`${(ls as number).toFixed(2)}×`} info={hintFor('bars.lengthScale')}>
          <Sl value={ls as number} min={0.2} max={3.0} step={0.05} onChange={sLs} />
        </FR>
        <FR label="Reactivity" hint={`${(re as number).toFixed(2)}×`} info={hintFor('bars.reactivity')}>
          <Sl value={re as number} min={0.1} max={3.0} step={0.05} onChange={sRe} />
        </FR>
      </Acc>

      <Acc label="Peak indicators" description={ACCORDION_DESCRIPTIONS['bars.peaks']}>
        <Tg value={pe as boolean} onChange={sPe} label="Show peaks" info={hintFor('bars.peakEnabled')} />
        {!!pe && (
          <div className="mt-2">
            <FR label="Decay" hint={`${(pd as number).toFixed(3)}`} info={hintFor('bars.peakDecay')}>
              <Sl value={pd as number} min={0.980} max={0.999} step={0.001} onChange={sPd} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Beat Boost" description={ACCORDION_DESCRIPTIONS['bars.beat']}>
        <p className="mb-2 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Frequency range for bar-height beat boost</p>
        <HzRangePicker
          startHz={bbtFS as number}
          endHz={bbtFE as number}
          onChangeStart={sBbtFS}
          onChangeEnd={sBbtFE}
        />
        <div className="mt-2">
          <FR label="Sensitivity" hint={`${(bbtSn as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('bars.beatSensitivity')}>
            <Sl value={bbtSn as number} min={0.1} max={5.0} step={0.05} onChange={sBbtSn} />
          </FR>
        </div>
      </Acc>
    </div>
  );
}

// ── Particles Section ─────────────────────────────────────────────────────────

function ParticlesSection() {
  const [en,   sEn]  = useF('particles', 'enabled');
  const [cnt,  sCnt] = useF('particles', 'count');
  const [cm,   sCm]  = useF('particles', 'colorMode');
  const [sc,   sSc]  = useF('particles', 'solidColor');
  const [sh,   sSh]  = useF('particles', 'particleShape');
  const [sz,   sSz]  = useF('particles', 'size');
  const [sob,  sSob] = useF('particles', 'sizeOnBeat');
  const [bm,   sBm]  = useF('particles', 'blendMode');
  const [or,   sOr]  = useF('particles', 'orbitRadius');
  const [om,   sOm]  = useF('particles', 'orbitMode');
  const [er,   sEr]  = useF('particles', 'ellipseRatio');
  const [sp,   sSp]  = useF('particles', 'speed');
  const [spr,  sSpr] = useF('particles', 'spread');
  const [kb,   sKb]  = useF('particles', 'kickBurstStrength');
  const [rFS,  sRFS] = useF('particles', 'reactiveFreqStart');
  const [rFE,  sRFE] = useF('particles', 'reactiveFreqEnd');
  const [rSens, sRSens] = useF('particles', 'reactiveSensitivity');
  const [cl,   sCl]  = useF('particles', 'connectionLines');
  const [cd,   sCd]  = useF('particles', 'connectionDistance');
  const [co,   sCo]  = useF('particles', 'connectionOpacity');
  const [tw,   sTw]  = useF('particles', 'twinkle');
  const [tws,  sTws] = useF('particles', 'twinkleSpeed');
  const [op,   sOp]  = useF('particles', 'opacity');

  return (
    <div className="flex flex-col gap-2">
      <Tg value={en as boolean} onChange={sEn} label="Particles" />

      <Acc label="General" description={ACCORDION_DESCRIPTIONS['particles.general']}>
        <FR label="Count" hint={`${cnt}`} info={hintFor('particles.count')}>
          <Sl value={cnt as number} min={0} max={400} step={10} onChange={sCnt} />
        </FR>
        <FR label="Color mode" info={ENUM_HINTS['particles.colorMode']?.[cm as string]}>
          <CB value={cm as string}
            options={[
              { value: 'solid',   label: 'Solid' },
              { value: 'rainbow', label: 'Rainbow' },
              { value: 'custom',  label: 'Custom' },
              { value: 'random',  label: 'Random' },
              { value: 'key-derived', label: 'Key' },
              { value: 'band-driven',  label: 'Bands' },
            ]}
            onChange={sCm as (v: string) => void}
          />
        </FR>
        {(cm as string) === 'solid' && (
          <FR label="Color" info={hintFor('particles.solidColor')}><CP value={sc as string} onChange={sSc} /></FR>
        )}
        {(cm as string) === 'custom' && <CustomColorEditor group="particles" />}
      </Acc>

      <Acc label="Shape & Size" description={ACCORDION_DESCRIPTIONS['particles.shape']}>
        <FR label="Shape" info={ENUM_HINTS['particles.particleShape']?.[sh as string]}>
          <CB value={sh as string}
            options={[
              { value: 'circle',  label: 'Circle' },
              { value: 'star',    label: 'Star' },
              { value: 'diamond', label: 'Diamond' },
            ]}
            onChange={sSh as (v: string) => void}
          />
        </FR>
        <FR label="Size" hint={`${(sz as number).toFixed(1)}px`} info={hintFor('particles.size')}>
          <Sl value={sz as number} min={0.5} max={8} step={0.1} onChange={sSz} />
        </FR>
        <FR label="Size burst on beat" info={hintFor('particles.sizeOnBeat')}>
          <Sl value={sob as number} min={0} max={3} step={0.05} onChange={sSob} />
        </FR>
        <FR label="Blend mode" info={ENUM_HINTS['particles.blendMode']?.[bm as string]}>
          <CB value={bm as string}
            options={[
              { value: 'additive', label: 'Additive' },
              { value: 'normal',   label: 'Normal' },
            ]}
            onChange={sBm as (v: string) => void}
          />
        </FR>
        <FR label="Opacity" hint={`${Math.round((op as number) * 100)}%`} info={hintFor('particles.opacity')}>
          <Sl value={op as number} min={0} max={1} step={0.01} onChange={sOp} />
        </FR>
      </Acc>

      <Acc label="Orbit" description={ACCORDION_DESCRIPTIONS['particles.orbit']}>
        <FR label="Orbit radius" hint={`${or}px`} info={hintFor('particles.orbitRadius')}>
          <Sl value={or as number} min={80} max={500} step={5} onChange={sOr} />
        </FR>
        <FR label="Orbit mode" info={ENUM_HINTS['particles.orbitMode']?.[om as string]}>
          <CB value={om as string}
            options={[
              { value: 'circular',   label: 'Circle' },
              { value: 'elliptical', label: 'Ellipse' },
              { value: 'scatter',    label: 'Scatter' },
            ]}
            onChange={sOm as (v: string) => void}
          />
        </FR>
        {(om as string) === 'elliptical' && (
          <FR label="Y/X ratio" hint={`${(er as number).toFixed(2)}`} info={hintFor('particles.ellipseRatio')}>
            <Sl value={er as number} min={0.3} max={1.0} step={0.05} onChange={sEr} />
          </FR>
        )}
        <FR label="Speed" info={hintFor('particles.speed')}>
          <Sl value={sp as number} min={0} max={3} step={0.05} onChange={sSp} />
        </FR>
        <FR label="Spread" info={hintFor('particles.spread')}>
          <Sl value={spr as number} min={0} max={3} step={0.05} onChange={sSpr} />
        </FR>
      </Acc>

      <Acc label="Physics" description={ACCORDION_DESCRIPTIONS['particles.physics']}>
        <FR label="Kick burst" info={hintFor('particles.kickBurstStrength')}>
          <Sl value={kb as number} min={0} max={3} step={0.05} onChange={sKb} />
        </FR>
        <div className="mt-1">
          <HzRangePicker
            startHz={rFS as number}
            endHz={rFE as number}
            onChangeStart={sRFS}
            onChangeEnd={sRFE}
          />
          <div className="mt-2">
            <FR label="Sensitivity" hint={`${(rSens as number).toFixed(2)}×`} sub="Lower = more sensitive" info={hintFor('particles.reactiveSensitivity')}>
              <Sl value={rSens as number} min={0.1} max={5.0} step={0.05} onChange={sRSens} />
            </FR>
          </div>
        </div>
      </Acc>

      <Acc label="Connections" description={ACCORDION_DESCRIPTIONS['particles.connections']}>
        <Tg value={cl as boolean} onChange={sCl} label="Connection lines" info={hintFor('particles.connectionLines')} />
        {!!cl && (
          <div className="mt-3 space-y-2">
            <FR label="Max distance" hint={`${cd}px`} sub="Capped at 200 particles when enabled" info={hintFor('particles.connectionDistance')}>
              <Sl value={cd as number} min={20} max={200} step={5} onChange={sCd} />
            </FR>
            <FR label="Line opacity" hint={`${Math.round((co as number) * 100)}%`} info={hintFor('particles.connectionOpacity')}>
              <Sl value={co as number} min={0} max={1} step={0.01} onChange={sCo} />
            </FR>
          </div>
        )}
      </Acc>

      <Acc label="Flicker" description={ACCORDION_DESCRIPTIONS['particles.flicker']}>
        <Tg value={tw as boolean} onChange={sTw} label="Twinkle" info={hintFor('particles.twinkle')} />
        {!!tw && (
          <div className="mt-2">
            <FR label="Speed" info={hintFor('particles.twinkleSpeed')}>
              <Sl value={tws as number} min={0.5} max={3} step={0.1} onChange={sTws} />
            </FR>
          </div>
        )}
      </Acc>
    </div>
  );
}

function EffectCard({
  label, enabled, onToggle, children, info,
}: {
  label: string; enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode; info?: string;
}) {
  return (
    <div className="mb-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev-2)' }}>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <Tg value={enabled} onChange={onToggle} label={label} />
        </div>
        {info && <Hint text={info} />}
      </div>
      {enabled && children && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────

function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

void getSettings;

function SaveIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
