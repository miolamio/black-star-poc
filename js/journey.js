// Pure, seekable direction for Exit Music. Interior imagery is artistic, not GR.
export const RECORDING_DURATION = 265.227;
export const DEFAULT_ANCHORS = Object.freeze({
  revealStart: 8, revealEnd: 52, plungeStart: 208, crossing: 218,
  thinningStart: 230, sparseAt: 260,
});
export const ANCHOR_KEYS = Object.keys(DEFAULT_ANCHORS);
export const PARTICLE_COUNT = 160;
export const SPARSE_COUNT = 3;

export function validateAnchors(anchors, duration = RECORDING_DURATION) {
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Recording duration must be finite and positive.');
  let previous = -1;
  const result = {};
  for (const key of ANCHOR_KEYS) {
    const value = anchors[key];
    if (!Number.isFinite(value) || value < 0 || value <= previous || value > duration) {
      throw new RangeError('Cues must be finite, strictly ordered seconds within the recording.');
    }
    result[key] = value;
    previous = value;
  }
  if (result.revealEnd > duration / 3) throw new RangeError('Complete the reveal within the first third of the recording.');
  return Object.freeze(result);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const progress = (t, a, b) => clamp((t - a) / (b - a));

export function sampleJourney(time, anchors = DEFAULT_ANCHORS, seed = 7, duration = RECORDING_DURATION) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Journey time must be finite and nonnegative.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer.');
  const a = anchors;
  const reveal = smooth(progress(time, a.revealStart, a.revealEnd));
  const approach = progress(time, a.revealEnd, a.plungeStart);
  const plunge = progress(time, a.plungeStart, a.crossing);
  // Each segment only moves inward. The rapid fall is concentrated near crossing.
  const radius = time <= a.revealEnd
    ? mix(58, 26, time / a.revealEnd)
    : time <= a.plungeStart
      ? 26 * Math.pow(8.5 / 26, approach)
      : mix(8.5, 1, plunge ** 12);
  const elevation = mix(0.006, 0.28, reveal) - 0.17 * smooth(approach);
  const azimuth = 0.18 * reveal + 0.24 * smooth(approach);
  const detail = mix(0.15, 1, smooth(progress(time, 0, a.plungeStart)));
  const thinning = smooth(progress(time, a.thinningStart, a.sparseAt));
  const interior = time >= a.crossing;
  const phase = time < a.revealStart ? 'opening' : time < a.revealEnd ? 'reveal'
    : time < a.plungeStart ? 'approach' : !interior ? 'plunge'
      : time < a.thinningStart ? 'interior' : time < a.sparseAt ? 'thinning' : 'sparse';
  return {
    time, seed, phase, interior, silentTail: time >= duration, radius, detail,
    position: [radius * Math.cos(elevation) * Math.sin(azimuth), radius * Math.sin(elevation), radius * Math.cos(elevation) * Math.cos(azimuth)],
    target: [0, 0, 0], fov: 48, roll: 0,
    motionTime: Math.max(0, time - a.crossing),
    particleCount: interior ? Math.max(SPARSE_COUNT, Math.ceil(mix(PARTICLE_COUNT, SPARSE_COUNT, thinning))) : 0,
    // Transient values, never written to the laboratory parameter object.
    parameters: {
      turbulence: mix(0.28, 0.88, detail), turbulenceScale: mix(0.65, 1.65, detail),
      diskBrightness: 1.05, diskSpin: 1.1, starDensity: 0.35, starBrightness: 0.4,
      milkyWay: 0.12, exposure: interior ? 0.8 : 0.85, grain: 0,
      bloomStrength: interior ? 0 : 0.3, chromaticAberration: 0,
    },
  };
}

function random(id, seed, salt) {
  let x = (Math.imul(id + 1, 0x9e3779b1) ^ seed ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Stable identity determines direction, speed and brightness. Density only removes
// identities from the end of the list; remaining particles do not globally fade.
export function sampleParticle(id, motionTime, seed = 7) {
  const angle = (id % 2 ? Math.PI : 0) + (random(id, seed, 1) - 0.5) * 1.7;
  const speed = 0.48 + random(id, seed, 2) * 0.3;
  const travel = (motionTime * speed + random(id, seed, 3)) % 1;
  const radius = 0.08 + 2.9 * travel ** 4;
  const length = 0.006 + 0.27 * travel ** 5;
  const envelope = smooth(progress(travel, 0.42, 0.65)) * (1 - smooth(progress(travel, 0.94, 1)));
  return {
    id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
    dx: Math.cos(angle) * length, dy: Math.sin(angle) * length,
    width: 0.0022 + random(id, seed, 4) * 0.0032,
    brightness: (0.10 + random(id, seed, 5) * 0.16) * envelope,
  };
}
