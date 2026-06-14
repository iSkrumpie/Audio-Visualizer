/**
 * useAudioReactive — Web Audio API + dual AnalyserNode pipeline
 *
 * Pattern adopted from skrumpie.de for bass-heavy look:
 *   - Visual analyser (fftSize=256, smoothed)  → drives glow, bars, particles
 *   - Kick  analyser (fftSize=2048, raw)        → drives beat detection (60-120Hz)
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
const VISUAL_FFT = 256; // → 128 bins
const KICK_FFT = 2048;
const VISUAL_SMOOTHING = 0.55;
const KICK_SMOOTHING = 0.0;
const MASTER_GAIN = 1.0;
const BEAT_GLOW_MAX = 55; // px, mirrors skrumpie.de CSS var

// ── Global beat detector (configurable Hz range + sensitivity) ─────────────
// Module-level singleton — lives for the lifetime of the page.
// The Hz range and sensitivity are read live from settings each rAF tick.
const globalBeatDetector = new FreqBeatDetector(48000);

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const visualRef = useRef<AnalyserNode | null>(null);
  const kickRef = useRef<AnalyserNode | null>(null);
  const visualDataRef = useRef<Uint8Array>(new Uint8Array(VISUAL_FFT / 2));
  const kickDataRef = useRef<Uint8Array>(new Uint8Array(KICK_FFT / 2));
  const rafRef = useRef<number | null>(null);

  const setPlayingRef = useRef(useAudioStore.getState().setPlaying);
  const setCurrentTimeRef = useRef(useAudioStore.getState().setCurrentTime);

  /** Connect <audio> element to a fresh AudioContext + dual analysers. */
  const connect = useCallback((audioEl: HTMLAudioElement) => {
    if (sourceRef.current) return; // already connected
    audioRef.current = audioEl;
    audioEl.crossOrigin = 'anonymous';
    audioEl.preload = 'auto';

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ sampleRate: 48000 });
    audioCtxRef.current = ctx;

    const source = ctx.createMediaElementSource(audioEl);
    sourceRef.current = source;

    // Master gain (hard ceiling to prevent clipping at high volumes)
    const masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN;

    // Visual analyser (smoothed) — drives glow, brightness, particles, bars
    const visual = ctx.createAnalyser();
    visual.fftSize = VISUAL_FFT;
    visual.smoothingTimeConstant = VISUAL_SMOOTHING;
    source.connect(visual);
    visual.connect(masterGain);
    masterGain.connect(ctx.destination);
    visualRef.current = visual;

    // Kick analyser (raw, high-res) — drives beat detection only
    const kick = ctx.createAnalyser();
    kick.fftSize = KICK_FFT;
    kick.smoothingTimeConstant = KICK_SMOOTHING;
    source.connect(kick);
    // no destination connect — audio already routed via visual
    kickRef.current = kick;

    // Expose for E2E debugging
    if (typeof window !== 'undefined') {
      (window as unknown as { __audioCtx?: AudioContext; __visualAnalyser?: AnalyserNode }).__audioCtx = ctx;
      (window as unknown as { __audioCtx?: AudioContext; __visualAnalyser?: AnalyserNode }).__visualAnalyser = visual;
    }
  }, []);

  /** Start the rAF analysis loop. */
  const start = useCallback(() => {
    if (rafRef.current !== null) return;
    const tick = () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') void ctx.resume();

      // ── Visual analysis (drives everything visual) ─────────────────
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

        audioAnalysis.bass = bass;
        audioAnalysis.loudness = loudness;
        audioAnalysis.highs = highs;
        audioAnalysis.freqData.set(d);
        visual.getByteTimeDomainData(audioAnalysis.waveData as Uint8Array<ArrayBuffer>);

        // Power curves: low values stay near 0, real peaks punch through
        const brightBoost = Math.pow(bass, 2.0) * 0.45 + Math.pow(loudness, 2.0) * 0.15;
        const satBoost = Math.pow(bass, 1.6) * 1.2 + Math.pow(loudness, 1.6) * 0.4;
        document.documentElement.style.setProperty('--audio-bright-boost', `${brightBoost}`);
        document.documentElement.style.setProperty('--audio-sat-boost', `${satBoost}`);

        // Sync to store for any React-side consumers
        const store = useAudioStore.getState();
        store.bass = bass;
        store.loudness = loudness;
        store.highs = highs;
        store.energy = Math.min(1, bass * 2 + loudness * 1 + highs * 0.5);
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
        audioAnalysis.beatPhase = globalBeat;
        useAudioStore.getState().beatPhase = globalBeat;
      }

      // Drive R3F frame (frameloop="never" — runs all useFrame callbacks)
      sceneRegistry.advance?.(performance.now() / 1000);

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // React to file changes
  const audioObjectUrl = useAudioStore((s) => s.audioObjectUrl);
  useEffect(() => {
    if (!audioObjectUrl) {
      stop();
      audioRef.current?.pause();
      audioRef.current?.removeAttribute('src');
      audioRef.current?.load();
      return;
    }
    // Create a single persistent <audio> element
    if (!audioRef.current) {
      const a = new Audio();
      a.addEventListener('play', () => setPlayingRef.current(true));
      a.addEventListener('pause', () => setPlayingRef.current(false));
      a.addEventListener('ended', () => {
        setPlayingRef.current(false);
        // Reset to start so user can replay (avoids black screen)
        if (audioRef.current) audioRef.current.currentTime = 0;
      });
      a.addEventListener('timeupdate', () => {
        if (audioRef.current) setCurrentTimeRef.current(audioRef.current.currentTime);
      });
      audioRef.current = a;
    }
    audioRef.current.src = audioObjectUrl;
    connect(audioRef.current);
    start();
  }, [audioObjectUrl, connect, start, stop]);

  // Volume sync
  const volume = useAudioStore((s) => s.volume);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Seek event listener (from TransportBar seek slider)
  useEffect(() => {
    const handler = (e: Event) => {
      const time = (e as CustomEvent).detail?.time;
      if (typeof time === 'number' && audioRef.current) {
        audioRef.current.currentTime = Math.max(0, time);
      }
    };
    window.addEventListener('audiovisualizer:seek', handler);
    return () => window.removeEventListener('audiovisualizer:seek', handler);
  }, []);

  const play = useCallback(async () => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') await ctx.resume();
    // Make sure the rAF analysis loop is running (it may have been stopped
    // by a previous export — see stopAndPause / startAndPlay below).
    if (rafRef.current === null) start();
    await audioRef.current?.play();
  }, [start]);

  /**
   * User-facing pause: stops audio playback but KEEPS the rAF analysis loop
   * running so the visualizer still shows the last-frame waveform / beat
   * decay. Required for the TransportBar pause button — pausing visuals
   * completely would freeze the canvas, which is not what users want.
   */
  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  /**
   * Export-facing pause: stops the audio element AND the rAF analysis loop.
   * Required for export: while the export pipeline writes precomputed
   * FFT data into `audioAnalysis` per frame, the live rAF loop would
   * race it and overwrite the precomputed data with stale live-analyser
   * samples — corrupting the FreqBeatDetector state and breaking all
   * beat-driven animations in the rendered MP4.
   */
  const stopAndPause = useCallback(() => {
    audioRef.current?.pause();
    stop();
  }, [stop]);

  /**
   * Resume the rAF analysis loop + audio playback.
   * Symmetric counterpart to stopAndPause() — used after export finishes
   * to restore the live preview.
   */
  const startAndPlay = useCallback(async () => {
    if (rafRef.current === null) start();
    await audioRef.current?.play();
  }, [start]);

  const togglePlay = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) await play();
    else pause();
  }, [play, pause]);

  return {
    audioEl: audioRef.current,
    isPlaying: useAudioStore((s) => s.isPlaying),
    play,
    pause,
    togglePlay,
    /** Stop rAF loop + pause audio. Use before export to avoid race with the export pipeline. */
    stopAndPause,
    /** Start rAF loop + resume audio. Use after export to restore live preview. */
    startAndPlay,
    seek: (t: number) => {
      if (audioRef.current) audioRef.current.currentTime = Math.max(0, t);
    },
  };
}
