/**
 * Hint.tsx — reusable "ⓘ" tooltip popover component.
 *
 * Features:
 *  - Hover (300 ms delay) + click-to-pin popover
 *  - Portal-rendered so it escapes overflow:hidden containers
 *  - Auto-flips side near viewport edges
 *  - framer-motion animated (enter/exit)
 *  - Escape closes; click-outside closes
 *  - SSR-safe (createPortal guarded by typeof document)
 *  - Zero new dependencies; uses existing CSS vars
 */

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

type Side = 'top' | 'right' | 'bottom' | 'left';

export interface HintProps {
  /** Explanation text — plain language, 1-2 sentences, max ~160 chars recommended. */
  text: string;
  /** Preferred side for the popover. Default: 'right'. Auto-flips near viewport edges. */
  side?: Side;
  /** Hover delay in ms before showing. Default: 300. Set to 0 to disable hover trigger. */
  hoverDelay?: number;
  /** Whether a click toggles the popover open and keeps it pinned. Default: true. */
  clickToToggle?: boolean;
  /** Optional className forwarded to the trigger button. */
  className?: string;
  /** aria-label override for the trigger button. Default: 'More info'. */
  ariaLabel?: string;
}

// ─── Position helper ──────────────────────────────────────────────────────────

const POPOVER_MAX_W = 240;
const POPOVER_FLIP_X = POPOVER_MAX_W + 12; // flip if closer to edge than this
const POPOVER_FLIP_Y = 120;                 // flip if closer to bottom than this
const GAP = 8;                              // gap between trigger and popover (px)
const ARROW_SIZE = 6;

interface PopoverPos {
  left: number;
  top: number;
  actualSide: Side;
}

function computePosition(
  triggerRect: DOMRect,
  preferredSide: Side,
): PopoverPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Resolve side, potentially flipping for viewport constraints
  let actualSide: Side = preferredSide;

  if (preferredSide === 'right' && triggerRect.right + POPOVER_FLIP_X > vw) {
    actualSide = 'left';
  } else if (preferredSide === 'left' && triggerRect.left - POPOVER_FLIP_X < 0) {
    actualSide = 'right';
  } else if (preferredSide === 'bottom' && triggerRect.bottom + POPOVER_FLIP_Y > vh) {
    actualSide = 'top';
  } else if (preferredSide === 'top' && triggerRect.top - POPOVER_FLIP_Y < 0) {
    actualSide = 'bottom';
  }

  // Additional cross-axis flip: if left/right placement but near bottom
  if ((actualSide === 'right' || actualSide === 'left') &&
      triggerRect.bottom + POPOVER_FLIP_Y > vh) {
    // anchor to bottom of trigger instead of center
  }

  let left: number;
  let top: number;

  switch (actualSide) {
    case 'right':
      left = triggerRect.right + GAP + ARROW_SIZE;
      top  = triggerRect.top + triggerRect.height / 2;
      break;
    case 'left':
      left = triggerRect.left - GAP - ARROW_SIZE - POPOVER_MAX_W;
      top  = triggerRect.top + triggerRect.height / 2;
      break;
    case 'top':
      left = triggerRect.left + triggerRect.width / 2;
      top  = triggerRect.top - GAP - ARROW_SIZE;
      break;
    case 'bottom':
    default:
      left = triggerRect.left + triggerRect.width / 2;
      top  = triggerRect.bottom + GAP + ARROW_SIZE;
      break;
  }

  // Keep within viewport horizontally
  left = Math.max(8, Math.min(left, vw - POPOVER_MAX_W - 8));

  return { left, top, actualSide };
}

// ─── CSS-in-JS styles (no extra style sheet needed) ──────────────────────────

const TRIGGER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text-dim)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  lineHeight: 1,
  verticalAlign: 'middle',
  transition: 'color 0.15s, border-color 0.15s',
};

function popoverStyle(pos: PopoverPos): CSSProperties {
  const base: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    maxWidth: POPOVER_MAX_W,
    background: 'var(--bg-elev-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 7,
    padding: '8px 10px',
    color: 'var(--text)',
    fontSize: 12,
    fontFamily: 'var(--font-ui, system-ui, sans-serif)',
    lineHeight: 1.5,
    boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3))',
    pointerEvents: 'auto',
    userSelect: 'none',
  };

  // Anchor transform so the popover is centered on the trigger's cross-axis
  switch (pos.actualSide) {
    case 'right':
    case 'left':
      return { ...base, left: pos.left, top: pos.top, transform: 'translateY(-50%)' };
    case 'top':
      return { ...base, left: pos.left, top: pos.top, transform: 'translate(-50%, -100%)' };
    case 'bottom':
    default:
      return { ...base, left: pos.left, top: pos.top, transform: 'translateX(-50%)' };
  }
}

