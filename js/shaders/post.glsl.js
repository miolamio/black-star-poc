// Post-processing shaders: fullscreen vertex, bloom prefilter / downsample / upsample,
// and the final composite (chromatic aberration, bloom, exposure, ACES, vignette, grain).

import { COMMON_GLSL } from './common.glsl.js';

export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Soft-knee threshold. Input is the HDR scene at full internal resolution; output is
// the first bloom mip (half resolution). A 4-tap box read reduces fireflies.
export const BLOOM_PREFILTER_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tInput;
uniform vec2  uTexel;
uniform float uThreshold;
uniform float uKnee;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  return c * contrib;
}

void main() {
  vec3 a = texture(tInput, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
  vec3 b = texture(tInput, vUv + uTexel * vec2( 0.5, -0.5)).rgb;
  vec3 c = texture(tInput, vUv + uTexel * vec2(-0.5,  0.5)).rgb;
  vec3 d = texture(tInput, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  // Karis average to suppress fireflies.
  float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b)));
  float wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b)));
  float wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b)));
  float wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
  vec3 avg = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  fragColor = vec4(max(prefilter(avg), vec3(0.0)), 1.0);
}
`;

// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty").
export const BLOOM_DOWN_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tInput;
uniform vec2 uTexel;

void main() {
  vec2 t = uTexel;
  vec3 a = texture(tInput, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture(tInput, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture(tInput, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture(tInput, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(tInput, vUv).rgb;
  vec3 f = texture(tInput, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(tInput, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(tInput, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture(tInput, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture(tInput, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture(tInput, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture(tInput, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(tInput, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 s = e * 0.125;
  s += (a + c + g + i) * 0.03125;
  s += (b + d + f + h) * 0.0625;
  s += (j + k + l + m) * 0.125;
  fragColor = vec4(s, 1.0);
}
`;

// 9-tap tent upsample, additively blended onto the destination mip.
export const BLOOM_UP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tInput;
uniform vec2  uTexel;
uniform float uRadius;

void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = vec3(0.0);
  s += texture(tInput, vUv + t * vec2(-1.0,  1.0)).rgb * 1.0;
  s += texture(tInput, vUv + t * vec2( 0.0,  1.0)).rgb * 2.0;
  s += texture(tInput, vUv + t * vec2( 1.0,  1.0)).rgb * 1.0;
  s += texture(tInput, vUv + t * vec2(-1.0,  0.0)).rgb * 2.0;
  s += texture(tInput, vUv).rgb * 4.0;
  s += texture(tInput, vUv + t * vec2( 1.0,  0.0)).rgb * 2.0;
  s += texture(tInput, vUv + t * vec2(-1.0, -1.0)).rgb * 1.0;
  s += texture(tInput, vUv + t * vec2( 0.0, -1.0)).rgb * 2.0;
  s += texture(tInput, vUv + t * vec2( 1.0, -1.0)).rgb * 1.0;
  fragColor = vec4(s / 16.0, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2  uResolution;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uGrain;
uniform float uChromatic;
uniform float uGrainSeed;
uniform int   uDebug;

${COMMON_GLSL}

// Stephen Hill's ACES fit (sRGB primaries in, sRGB primaries out).
const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACESOutputMat = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602);

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 c) {
  c = ACESInputMat * c;
  c = RRTAndODTFit(c);
  c = ACESOutputMat * c;
  return clamp(c, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 sampleHDR(vec2 uv) {
  return texture(tScene, uv).rgb + texture(tBloom, uv).rgb * uBloomStrength;
}

void main() {
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  if (uDebug == 1) {           // raw HDR scene
    fragColor = vec4(linearToSRGB(clamp(texture(tScene, uv).rgb, 0.0, 1.0)), 1.0);
    return;
  }
  if (uDebug == 2) {           // bloom buffer
    fragColor = vec4(linearToSRGB(clamp(texture(tBloom, uv).rgb * uBloomStrength, 0.0, 1.0)), 1.0);
    return;
  }
  if (uDebug >= 3) {           // analytic views pass through untouched
    fragColor = vec4(linearToSRGB(clamp(texture(tScene, uv).rgb, 0.0, 1.0)), 1.0);
    return;
  }

  // Subtle lateral chromatic aberration on the HDR image (before tone mapping).
  vec2 off = fromCenter * r2 * uChromatic * 4.0;
  vec3 hdr;
  hdr.r = sampleHDR(uv + off).r;
  hdr.g = sampleHDR(uv).g;
  hdr.b = sampleHDR(uv - off).b;

  hdr *= uExposure;
  vec3 col = acesFitted(hdr);

  // Vignette
  float vig = 1.0 - uVignette * smoothstep(0.15, 1.05, sqrt(r2) * 1.55);
  col *= vig;

  // Luminance-weighted film grain (keeps true blacks black).
  vec3 gh = hash3i(ivec3(uv * uResolution, int(uGrainSeed)));
  float n = (gh.x + gh.y - 1.0);           // triangular in [-1, 1]
  float l = luma(col);
  col += n * uGrain * (0.03 + 0.7 * l) * (1.0 - l * 0.5);

  col = linearToSRGB(clamp(col, 0.0, 1.0));

  // Dither to 8 bit to avoid banding in deep gradients.
  col += (gh.z - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
