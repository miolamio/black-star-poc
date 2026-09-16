// Pure, seekable direction for Exit Music. Interior imagery is artistic, not GR.
export const RECORDING_DURATION = 265.227;
export const DEFAULT_ANCHORS = Object.freeze({
  revealStart: 8, revealEnd: 52, plungeStart: 208, crossing: 218,
  thinningStart: 230, sparseAt: 260,
});
export const ANCHOR_KEYS = Object.keys(DEFAULT_ANCHORS);
export const PARTICLE_COUNT = 480;
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
  // One continuously accelerating approach. The last term joins with zero
  // velocity/acceleration, adding the final fall without a speed discontinuity.
  const inward = progress(time, 0, a.crossing);
  const radius = time >= a.crossing ? 1 : mix(82, 1, 0.2 * inward + 0.7 * inward ** 2.4 + 0.1 * plunge ** 8);
  const elevation = mix(0.006, 0.28, reveal) - 0.17 * smooth(approach);
  const azimuth = 0.18 * reveal + 0.24 * smooth(approach);
  const detail = mix(0.15, 1, smooth(progress(time, 0, a.plungeStart)));
  const thinning = smooth(progress(time, a.thinningStart, a.sparseAt));
  const interior = time >= a.crossing;
  const motionTime = Math.max(0, time - a.crossing);
  const particleCount = interior ? Math.max(SPARSE_COUNT, Math.ceil(mix(PARTICLE_COUNT, SPARSE_COUNT, thinning))) : 0;
  const phase = time < a.revealStart ? 'opening' : time < a.revealEnd ? 'reveal'
    : time < a.plungeStart ? 'approach' : !interior ? 'plunge'
      : time < a.thinningStart ? 'interior' : time < a.sparseAt ? 'thinning' : 'sparse';
  return {
    time, seed, phase, interior, silentTail: time >= duration, radius, detail,
    position: [radius * Math.cos(elevation) * Math.sin(azimuth), radius * Math.sin(elevation), radius * Math.cos(elevation) * Math.cos(azimuth)],
    target: [0, 0, 0], fov: 48, roll: 0,
    motionTime, particleCount,
    flash: interior ? sampleInteriorFlash(motionTime, seed, particleCount / PARTICLE_COUNT) : { strength: 0, angle: 0, shape: 0 },
    // Transient values, never written to the laboratory parameter object.
    parameters: {
      turbulence: mix(0.28, 0.88, detail), turbulenceScale: mix(0.65, 1.65, detail),
      diskOuter: 22, diskDensity: 1.35, diskTemperature: 22000,
      diskBrightness: 2.8, diskSpin: 1.25, starDensity: 1.2, starBrightness: 1.25,
      milkyWay: 2.2, exposure: interior ? 1.05 : 1.1, grain: 0,
      bloomStrength: interior ? 0.5 : 0.42, bloomThreshold: 0.7, bloomRadius: 0.75,
      vignette: interior ? 0.2 : 0.28, chromaticAberration: 0,
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
  const angle = random(id, seed, 1) * Math.PI * 2;
  const speed = 0.22 + random(id, seed, 2) * 0.18;
  const travel = (motionTime * speed + random(id, seed, 3)) % 1;
  // Perspective projection: stars accelerate outward as their depth approaches
  // the viewer; their heads grow into long trails before leaving the frame.
  const depth = Math.max(0.035, 1 - travel);
  const radius = (0.025 + random(id, seed, 6) * 0.22) / depth ** 1.3;
  const length = 0.0018 + 0.011 * travel ** 3 / depth ** 1.5;
  const envelope = smooth(progress(travel, 0, 0.08)) * (1 - smooth(progress(travel, 0.96, 1)));
  return {
    id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
    dx: Math.cos(angle) * length, dy: Math.sin(angle) * length,
    width: (0.0012 + random(id, seed, 4) * 0.0024) * (0.5 + travel),
    brightness: (0.7 + random(id, seed, 5) * 2.8) * (0.2 + travel * travel) * envelope,
    hue: random(id, seed, 7),
  };
}

export function sampleInteriorFlash(motionTime, seed = 7, activity = 1) {
  const event = Math.floor(motionTime / 4.2);
  const age = motionTime % 4.2;
  const eligible = random(event, seed, 9) < Math.max(0.08, activity);
  return {
    strength: eligible ? smooth(progress(age, 0, 0.045)) * (1 - smooth(progress(age, 0.12, 0.65))) : 0,
    angle: random(event, seed, 10) * Math.PI * 2,
    shape: random(event, seed, 11) * 100,
  };
}
