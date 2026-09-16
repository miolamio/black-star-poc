// Full-screen Schwarzschild null-geodesic raytracer.
// Units: Schwarzschild radius rs = 1. Photon sphere r = 1.5, ISCO r = 3.
// Geodesics are integrated in 3D via the Binet form written as a central force:
//   a = -1.5 * h^2 * x / r^5,  h = |x × v| (conserved)
// which is exact for null geodesics in Schwarzschild coordinates.

import { COMMON_GLSL } from './common.glsl.js';

export const GEODESIC_FRAG = /* glsl */ `
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanHalfFov;

// --- live parameters
uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskDensity;
uniform float uDiskTemperature;
uniform float uDiskBrightness;
uniform float uBeaming;
uniform float uRedshift;
uniform float uDiskSpin;
uniform float uTurbulence;
uniform float uTurbulenceScale;
uniform int   uMaxCrossings;
uniform float uStarDensity;
uniform float uStarBrightness;
uniform float uMilkyWay;

// --- quality / mode
uniform int   uMaxSteps;
uniform float uStepScale;
uniform int   uDebug;
uniform float uDiskOn;
uniform float uSkyOn;
uniform float uPerformance;

${COMMON_GLSL}

// ------------------------------------------------------------ geodesic integrator
vec3 geoAccel(vec3 p, float h2) {
  float r2 = dot(p, p);
  float r  = sqrt(r2);
  return (-1.5 * h2 / (r2 * r2 * r)) * p;
}

void rk4Step(inout vec3 p, inout vec3 v, float dt, float h2) {
  vec3 k1v = geoAccel(p, h2);                 vec3 k1p = v;
  vec3 k2v = geoAccel(p + 0.5 * dt * k1p, h2); vec3 k2p = v + 0.5 * dt * k1v;
  vec3 k3v = geoAccel(p + 0.5 * dt * k2p, h2); vec3 k3p = v + 0.5 * dt * k2v;
  vec3 k4v = geoAccel(p + dt * k3p, h2);       vec3 k4p = v + dt * k3v;
  p += (dt / 6.0) * (k1p + 2.0 * k2p + 2.0 * k3p + k4p);
  v += (dt / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
}

// ------------------------------------------------------------ accretion disk
struct DiskSample { vec3 color; float alpha; float g; };

// Novikov-Thorne style thin-disk temperature profile, normalised to peak = 1.
float diskTempProfile(float r) {
  float x = uDiskInner / r;
  return pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;
}

DiskSample shadeDisk(vec3 hit, vec3 vel) {
  DiskSample s;
  float r = length(hit.xz);
  vec3 er   = vec3(hit.x, 0.0, hit.z) / r;
  vec3 ephi = vec3(-er.z, 0.0, er.x) * sign(uDiskSpin + 1e-6);

  // Photon direction toward the observer, expressed in the local static frame.
  vec3 n  = -normalize(vel);
  float nr = dot(n, er);
  vec3 nt  = n - nr * er;
  float lapse = sqrt(max(1.0 - 1.0 / r, 1e-4));
  vec3 nl = normalize(er * (nr / lapse) + nt);

  // Circular Keplerian orbit in Schwarzschild: local speed beta = sqrt(1 / (2 (r - 1))).
  float beta  = min(sqrt(1.0 / (2.0 * max(r - 1.0, 0.55))), 0.95);
  float gamma = inversesqrt(1.0 - beta * beta);
  float gDop  = 1.0 / (gamma * (1.0 - beta * dot(ephi, nl)));
  float g     = gDop * lapse;
  s.g = g;

  // Turbulence: rotate the sampling frame with the local orbital angular velocity so
  // differential rotation shears the pattern (M = 0.5 in rs = 1 units).
  float phi   = atan(hit.z, hit.x);
  float omega = sqrt(0.5 / (r * r * r)) * uDiskSpin;
  float phr   = phi - omega * uTime * 0.6;
  vec2 cs     = vec2(cos(phr), sin(phr));
  float sc    = uTurbulenceScale;
  float n1 = fbm4(vec3(cs * r * 0.55 * sc, uTime * 0.07));
  float n2 = fbm4(vec3(cs * 1.6 * sc, r * 2.6 * sc + uTime * 0.11));
  float n3 = vnoise(vec3(cs * r * 1.8 * sc, uTime * 0.2 + 17.0));
  float turb = mix(1.0, (0.28 + 1.9 * n1 * n1 * n1) * mix(0.6, 1.4, n2) * (0.9 + 0.2 * n3), uTurbulence);

  float tprof = diskTempProfile(r);
  float outer = 1.0 - smoothstep(uDiskOuter * 0.72, uDiskOuter, r);
  float rin   = uDiskInner / r;

  float density = uDiskDensity * outer * turb * pow(rin, 0.6) * smoothstep(0.0, 0.12, tprof);
  float alpha   = 1.0 - exp(-density * 2.5);

  float Tobs = uDiskTemperature * tprof * mix(1.0, g, uRedshift);
  // Bolometric emission ~ T^4, so the inner ring dominates and the rim fades to embers.
  float emis = pow(max(tprof, 0.0), 4.0) * turb * pow(g, uBeaming);
  vec3 col = blackbodyRGB(max(Tobs, 800.0)) * emis * uDiskBrightness;
  if (uPerformance > 0.5) {
    // Art direction for the performance; laboratory blackbody colours remain
    // unchanged. Lift the outer disk so its extended radius stays visible.
    vec3 starlight = mix(vec3(0.28, 0.27, 0.62), vec3(0.68, 0.80, 1.15), clamp((Tobs - 6000.0) / 16000.0, 0.0, 1.0));
    col = mix(col, starlight * emis * uDiskBrightness, 0.78);
    col += vec3(0.12, 0.15, 0.30) * uDiskBrightness * pow(tprof, 1.4) * turb;
  }

  s.color = col * alpha;
  s.alpha = alpha;
  return s;
}

// ------------------------------------------------------------ procedural sky
const vec3 GAL_N = normalize(vec3(0.33, 0.84, 0.43));           // galactic plane normal
const vec3 GAL_C = normalize(vec3(0.80, -0.16, -0.30));          // toward galactic centre

vec3 starLayer(vec3 d, float N, float density, float bright, float sigma0, float fp) {
  vec3 col = vec3(0.0);
  vec3 p = d * N;
  ivec3 base = ivec3(floor(p - 0.5));
  for (int k = 0; k < 8; k++) {
    ivec3 c = base + ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 h = hash3i(c);
    if (h.x > density) continue;
    vec3 sp = (vec3(c) + hash3i(c + ivec3(7919, 104729, 1299709))) / N;
    vec3 sd = normalize(sp);
    float dist = length(d - sd);
    float sigma = max(sigma0, fp * 0.55);
    float w = exp(-dist * dist / (2.0 * sigma * sigma)) * (sigma0 * sigma0) / (sigma * sigma);
    float m = h.y;
    // Heavy-tailed flux distribution: most stars faint, a few brilliant.
    float lum = bright * 0.02 / (pow(m, 1.15) + 0.004);
    float T = 2400.0 + 22000.0 * pow(h.z, 2.6);
    col += blackbodyRGB(T) * lum * w;
  }
  return col;
}

vec3 renderSky(vec3 d, float fp, float pixAng) {
  vec3 col = vec3(0.0);

  // A fixed galactic plane spans the performance camera's viewing arc, placing
  // its luminous band behind the hole throughout the reveal and approach.
  vec3 galN = uPerformance > 0.5 ? normalize(vec3(-0.5, 0.866, 0.02)) : GAL_N;
  vec3 galC = uPerformance > 0.5 ? normalize(vec3(-0.29, -0.15, -1.0)) : GAL_C;
  float lat  = dot(d, galN);
  float bandWidth = uPerformance > 0.5 ? 0.17 : 0.13;
  float band = exp(-lat * lat / (2.0 * bandWidth * bandWidth));
  float wide = exp(-lat * lat / (2.0 * 0.32 * 0.32));

  // Milky Way nebulosity with dust lanes and a warm bulge.
  float neb  = fbm5(d * 4.5 + vec3(3.1, 1.7, 9.2));
  float neb2 = fbm4(d * 11.0 + vec3(8.0, 2.0, 4.0));
  float dust = fbm4(d * 7.0 + vec3(1.0, 6.0, 3.0));
  float toC  = dot(d, galC);
  float bulge = exp(-(1.0 - toC) * 3.5);
  float lanes = 1.0 - 0.8 * smoothstep(0.48, 0.66, dust) * band;
  float mw = (band * (0.15 + 1.4 * neb * neb + 0.6 * neb2 * neb2) + wide * 0.12 * neb + bulge * band * 0.8) * lanes;
  vec3 mwCol = mix(vec3(0.55, 0.68, 1.0), vec3(1.0, 0.86, 0.66), clamp(neb * 1.4 + bulge * 0.6, 0.0, 1.0));
  if (uPerformance > 0.5) {
    float filaments = fbm4(d * 38.0 + vec3(7.0, 2.0, 13.0));
    float clouds = pow(max(neb2 * 1.7, 0.0), 2.0);
    float dustLane = smoothstep(0.35, 0.64, dust + (filaments - 0.5) * 0.3);
    mw = (band * (0.22 + clouds + bulge * 0.8) + wide * neb * 0.15)
      * (1.0 - 0.92 * dustLane * band) * (0.7 + filaments * 0.8);
    mwCol = mix(vec3(0.24, 0.2, 0.6), vec3(0.62, 0.78, 1.15), clamp(neb * 0.8 + bulge * 0.3, 0.0, 1.0));
  }
  col += mwCol * mw * uMilkyWay * 0.16;

  // Stars, denser toward the band.
  float dens = uStarDensity * (0.35 + 1.4 * band + 0.3 * wide);
  float sig0 = pixAng * 0.6;
  col += starLayer(d, 40.0,  min(dens * 0.16, 0.98), uStarBrightness * 1.0, sig0, fp);
  col += starLayer(d, 160.0, min(dens * 0.26, 0.98), uStarBrightness * 0.16, sig0, fp);
  return col;
}

// ------------------------------------------------------------ debug palettes
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(smoothstep(0.0, 0.5, t), smoothstep(0.25, 0.85, t) * (1.0 - smoothstep(0.85, 1.0, t)) + smoothstep(0.85, 1.0, t), 1.0 - smoothstep(0.0, 0.45, t)) * (0.15 + 0.85 * t) + vec3(0.0, 0.0, 0.05);
}

// ------------------------------------------------------------ main
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  vec3 dir = normalize(uCamFwd + uCamRight * (ndc.x * uTanHalfFov * aspect) + uCamUp * (ndc.y * uTanHalfFov));

  vec3 p = uCamPos;
  vec3 v = dir;
  vec3 L = cross(p, v);
  float h2 = dot(L, L);
  float R_ESC = max(30.0, uDiskOuter + 6.0);

  int term = 0;         // 0 exhausted, 1 horizon, 2 escaped, 3 opaque disk
  int crossings = 0;
  int steps = 0;
  float gFirst = 0.0;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool diskOn = uDiskOn > 0.5;

  for (int i = 0; i < uMaxSteps; i++) {
    steps = i + 1;
    float r = length(p);
    if (r < 1.0) { term = 1; break; }
    if (r > R_ESC && dot(p, v) > 0.0) { term = 2; break; }

    float dt = clamp(r * 0.065, 0.03, 1.6);
    if (diskOn && r < uDiskOuter * 1.1 && abs(p.y) < 2.5) dt = min(dt, 0.3);
    dt *= uStepScale;

    vec3 pPrev = p;
    rk4Step(p, v, dt, h2);

    if (diskOn && crossings < uMaxCrossings && pPrev.y * p.y < 0.0) {
      float f = pPrev.y / (pPrev.y - p.y);
      vec3 hit = mix(pPrev, p, f);
      hit.y = 0.0;
      float rh = length(hit.xz);
      if (rh > uDiskInner && rh < uDiskOuter) {
        DiskSample s = shadeDisk(hit, v);
        col += trans * s.color;
        trans *= (1.0 - s.alpha);
        if (crossings == 0) gFirst = s.g;
        crossings++;
        if (trans < 0.01) { term = 3; break; }
      }
    }
  }

  // Escaped direction (falls back to the primary direction so derivatives are defined).
  vec3 skyDir = (term == 2) ? normalize(v) : dir;
  float fp = min(length(fwidth(skyDir)), 0.06);
  float pixAng = 2.0 * uTanHalfFov / uResolution.y;

  if (term == 2 && uSkyOn > 0.5) {
    col += trans * renderSky(skyDir, fp, pixAng);
  }

  if (uDebug >= 3) {
    vec3 dbg = vec3(0.0);
    if (uDebug == 3) {
      // Redshift factor of the first disk hit: blue (g < 1) .. white (1) .. red (g > 1)
      if (crossings > 0) {
        float t = clamp((gFirst - 0.4) / 1.2, 0.0, 1.0);
        dbg = mix(vec3(0.05, 0.25, 1.0), vec3(1.0), smoothstep(0.0, 0.5, t));
        dbg = mix(dbg, vec3(1.0, 0.12, 0.05), smoothstep(0.5, 1.0, t));
      }
    } else if (uDebug == 4) {
      const vec3 pal[6] = vec3[6](vec3(0.0), vec3(0.1, 0.3, 1.0), vec3(0.1, 0.9, 0.3), vec3(1.0, 0.9, 0.1), vec3(1.0, 0.4, 0.1), vec3(1.0, 0.1, 0.6));
      dbg = pal[min(crossings, 5)];
    } else if (uDebug == 5) {
      dbg = heat(float(steps) / float(uMaxSteps));
    } else if (uDebug == 6) {
      if (term == 1) dbg = vec3(0.9, 0.1, 0.1);
      else if (term == 0) dbg = vec3(0.4, 0.05, 0.05);
      else if (term == 3) dbg = vec3(0.1, 0.9, 0.2);
      else dbg = crossings > 0 ? vec3(0.2, 0.7, 0.9) : vec3(0.1, 0.25, 1.0);
    } else if (uDebug == 7 || uDebug == 8) {
      dbg = col;
    } else if (uDebug == 9) {
      if (term == 2) {
        float ang = acos(clamp(dot(skyDir, dir), -1.0, 1.0));
        dbg = heat(ang / PI);
      }
    }
    fragColor = vec4(dbg, 1.0);
    return;
  }

  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
