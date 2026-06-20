/**
 * HyperspeedEffect — R3F Render-to-Texture background effect.
 *
 * Renders a 3D night highway with streaking car lights into a
 * WebGLRenderTarget, then composites the result onto a full-screen
 * quad in the main R3F scene.
 *
 * Ported from reactbits.dev/backgrounds/hyperspeed (MIT license,
 * DavidHDev/react-bits). No own WebGLRenderer — uses `gl` from useFrame.
 *
 * Architecture:
 *   - Dedicated THREE.Scene + THREE.PerspectiveCamera for road scene
 *   - WebGLRenderTarget as intermediate buffer
 *   - Output ShaderMaterial applies beat-brightness and opacity
 *   - renderOrder set per-frame (never in JSX) for behindLogo
 *   - depthTest: false on output material
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioAnalysis } from '@/hooks/useAudioReactive';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import type { BlendMode } from '@/lib/settingsStore';
import { applyBlendMode } from '@/lib/blendMode';
import { FreqBeatDetector } from '@/lib/audioUtils';
import { useBeatDetectorRegistration } from './AudioScene';
import { usePhaseSource } from '@/hooks/usePhaseSource';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DistortionType =
  | 'turbulentDistortion'
  | 'mountainDistortion'
  | 'xyDistortion'
  | 'LongRaceDistortion'
  | 'deepDistortion'
  | 'turbulentDistortionStill'
  | 'deepDistortionStill';

interface DistortionObject {
  uniforms: Record<string, { value: THREE.Vector2 | THREE.Vector3 | THREE.Vector4 }>;
  getDistortion: string;
  getJS?: (progress: number, time: number) => THREE.Vector3;
}

interface HyperspeedOptions {
  length: number;
  roadWidth: number;
  islandWidth: number;
  lanesPerRoad: number;
  fov: number;
  carLightsFade: number;
  totalSideLightSticks: number;
  lightPairsPerRoadWay: number;
  shoulderLinesWidthPercentage: number;
  brokenLinesWidthPercentage: number;
  brokenLinesLengthPercentage: number;
  lightStickWidth:    [number, number];
  lightStickHeight:   [number, number];
  movingAwaySpeed:    [number, number];
  movingCloserSpeed:  [number, number];
  carLightsLength:    [number, number];
  carLightsRadius:    [number, number];
  carWidthPercentage: [number, number];
  carShiftX:          [number, number];
  carFloorSeparation: [number, number];
  distortion: DistortionObject;
  colors: {
    roadColor:    number;
    islandColor:  number;
    background:   number;
    shoulderLines: number;
    brokenLines:  number;
    leftCars:     number[];
    rightCars:    number[];
    sticks:       number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

const rnd = (base: number | [number, number]): number =>
  Array.isArray(base) ? Math.random() * (base[1] - base[0]) + base[0] : Math.random() * base;

function pickRandom<T>(arr: T | T[]): T {
  if (Array.isArray(arr)) return arr[Math.floor(Math.random() * arr.length)] as T;
  return arr;
}

const nsin = (val: number) => Math.sin(val) * 0.5 + 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Distortion uniforms (module-level, shared across rebuild cycles)
// ─────────────────────────────────────────────────────────────────────────────

const mountainUniforms = {
  uFreq: { value: new THREE.Vector3(3, 6, 10) },
  uAmp:  { value: new THREE.Vector3(30, 30, 20) },
};
const xyUniforms = {
  uFreq: { value: new THREE.Vector2(5, 2) },
  uAmp:  { value: new THREE.Vector2(25, 15) },
};
const longRaceUniforms = {
  uFreq: { value: new THREE.Vector2(2, 3) },
  uAmp:  { value: new THREE.Vector2(35, 10) },
};
const turbulentUniforms = {
  uFreq: { value: new THREE.Vector4(4, 8, 8, 1) },
  uAmp:  { value: new THREE.Vector4(25, 5, 10, 10) },
};
const deepUniforms = {
  uFreq: { value: new THREE.Vector2(4, 8) },
  uAmp:  { value: new THREE.Vector2(10, 20) },
  uPowY: { value: new THREE.Vector2(20, 2) },
};

// ─────────────────────────────────────────────────────────────────────────────
// Distortion definitions (all 7 types)
// ─────────────────────────────────────────────────────────────────────────────

const DISTORTIONS: Record<DistortionType, DistortionObject> = {

  mountainDistortion: {
    uniforms: mountainUniforms,
    getDistortion: `
      uniform vec3 uAmp;
      uniform vec3 uFreq;
      #define PI 3.14159265358979
      float nsin(float val){ return sin(val) * 0.5 + 0.5; }
      vec3 getDistortion(float progress){
        float movementProgressFix = 0.02;
        return vec3(
          cos(progress * PI * uFreq.x + uTime) * uAmp.x - cos(movementProgressFix * PI * uFreq.x + uTime) * uAmp.x,
          nsin(progress * PI * uFreq.y + uTime) * uAmp.y - nsin(movementProgressFix * PI * uFreq.y + uTime) * uAmp.y,
          nsin(progress * PI * uFreq.z + uTime) * uAmp.z - nsin(movementProgressFix * PI * uFreq.z + uTime) * uAmp.z
        );
      }
    `,
    getJS: (progress, time) => {
      const fix = 0.02;
      const f = mountainUniforms.uFreq.value;
      const a = mountainUniforms.uAmp.value;
      const d = new THREE.Vector3(
        Math.cos(progress * Math.PI * f.x + time) * a.x - Math.cos(fix * Math.PI * f.x + time) * a.x,
        nsin(progress * Math.PI * f.y + time) * a.y - nsin(fix * Math.PI * f.y + time) * a.y,
        nsin(progress * Math.PI * f.z + time) * a.z - nsin(fix * Math.PI * f.z + time) * a.z,
      );
      return d.multiply(new THREE.Vector3(2, 2, 2)).add(new THREE.Vector3(0, 0, -5));
    },
  },

  xyDistortion: {
    uniforms: xyUniforms,
    getDistortion: `
      uniform vec2 uFreq;
      uniform vec2 uAmp;
      #define PI 3.14159265358979
      vec3 getDistortion(float progress){
        float movementProgressFix = 0.02;
        return vec3(
          cos(progress * PI * uFreq.x + uTime) * uAmp.x - cos(movementProgressFix * PI * uFreq.x + uTime) * uAmp.x,
          sin(progress * PI * uFreq.y + PI/2. + uTime) * uAmp.y - sin(movementProgressFix * PI * uFreq.y + PI/2. + uTime) * uAmp.y,
          0.
        );
      }
    `,
    getJS: (progress, time) => {
      const fix = 0.02;
      const f = xyUniforms.uFreq.value;
      const a = xyUniforms.uAmp.value;
      const d = new THREE.Vector3(
        Math.cos(progress * Math.PI * f.x + time) * a.x - Math.cos(fix * Math.PI * f.x + time) * a.x,
        Math.sin(progress * Math.PI * f.y + time + Math.PI / 2) * a.y - Math.sin(fix * Math.PI * f.y + time + Math.PI / 2) * a.y,
        0,
      );
      return d.multiply(new THREE.Vector3(2, 0.4, 1)).add(new THREE.Vector3(0, 0, -3));
    },
  },

  LongRaceDistortion: {
    uniforms: longRaceUniforms,
    getDistortion: `
      uniform vec2 uFreq;
      uniform vec2 uAmp;
      #define PI 3.14159265358979
      vec3 getDistortion(float progress){
        float camProgress = 0.0125;
        return vec3(
          sin(progress * PI * uFreq.x + uTime) * uAmp.x - sin(camProgress * PI * uFreq.x + uTime) * uAmp.x,
          sin(progress * PI * uFreq.y + uTime) * uAmp.y - sin(camProgress * PI * uFreq.y + uTime) * uAmp.y,
          0.
        );
      }
    `,
    getJS: (progress, time) => {
      const fix = 0.0125;
      const f = longRaceUniforms.uFreq.value;
      const a = longRaceUniforms.uAmp.value;
      const d = new THREE.Vector3(
        Math.sin(progress * Math.PI * f.x + time) * a.x - Math.sin(fix * Math.PI * f.x + time) * a.x,
        Math.sin(progress * Math.PI * f.y + time) * a.y - Math.sin(fix * Math.PI * f.y + time) * a.y,
        0,
      );
      return d.multiply(new THREE.Vector3(1, 1, 0)).add(new THREE.Vector3(0, 0, -5));
    },
  },

  turbulentDistortion: {
    uniforms: turbulentUniforms,
    getDistortion: `
      uniform vec4 uFreq;
      uniform vec4 uAmp;
      float nsin(float val){ return sin(val) * 0.5 + 0.5; }
      #define PI 3.14159265358979
      float getDistortionX(float progress){
        return (
          cos(PI * progress * uFreq.r + uTime) * uAmp.r +
          pow(cos(PI * progress * uFreq.g + uTime * (uFreq.g / uFreq.r)), 2.) * uAmp.g
        );
      }
      float getDistortionY(float progress){
        return (
          -nsin(PI * progress * uFreq.b + uTime) * uAmp.b +
          -pow(nsin(PI * progress * uFreq.a + uTime / (uFreq.b / uFreq.a)), 5.) * uAmp.a
        );
      }
      vec3 getDistortion(float progress){
        return vec3(
          getDistortionX(progress) - getDistortionX(0.0125),
          getDistortionY(progress) - getDistortionY(0.0125),
          0.
        );
      }
    `,
    getJS: (progress, time) => {
      const f = turbulentUniforms.uFreq.value;
      const a = turbulentUniforms.uAmp.value;
      const getX = (p: number) =>
        Math.cos(Math.PI * p * f.x + time) * a.x +
        Math.pow(Math.cos(Math.PI * p * f.y + time * (f.y / f.x)), 2) * a.y;
      const getY = (p: number) =>
        -nsin(Math.PI * p * f.z + time) * a.z -
        Math.pow(nsin(Math.PI * p * f.w + time / (f.z / f.w)), 5) * a.w;
      const d = new THREE.Vector3(
        getX(progress) - getX(progress + 0.007),
        getY(progress) - getY(progress + 0.007),
        0,
      );
      return d.multiply(new THREE.Vector3(-2, -5, 0)).add(new THREE.Vector3(0, 0, -10));
    },
  },

  turbulentDistortionStill: {
    uniforms: turbulentUniforms,
    getDistortion: `
      uniform vec4 uFreq;
      uniform vec4 uAmp;
      float nsin(float val){ return sin(val) * 0.5 + 0.5; }
      #define PI 3.14159265358979
      float getDistortionX(float progress){
        return (
          cos(PI * progress * uFreq.r) * uAmp.r +
          pow(cos(PI * progress * uFreq.g * (uFreq.g / uFreq.r)), 2.) * uAmp.g
        );
      }
      float getDistortionY(float progress){
        return (
          -nsin(PI * progress * uFreq.b) * uAmp.b +
          -pow(nsin(PI * progress * uFreq.a / (uFreq.b / uFreq.a)), 5.) * uAmp.a
        );
      }
      vec3 getDistortion(float progress){
        return vec3(
          getDistortionX(progress) - getDistortionX(0.02),
          getDistortionY(progress) - getDistortionY(0.02),
          0.
        );
      }
    `,
    // no getJS — camera looks straight ahead
  },

  deepDistortionStill: {
    uniforms: deepUniforms,
    getDistortion: `
      uniform vec2 uFreq;
      uniform vec2 uAmp;
      uniform vec2 uPowY;
      float nsin(float val){ return sin(val) * 0.5 + 0.5; }
      #define PI 3.14159265358979
      float getDistortionX(float progress){ return ( sin(progress * PI * uFreq.x) * uAmp.x * 2. ); }
      float getDistortionY(float progress){ return ( pow(abs(progress * uPowY.x), uPowY.y) + sin(progress * PI * uFreq.y) * uAmp.y ); }
      vec3 getDistortion(float progress){
        return vec3(
          getDistortionX(progress) - getDistortionX(0.02),
          getDistortionY(progress) - getDistortionY(0.05),
          0.
        );
      }
    `,
    // no getJS
  },

  deepDistortion: {
    uniforms: deepUniforms,
    getDistortion: `
      uniform vec2 uFreq;
      uniform vec2 uAmp;
      uniform vec2 uPowY;
      float nsin(float val){ return sin(val) * 0.5 + 0.5; }
      #define PI 3.14159265358979
      float getDistortionX(float progress){ return ( sin(progress * PI * uFreq.x + uTime) * uAmp.x ); }
      float getDistortionY(float progress){ return ( pow(abs(progress * uPowY.x), uPowY.y) + sin(progress * PI * uFreq.y + uTime) * uAmp.y ); }
      vec3 getDistortion(float progress){
        return vec3(
          getDistortionX(progress) - getDistortionX(0.02),
          getDistortionY(progress) - getDistortionY(0.02),
          0.
        );
      }
    `,
    getJS: (progress, time) => {
      const f = deepUniforms.uFreq.value;
      const a = deepUniforms.uAmp.value;
      const p = deepUniforms.uPowY.value;
      const getX = (t: number) => Math.sin(t * Math.PI * f.x + time) * a.x;
      const getY = (t: number) => Math.pow(t * p.x, p.y) + Math.sin(t * Math.PI * f.y + time) * a.y;
      const d = new THREE.Vector3(
        getX(progress) - getX(progress + 0.01),
        getY(progress) - getY(progress + 0.01),
        0,
      );
      return d.multiply(new THREE.Vector3(-2, -4, 0)).add(new THREE.Vector3(0, 0, -10));
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shaders (template literals evaluated at module load — same as original JS)
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable prefer-template */
const CAR_LIGHTS_FRAG = [
  '#define USE_FOG;',
  THREE.ShaderChunk['fog_pars_fragment'],
  'varying vec3 vColor;',
  'varying vec2 vUv;',
  'uniform vec2 uFade;',
  'void main() {',
  '  vec3 color = vec3(vColor);',
  '  float alpha = smoothstep(uFade.x, uFade.y, vUv.x);',
  '  gl_FragColor = vec4(color, alpha);',
  '  if (gl_FragColor.a < 0.0001) discard;',
  THREE.ShaderChunk['fog_fragment'],
  '}',
].join('\n');

