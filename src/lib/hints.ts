/**
 * hints.ts — Central repository for plain-language explanations.
 *
 * Each key is a setting path (e.g. 'background.blur') and the value is
 * the user-facing explanation text. Two additional maps cover
 * accordion descriptions and colorMode / enum explanations.
 *
 * STYLE GUIDE:
 * - Plain English, no jargon. Avoid "spectral flux", "Hz bin", "kernel",
 *   "shader", "chromatic aberration", "sigmoid", "FFT", "RGB multiply".
 * - Use analogies: "like Instagram's blur", "like a neon sign".
 * - Length: 1-2 sentences, 60-150 chars for per-setting hints.
 * - Start with what the user sees, NOT the technical mechanism.
 *   BAD:  "Applies a 2D Gaussian blur kernel to the texture."
 *   GOOD: "Softens the background. Try 10 for dreamy, 25+ for abstract."
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Per-setting hints: 'group.field' → plain-language explanation
// ─────────────────────────────────────────────────────────────────────────────
export const SETTING_HINTS: Record<string, string> = {

  // ── Background: Image ────────────────────────────────────────────────────
  'background.blur':
    'Softens the background image. 0 = crisp, 10 = soft focus, 25+ = strong dreamy blur.',
  'background.sharpen':
    'Boosts edge contrast. Use sparingly — too much looks gritty. Counteracts blur nicely at low values.',
  'background.brightness':
    'Makes the background lighter or darker. Lower it to let the bars stand out more.',
  'background.saturation':
    'How vivid the background colors are. 0 = black & white, 1 = normal, 2+ = hyper-saturated.',
  'background.contrast':
    'Widens the gap between light and dark areas. High contrast looks punchy and cinematic.',
  'background.hueShift':
    'Rotates all colors around the color wheel. 180° flips warm to cool, or vice versa.',

  // ── Background: Tint ─────────────────────────────────────────────────────
  'background.tintColor':
    'The color used for the tint wash. Pick something that matches your mood or brand.',
  'background.tintOpacity':
    'How strongly the tint covers the background. 0 = invisible, 1 = full color wash.',
  'background.tintMode':
    'How the tint color blends with the image. Multiply darkens; Screen brightens; Overlay is punchy.',

  // ── Background: Beat FX ──────────────────────────────────────────────────
  'background.beatFxFreqRange':
    'Which part of the audio drives the beat pulse. Lower = kick/bass, higher = snare/hi-hat.',
  'background.beatFxFreqStart':
    'Lowest frequency watched for the beat. 40 Hz catches kick drums and sub-bass.',
  'background.beatFxFreqEnd':
    'Highest frequency watched for the beat. 120 Hz keeps it to the kick range.',
  'background.beatFxSensitivity':
    'How easily the background reacts to a beat. Low = only loud hits; high = reacts to everything.',
  'background.scaleOnBeat':
    'How much the background zooms in on each beat. 0.05 is subtle; 0.3 is very bouncy.',

  // ── Background: Vignette ─────────────────────────────────────────────────
  'background.vignetteEnabled':
    'Darkens the corners of the frame, like an old photograph or cinema lens.',
  'background.vignetteStrength':
    'How dark the corner shadows are. 0.3 is barely noticeable; 1.0 is dramatic.',

  // ── Background: Nebula / Fog ─────────────────────────────────────────────
  'background.nebulaEnabled':
    'Adds a flowing fog layer that drifts and reacts to the music. Like a smoke machine.',
  'background.nebulaIntensity':
    'How opaque the fog is. Low values are a soft haze; high values fill the whole frame.',
  'background.nebulaColor1':
    'The first color in the fog gradient. Mixes with the second color as the fog drifts.',
  'background.nebulaColor2':
    'The second fog color. Try complementary colors (e.g. teal + purple) for a cosmic look.',
  'background.nebulaDriftSpeed':
    'How fast the fog moves across the frame. 0.1 = slow cloud drift; 1.0+ = swirling storm.',
  'background.nebulaReactivity':
    'How much the fog brightens and pulses with the music energy.',
  'background.nebulaScale':
    'Size of the fog patches. Small = fine wispy tendrils; large = big sweeping clouds.',
  'background.nebulaOffsetX':
    'Shifts the fog pattern left or right. Good for centering or off-centering the look.',
  'background.nebulaOffsetY':
    'Shifts the fog pattern up or down.',
  'background.nebulaBeatMode':
    'When on, the fog pulses sharply on beats instead of reacting to overall loudness.',
  'background.nebulaBeatFreqStart':
    'Lowest frequency that triggers the fog beat pulse.',
  'background.nebulaBeatFreqEnd':
    'Highest frequency that triggers the fog beat pulse.',
  'background.nebulaBeatSensitivity':
    'How sensitive the fog beat pulse is. Higher = reacts to quieter beats.',

  // ── Background: Glow FX (Bloom) ──────────────────────────────────────────
  'background.bloomEnabled':
    'Makes bright areas glow and bleed into the surrounding background, like a blown-out photo.',
  'background.bloomIntensity':
    'Strength of the glow bleed. 0.5 = subtle halo; 2.0 = everything glows intensely.',
  'background.bloomThreshold':
    'Minimum brightness needed to trigger the glow. Lower = more things glow.',

  // ── Background: Color FX ─────────────────────────────────────────────────
  'background.caEnabled':
    'Splits red and blue light slightly apart, like a cheap old camera lens or a glitch effect.',
  'background.caOffset':
    'How far the color channels split. 1-3 is subtle; 10+ is very noticeable.',
  'background.sepiaEnabled':
    'Tints the background warm golden-brown like a vintage photograph.',
  'background.sepiaIntensity':
    'How strongly the sepia tone is applied. 0 = no effect; 1 = full vintage brown.',
  'background.colorAverageEnabled':
    'Blends all background colors toward a single average tone. Creates a washed, dreamy look.',

  // ── Background: Noise ────────────────────────────────────────────────────
  'background.noiseEnabled':
    'Adds animated grain or texture to the background. Like film grain or a TV screen.',
  'background.noiseIntensity':
    'How strong the grain is. 0.1 = light film grain; 0.5+ = heavy texture.',
  'background.noiseSpeed':
    'How fast the grain animation plays. Higher = flickery and nervous.',
  'background.noiseScale':
    'Size of the grain texture. Low = fine dust; high = large blobs.',
  'background.noiseBeatBoost':
    'How much the grain spikes on each beat.',
  'background.noiseColorMode':
    'Whether the grain is gray (monochrome) or full color (rainbow static).',

  // ── Background: Scanlines ────────────────────────────────────────────────
  'background.scanlineEnabled':
    'Overlays horizontal lines like an old CRT TV screen.',
  'background.scanDensity':
    'How many scanlines per screen height. High = dense fine lines; low = chunky TV bars.',
  'background.scanScrollSpeed':
    'How fast the lines scroll down the screen. 0 = static; 1+ = animated rolling.',
  'background.scanThickness':
    'How thick each scanline is relative to the gap between them.',
  'background.scanBeatOpacity':
    'How much the scanlines flare brighter on each beat.',
  'background.scanBeatDensity':
    'How much more tightly the lines pack together on each beat.',

  // ── Background: Glitch ───────────────────────────────────────────────────
  'background.glitchEnabled':
    'Randomly shifts horizontal slices of the background, like a corrupted video signal.',
  'background.glitchDelay':
    'Average time between glitch flashes, in seconds. Lower = more frequent.',
  'background.glitchStrength':
    'How far each slice is displaced. Low = barely noticeable; high = dramatic tears.',
  'background.glitchRGBSplit':
    'Pulls the red and blue channels apart during a glitch. Adds color fringing.',
  'background.glitchBlockSize':
    'Height of each glitched slice. Large blocks look like VHS dropout.',
  'background.glitchBlockProb':
    'What fraction of slices glitch at once. 0.1 = only a few; 0.8 = chaos.',
  'background.glitchVertical':
    'Also glitches vertical columns, not just horizontal rows.',
  'background.glitchDecay':
    'How quickly the glitch fades. Fast = snap; slow = lingers.',
  'background.glitchBeatSync':
    'Triggers a glitch flash on every beat instead of randomly.',

  // ── Background: Pixelation ───────────────────────────────────────────────
  'background.pixelationEnabled':
    'Makes the background look like a retro low-res video game.',
  'background.pixelGranularity':
    'Pixel block size. 4-8 = mosaic; 16+ = chunky 8-bit look.',
  'background.pixelBeatSize':
    'How much the pixel blocks grow on each beat.',
  'background.pixelWave':
    'Adds a slow ripple to the pixelation, so blocks wobble like jelly.',
  'background.pixelWaveSpeed':
    'How fast the pixelation wave ripples.',

  // ── Background: Dot Screen ───────────────────────────────────────────────
  'background.dotScreenEnabled':
    'Replaces the background with a halftone dot pattern, like a newsprint photo.',
  'background.dotScale':
    'Size of the dots. Small = fine newspaper print; large = big bold circles.',
  'background.dotRotation':
    'Starting angle of the dot grid. 45° gives a classic halftone look.',
  'background.dotRotSpeed':
    'How fast the dot grid rotates. 0 = static; 0.5+ = spinning hypnotic grid.',
  'background.dotBeatScale':
    'How much the dots grow on each beat.',
  'background.dotColorSep':
    'Separates RGB dot channels slightly for a colorful halftone print effect.',

  // ── Background: Grid ─────────────────────────────────────────────────────
  'background.gridEnabled':
    'Overlays a glowing grid or graph-paper pattern over the background.',
  'background.gridScale':
    'How large each grid cell is. Small = dense matrix; large = few big squares.',
  'background.gridColor':
    'The color of the grid lines.',
  'background.gridPulseStrength':
    'How brightly the grid lines flare on each beat.',
  'background.gridWave':
    'Adds a ripple to the grid lines so they undulate with the music.',
  'background.gridWaveSpeed':
    'How fast the grid ripple moves.',
  'background.gridMovement':
    'Makes the grid slowly scroll or drift, giving a sci-fi floor effect.',

  // ── Background: Weather / BG Particles ───────────────────────────────────
  'background.bgParticlesEnabled':
    'Adds floating particles drifting behind everything else. Like dust motes in light.',
  'background.bgParticlesCount':
    'Number of floating particles. 50 = sparse; 300+ = thick swarm.',
  'background.bgParticlesSpeed':
    'How fast the particles drift. 0.5 = lazily floating; 3+ = streaking.',
  'background.bgParticlesSize':
    'Point size of each particle. 1-2 = fine dust; 5+ = large bright orbs.',
  'background.bgParticlesOpacity':
    'How visible the particles are. Lower for a very subtle effect.',
  'background.bgParticlesColor':
    'Color of the background particles.',
  'background.bgParticlesBeatFreqStart':
    'Lowest frequency that makes the particles burst on a beat.',
  'background.bgParticlesBeatFreqEnd':
    'Highest frequency that triggers the particle burst.',
  'background.bgParticlesBeatSensitivity':
    'How easily a beat triggers the particle burst.',

  // ── Background: Rain ─────────────────────────────────────────────────────
  'background.rainEnabled':
    'Adds falling rain streaks over the background.',
  'background.rainCount':
    'Number of rain streaks. 50 = drizzle; 300+ = downpour.',
  'background.rainSpeed':
    'How fast the rain falls. 1 = slow drizzle; 5+ = heavy shower.',
  'background.rainAngle':
    'Tilt of the rain streaks. 0° = straight down; 20° = wind-driven.',
  'background.rainLength':
    'Length of each streak. Short = droplets; long = long trailing lines.',
  'background.rainWidth':
    'Thickness of each streak.',
  'background.rainOpacity':
    'How visible the rain is against the background.',
  'background.rainColor':
    'Color of the rain streaks. White looks natural; neon looks sci-fi.',
  'background.rainBeatFreqStart':
    'Lowest frequency that makes rain briefly surge on a beat.',
  'background.rainBeatFreqEnd':
    'Highest frequency watched for the rain beat trigger.',
  'background.rainBeatSensitivity':
    'How easily a beat triggers the rain surge.',

  // ── Background: Snow ─────────────────────────────────────────────────────
  'background.snowEnabled':
    'Adds drifting snowflakes over the background.',
  'background.snowCount':
    'Number of snowflakes. 30 = gentle flurry; 200+ = blizzard.',
  'background.snowSpeed':
    'How fast the flakes fall.',
  'background.snowSize':
    'Size of each flake. 2-4 = fine; 8+ = big fluffy flakes.',
  'background.snowSway':
    'How much each flake sways left and right as it falls. 0 = straight down.',
  'background.snowOpacity':
    'Visibility of the snowflakes.',
  'background.snowColor':
    'Color of the flakes. White is classic; pale blue is cool and icy.',
  'background.snowBeatFreqStart':
    'Lowest frequency that makes the snow burst on a beat.',
  'background.snowBeatFreqEnd':
    'Highest frequency watched for the snow beat trigger.',
  'background.snowBeatSensitivity':
    'How easily a beat triggers the snow burst.',

  // ── Logo ──────────────────────────────────────────────────────────────────
  'logo.enabled':
    'Show or hide the circular logo at the center of the visualizer.',
  'logo.size':
    'Diameter of the logo on screen. 200 is a small badge; 600+ fills a lot of the frame.',
  'logo.opacity':
    'How transparent the logo is. 1 = fully opaque; 0.5 = semi-transparent ghostly look.',
  'logo.beatScaleStrength':
    'How much the logo "punches" bigger on each beat. 0.1 = subtle; 0.5 = very bouncy.',
  'logo.beatFxFreqStart':
    'Lowest frequency that makes the logo pulse. Keep this low (40-80 Hz) for kick-drum driven bouncing.',
  'logo.beatFxFreqEnd':
    'Highest frequency watched for the logo pulse.',
  'logo.beatFxSensitivity':
    'How sensitive the logo pulse is to quiet vs. loud beats.',

  // ── Logo: Outer Glow ─────────────────────────────────────────────────────
  'logo.outerGlowEnabled':
    'Adds a halo that radiates outward from the edge of the logo, like a neon light.',
  'logo.outerGlowIntensity':
    'Brightness of the outer halo. 0.3 = subtle ring; 1.5+ = blazing corona.',
  'logo.outerGlowSize':
    'How far the glow extends beyond the logo edge. Small = tight ring; large = wide aura.',
  'logo.outerGlowBlur':
    'Softness of the outer glow. High values spread it wide and smooth.',
  'logo.outerGlowColorMode':
    'How the outer glow color is chosen — static color, cycling rainbow, your custom palette, or random.',
  'logo.outerGlowColor':
    'The base color of the outer glow when Color Mode is set to Solid.',
  'logo.outerGlowCycleSpeed':
    'How fast the outer glow cycles through colors in Rainbow or Random mode.',
  'logo.outerGlowCustomColors':
    'Your custom palette for the outer glow. Add multiple colors for a gradient cycle.',

  // ── Logo: Inner Glow ─────────────────────────────────────────────────────
  'logo.innerGlowEnabled':
    'Adds a soft light that bleeds inward from the logo\'s edge toward its center.',
  'logo.innerGlowIntensity':
    'Brightness of the inner glow. 0.3 = a warm inner rim light; 1.0+ = strong fill.',
  'logo.innerGlowSize':
    'How far the glow reaches toward the center of the logo.',
  'logo.innerGlowBlur':
    'Softness of the inner glow falloff.',
  'logo.innerGlowColorMode':
    'How the inner glow color is chosen — static, rainbow, custom palette, or random.',
  'logo.innerGlowColor':
    'The base color of the inner glow when Color Mode is set to Solid.',
  'logo.innerGlowCycleSpeed':
    'How fast the inner glow cycles through colors in Rainbow or Random mode.',
  'logo.innerGlowCustomColors':
    'Your custom palette for the inner glow.',

  // ── Logo: Fire Ring ──────────────────────────────────────────────────────
  'logo.fireEnabled':
    'Wraps the logo in an animated fire ring that burns and flickers with the music.',
  'logo.fireIntensity':
    'Overall brightness and density of the fire.',
  'logo.fireHeight':
    'How tall the flames reach above the logo edge. 0.2 = small flicker; 0.8 = tall blaze.',
  'logo.fireSpeed':
    'Animation speed of the fire flicker. High = rapid crackling; low = slow gentle flame.',
  'logo.fireReactivity':
    'How much the fire surges in response to the audio.',
  'logo.fireColorInner':
    'Color at the hottest core of the flame (closest to the logo). Used in Gradient mode.',
  'logo.fireColorMid':
    'Mid-range flame color — the transition between inner and outer. Used in Gradient mode.',
  'logo.fireColorOuter':
    'Color at the tips of the flame (furthest from the logo). Used in Gradient mode.',
  'logo.fireColorMode':
    'Solid = one color for the whole flame. Gradient = 3-stop gradient from hot to cool. Rainbow = hue cycles around the ring. Random = random color per frame. Key = tinted by detected musical key. Band = tinted by the currently loudest frequency band.',
  'logo.fireSolidColor':
    'The single color used for the entire flame when Color mode = Solid.',
  'logo.fireFreqStart':
    'Lowest frequency that makes the fire surge on a beat.',
  'logo.fireFreqEnd':
    'Highest frequency watched for the fire beat trigger.',
  'logo.fireSensitivity':
    'How easily the fire reacts to quieter beats.',

  // ── Logo: Sparks ──────────────────────────────────────────────────────────
  'logo.sparksEnabled':
    'Adds a ring of glowing embers that fly out from the logo. On every kick a burst of extra sparks fires outward.',
  'logo.sparksCount':
    'How many sparks are in the ambient pool around the logo. More = denser look but slightly more GPU cost.',
  'logo.sparksSize':
    'How big each spark is. 0.5 = subtle, 1.5 = bold, 3.0 = dramatic. Bigger logo = bigger sparks.',
  'logo.sparksSpeed':
    'How fast the sparks fly outward from the logo. Higher = more energetic.',
  'logo.sparksBurstCount':
    'How many extra sparks fire on every kick. 0 = no bursts (ambient only), 50+ = dramatic bursts.',
  'logo.sparksLifetime':
    'How long each spark lives before fading. Short (0.4s) = sharp metallic feel. Long (2.5s) = lingering embers.',
  'logo.sparksGravity':
    'How strongly sparks fall after spawning. 0 = no gravity (float in space), 5+ = heavy drop.',
  'logo.sparksDrag':
    'Air resistance on the sparks. Higher = sparks slow down faster.',
  'logo.sparksSpread':
    'How wide the spawn angle is around the logo. 0° = all from one side, 90° = sparks from a quarter of the ring.',
  'logo.sparksColorHot':
    'Color of freshly spawned sparks (the white/yellow tip of the cooling gradient).',
  'logo.sparksColorMid':
    'Mid color in the cooling gradient — applied at ~50% through the spark\'s life.',
  'logo.sparksColorCool':
    'Color of sparks right before they die — the dark red end of the gradient.',
  'logo.sparksOpacity':
    'Overall brightness. Lower = ghostly, higher = punchy.',

  // ── Bars ──────────────────────────────────────────────────────────────────
  'bars.enabled':
    'Show or hide the circular frequency bars around the logo.',
  'bars.count':
    'Number of bars. 32 = chunky blocky look; 128 = smooth detailed ring; 256 = ultra-fine.',
  'bars.colorMode':
    'How bar colors are assigned — one color, rainbow, your own palette, or random.',
  'bars.solidColor':
    'The single color used for all bars when Color Mode is set to Solid.',
  'bars.customColors':
    'Your custom color zones. Each zone covers a frequency range and shows in its chosen color.',
  'bars.thickness':
    'Width of each bar. Thin bars look sleek; thick bars look bold and chunky.',
  'bars.gapSize':
    'Gap between adjacent bars. 0 = tightly packed; 0.5 = well spaced.',
  'bars.minHeight':
    'Minimum bar height even during silence. Keeps the ring visible between beats.',
  'bars.opacity':
    'Overall transparency of the bars.',
  'bars.freqStart':
    'Lowest frequency shown by the bars. Lowering this shows more sub-bass detail.',
  'bars.freqEnd':
    'Highest frequency shown by the bars. Raise for more treble detail.',
  'bars.rotationSpeed':
    'How fast the whole ring rotates. 0 = static; 0.5+ = slowly spinning wheel.',
  'bars.rotationOnBeat':
    'Gives the ring a speed kick on each beat, then it slows down again.',
  'bars.smoothing':
    'How quickly bars respond to changes. High = smooth rubbery motion; low = snappy.',
  'bars.innerRadius':
    'Distance from the center to the base of the bars. Larger = bars start further out.',
  'bars.lengthScale':
    'Maximum length of a bar at full volume. Scale up for dramatic tall spikes.',
  'bars.reactivity':
    'How dramatically bars respond to the audio amplitude.',
  'bars.peakEnabled':
    'Shows a small dot at the recent peak height of each bar, like a VU meter.',
  'bars.peakDecay':
    'How fast the peak dots drift down after a loud moment. Lower = slow drift.',
  'bars.beatFreqStart':
    'Lowest frequency used for the extra beat-boost height spike.',
  'bars.beatFreqEnd':
    'Highest frequency used for the beat-boost spike.',
  'bars.beatSensitivity':
    'How easily the beat-boost triggers. Higher = fires on quieter beats too.',

  // ── Particles ─────────────────────────────────────────────────────────────
  'particles.enabled':
    'Show or hide the particle cloud that orbits the logo.',
  'particles.count':
    'Number of particles in the swarm. 50 = sparse; 300+ = dense cloud.',
  'particles.colorMode':
    'How particle colors are assigned — one color, rainbow, custom palette, or random.',
  'particles.solidColor':
    'The single color of all particles when Color Mode is set to Solid.',
  'particles.customColors':
    'Your custom color zones for the particle swarm.',
  'particles.particleShape':
    'Shape of each particle — smooth dot, spiky star, or sharp diamond.',
  'particles.size':
    'Base size of each particle. 1 = tiny; 5+ = large visible shapes.',
  'particles.sizeOnBeat':
    'How much each particle briefly grows on a beat.',
  'particles.blendMode':
    'How particles layer on top of each other. Additive stacks brightness like glowing embers.',
  'particles.opacity':
    'Overall transparency of the particle swarm.',
  'particles.orbitRadius':
    'Distance from the logo center to the particle orbit ring.',
  'particles.orbitMode':
    'How particles move — a tight circle, an oval, or free-drifting scatter.',
  'particles.ellipseRatio':
    'Squash factor for elliptical orbit mode. 0.5 = very flat oval; 1.0 = circle.',
  'particles.speed':
    'How fast particles travel along their orbit.',
  'particles.spread':
    'How much particles spread out from their orbit path. High = loose fuzzy cloud.',
  'particles.kickBurstStrength':
    'On a kick/beat, particles shoot outward briefly. Higher = more dramatic burst.',
  'particles.reactiveFreqStart':
    'Lowest frequency that drives the particle color and size reaction.',
  'particles.reactiveFreqEnd':
    'Highest frequency that drives the particle reaction.',
  'particles.reactiveSensitivity':
    'How strongly particles react to the audio energy.',
  'particles.connectionLines':
    'Draws lines between nearby particles, like a network graph or constellation map.',
  'particles.connectionDistance':
    'How close two particles must be before a connection line appears.',
  'particles.connectionOpacity':
    'Transparency of the connection lines. Low = subtle web; high = bright grid.',
  'particles.twinkle':
    'Particles randomly fade in and out, like twinkling stars.',
  'particles.twinkleSpeed':
    'How fast the twinkling flicker is. High = rapid shimmer; low = slow breathing.',

  // ── Audio ─────────────────────────────────────────────────────────────────
  'audio.detectionMode':
    'Pre-computed analyses the whole song first for accurate BPM and beats. Live mode starts instantly.',
  'audio.preAnalysisProgress':
    'Analysis runs once when you load a song. Visualizer uses live detection until it finishes.',
  'audio.bpm':
    'Song tempo detected automatically. Read-only — used internally for beat timing.',
  'audio.key':
    'Musical key detected from the song (e.g. C#, F minor). Drives key-derived color modes.',
  'audio.scale':
    'Whether the song is major (bright) or minor (dark). Shown alongside the key.',
  'audio.keyInfluence':
    'How strongly the detected key shifts colors in key-derived and band-driven color modes.',
  'audio.globalBeatFreqStart':
    'Lowest frequency for the global beat trigger that drives most animations.',
  'audio.globalBeatFreqEnd':
    'Highest frequency for the global beat. 30-160 Hz is a good range for kick drums.',
  'audio.globalBeatSensitivity':
    'How easily the global beat fires. Lower = only loud punchy hits; higher = catches everything.',
  'audio.bandSensitivity.kick':
    'Gain multiplier for the kick drum band in pre-computed mode. 1.0 = normal.',
  'audio.bandSensitivity.snare':
    'Gain multiplier for the snare band. Boost if snare-driven animations feel sluggish.',
  'audio.bandSensitivity.vocal':
    'Gain multiplier for the vocal / mid-range band.',
  'audio.bandSensitivity.hihat':
    'Gain multiplier for the hi-hat / high-frequency band. Often needs a boost — hats are quiet.',
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Per-accordion section descriptions: section-key → 1-sentence overview
// ─────────────────────────────────────────────────────────────────────────────
export const ACCORDION_DESCRIPTIONS: Record<string, string> = {
  // Background tab
  'background.image':
    'Adjust sharpness, brightness, color tone, and overall look of your background image.',
  'background.tint':
    'Wash the whole background with a color — great for matching a mood: warm, cool, neon.',
  'background.beatFx':
    'Make the background zoom or pulse in time with the beat.',
  'background.vignette':
    'Darken the corners of the frame for a cinematic or vintage look.',
  'background.fog':
    'Add a drifting color fog layer — like a smoke machine on a concert stage.',
  'background.glow':
    'Make bright parts of the background bleed and glow (bloom effect).',
  'background.color':
    'Color distortion effects: color split, sepia tone, and color-averaging.',
  'background.effects':
    'Stylistic effects: grain, scanlines, glitch, pixelation, halftone dots, and grid overlay.',
  'background.weather':
    'Atmospheric particle effects: floating dust, falling rain, and drifting snow.',

  // Logo tab
  'logo.sparks':
    'Glowing embers and sparks that fly outward from the logo. Ambient pool + extra burst on every kick.',
  'logo.size':
    'Control the size and visibility of the logo, and how it bounces on the beat.',
  'logo.outerGlow':
    'A halo that radiates outward from the logo edge — color, size, and animation.',
  'logo.innerGlow':
    'A soft light that bleeds from the logo edge inward — like a rim light.',
  'logo.fire':
    'An animated fire ring that wraps the logo and reacts to the music.',
  'logo.animation':
    'Beat-reactive scale bounce — controls which frequencies trigger the logo pulse.',

  // Bars tab
  'bars.general':
    'Main bar settings: count, color mode, and opacity.',
  'bars.shape':
    'Bar dimensions: thickness, gap, minimum height, and frequency mapping.',
  'bars.frequency':
    'Which frequency range the bars display — set the low and high cutoff.',
  'bars.animation':
    'Bar motion: rotation speed, beat-triggered spin, and audio smoothing.',
  'bars.sizeRadius':
    'Distance from center and bar length — controls how big the ring looks.',
  'bars.peaks':
    'Peak-hold dots that float above each bar, like a classic VU meter.',
  'bars.beat':
    'Extra height spike triggered by a beat in a chosen frequency range.',

  // Particles tab
  'particles.general':
    'Main particle settings: count, color mode, and opacity.',
  'particles.shape':
    'Shape, size, and blending of each particle.',
  'particles.orbit':
    'How particles move: circular orbit, oval, or free scatter.',
  'particles.physics':
    'Audio reactivity: which frequencies drive particle size and color changes.',
  'particles.connections':
    'Lines drawn between nearby particles, forming a constellation or network.',
  'particles.flicker':
    'Random twinkling — particles fade in and out like distant stars.',

  // Audio tab
  'audio.detection':
    'Choose between fast live detection or the more accurate pre-computed analysis.',
  'audio.metadata':
    'BPM, key, and scale detected automatically from the song. Read-only.',
  'audio.bands':
    'Fine-tune how strongly each frequency band (kick, snare, vocal, hi-hat) drives animations.',
  'audio.keyInfluence':
    'How much the detected musical key shifts colors in key-derived color modes.',
  'audio.legacy':
    'Advanced: direct control over the global beat detector frequency range and sensitivity.',
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Enum / color-mode hints: 'group.field' → { enumValue → explanation }
// ─────────────────────────────────────────────────────────────────────────────
export const ENUM_HINTS: Record<string, Record<string, string>> = {

  'logo.fireColorMode': {
    'solid':       'One single color for the entire flame.',
    'gradient':    'Smooth 3-stop gradient from hot to cool. Set 3 colors below.',
    'rainbow':     'Hue cycles around the ring and slowly with time.',
    'random':      'Random color for each frame.',
    'key-derived': 'Color tinted by the detected musical key.',
    'band-driven': 'Color tinted by whichever frequency band is loudest right now.',
  },

  'background.tintMode': {
    'multiply':
      'Darkens the image and tints it. Most natural for warm or cool mood washes.',
    'overlay':
      'Strong contrast — light areas get lighter, dark get darker. Punchy and graphic.',
    'soft-light':
      'Softer than Overlay. Great for gentle, filmic color grading.',
    'screen':
      'Brightens the image. Use for neon glows and high-energy looks.',
  },

  'background.noiseColorMode': {
    'monochrome':
      'Gray grain, like film grain or a black-and-white photo.',
    'color':
      'Full-color static noise, like a broken TV or rainbow glitter.',
  },

  'bars.colorMode': {
    'solid':
      'All bars use one color. Clean, minimal, brand-safe.',
    'rainbow':
      'Bars cycle through the full color spectrum. Energetic, festival vibe.',
    'custom':
      'You pick the colors and which frequency ranges they cover. Most control.',
    'random':
      'Each bar gets a random color from a wide palette. Chaotic, playful.',
    'key-derived':
      'Colors come from the detected musical key of the song. Harmonious.',
    'band-driven':
      'Each bar\'s color reflects which part of the audio spectrum it represents.',
  },

  'particles.colorMode': {
    'solid':
      'All particles share one color. Calm and focused.',
    'rainbow':
      'Each particle cycles through the full color spectrum. Lively, ever-changing.',
    'custom':
      'You pick the colors and the frequency ranges they apply to.',
    'random':
      'Each particle gets a random color. Maximum variety.',
    'key-derived':
      'Colors come from the detected musical key. Harmonious with the song.',
    'band-driven':
      'Particles change color based on the frequency band they react to.',
  },

  'particles.particleShape': {
    'circle':
      'Smooth soft dots. Easy on the eyes, works with any style.',
    'star':
      'Spiky 5-point stars. Edgy, energetic, festival look.',
    'diamond':
      'Sharp angular shapes. Tech, glitch, or cyberpunk aesthetic.',
  },

  'particles.blendMode': {
    'additive':
      'Particles stack brighter where they overlap, like glowing embers or fireworks.',
    'normal':
      'Standard transparency. Particles naturally cover each other.',
  },

  'particles.orbitMode': {
    'circular':
      'Particles travel in a perfect circle around the logo.',
    'elliptical':
      'Oval orbit — slightly squashed. Adds perspective depth.',
    'scatter':
      'No orbit — particles drift freely in all directions. Most chaotic and organic.',
  },

  'logo.outerGlowColorMode': {
    'solid':
      'One glow color. Matches the logo or your brand color.',
    'rainbow':
      'Glow smoothly cycles through the color spectrum.',
    'custom':
      'You choose the palette — great for branded multi-color looks.',
    'random':
      'Color changes randomly each cycle. Wild and unpredictable.',
  },

  'logo.innerGlowColorMode': {
    'solid':
      'One glow color radiating inward from the logo edge.',
    'rainbow':
      'Inner glow cycles through the color spectrum.',
    'custom':
      'You choose the palette for the inner glow.',
    'random':
      'Inner glow color changes randomly.',
  },

  'audio.detectionMode': {
    'precomputed':
      'Analyses the full song first (BPM, key, beats). Most accurate, takes 5-15 s on load.',
    'live':
      'Detects beats live while playing. Starts instantly, slightly less precise.',
  },
};
