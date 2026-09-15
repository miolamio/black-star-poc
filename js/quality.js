// Quality profiles: internal resolution scale, device-pixel-ratio cap, geodesic step
// budget, and bloom mip count. `detectQuality` picks a sensible starting profile.

export const QUALITY = {
  low: {
    name: 'Low',
    resolutionScale: 0.5,
    maxDpr: 1.0,
    maxSteps: 110,
    stepScale: 1.35,
    bloomMips: 4,
  },
  medium: {
    name: 'Medium',
    resolutionScale: 0.75,
    maxDpr: 1.5,
    maxSteps: 180,
    stepScale: 1.0,
    bloomMips: 5,
  },
  high: {
    name: 'High',
    resolutionScale: 1.0,
    maxDpr: 2.0,
    maxSteps: 300,
    stepScale: 0.85,
    bloomMips: 6,
  },
};

export const QUALITY_KEYS = Object.keys(QUALITY);

export function detectQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  const pixels = window.innerWidth * window.innerHeight * dpr * dpr;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (cores >= 8 && pixels < 4.5e6) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}
