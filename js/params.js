// The 21 live parameters. Each definition drives the GUI, persistence, URL parsing,
// and the shader uniform of the same name (prefixed with "u").

export const PARAM_DEFS = [
  // --- Disk geometry & emission
  { key: 'diskInner',        label: 'Inner radius (rs)',   group: 'Disk',       min: 1.6,   max: 8,     step: 0.01,  def: 3.0 },
  { key: 'diskOuter',        label: 'Outer radius (rs)',   group: 'Disk',       min: 4,     max: 24,    step: 0.05,  def: 12.0 },
  { key: 'diskDensity',      label: 'Density',             group: 'Disk',       min: 0,     max: 3,     step: 0.01,  def: 0.9 },
  { key: 'diskTemperature',  label: 'Peak temperature (K)',group: 'Disk',       min: 1500,  max: 25000, step: 10,    def: 7200 },
  { key: 'diskBrightness',   label: 'Brightness',          group: 'Disk',       min: 0,     max: 8,     step: 0.01,  def: 1.3 },
  { key: 'diskSpin',         label: 'Spin rate',           group: 'Disk',       min: -3,    max: 3,     step: 0.01,  def: 1.0 },
  { key: 'turbulence',       label: 'Turbulence',          group: 'Disk',       min: 0,     max: 1,     step: 0.005, def: 0.7 },
  { key: 'turbulenceScale',  label: 'Turbulence scale',    group: 'Disk',       min: 0.2,   max: 4,     step: 0.01,  def: 1.0 },
  { key: 'maxCrossings',     label: 'Max disk crossings',  group: 'Disk',       min: 1,     max: 6,     step: 1,     def: 4 },
  // --- Relativity
  { key: 'beaming',          label: 'Doppler beaming',     group: 'Relativity', min: 0,     max: 5,     step: 0.01,  def: 3.0 },
  { key: 'redshift',         label: 'Colour shift',        group: 'Relativity', min: 0,     max: 1,     step: 0.005, def: 1.0 },
  // --- Sky
  { key: 'starDensity',      label: 'Star density',        group: 'Sky',        min: 0,     max: 1.6,   step: 0.005, def: 0.9 },
  { key: 'starBrightness',   label: 'Star brightness',     group: 'Sky',        min: 0,     max: 4,     step: 0.01,  def: 1.0 },
  { key: 'milkyWay',         label: 'Milky Way',           group: 'Sky',        min: 0,     max: 3,     step: 0.01,  def: 1.0 },
  // --- Post
  { key: 'exposure',         label: 'Exposure',            group: 'Post',       min: 0.05,  max: 6,     step: 0.01,  def: 1.0 },
  { key: 'bloomStrength',    label: 'Bloom strength',      group: 'Post',       min: 0,     max: 3,     step: 0.005, def: 0.55 },
  { key: 'bloomThreshold',   label: 'Bloom threshold',     group: 'Post',       min: 0,     max: 4,     step: 0.005, def: 0.9 },
  { key: 'bloomRadius',      label: 'Bloom radius',        group: 'Post',       min: 0.2,   max: 3,     step: 0.01,  def: 1.0 },
  { key: 'vignette',         label: 'Vignette',            group: 'Post',       min: 0,     max: 1,     step: 0.005, def: 0.4 },
  { key: 'grain',            label: 'Film grain',          group: 'Post',       min: 0,     max: 0.3,   step: 0.001, def: 0.035 },
  { key: 'chromaticAberration', label: 'Chromatic aberr.', group: 'Post',       min: 0,     max: 0.02,  step: 0.0001,def: 0.0025 },
];

export const PARAM_KEYS = PARAM_DEFS.map((d) => d.key);
export const PARAM_COUNT = PARAM_DEFS.length;

export function defaultParams() {
  const out = {};
  for (const d of PARAM_DEFS) out[d.key] = d.def;
  return out;
}

export function clampParams(p) {
  const out = {};
  for (const d of PARAM_DEFS) {
    let v = Number(p[d.key]);
    if (!Number.isFinite(v)) v = d.def;
    v = Math.min(d.max, Math.max(d.min, v));
    if (d.step >= 1) v = Math.round(v);
    out[d.key] = v;
  }
  return out;
}

export function uniformName(key) {
  return 'u' + key.charAt(0).toUpperCase() + key.slice(1);
}