const CAR_LIGHTS_VERT = [
  '#define USE_FOG;',
  THREE.ShaderChunk['fog_pars_vertex'],
  'attribute vec3 aOffset;',
  'attribute vec3 aMetrics;',
  'attribute vec3 aColor;',
  'uniform float uTravelLength;',
  'uniform float uTime;',
  'varying vec2 vUv;',
  'varying vec3 vColor;',
  '#include <getDistortion_vertex>',
  'void main() {',
  '  vec3 transformed = position.xyz;',
  '  float radius = aMetrics.r;',
  '  float myLength = aMetrics.g;',
  '  float speed = aMetrics.b;',
  '  transformed.xy *= radius;',
  '  transformed.z *= myLength;',
  '  transformed.z += myLength - mod(uTime * speed + aOffset.z, uTravelLength);',
  '  transformed.xy += aOffset.xy;',
  '  float progress = abs(transformed.z / uTravelLength);',
  '  transformed.xyz += getDistortion(progress);',
  '  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  vUv = uv;',
  '  vColor = aColor;',
  THREE.ShaderChunk['fog_vertex'],
  '}',
].join('\n');

const SIDE_STICKS_VERT = [
  '#define USE_FOG;',
  THREE.ShaderChunk['fog_pars_vertex'],
  'attribute float aOffset;',
  'attribute vec3 aColor;',
  'attribute vec2 aMetrics;',
  'uniform float uTravelLength;',
  'uniform float uTime;',
  'varying vec3 vColor;',
  'mat4 rotationY( in float angle ) {',
  '  return mat4( cos(angle), 0, sin(angle), 0,',
  '               0, 1.0, 0, 0,',
  '               -sin(angle), 0, cos(angle), 0,',
  '               0, 0, 0, 1);',
  '}',
  '#include <getDistortion_vertex>',
  'void main(){',
  '  vec3 transformed = position.xyz;',
  '  float width = aMetrics.x;',
  '  float height = aMetrics.y;',
  '  transformed.xy *= vec2(width, height);',
  '  float time = mod(uTime * 60. * 2. + aOffset, uTravelLength);',
  '  transformed = (rotationY(3.14/2.) * vec4(transformed,1.)).xyz;',
  '  transformed.z += -uTravelLength + time;',
  '  float progress = abs(transformed.z / uTravelLength);',
  '  transformed.xyz += getDistortion(progress);',
  '  transformed.y += height / 2.;',
  '  transformed.x += -width / 2.;',
  '  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  vColor = aColor;',
  THREE.ShaderChunk['fog_vertex'],
  '}',
].join('\n');

