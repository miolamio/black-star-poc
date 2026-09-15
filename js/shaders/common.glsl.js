// Shared GLSL ES 3.00 helpers: integer hashing, value noise, fbm, blackbody colour.
// Everything here is deterministic across GPUs (no sin-based hashes).

export const COMMON_GLSL = /* glsl */ `
#define PI 3.14159265358979
#define TAU 6.28318530717959

// ---------------------------------------------------------------- hashing
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3i(ivec3 p) {
  uvec3 v = pcg3d(uvec3(p + ivec3(1 << 20)));
  return vec3(v) * (1.0 / 4294967296.0);
}
float hash1i(ivec3 p) { return hash3i(p).x; }
vec3 hash3f(vec3 p) { return hash3i(ivec3(floor(p))); }

// ---------------------------------------------------------------- value noise
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  float n000 = hash1i(c + ivec3(0, 0, 0));
  float n100 = hash1i(c + ivec3(1, 0, 0));
  float n010 = hash1i(c + ivec3(0, 1, 0));
  float n110 = hash1i(c + ivec3(1, 1, 0));
  float n001 = hash1i(c + ivec3(0, 0, 1));
  float n101 = hash1i(c + ivec3(1, 0, 1));
  float n011 = hash1i(c + ivec3(0, 1, 1));
  float n111 = hash1i(c + ivec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

// fbm in [0,1]
float fbm4(vec3 p) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec3(11.7, 5.3, 2.9);
    a *= 0.5;
  }
  return s / n;
}
float fbm5(vec3 p) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    n += a;
    p = p * 2.07 + vec3(3.1, 7.7, 1.3);
    a *= 0.5;
  }
  return s / n;
}

// ---------------------------------------------------------------- colour
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Planckian locus chromaticity fit (Kim et al.) -> XYZ (Y = 1) -> linear sRGB.
vec3 blackbodyRGB(float T) {
  float Tc = clamp(T, 1667.0, 25000.0);
  float u = 1000.0 / Tc;
  float x = (Tc < 4000.0)
    ? (-0.2661239 * u * u * u - 0.2343589 * u * u + 0.8776956 * u + 0.179910)
    : (-3.0258469 * u * u * u + 2.1070379 * u * u + 0.2226347 * u + 0.240390);
  float y;
  if (Tc < 2222.0)      y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
  else if (Tc < 4000.0) y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
  else                  y =  3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  vec3 XYZ = vec3(x / y, 1.0, (1.0 - x - y) / y);
  const mat3 XYZ2RGB = mat3(
     3.2406, -0.9689,  0.0557,
    -1.5372,  1.8758, -0.2040,
    -0.4986,  0.0415,  1.0570);
  vec3 rgb = XYZ2RGB * XYZ;
  rgb = max(rgb, vec3(0.0));
  return rgb / max(luma(rgb), 1e-4);
}
`;
