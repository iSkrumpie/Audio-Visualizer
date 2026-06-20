/**
 * DropZone — drag & drop or click-to-pick file input
 *
 * Generic, reused for audio / logo / background uploads.
 * Studio aesthetic: hairline border, neutral surface, subtle accent on drag.
 */

import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFileUpload, type UploadKind } from '@/hooks/useFileUpload';
import { useAudioStore } from '@/lib/audioStore';

type DropZoneProps = {
  kind: UploadKind;
  label: string;
  hint: string;
  accept: string;
  previewUrl?: string | null;
  previewAlt?: string;
  previewIcon?: React.ReactNode;
  disabled?: boolean;
};

export function DropZone({
  kind,
  label,
  hint,
  accept,
  previewUrl,
  previewAlt,
  previewIcon,
  disabled = false,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { handleFile } = useFileUpload(kind);
  const setError = useAudioStore((s) => s.setError);

  const onClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    },
    [handleFile],
  );

  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile, disabled],
  );

  const hasFile = !!previewUrl;

  const surfaceStyle: React.CSSProperties = {
    background: isDragOver
      ? 'var(--bg-elev-2)'
      : hasFile
        ? 'var(--bg-elev-2)'
        : 'var(--bg-elev-1)',
    borderColor: isDragOver
      ? 'var(--accent)'
      : hasFile
        ? 'var(--border-strong)'
        : 'var(--border)',
    boxShadow: isDragOver ? '0 0 0 3px var(--focus-ring)' : 'none',
  };

  return (
    <motion.div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      whileHover={!disabled ? { y: -1 } : {}}
      whileTap={!disabled ? { scale: 0.995 } : {}}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={[
        'group relative flex h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border p-4 text-center transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
      style={surfaceStyle}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onChange}
        onClick={(e) => e.stopPropagation()}
        className="hidden"
        disabled={disabled}
      />

      <AnimatePresence mode="wait">
        {hasFile && previewUrl ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {kind === 'audio' ? (
              <AudioPreview />
            ) : (
              <img
                src={previewUrl}
                alt={previewAlt ?? label}
                className="h-full w-full object-cover"
                style={{ opacity: 0.85 }}
              />
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to top, var(--bg-elev-2) 0%, rgba(0,0,0,0) 60%)',
              }}
            />
            <div
              className="absolute bottom-2 left-3 right-3 flex items-center justify-between"
              style={{ color: 'var(--text)' }}
            >
              <span className="font-ui text-xs font-semibold tracking-wide">{label}</span>
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  background: 'var(--success)',
                  color: 'var(--text-inverse)',
                }}
              >
                ✓ {hint}
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setError(null);
                if (kind === 'audio') useAudioStore.getState().setAudio(null);
                else if (kind === 'logo') useAudioStore.getState().setLogo(null);
                else useAudioStore.getState().setBackground(null);
              }}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{
                background: 'var(--bg-overlay)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              aria-label="Remove file"
            >
              <CloseIcon />
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-1.5"
          >
            {previewIcon && (
              <div style={{ color: 'var(--text-muted)' }}>{previewIcon}</div>
            )}
            <div
              className="font-display text-sm font-semibold tracking-wide"
              style={{ color: 'var(--text)' }}
            >
              {label}
            </div>
            <div className="font-ui text-xs" style={{ color: 'var(--text-muted)' }}>
              {hint}
            </div>
            <div className="mt-1 font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {isDragOver ? 'Drop to upload' : `Drop or click · max ${kind === 'audio' ? '200 MB' : '10 MB'}`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function AudioPreview() {
  const meta = useAudioStore((s) => s.audioMetadata);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: 'var(--bg-elev-1)', color: 'var(--accent)' }}
      >
        <AudioIcon />
      </div>
      <div
        className="line-clamp-1 max-w-full font-ui text-sm font-medium"
        style={{ color: 'var(--text)' }}
      >
        {meta?.name ?? 'audio loaded'}
      </div>
      <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {(meta?.size ?? 0) / 1024 / 1024 < 1
          ? `${((meta?.size ?? 0) / 1024).toFixed(0)} KB`
          : `${((meta?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`}
        {meta?.duration ? ` · ${Math.round(meta.duration)}s` : ''}
      </div>
    </div>
  );
}

function AudioIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
