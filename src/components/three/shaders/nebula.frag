// Nebula fog shader — fBM simplex noise, audio-reactive
// Based on Ashima Arts simplex noise (MIT)

uniform float uTime;
uniform float uIntensity;
uniform float uDriftSpeed;
uniform float uAudioEnergy;
uniform float uAudioBass;
uniform vec3 uColor1;
uniform vec3 uColor2;

varying vec2 vUv;

// --- Simplex 2D noise (Ashima Arts) ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// fBM — 4 octaves
float fbm(vec2 p) {
  float f = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 4; i++) {
    f += amp * snoise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return f;
}

void main() {
  vec2 uv = vUv;

  // Drift with time
  float t = uTime * uDriftSpeed * 0.08;
  vec2 offset = vec2(t * 0.7, t * 0.5);

  // fBM noise at two scales
  float n1 = fbm(uv * 2.5 + offset);
  float n2 = fbm(uv * 4.0 - offset * 0.6 + vec2(5.2, 1.3));

  // Mix two noise layers
  float noise = n1 * 0.6 + n2 * 0.4;
  noise = noise * 0.5 + 0.5; // remap to 0..1

  // Audio-reactive density boost
  float audioBoost = 1.0 + uAudioEnergy * 1.5 + uAudioBass * 0.8;
  noise *= audioBoost;

  // Color blend between two nebula colors
  vec3 col = mix(uColor1, uColor2, n2 * 0.5 + 0.5);

  // Fade edges (vignette within nebula)
  float edgeFade = smoothstep(0.0, 0.3, uv.x) * smoothstep(1.0, 0.7, uv.x)
                 * smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.7, uv.y);

  float alpha = noise * uIntensity * edgeFade * 0.6;
  alpha = clamp(alpha, 0.0, 0.85);

  gl_FragColor = vec4(col, alpha);
}