const SIDE_STICKS_FRAG = [
  '#define USE_FOG;',
  THREE.ShaderChunk['fog_pars_fragment'],
  'varying vec3 vColor;',
  'void main(){',
  '  vec3 color = vec3(vColor);',
  '  gl_FragColor = vec4(color, 1.);',
  THREE.ShaderChunk['fog_fragment'],
  '}',
].join('\n');

const ROAD_VERT = [
  '#define USE_FOG;',
  'uniform float uTime;',
  THREE.ShaderChunk['fog_pars_vertex'],
  'uniform float uTravelLength;',
  'varying vec2 vUv;',
  '#include <getDistortion_vertex>',
  'void main() {',
  '  vec3 transformed = position.xyz;',
  '  vec3 distortion = getDistortion((transformed.y + uTravelLength / 2.) / uTravelLength);',
  '  transformed.x += distortion.x;',
  '  transformed.z += distortion.y;',
  '  transformed.y += -1. * distortion.z;',
  '  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.);',
  '  gl_Position = projectionMatrix * mvPosition;',
  '  vUv = uv;',
  THREE.ShaderChunk['fog_vertex'],
  '}',
].join('\n');

const ROAD_MARKINGS_VARS = `
  uniform float uLanes;
  uniform vec3 uBrokenLinesColor;
  uniform vec3 uShoulderLinesColor;
  uniform float uShoulderLinesWidthPercentage;
  uniform float uBrokenLinesWidthPercentage;
  uniform float uBrokenLinesLengthPercentage;
  highp float hsp_random2(vec2 co) {
    highp float a = 12.9898;
    highp float b = 78.233;
    highp float c = 43758.5453;
    highp float dt = dot(co.xy, vec2(a, b));
    highp float sn = mod(dt, 3.14);
    return fract(sin(sn) * c);
  }
`;

