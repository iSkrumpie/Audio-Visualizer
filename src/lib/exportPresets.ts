/**
 * Export presets — YouTube & TikTok platform specs.
 *
 * Sources:
 *   YouTube: support.google.com/youtube/answer/1722171 (June 2026)
 *   TikTok:  shortsync.app, tikup.online (June 2026)
 *
 * All presets target H.264 (AVC) + AAC-LC in MP4 — the only codec
 * universally supported by browser WebCodecs encoders.
 */

export type ExportPlatform = 'youtube' | 'tiktok';

export type ExportPreset = {
  id: string;
  platform: ExportPlatform;
  /** Short display label, e.g. "1080p" */
  label: string;
  /** Secondary line, e.g. "60 fps · 12 Mbps" */
  sublabel: string;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate in bps */
  videoBitrate: number;
  /** Audio bitrate in bps */
  audioBitrate: number;
  /** Highlighted as the best default for this platform */
  recommended?: boolean;
};

export const EXPORT_PRESETS: ExportPreset[] = [
  // ── YouTube (16:9 landscape) ─────────────────────────────────────────────
  // Spec: BT.709 SDR, H.264 High Profile, AAC-LC 48 kHz stereo
  {
    id: 'yt-1080p-60',
    platform: 'youtube',
    label: '1080p HD',
    sublabel: '60 fps · 12 Mbps · 1920×1080',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrate: 12_000_000,
    audioBitrate: 384_000,
    recommended: true,
  },
  {
    id: 'yt-1080p-30',
    platform: 'youtube',
    label: '1080p HD',
    sublabel: '30 fps · 8 Mbps · 1920×1080',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 384_000,
  },
  {
    id: 'yt-1440p-60',
    platform: 'youtube',
    label: '1440p 2K',
    sublabel: '60 fps · 24 Mbps · 2560×1440',
    width: 2560,
    height: 1440,
    fps: 60,
    videoBitrate: 24_000_000,
    audioBitrate: 384_000,
  },
  {
    id: 'yt-1440p-30',
    platform: 'youtube',
    label: '1440p 2K',
    sublabel: '30 fps · 16 Mbps · 2560×1440',
    width: 2560,
    height: 1440,
    fps: 30,
    videoBitrate: 16_000_000,
    audioBitrate: 384_000,
  },
  {
    id: 'yt-4k-30',
    platform: 'youtube',
    label: '4K UHD',
    sublabel: '30 fps · 45 Mbps · 3840×2160',
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrate: 45_000_000,
    audioBitrate: 384_000,
  },

  // ── TikTok (9:16 portrait) ───────────────────────────────────────────────
  // Spec: 1080×1920 portrait, H.264, AAC-LC, 48 kHz stereo
  // TikTok algorithm-boosts native portrait uploads; landscape gets letterboxed.
  {
    id: 'tt-1080p-60',
    platform: 'tiktok',
    label: '1080p Portrait',
    sublabel: '60 fps · 10 Mbps · 1080×1920',
    width: 1080,
    height: 1920,
    fps: 60,
    videoBitrate: 10_000_000,
    audioBitrate: 256_000,
    recommended: true,
  },
  {
    id: 'tt-1080p-30',
    platform: 'tiktok',
    label: '1080p Portrait',
    sublabel: '30 fps · 10 Mbps · 1080×1920',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: 10_000_000,
    audioBitrate: 256_000,
  },
];

export const PLATFORM_META: Record<
  ExportPlatform,
  { label: string; description: string }
> = {
  youtube: {
    label: 'YouTube',
    description: 'H.264 · BT.709 · MP4',
  },
  tiktok: {
    label: 'TikTok',
    description: '9:16 Portrait · H.264 · MP4',
  },
};
