/**
 * useAudioReactive — Web Audio API + dual AnalyserNode pipeline
 *
 * v2 (Session 11): Uses decodeAudioData() + AudioBufferSourceNode instead of
 * createMediaElementSource(<audio>), so that the live preview and the export
 * pipeline (which already uses OfflineAudioContext + decodeAudioData) both go
 * through the same Chrome audio-decoding path. This eliminates the 3–5 dB gain
 * difference between MediaElementSource and BufferSource that caused beat
 * animations to appear more intense in exported MP4s than in the live preview.
 *
 * Pattern adopted from skrumpie.de for bass-heavy look:
 *   - Visual analyser (fftSize=256, smoothed)  → drives glow, bars, particles
 *   - Kick  analyser (fftSize=2048, raw)        → drives beat detection
 *
 * Reads audio data every animation frame and writes to a shared mutable
 * object (`audioAnalysis`) — Three.js / Canvas loops read from it directly
 * to avoid React re-renders.
 *
 * Frequency extraction (skrumpie.de mapping):
 *   bass      = avg(bins 0..5)        → 0..1
 *   loudness  = avg(all bins)         → 0..1
 *   highs     = avg(bins 60..end)     → 0..1
 *
 * Beat detection: configurable FreqBeatDetector (spectral-flux) driven by
 * settings.audio.globalBeatFreqStart/End/Sensitivity. Hz range and sensitivity
 * are read live from settings each rAF tick.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useAudioStore } from '@/lib/audioStore';
import { sceneRegistry } from '@/components/three/AudioScene';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { getSettings } from '@/lib/settingsStore';

// ── Tunables (skrumpie.de-derived) ─────────────────────────────────────────
const VISUAL_FFT      = 256;   // → 128 bins
const KICK_FFT        = 2048;
const VISUAL_SMOOTHING = 0.55;
const KICK_SMOOTHING   = 0.0;
const BEAT_GLOW_MAX   = 55;    // px, mirrors skrumpie.de CSS var

// ── Global beat detector (configurable Hz range + sensitivity) ─────────────
// Module-level singleton — lives for the lifetime of the page.
// The Hz range and sensitivity are read live from settings each rAF tick.
const globalBeatDetector = new FreqBeatDetector(48000);

// Expose for the export pipeline so both paths share the same detector
// instance. The export resets it to clean state and replays from frame 0,
// producing byte-identical beatPhase at every frame index.
if (typeof window !== 'undefined') {
  (window as any).__detectors = { global: globalBeatDetector };
}

// ── Shared mutable analysis (read by canvas/Three.js render loops) ─────────
export const audioAnalysis = {
  bass: 0,
  loudness: 0,
  highs: 0,
  /** Smoothed frequency data, 128 bins, 0-255 (visual analyser, smoothing=0.55) */
  freqData: new Uint8Array(VISUAL_FFT / 2),
  /** Raw (unsmoothed) frequency data, 1024 bins, 0-255 (kick analyser, smoothing=0) */
  rawFreqData: new Uint8Array(KICK_FFT / 2),
  /** Raw time-domain data, 256 bytes, 128 = silence */
  waveData: new Uint8Array(VISUAL_FFT),
  /** 0..1, combined energy from bass + loudness + highs */
  energy: 0,
  /** 0..1, decays from 1 after kick, drives logo pulse + glow */
  beatPhase: 0,
};