const ROAD_MARKINGS_FRAG = `
  uv.y = mod(uv.y + uTime * 0.05, 1.);
  float laneWidth = 1.0 / uLanes;
  float brokenLineWidth = laneWidth * uBrokenLinesWidthPercentage;
  float laneEmptySpace = 1. - uBrokenLinesLengthPercentage;
  float brokenLines = step(1.0 - brokenLineWidth, fract(uv.x * 2.0)) * step(laneEmptySpace, fract(uv.y * 10.0));
  float sideLines = step(1.0 - brokenLineWidth, fract((uv.x - laneWidth * (uLanes - 1.0)) * 2.0)) + step(brokenLineWidth, uv.x);
  brokenLines = mix(brokenLines, sideLines, uv.x);
`;

const ROAD_BASE_FRAG = [
  '#define USE_FOG;',
  'varying vec2 vUv;',
  'uniform vec3 uColor;',
  'uniform float uTime;',
  '#include <roadMarkings_vars>',
  THREE.ShaderChunk['fog_pars_fragment'],
  'void main() {',
  '  vec2 uv = vUv;',
  '  vec3 color = vec3(uColor);',
  '  #include <roadMarkings_fragment>',
  '  gl_FragColor = vec4(color, 1.);',
  THREE.ShaderChunk['fog_fragment'],
  '}',
].join('\n');

const ISLAND_FRAG = ROAD_BASE_FRAG
  .replace('#include <roadMarkings_fragment>', '')
  .replace('#include <roadMarkings_vars>', '');

const ROAD_FRAG = ROAD_BASE_FRAG
  .replace('#include <roadMarkings_fragment>', ROAD_MARKINGS_FRAG)
  .replace('#include <roadMarkings_vars>', ROAD_MARKINGS_VARS);
/* eslint-enable prefer-template */