/** Small CSS-border-triangle arrow pointing toward the trigger. */
function arrowStyle(actualSide: Side): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    border: `${ARROW_SIZE}px solid transparent`,
  };

  switch (actualSide) {
    case 'right': // popover is to the right → arrow points left
      return {
        ...base,
        left: -ARROW_SIZE * 2,
        top: '50%',
        transform: 'translateY(-50%)',
        borderRightColor: 'var(--border-strong)',
        borderLeft: 'none',
      };
    case 'left': // popover is to the left → arrow points right
      return {
        ...base,
        right: -ARROW_SIZE * 2,
        top: '50%',
        transform: 'translateY(-50%)',
        borderLeftColor: 'var(--border-strong)',
        borderRight: 'none',
      };
    case 'top': // popover is above → arrow points down
      return {
        ...base,
        bottom: -ARROW_SIZE * 2,
        left: '50%',
        transform: 'translateX(-50%)',
        borderTopColor: 'var(--border-strong)',
        borderBottom: 'none',
      };
    case 'bottom': // popover is below → arrow points up
    default:
      return {
        ...base,
        top: -ARROW_SIZE * 2,
        left: '50%',
        transform: 'translateX(-50%)',
        borderBottomColor: 'var(--border-strong)',
        borderTop: 'none',
      };
  }
}

// ─── framer-motion variants per side ─────────────────────────────────────────

function motionInitial(side: Side) {
  switch (side) {
    case 'right':   return { opacity: 0, scale: 0.95, x: -4 };
    case 'left':    return { opacity: 0, scale: 0.95, x:  4 };
    case 'top':     return { opacity: 0, scale: 0.95, y:  4 };
    case 'bottom':
    default:        return { opacity: 0, scale: 0.95, y: -4 };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Hint({
  text,
  side = 'right',
  hoverDelay = 300,
  clickToToggle = true,
  className,
  ariaLabel = 'More info',
}: HintProps) {
  const [pinned,  setPinned]  = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pos,     setPos]     = useState<PopoverPos | null>(null);

  const triggerRef     = useRef<HTMLButtonElement>(null);
  const popoverRef     = useRef<HTMLDivElement>(null);
  const hoverTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = pinned || hovered;

  // ── Position measurement ────────────────────────────────────────────────────
  const measureAndSetPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos(computePosition(rect, side));
  }, [side]);

  useLayoutEffect(() => {
    if (isOpen) measureAndSetPos();
  }, [isOpen, measureAndSetPos]);

  // Re-measure on resize while open
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('resize', measureAndSetPos);
    return () => window.removeEventListener('resize', measureAndSetPos);
  }, [isOpen, measureAndSetPos]);

  // ── Keyboard: Escape closes ─────────────────────────────────────────────────
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned]);

  // ── Click-outside closes ────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinned) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) return;
      setPinned(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [pinned]);

  // ── Cleanup timers on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
      if (hideTimerRef.current  !== null) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // ── Hover handlers ──────────────────────────────────────────────────────────
  const startShowHover = useCallback(() => {
    if (hoverDelay === 0) {
      setHovered(true);
      return;
    }
    hoverTimerRef.current = setTimeout(() => setHovered(true), hoverDelay);
  }, [hoverDelay]);

  const startHideHover = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Small grace period so cursor can travel into the popover
    hideTimerRef.current = setTimeout(() => setHovered(false), 200);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // ── Hover state on trigger ──────────────────────────────────────────────────
  const [triggerHovered, setTriggerHovered] = useState(false);

  const triggerStyle: CSSProperties = {
    ...TRIGGER_STYLE,
    ...(triggerHovered
      ? { color: 'var(--text)', borderColor: 'var(--accent)' }
      : {}),
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const popoverEl = isOpen && pos && (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        role="tooltip"
        id="hint-popover"
        style={popoverStyle(pos)}
        initial={motionInitial(pos.actualSide)}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onMouseEnter={cancelHide}
        onMouseLeave={startHideHover}
      >
        {/* Arrow triangle */}
        <span style={arrowStyle(pos.actualSide)} aria-hidden="true" />
        {text}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-describedby={isOpen ? 'hint-popover' : undefined}
        style={triggerStyle}
        className={`hint-trigger${className ? ` ${className}` : ''}`}
        onMouseEnter={() => {
          setTriggerHovered(true);
          cancelHide();
          startShowHover();
        }}
        onMouseLeave={() => {
          setTriggerHovered(false);
          startHideHover();
        }}
        onFocus={() => { cancelHide(); startShowHover(); }}
        onBlur={startHideHover}
        onClick={() => {
          if (!clickToToggle) return;
          setPinned(p => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && pinned) {
            setPinned(false);
          }
        }}
      >
        {/* ⓘ — info circle icon */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>

      {typeof document !== 'undefined' &&
        createPortal(popoverEl, document.body)}
    </>
  );
}
