// Four presets. Each sets all 21 parameters plus a camera pose (position in rs units,
// looking at the origin) and a default cinematic path.

import { defaultParams } from './params.js';

export const PRESETS = {
  interstellar: {
    name: 'Interstellar',
    description: 'Thin warm disk seen nearly edge-on, classic lensed halo.',
    params: {
      ...defaultParams(),
      diskInner: 3.0, diskOuter: 12.0, diskDensity: 0.9, diskTemperature: 7200,
      diskBrightness: 1.3, diskSpin: 1.0, turbulence: 0.7, turbulenceScale: 1.0, maxCrossings: 4,
      beaming: 3.0, redshift: 1.0,
      starDensity: 0.9, starBrightness: 1.0, milkyWay: 1.0,
      exposure: 1.0, bloomStrength: 0.55, bloomThreshold: 0.9, bloomRadius: 1.0,
      vignette: 0.4, grain: 0.035, chromaticAberration: 0.0025,
    },
    camera: { position: [0, 2.6, 21.0], fov: 48 },
    path: 'orbit',
  },
  quasar: {
    name: 'Quasar',
    description: 'Hot blue-white disk, violent turbulence, strong beaming.',
    params: {
      ...defaultParams(),
      diskInner: 2.4, diskOuter: 18.0, diskDensity: 1.6, diskTemperature: 16000,
      diskBrightness: 2.2, diskSpin: 1.8, turbulence: 0.95, turbulenceScale: 1.6, maxCrossings: 5,
      beaming: 4.0, redshift: 1.0,
      starDensity: 1.1, starBrightness: 0.9, milkyWay: 1.3,
      exposure: 0.85, bloomStrength: 0.9, bloomThreshold: 0.7, bloomRadius: 1.3,
      vignette: 0.45, grain: 0.05, chromaticAberration: 0.004,
    },
    camera: { position: [4.0, 6.5, 22.0], fov: 55 },
    path: 'flyby',
  },
  ember: {
    name: 'Ember',
    description: 'Cool dim disk, dusty and slow, deep red glow.',
    params: {
      ...defaultParams(),
      diskInner: 3.4, diskOuter: 9.5, diskDensity: 1.6, diskTemperature: 3100,
      diskBrightness: 0.6, diskSpin: 0.55, turbulence: 0.85, turbulenceScale: 2.2, maxCrossings: 3,
      beaming: 2.2, redshift: 0.8,
      starDensity: 0.7, starBrightness: 0.8, milkyWay: 0.6,
      exposure: 1.0, bloomStrength: 0.7, bloomThreshold: 0.5, bloomRadius: 1.6,
      vignette: 0.55, grain: 0.06, chromaticAberration: 0.003,
    },
    camera: { position: [-3.0, 1.6, 15.0], fov: 48 },
    path: 'plunge',
  },
  lensing: {
    name: 'Pure Lensing',
    description: 'No disk. Einstein ring, photon ring and the lensed Milky Way.',
    params: {
      ...defaultParams(),
      diskInner: 3.0, diskOuter: 12.0, diskDensity: 0.0, diskTemperature: 7200,
      diskBrightness: 0.0, diskSpin: 1.0, turbulence: 0.5, turbulenceScale: 1.0, maxCrossings: 1,
      beaming: 3.0, redshift: 1.0,
      starDensity: 1.4, starBrightness: 1.6, milkyWay: 1.5,
      exposure: 1.1, bloomStrength: 0.45, bloomThreshold: 0.6, bloomRadius: 1.0,
      vignette: 0.35, grain: 0.03, chromaticAberration: 0.002,
    },
    camera: { position: [0, 0.8, 11.0], fov: 60 },
    path: 'rise',
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const DEFAULT_PRESET = 'interstellar';

export function getPreset(key) {
  return PRESETS[key] || PRESETS[DEFAULT_PRESET];
}