export function useAudioReactive() {
  // ── Persistent audio graph (analysers + gain → destination) ────────────────
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const visualRef     = useRef<AnalyserNode | null>(null);
  const kickRef       = useRef<AnalyserNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // ── Decoded audio buffer ───────────────────────────────────────────────────
  // Note: decodeAudioData() loads the entire file as Float32Array PCM into RAM.
  // The 2 GB upload limit in useFileUpload.ts is preserved intentionally;
  // extremely large files may exhaust available memory.
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  // ── Current playback source (one-shot, recreated each play()) ─────────────
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // ── Playback-time tracking ─────────────────────────────────────────────────
  // virtualCurrentTime = playStartOffset + (ctx.currentTime − playStartCtxTime)
  const playStartCtxTimeRef = useRef<number>(0);
  const playStartOffsetRef  = useRef<number>(0);
  const currentOffsetRef    = useRef<number>(0); // last known position (updated every rAF tick)
  const isAudioPlayingRef   = useRef<boolean>(false);

  // ── Blob URL for backward-compat script access ────────────────────────────
  const objectUrlRef = useRef<string | null>(null);

  // ── Analysis data buffers ──────────────────────────────────────────────────
  const visualDataRef = useRef<Uint8Array>(new Uint8Array(VISUAL_FFT / 2));
  const kickDataRef   = useRef<Uint8Array>(new Uint8Array(KICK_FFT / 2));

  // ── RAF loop handle ────────────────────────────────────────────────────────
  const rafRef = useRef<number | null>(null);

  const setPlayingRef     = useRef(useAudioStore.getState().setPlaying);
  const setCurrentTimeRef = useRef(useAudioStore.getState().setCurrentTime);

  // ── Stable function refs: always point to the latest play/pause/seek ───────
  // Used by window.__audioEl so scripts always call the current implementation.
  const playFnRef  = useRef<() => Promise<void>>(async () => {});
  const pauseFnRef = useRef<() => void>(() => {});
  const seekFnRef  = useRef<(t: number) => void>(() => {});

  // ── Virtual currentTime ────────────────────────────────────────────────────
  /** Returns playback position in seconds, derived from AudioContext clock. */
  const getVirtualCurrentTime = useCallback((): number => {
    if (!isAudioPlayingRef.current || !audioCtxRef.current) {
      return currentOffsetRef.current;
    }
    const elapsed = audioCtxRef.current.currentTime - playStartCtxTimeRef.current;
    const dur     = audioBufferRef.current?.duration ?? Infinity;
    return Math.min(playStartOffsetRef.current + elapsed, dur);
  }, []);

  // ── Set up persistent audio graph ─────────────────────────────────────────
  /**
   * Creates AudioContext({ sampleRate: 48000 }) + analysers + masterGain.
   * Idempotent — returns immediately if already initialised.
   */
  const setupGraph = useCallback(() => {
    if (audioCtxRef.current) return;

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ sampleRate: 48000 });
    audioCtxRef.current = ctx;

    // Initialise master gain to the current store volume
    const masterGain = ctx.createGain();
    masterGain.gain.value = useAudioStore.getState().volume;
    masterGainRef.current = masterGain;

    // Visual analyser (smoothed) — drives glow, brightness, particles, bars
    const visual = ctx.createAnalyser();
    visual.fftSize = VISUAL_FFT;
    visual.smoothingTimeConstant = VISUAL_SMOOTHING;
    visual.connect(masterGain);
    masterGain.connect(ctx.destination);
    visualRef.current = visual;

    // Kick analyser (raw, high-res) — drives beat detection only
    const kick = ctx.createAnalyser();
    kick.fftSize = KICK_FFT;
    kick.smoothingTimeConstant = KICK_SMOOTHING;
    // CRITICAL: AnalyserNodes only process audio when connected downstream.
    // Route the kick tap through a silent gain to ctx.destination so it
    // receives every sample. Without this, the kick analyser reports
    // slightly different magnitudes than the live visual path (and very
    // different from the export path, where the offline kick analyser IS
    // connected to destination). The silent gain prevents the user from
    // hearing the kick audio twice.
    const kickSilentGain = ctx.createGain();
    kickSilentGain.gain.value = 0;
    kick.connect(kickSilentGain);
    kickSilentGain.connect(ctx.destination);
    kickRef.current = kick;

    // Expose for E2E / diagnostic scripts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__audioCtx       = ctx;
    w.__visualAnalyser = visual;
    w.__kickAnalyser   = kick;
  }, []);

  // ── rAF analysis loop ──────────────────────────────────────────────────────
  /** Start the rAF analysis loop. Idempotent. */
  const start = useCallback(() => {
    if (rafRef.current !== null) return;
    const tick = () => {
      const ctx = audioCtxRef.current;
      if (ctx?.state === 'suspended') void ctx.resume();

      // ── Update virtual currentTime ──────────────────────────────────────
      if (isAudioPlayingRef.current) {
        const vt = getVirtualCurrentTime();
        currentOffsetRef.current = vt;
        setCurrentTimeRef.current(vt);
      }

      // ── Visual analysis (drives everything visual) ──────────────────────
      const visual = visualRef.current;
      if (visual) {
        const d = visualDataRef.current;
        visual.getByteFrequencyData(d as Uint8Array<ArrayBuffer>);

        let bassSum = 0;
        for (let i = 0; i < 6; i++) bassSum += d[i];
        const bass = bassSum / (6 * 255);

        let total = 0;
        for (let i = 0; i < d.length; i++) total += d[i];
        const loudness = total / (d.length * 255);

        let highSum = 0;
        for (let i = 60; i < d.length; i++) highSum += d[i];
        const highs = highSum / ((d.length - 60) * 255);

        audioAnalysis.bass     = bass;
        audioAnalysis.loudness = loudness;
        audioAnalysis.highs    = highs;
        audioAnalysis.freqData.set(d);
        visual.getByteTimeDomainData(audioAnalysis.waveData as Uint8Array<ArrayBuffer>);

        // Combined energy from bass + loudness + highs (matches fft.ts / exportEngine
        // formula exactly, so the live preview and the export see the same value).
        const energy = Math.min(1, bass * 2 + loudness + highs * 0.5);
        audioAnalysis.energy = energy;

        // Power curves: low values stay near 0, real peaks punch through
        const brightBoost = Math.pow(bass, 2.0) * 0.45 + Math.pow(loudness, 2.0) * 0.15;
        const satBoost    = Math.pow(bass, 1.6) * 1.2  + Math.pow(loudness, 1.6) * 0.4;
        document.documentElement.style.setProperty('--audio-bright-boost', `${brightBoost}`);
        document.documentElement.style.setProperty('--audio-sat-boost', `${satBoost}`);

        // Sync to store for any React-side consumers
        const store = useAudioStore.getState();
        store.bass     = bass;
        store.loudness = loudness;
        store.highs    = highs;
        store.energy   = energy;
      }

      // ── Global beat detection (configurable Hz range via settings.audio) ──
      const kick = kickRef.current;
      if (kick) {
        const kd = kickDataRef.current;
        kick.getByteFrequencyData(kd as Uint8Array<ArrayBuffer>);
        // Expose raw (unsmoothed) FFT data for per-component beat detectors
        audioAnalysis.rawFreqData.set(kd);

        // Read current settings live (no React re-render needed)
        const audioSettings = getSettings().audio;
        globalBeatDetector.setSensitivity(audioSettings.globalBeatSensitivity);
        const globalBeat = globalBeatDetector.update(
          kd,
          audioSettings.globalBeatFreqStart,
          audioSettings.globalBeatFreqEnd,
        );

        document.documentElement.style.setProperty(
          '--beat-glow',
          `${Math.round(globalBeat * BEAT_GLOW_MAX)}px`,
        );
        audioAnalysis.beatPhase            = globalBeat;
        useAudioStore.getState().beatPhase = globalBeat;
      }

      // Drive R3F frame (frameloop="never" — runs all useFrame callbacks)
      sceneRegistry.advance?.(performance.now() / 1000);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getVirtualCurrentTime]);

  /** Stop the rAF analysis loop. */
  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ── Source node lifecycle helpers ──────────────────────────────────────────

  /**
   * Create a new AudioBufferSourceNode and start it at `offset` seconds.
   * Connects the source to both analysers.
   */
  const startSourceAt = useCallback((offset: number) => {
    const ctx = audioCtxRef.current;
    const buf = audioBufferRef.current;
    if (!ctx || !buf) return;

    const safeOffset = Math.min(Math.max(0, offset), buf.duration);

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(visualRef.current!);
    source.connect(kickRef.current!);
    source.start(0, safeOffset);

    playStartCtxTimeRef.current = ctx.currentTime;
    playStartOffsetRef.current  = safeOffset;
    sourceNodeRef.current       = source;
    isAudioPlayingRef.current   = true;
    setPlayingRef.current(true);

    source.onended = () => {
      // Ignore if this source has been superseded by seek or a new play()
      if (source !== sourceNodeRef.current) return;
      isAudioPlayingRef.current = false;
      currentOffsetRef.current  = 0;
      sourceNodeRef.current     = null;
      setCurrentTimeRef.current(0);
      setPlayingRef.current(false);
    };
  }, []);

  /**
   * Stop and disconnect the current source (if any).
   * Clears `onended` first so the natural-end handler does not reset position.
   */
  const stopCurrentSource = useCallback(() => {
    const src = sourceNodeRef.current;
    if (!src) return;
    src.onended = null; // prevent natural-end handler from zeroing position
    try { src.stop(); } catch { /* already stopped */ }
    src.disconnect();
    sourceNodeRef.current     = null;
    isAudioPlayingRef.current = false;
  }, []);

  // ── Public playback controls ───────────────────────────────────────────────

  const play = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (!ctx || !audioBufferRef.current) return;

    if (ctx.state === 'suspended') await ctx.resume();
    // Ensure the rAF analysis loop is running (may have been stopped by export)
    if (rafRef.current === null) start();

    stopCurrentSource();
    startSourceAt(currentOffsetRef.current);
  }, [start, startSourceAt, stopCurrentSource]);

  /**
   * User-facing pause: stops audio playback but KEEPS the rAF analysis loop
   * running so the visualizer still shows the last-frame waveform / beat
   * decay. Required for the TransportBar pause button.
   */
  const pause = useCallback(() => {
    if (!isAudioPlayingRef.current) return;
    // Snapshot position before stopping so we can resume from here
    const vt = getVirtualCurrentTime();
    currentOffsetRef.current = vt;
    setCurrentTimeRef.current(vt);
    stopCurrentSource();
    setPlayingRef.current(false);
  }, [getVirtualCurrentTime, stopCurrentSource]);

  /** Internal seek: update offset and (if playing) restart source at new position. */
  const seekImpl = useCallback((time: number) => {
    const clamped = Math.max(0, time);
    currentOffsetRef.current = clamped;
    setCurrentTimeRef.current(clamped);

    if (isAudioPlayingRef.current) {
      stopCurrentSource();
      startSourceAt(clamped);
    }
  }, [startSourceAt, stopCurrentSource]);

  // Keep stable function refs current (cheap, runs every render)
  playFnRef.current  = play;
  pauseFnRef.current = pause;
  seekFnRef.current  = seekImpl;

  // ── Expose virtual audio element for backward-compat E2E scripts ───────────
  // window.__audioEl mimics HTMLAudioElement's .src / .currentTime / .play() / .pause()
  // so that test-fft-only.mjs and diagnose-fft-sources.mjs still work unchanged.
  // All mutable state is accessed via stable refs at call time.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__audioEl = {
      get src(): string { return objectUrlRef.current ?? ''; },
      get currentTime(): number {
        if (!isAudioPlayingRef.current || !audioCtxRef.current) return currentOffsetRef.current;
        const elapsed = audioCtxRef.current.currentTime - playStartCtxTimeRef.current;
        const dur     = audioBufferRef.current?.duration ?? Infinity;
        return Math.min(playStartOffsetRef.current + elapsed, dur);
      },
      set currentTime(t: number) { seekFnRef.current(t); },
      play():  Promise<void> { return playFnRef.current(); },
      pause(): void          { pauseFnRef.current(); },
    };
  }, []); // stable: all mutable state accessed via refs at call time

  // ── React to file changes ──────────────────────────────────────────────────
  const audioObjectUrl = useAudioStore((s) => s.audioObjectUrl);
  useEffect(() => {
    if (!audioObjectUrl) {
      stop();
      stopCurrentSource();
      currentOffsetRef.current = 0;
      setCurrentTimeRef.current(0);
      setPlayingRef.current(false);
      audioBufferRef.current = null;
      objectUrlRef.current   = null;
      return;
    }

    objectUrlRef.current = audioObjectUrl;

    // Set up the persistent audio graph (idempotent)
    setupGraph();

    // Stop any in-flight playback from a previous file
    stopCurrentSource();
    currentOffsetRef.current = 0;
    setCurrentTimeRef.current(0);
    setPlayingRef.current(false);

    // Decode the audio file into a PCM buffer.
    // Using decodeAudioData() ensures the live preview reads the SAME PCM
    // signal as the export pipeline (OfflineAudioContext + BufferSource),
    // eliminating the gain/EQ difference caused by createMediaElementSource.
    fetch(audioObjectUrl)
      .then((r) => r.arrayBuffer())
      .then((ab) => audioCtxRef.current!.decodeAudioData(ab))
      .then((buffer) => {
        audioBufferRef.current = buffer;

        // Expose decoded buffer for verify-export.mjs / diagnose scripts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__audioBuffer = buffer;

        // Start the rAF analysis loop (reads silence until user hits play)
        start();
      })
      .catch((err: unknown) => {
        console.error('[useAudioReactive] decodeAudioData failed:', err);
      });
  }, [audioObjectUrl, setupGraph, start, stop, stopCurrentSource]);

  // ── Volume sync ────────────────────────────────────────────────────────────
  const volume = useAudioStore((s) => s.volume);
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volume;
    }
  }, [volume]);

  // ── Seek event listener (from TransportBar seek slider) ───────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const time = (e as CustomEvent<{ time: number }>).detail?.time;
      if (typeof time === 'number') seekImpl(time);
    };
    window.addEventListener('audiovisualizer:seek', handler);
    return () => window.removeEventListener('audiovisualizer:seek', handler);
  }, [seekImpl]);

  // ── Export lifecycle helpers ───────────────────────────────────────────────

  /**
   * Export-facing pause: stops audio playback AND the rAF analysis loop.
   * Required before export: while the export pipeline writes precomputed FFT
   * data into `audioAnalysis`, the live rAF loop would race it and overwrite
   * the data — corrupting FreqBeatDetector state and breaking all beat-driven
   * animations in the rendered MP4.
   */
  const stopAndPause = useCallback(() => {
    pause();
    stop();
  }, [pause, stop]);

  /**
   * Resume the rAF analysis loop + audio playback.
   * Symmetric counterpart to stopAndPause() — used after export finishes
   * to restore the live preview.
   */
  const startAndPlay = useCallback(async () => {
    if (rafRef.current === null) start();
    await play();
  }, [start, play]);

  const togglePlay = useCallback(async () => {
    if (isAudioPlayingRef.current) pause();
    else await play();
  }, [play, pause]);

  return {
    isPlaying: useAudioStore((s) => s.isPlaying),
    play,
    pause,
    togglePlay,
    /** Stop rAF loop + pause audio. Use before export to avoid race with the export pipeline. */
    stopAndPause,
    /** Start rAF loop + resume audio. Use after export to restore live preview. */
    startAndPlay,
    seek: (t: number) => seekImpl(t),
  };
}
