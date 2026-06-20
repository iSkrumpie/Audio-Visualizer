/**
 * HzRangePicker — shared UI for selecting a frequency band.
 *
 * - 10 preset buttons (Kick, Sub-Bass, Bass, Snare, Vocal, Mids, High-Mids, Highs, Hi-Hat, Full)
 * - Logarithmic dual-slider for custom ranges
 * - Bin-count quality indicator (poor/ok/good)
 * - Live preview of current Hz range
 *
 * Used by: Background "Beat FX", Logo "Animation", Logo "Fire",
 *          Particles "Physics", Bars "Beat Boost".
 */
import { useMemo } from 'react';
import {
  FREQ_PRESETS,
  sliderToHz,
  hzToSlider,
  getBinCountForRange,
  getBeatDetectionQuality,
  MIN_HZ,
  MAX_HZ,
} from '@/lib/audioUtils';

interface HzRangePickerProps {
  startHz: number;
  endHz: number;
  onChangeStart: (hz: number) => void;
  onChangeEnd: (hz: number) => void;
  /** Optional: minimum allowed end-start spread in Hz (default 10) */
  minSpread?: number;
}

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;

export function HzRangePicker({
  startHz,
  endHz,
  onChangeStart,
  onChangeEnd,
  minSpread = 10,
}: HzRangePickerProps) {
  // Active preset detection — which button is "lit"
  const activeKey = useMemo(() => {
    const match = FREQ_PRESETS.find(
      (p) => p.startHz === startHz && p.endHz === endHz,
    );
    return match?.key ?? null;
  }, [startHz, endHz]);

  const binCount = getBinCountForRange(startHz, endHz, SAMPLE_RATE, FFT_SIZE);
  const quality  = getBeatDetectionQuality(binCount);
  const qColor   = quality === 'good' ? 'var(--accent)' : quality === 'ok' ? '#f59e0b' : 'var(--danger)';

  const handlePreset = (preset: typeof FREQ_PRESETS[number]) => {
    onChangeStart(preset.startHz);
    onChangeEnd(preset.endHz);
  };

  const onSliderStart = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value) / 1000;
    const newStart = Math.round(sliderToHz(t));
    const clamped  = Math.min(newStart, endHz - minSpread);
    onChangeStart(Math.max(MIN_HZ, clamped));
  };
  const onSliderEnd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value) / 1000;
    const newEnd = Math.round(sliderToHz(t));
    const clamped  = Math.max(newEnd, startHz + minSpread);
    onChangeEnd(Math.min(MAX_HZ, clamped));
  };

  const startPct = hzToSlider(startHz) * 100;
  const endPct   = hzToSlider(endHz)   * 100;

  return (
    <div className="space-y-2">
      {/* ── Preset buttons ── */}
      <div className="flex flex-wrap gap-1">
        {FREQ_PRESETS.map((p) => {
          const active = activeKey === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePreset(p)}
              className="rounded-md border px-2 py-0.5 font-ui text-[10px] font-medium transition-colors"
              style={{
                background:  active ? 'var(--accent)' : 'var(--bg-elev-2)',
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                color:       active ? 'var(--text-inverse)' : 'var(--text-muted)',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--border-strong)';
                  e.currentTarget.style.color = 'var(--text)';
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
              title={`${p.startHz} – ${p.endHz} Hz`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* ── Range display + log sliders ── */}
      <div className="flex items-center gap-2">
        <span
          className="w-14 text-right font-mono text-[10px] tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {startHz} Hz
        </span>
        <div className="relative flex-1">
          {/* Slider track visualization */}
          <div
            className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
            style={{ background: 'var(--border-strong)' }}
          />
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
            style={{
              background: 'var(--accent)',
              left:  `${startPct}%`,
              width: `${Math.max(0, endPct - startPct)}%`,
            }}
          />
          <input
            type="range"
            min={0} max={1000} step={1}
            value={Math.round(hzToSlider(startHz) * 1000)}
            onChange={onSliderStart}
            className="hz-range-picker relative w-full appearance-none bg-transparent"
            style={{ height: 16 }}
            aria-label="Frequency start"
          />
          <input
            type="range"
            min={0} max={1000} step={1}
            value={Math.round(hzToSlider(endHz) * 1000)}
            onChange={onSliderEnd}
            className="hz-range-picker relative w-full appearance-none bg-transparent"
            style={{ height: 16, marginTop: -16 }}
            aria-label="Frequency end"
          />
        </div>
        <span
          className="w-16 font-mono text-[10px] tabular-nums"
          style={{ color: 'var(--text-muted)' }}
        >
          {endHz} Hz
        </span>
      </div>

      {/* ── Quality indicator ── */}
      <div className="flex items-center gap-2 font-mono text-[9px]" style={{ color: 'var(--text-dim)' }}>
        <span>Bandwidth:</span>
        <span style={{ color: qColor, fontWeight: 600 }}>
          {binCount} bin{binCount !== 1 ? 's' : ''}
        </span>
        <span>·</span>
        <span style={{ color: qColor }}>
          {quality === 'good' ? '✓ reliable' : quality === 'ok' ? '~ OK' : '⚠ noisy'}
        </span>
      </div>
    </div>
  );
}