// ─────────────────────────────────────────────────────────────────────────────
// Output shaders (main R3F scene quad)
// ─────────────────────────────────────────────────────────────────────────────

const OUTPUT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const OUTPUT_FRAG = /* glsl */`
  uniform sampler2D uTexture;
  uniform float uOpacity;
  uniform float uBeat;
  uniform float uBeatBoost;
  varying vec2 vUv;
  void main() {
    vec4 hsp_color = texture2D(uTexture, vUv);
    hsp_color.rgb *= (1.0 + uBeat * uBeatBoost);
    gl_FragColor = vec4(hsp_color.rgb, hsp_color.a * uOpacity);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// CarLights class
// ─────────────────────────────────────────────────────────────────────────────

type FogUniforms = Record<string, { value: unknown }>;

class CarLights {
  private options: HyperspeedOptions;
  private colors:  number[];
  private speed:   [number, number];
  private fade:    THREE.Vector2;
  private fog:     FogUniforms;
  mesh!: THREE.Mesh;

  constructor(fog: FogUniforms, options: HyperspeedOptions, colors: number[], speed: [number, number], fade: THREE.Vector2) {
    this.fog     = fog;
    this.options = options;
    this.colors  = colors;
    this.speed   = speed;
    this.fade    = fade;
  }

  init(scene: THREE.Scene) {
    const o = this.options;
    const curve   = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
    const baseGeo = new THREE.TubeGeometry(curve, 40, 1, 8, false);
    const instanced = new THREE.InstancedBufferGeometry().copy(baseGeo as unknown as THREE.InstancedBufferGeometry);
    baseGeo.dispose();
    instanced.instanceCount = o.lightPairsPerRoadWay * 2;

    const laneWidth = o.roadWidth / o.lanesPerRoad;
    const aOffset:  number[] = [];
    const aMetrics: number[] = [];
    const aColor:   number[] = [];
    const threeColors = this.colors.map(c => new THREE.Color(c));

    for (let i = 0; i < o.lightPairsPerRoadWay; i++) {
      const radius   = rnd(o.carLightsRadius);
      const length   = rnd(o.carLightsLength);
      const spd      = rnd(this.speed);
      const carLane  = i % o.lanesPerRoad;
      let   laneX    = carLane * laneWidth - o.roadWidth / 2 + laneWidth / 2;
      const carWidth = rnd(o.carWidthPercentage) * laneWidth;
      laneX += rnd(o.carShiftX) * laneWidth;
      const offsetY  = rnd(o.carFloorSeparation) + radius * 1.3;
      const offsetZ  = -rnd(o.length);

      aOffset.push(laneX - carWidth / 2, offsetY, offsetZ);
      aOffset.push(laneX + carWidth / 2, offsetY, offsetZ);
      aMetrics.push(radius, length, spd);
      aMetrics.push(radius, length, spd);
      const col = pickRandom(threeColors);
      aColor.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }

    instanced.setAttribute('aOffset',  new THREE.InstancedBufferAttribute(new Float32Array(aOffset),  3, false));
    instanced.setAttribute('aMetrics', new THREE.InstancedBufferAttribute(new Float32Array(aMetrics), 3, false));
    instanced.setAttribute('aColor',   new THREE.InstancedBufferAttribute(new Float32Array(aColor),   3, false));

    const mat = new THREE.ShaderMaterial({
      fragmentShader: CAR_LIGHTS_FRAG,
      vertexShader:   CAR_LIGHTS_VERT,
      transparent:    true,
      uniforms: {
        uTime:         { value: 0 },
        uTravelLength: { value: o.length },
        uFade:         { value: this.fade },
        ...this.fog,
        ...o.distortion.uniforms,
      },
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <getDistortion_vertex>',
        o.distortion.getDistortion,
      );
    };

    this.mesh = new THREE.Mesh(instanced, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time: number) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  }

  dispose(scene: THREE.Scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.ShaderMaterial).dispose();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LightsSticks class
// ─────────────────────────────────────────────────────────────────────────────

class LightsSticks {
  private options: HyperspeedOptions;
  private fog:     FogUniforms;
  mesh!: THREE.Mesh;

  constructor(fog: FogUniforms, options: HyperspeedOptions) {
    this.fog     = fog;
    this.options = options;
  }

  init(scene: THREE.Scene) {
    const o = this.options;
    const baseGeo   = new THREE.PlaneGeometry(1, 1);
    const instanced = new THREE.InstancedBufferGeometry().copy(baseGeo as unknown as THREE.InstancedBufferGeometry);
    baseGeo.dispose();
    const total = o.totalSideLightSticks;
    instanced.instanceCount = total;

    const stickOffset = o.length / (total - 1);
    const aOffset:  number[] = [];
    const aColor:   number[] = [];
    const aMetrics: number[] = [];
    const threeColor = new THREE.Color(o.colors.sticks);

    for (let i = 0; i < total; i++) {
      aOffset.push((i - 1) * stickOffset * 2 + stickOffset * Math.random());
      aColor.push(threeColor.r, threeColor.g, threeColor.b);
      aMetrics.push(rnd(o.lightStickWidth), rnd(o.lightStickHeight));
    }

    instanced.setAttribute('aOffset',  new THREE.InstancedBufferAttribute(new Float32Array(aOffset),  1, false));
    instanced.setAttribute('aColor',   new THREE.InstancedBufferAttribute(new Float32Array(aColor),   3, false));
    instanced.setAttribute('aMetrics', new THREE.InstancedBufferAttribute(new Float32Array(aMetrics), 2, false));

    const mat = new THREE.ShaderMaterial({
      fragmentShader: SIDE_STICKS_FRAG,
      vertexShader:   SIDE_STICKS_VERT,
      side:           THREE.DoubleSide,
      uniforms: {
        uTravelLength: { value: o.length },
        uTime:         { value: 0 },
        ...this.fog,
        ...o.distortion.uniforms,
      },
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <getDistortion_vertex>',
        o.distortion.getDistortion,
      );
    };

    this.mesh = new THREE.Mesh(instanced, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time: number) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  }

  dispose(scene: THREE.Scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.ShaderMaterial).dispose();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Road class
// ─────────────────────────────────────────────────────────────────────────────

class Road {
  private options:  HyperspeedOptions;
  private fog:      FogUniforms;
  private uTime = { value: 0 };
  leftRoadWay!:  THREE.Mesh;
  rightRoadWay!: THREE.Mesh;
  island!:       THREE.Mesh;

  constructor(fog: FogUniforms, options: HyperspeedOptions) {
    this.fog     = fog;
    this.options = options;
  }

  private createPlane(side: number, isRoad: boolean, scene: THREE.Scene): THREE.Mesh {
    const o = this.options;
    const geo = new THREE.PlaneGeometry(
      isRoad ? o.roadWidth : o.islandWidth,
      o.length,
      20,
      100,
    );

    let uniforms: FogUniforms = {
      uTravelLength: { value: o.length },
      uColor:        { value: new THREE.Color(isRoad ? o.colors.roadColor : o.colors.islandColor) },
      uTime:         this.uTime,
    };

    if (isRoad) {
      uniforms = {
        ...uniforms,
        uLanes:                        { value: o.lanesPerRoad },
        uBrokenLinesColor:             { value: new THREE.Color(o.colors.brokenLines) },
        uShoulderLinesColor:           { value: new THREE.Color(o.colors.shoulderLines) },
        uShoulderLinesWidthPercentage: { value: o.shoulderLinesWidthPercentage },
        uBrokenLinesLengthPercentage:  { value: o.brokenLinesLengthPercentage },
        uBrokenLinesWidthPercentage:   { value: o.brokenLinesWidthPercentage },
      };
    }

    const mat = new THREE.ShaderMaterial({
      fragmentShader: isRoad ? ROAD_FRAG : ISLAND_FRAG,
      vertexShader:   ROAD_VERT,
      side:           THREE.DoubleSide,
      uniforms: { ...uniforms, ...this.fog, ...o.distortion.uniforms },
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <getDistortion_vertex>',
        o.distortion.getDistortion,
      );
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x  = -Math.PI / 2;
    mesh.position.z  = -o.length / 2;
    mesh.position.x += (o.islandWidth / 2 + o.roadWidth / 2) * side;
    scene.add(mesh);
    return mesh;
  }

  init(scene: THREE.Scene) {
    this.leftRoadWay  = this.createPlane(-1, true,  scene);
    this.rightRoadWay = this.createPlane(1,  true,  scene);
    this.island       = this.createPlane(0,  false, scene);
  }

  update(time: number) {
    this.uTime.value = time;
  }

  dispose(scene: THREE.Scene) {
    [this.leftRoadWay, this.rightRoadWay, this.island].forEach(m => {
      if (m) {
        scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.ShaderMaterial).dispose();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HyperspeedScene — owns the 3D scene, camera, and geometry
// Does NOT own a WebGLRenderer
// ─────────────────────────────────────────────────────────────────────────────

class HyperspeedScene {
  scene:  THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private clock:          THREE.Clock;
  private road:           Road;
  private leftCarLights:  CarLights;
  private rightCarLights: CarLights;
  private leftSticks:     LightsSticks;
  private options:        HyperspeedOptions;
  timeOffset = 0;

  constructor(options: HyperspeedOptions) {
    this.options = options;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    const fog = new THREE.Fog(
      options.colors.background,
      options.length * 0.2,
      options.length * 500,
    );
    this.scene.fog = fog;

    const fogUniforms: FogUniforms = {
      fogColor: { value: (fog as THREE.Fog).color },
      fogNear:  { value: (fog as THREE.Fog).near },
      fogFar:   { value: (fog as THREE.Fog).far },
    };

    this.camera = new THREE.PerspectiveCamera(options.fov, 1, 0.1, 10000);
    this.camera.position.set(0, 8, -5);

    this.clock = new THREE.Clock();

    this.road           = new Road(fogUniforms, options);
    this.leftCarLights  = new CarLights(fogUniforms, options, options.colors.leftCars, options.movingAwaySpeed, new THREE.Vector2(0, 1 - options.carLightsFade));
    this.rightCarLights = new CarLights(fogUniforms, options, options.colors.rightCars, options.movingCloserSpeed, new THREE.Vector2(1, 0 + options.carLightsFade));
    this.leftSticks     = new LightsSticks(fogUniforms, options);
  }

  init() {
    const o = this.options;
    this.road.init(this.scene);
    this.leftCarLights.init(this.scene);
    this.leftCarLights.mesh.position.setX(-o.roadWidth / 2 - o.islandWidth / 2);
    this.rightCarLights.init(this.scene);
    this.rightCarLights.mesh.position.setX(o.roadWidth / 2 + o.islandWidth / 2);
    this.leftSticks.init(this.scene);
    this.leftSticks.mesh.position.setX(-(o.roadWidth + o.islandWidth / 2));
  }

  update(delta: number) {
    this.timeOffset += delta;
    const time = this.clock.elapsedTime + this.timeOffset;
    this.rightCarLights.update(time);
    this.leftCarLights.update(time);
    this.leftSticks.update(time);
    this.road.update(time);
    if (this.options.distortion.getJS) {
      const d = this.options.distortion.getJS(0.025, time);
      this.camera.lookAt(new THREE.Vector3(
        this.camera.position.x + d.x,
        this.camera.position.y + d.y,
        this.camera.position.z + d.z,
      ));
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.road.dispose(this.scene);
    this.leftCarLights.dispose(this.scene);
    this.rightCarLights.dispose(this.scene);
    this.leftSticks.dispose(this.scene);
    this.scene.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React component
// ─────────────────────────────────────────────────────────────────────────────

const _prevClearColor = new THREE.Color();

export function HyperspeedEffect() {
  const meshRef      = useRef<THREE.Mesh>(null!);
  const matRef       = useRef<THREE.ShaderMaterial>(null!);
  const rtRef        = useRef<THREE.WebGLRenderTarget | null>(null);
  const sceneRef     = useRef<HyperspeedScene | null>(null);
  const prevBlendRef = useRef<BlendMode | null>(null);
  const prevKeyRef   = useRef<string>('');

  // ── Beat detection ────────────────────────────────────────────────────────
  const detector = useMemo(() => new FreqBeatDetector(48000), []);
  useBeatDetectorRegistration(detector);

  const phaseSrc = usePhaseSource({
    detector,
    getPrecomputedRange: () => {
      const bg = getSettings().background;
      return {
        startHz: bg.hyperspeedBeatFreqStart ?? DEFAULT_SETTINGS.background.hyperspeedBeatFreqStart,
        endHz:   bg.hyperspeedBeatFreqEnd   ?? DEFAULT_SETTINGS.background.hyperspeedBeatFreqEnd,
      };
    },
    liveFn: () => {
      const bg = getSettings().background;
      detector.setSensitivity(
        bg.hyperspeedBeatSensitivity ?? DEFAULT_SETTINGS.background.hyperspeedBeatSensitivity,
      );
      return detector.update(
        audioAnalysis.rawFreqData,
        bg.hyperspeedBeatFreqStart ?? DEFAULT_SETTINGS.background.hyperspeedBeatFreqStart,
        bg.hyperspeedBeatFreqEnd   ?? DEFAULT_SETTINGS.background.hyperspeedBeatFreqEnd,
      );
    },
  });
  const phaseSrcRef = useRef(phaseSrc);
  phaseSrcRef.current = phaseSrc;

  // ── Output uniforms ───────────────────────────────────────────────────────
  const uniforms = useMemo(() => ({
    uTexture:   { value: null as THREE.Texture | null },
    uOpacity:   { value: 1.0 },
    uBeat:      { value: 0.0 },
    uBeatBoost: { value: 1.5 },
  }), []);

  // ── Main loop ─────────────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const { gl, size } = state;
    const bg   = getSettings().background;
    const mesh = meshRef.current;
    const mat  = matRef.current;
    if (!mesh || !mat) return;

    // Ensure render target matches canvas size
    if (
      !rtRef.current ||
      rtRef.current.width  !== size.width  ||
      rtRef.current.height !== size.height
    ) {
      rtRef.current?.dispose();
      rtRef.current = new THREE.WebGLRenderTarget(size.width, size.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format:    THREE.RGBAFormat,
      });
      mat.uniforms.uTexture.value = rtRef.current.texture;
    }

    // Scene rebuild key (distortion, road geometry, colors)
    const sceneKey = JSON.stringify([
      bg.hyperspeedDistortion   ?? DEFAULT_SETTINGS.background.hyperspeedDistortion,
      bg.hyperspeedRoadWidth    ?? DEFAULT_SETTINGS.background.hyperspeedRoadWidth,
      bg.hyperspeedLanesPerRoad ?? DEFAULT_SETTINGS.background.hyperspeedLanesPerRoad,
      bg.hyperspeedLeftCarColor1  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor1,
      bg.hyperspeedLeftCarColor2  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor2,
      bg.hyperspeedLeftCarColor3  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor3,
      bg.hyperspeedRightCarColor1 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor1,
      bg.hyperspeedRightCarColor2 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor2,
      bg.hyperspeedRightCarColor3 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor3,
      bg.hyperspeedSticksColor    ?? DEFAULT_SETTINGS.background.hyperspeedSticksColor,
    ]);

    if (sceneKey !== prevKeyRef.current) {
      prevKeyRef.current = sceneKey;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    }

    // Build scene if missing
    if (!sceneRef.current) {
      const distKey = (bg.hyperspeedDistortion ?? DEFAULT_SETTINGS.background.hyperspeedDistortion) as DistortionType;
      const dist = DISTORTIONS[distKey] ?? DISTORTIONS.turbulentDistortion;
      const h2n  = (hex: string) => parseInt(hex.replace('#', ''), 16);
      const opts: HyperspeedOptions = {
        length:                       400,
        roadWidth:                    bg.hyperspeedRoadWidth    ?? DEFAULT_SETTINGS.background.hyperspeedRoadWidth,
        islandWidth:                  2,
        lanesPerRoad:                 bg.hyperspeedLanesPerRoad ?? DEFAULT_SETTINGS.background.hyperspeedLanesPerRoad,
        fov:                          bg.hyperspeedFov          ?? DEFAULT_SETTINGS.background.hyperspeedFov,
        carLightsFade:                0.4,
        totalSideLightSticks:         20,
        lightPairsPerRoadWay:         40,
        shoulderLinesWidthPercentage: 0.05,
        brokenLinesWidthPercentage:   0.1,
        brokenLinesLengthPercentage:  0.5,
        lightStickWidth:              [0.12, 0.5],
        lightStickHeight:             [1.3, 1.7],
        movingAwaySpeed:              [60, 80],
        movingCloserSpeed:            [-120, -160],
        carLightsLength:              [400 * 0.03, 400 * 0.2],
        carLightsRadius:              [0.05, 0.14],
        carWidthPercentage:           [0.3, 0.5],
        carShiftX:                    [-0.8, 0.8],
        carFloorSeparation:           [0, 5],
        distortion: dist,
        colors: {
          roadColor:    0x080808,
          islandColor:  0x0a0a0a,
          background:   0x000000,
          shoulderLines: 0xffffff,
          brokenLines:  0xffffff,
          leftCars: [
            h2n(bg.hyperspeedLeftCarColor1  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor1),
            h2n(bg.hyperspeedLeftCarColor2  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor2),
            h2n(bg.hyperspeedLeftCarColor3  ?? DEFAULT_SETTINGS.background.hyperspeedLeftCarColor3),
          ],
          rightCars: [
            h2n(bg.hyperspeedRightCarColor1 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor1),
            h2n(bg.hyperspeedRightCarColor2 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor2),
            h2n(bg.hyperspeedRightCarColor3 ?? DEFAULT_SETTINGS.background.hyperspeedRightCarColor3),
          ],
          sticks: h2n(bg.hyperspeedSticksColor ?? DEFAULT_SETTINGS.background.hyperspeedSticksColor),
        },
      };
      const hs = new HyperspeedScene(opts);
      hs.init();
      sceneRef.current = hs;
    }

    // Blend mode (only when changed)
    const blendMode = (bg.hyperspeedBlendMode ?? DEFAULT_SETTINGS.background.hyperspeedBlendMode) as BlendMode;
    if (blendMode !== prevBlendRef.current) {
      applyBlendMode(mat, blendMode);
      prevBlendRef.current = blendMode;
    }

    // Visibility
    const enabled = bg.hyperspeedEnabled ?? DEFAULT_SETTINGS.background.hyperspeedEnabled;
    if (!enabled) {
      mat.visible = false;
      return;
    }
    mat.visible = true;

    // behindLogo — set in useFrame, never in JSX
    const behindLogo = bg.hyperspeedBehindLogo ?? DEFAULT_SETTINGS.background.hyperspeedBehindLogo;
    mesh.renderOrder = behindLogo ? 4 : 9;

    // Scale to fill screen
    mesh.scale.set(size.width, size.height, 1);

    // Update perspective camera aspect
    const hs = sceneRef.current!;
    hs.camera.fov    = bg.hyperspeedFov ?? DEFAULT_SETTINGS.background.hyperspeedFov;
    hs.camera.aspect = size.width / size.height;
    hs.camera.updateProjectionMatrix();

    // Advance scene
    const speed = bg.hyperspeedSpeed ?? DEFAULT_SETTINGS.background.hyperspeedSpeed;
    hs.update(delta * speed);

    // Render hyperspeed scene to render target
    const prevTarget     = gl.getRenderTarget();
    const prevClearAlpha = gl.getClearAlpha();
    gl.getClearColor(_prevClearColor);

    gl.setRenderTarget(rtRef.current);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    gl.render(hs.scene, hs.camera);

    gl.setRenderTarget(prevTarget);
    gl.setClearColor(_prevClearColor, prevClearAlpha);

    // Beat
    const beat = phaseSrcRef.current();
    mat.uniforms.uBeat.value      = beat;
    mat.uniforms.uBeatBoost.value = bg.hyperspeedBeatBrightness ?? DEFAULT_SETTINGS.background.hyperspeedBeatBrightness;
    mat.uniforms.uOpacity.value   = bg.hyperspeedOpacity        ?? DEFAULT_SETTINGS.background.hyperspeedOpacity;
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    rtRef.current?.dispose();
    sceneRef.current?.dispose();
  }, []);

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={OUTPUT_VERT}
        fragmentShader={OUTPUT_FRAG}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
