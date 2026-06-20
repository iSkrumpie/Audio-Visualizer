/**
 * blendMode.ts — Shared blend mode utility for all R3F effect components.
 *
 * Maps a BlendMode string to the correct THREE.js blending settings.
 * Call applyBlendMode() in useFrame only when the mode changes (use a ref to track).
 */
import * as THREE from 'three';
import type { BlendMode } from './settingsStore';

export const BLEND_MODE_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal',   label: 'Normal'   },
  { value: 'add',      label: 'Add'      },
  { value: 'screen',   label: 'Screen'   },
  { value: 'multiply', label: 'Multiply' },
  { value: 'darken',   label: 'Darken'   },
  { value: 'lighten',  label: 'Lighten'  },
  { value: 'subtract', label: 'Subtract' },
];

export function applyBlendMode(mat: THREE.Material, mode: BlendMode): void {
  switch (mode) {
    case 'normal':
      mat.blending = THREE.NormalBlending;
      break;
    case 'add':
      mat.blending = THREE.AdditiveBlending;
      break;
    case 'screen':
      mat.blending      = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc      = THREE.OneFactor;
      mat.blendDst      = THREE.OneMinusSrcColorFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case 'multiply':
      mat.blending = THREE.MultiplyBlending;
      break;
    case 'darken':
      mat.blending      = THREE.CustomBlending;
      mat.blendEquation = THREE.MinEquation;
      mat.blendSrc      = THREE.OneFactor;
      mat.blendDst      = THREE.OneFactor;
      break;
    case 'lighten':
      mat.blending      = THREE.CustomBlending;
      mat.blendEquation = THREE.MaxEquation;
      mat.blendSrc      = THREE.OneFactor;
      mat.blendDst      = THREE.OneFactor;
      break;
    case 'subtract':
      mat.blending      = THREE.CustomBlending;
      mat.blendEquation = THREE.ReverseSubtractEquation;
      mat.blendSrc      = THREE.OneFactor;
      mat.blendDst      = THREE.OneFactor;
      break;
  }
  mat.needsUpdate = true;
}
