// Small local streaks only: the clear colour remains exactly black.
export const INTERIOR_VERT = /* glsl */ `
precision highp float;
in vec4 segment;
in vec2 appearance;
uniform float uAspect;
out vec2 vLocal;
out float vBrightness;
void main() {
  vec2 direction = normalize(segment.zw);
  vec2 side = vec2(-direction.y, direction.x);
  vec2 center = segment.xy + position.x * segment.zw;
  center += side * position.y * appearance.x;
  gl_Position = vec4(center.x / uAspect, center.y, 0.0, 1.0);
  vLocal = position.xy;
  vBrightness = appearance.y;
}
`;
export const INTERIOR_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal;
in float vBrightness;
out vec4 fragColor;
void main() {
  float core = exp(-vLocal.y * vLocal.y * 5.0);
  float ends = 1.0 - smoothstep(0.25, 1.0, abs(vLocal.x));
  fragColor = vec4(vec3(0.66, 0.75, 0.85) * vBrightness * core * ends, 1.0);
}
`;
