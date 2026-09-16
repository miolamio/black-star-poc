import { COMMON_GLSL } from './common.glsl.js';

// Perspective star heads and trails, with local HDR light rather than a screen fade.
export const INTERIOR_VERT = /* glsl */ `
precision highp float;
in vec4 segment;
in vec3 appearance;
uniform float uAspect;
out vec2 vLocal;
out float vBrightness;
out float vStretch;
out vec3 vColor;
void main() {
  vec2 direction = normalize(segment.zw);
  vec2 side = vec2(-direction.y, direction.x);
  vec2 center = segment.xy + position.x * segment.zw;
  center += side * position.y * appearance.x;
  gl_Position = vec4(center.x / uAspect, center.y, 0.0, 1.0);
  vLocal = position.xy;
  vBrightness = appearance.y;
  vStretch = length(segment.zw) / appearance.x;
  vColor = mix(vec3(0.12, 0.38, 1.35), vec3(0.85, 0.94, 1.2), appearance.z);
}
`;
export const INTERIOR_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
in float vBrightness;
in float vStretch;
in vec3 vColor;
out vec4 fragColor;
void main() {
  float trail = exp(-vLocal.y * vLocal.y * 18.0)
    * smoothstep(-1.0, -0.5, vLocal.x) * (1.0 - smoothstep(0.55, 1.0, vLocal.x));
  vec2 headPos = vec2((vLocal.x - 0.4) * vStretch, vLocal.y);
  float head = exp(-dot(headPos, headPos) * 9.0);
  float halo = exp(-vLocal.y * vLocal.y * 2.0) * (1.0 - vLocal.x * vLocal.x) * 0.12;
  fragColor = vec4((vColor * (trail + halo) + vec3(1.1, 1.25, 1.5) * head) * vBrightness, 1.0);
}
`;

export const INTERIOR_FIELD_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform float uAspect;
uniform float uFlash;
uniform float uAngle;
uniform float uShape;
${COMMON_GLSL}

float zigzag(float x, float scale, int salt) {
  float k = x * scale;
  int cell = int(floor(k));
  return mix(hash1i(ivec3(cell, int(uShape), salt)),
    hash1i(ivec3(cell + 1, int(uShape), salt)), fract(k)) - 0.5;
}

float bolt(vec2 p, float branch) {
  float spine = 0.22 + 0.19 * sin(p.x * 2.8 + uShape)
    + 0.25 * zigzag(p.x, 7.0, 3) + 0.07 * zigzag(p.x, 23.0, 5);
  spine += branch * (0.3 + p.x * 0.4);
  float dist = abs(p.y - spine);
  float window = smoothstep(-1.25, -0.75, p.x) * (1.0 - smoothstep(0.65, 1.3 - branch * 0.5, p.x));
  return (exp(-dist * 480.0) * 5.0 + exp(-dist * 60.0) * 0.38) * window;
}

void main() {
  if (uFlash <= 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 p = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  float c = cos(uAngle), s = sin(uAngle);
  p = mat2(c, -s, s, c) * p;
  float arc = bolt(p, 0.0) + bolt(p, 1.0) * 0.55;
  // Brief backlighting exposes cloud-like silhouettes behind each discharge.
  float clouds = fbm4(vec3(p * 3.0, uShape));
  float folds = smoothstep(0.35, 0.62, clouds);
  vec2 lightOrigin = p - vec2(-0.2, 0.22);
  float glow = exp(-dot(lightOrigin, lightOrigin) * 3.8) * (0.08 + 0.22 * folds);
  vec3 light = vec3(0.18, 0.48, 1.4) * arc + vec3(0.12, 0.2, 0.6) * glow;
  fragColor = vec4(light * uFlash, 1.0);
}
`;
