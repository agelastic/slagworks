// GLSL sources. Every vertex buffer uses one layout: aPos (3 floats), aUv (2), aLight (2).

// brightness = light * (FOG_MIN + (1 - FOG_MIN) * exp(-FOG_K * depth)), quantised to LIGHT_BANDS steps.
// NEAR_GLOW keeps surfaces right in front of the camera faintly visible in unlit cells.
export const FOG_MIN = 0.1;
export const FOG_K = 0.11;
export const NEAR_GLOW = 0.2;
export const LIGHT_BANDS = 24;

const SHADE = `
#define FOG_MIN ${FOG_MIN.toFixed(4)}
#define FOG_K ${FOG_K.toFixed(4)}
#define NEAR_GLOW ${NEAR_GLOW.toFixed(4)}
#define BANDS ${LIGHT_BANDS.toFixed(1)}
float shade(float light, float depth) {
  float f = exp(-FOG_K * depth);
  float g = f * f;
  g *= g;
  float b = max(light * (FOG_MIN + (1.0 - FOG_MIN) * f), NEAR_GLOW * g * g);
  return floor(b * BANDS + 0.5) * (1.0 / BANDS);
}
`;

// With EMU_MEDIUMP defined, texture coordinates are rounded to 11 significant bits before the
// lookup, which is what a 16-bit mediump float keeps. Desktop GPUs run mediump at full precision,
// so this is the only way to see phone-class precision in a desktop test.
const EMU = `
#ifdef EMU_MEDIUMP
float q16(float x) {
  if (x == 0.0) return 0.0;
  float s = exp2(floor(log2(abs(x))) - 10.0);
  return floor(x / s + 0.5) * s;
}
vec2 q16(vec2 v) { return vec2(q16(v.x), q16(v.y)); }
#else
#define q16(v) (v)
#endif
`;

export const WORLD_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec2 aLight;      // x = light, y = flicker amount
uniform mat4 uMat;
uniform vec2 uLightMod;     // x = flicker noise 0..1, y = extra light
varying vec2 vUv;
varying float vLight;
varying float vDepth;
void main() {
  gl_Position = uMat * vec4(aPos, 1.0);
  vUv = aUv;
  vLight = aLight.x * (1.0 - aLight.y * uLightMod.x) + uLightMod.y;
  vDepth = gl_Position.w;
}
`;

export const WORLD_FS = `
precision mediump float;
${SHADE}${EMU}
uniform sampler2D uTex;
uniform float uFullbright;
varying vec2 vUv;
varying float vLight;
varying float vDepth;
void main() {
  vec3 c = texture2D(uTex, q16(vUv)).rgb;
  gl_FragColor = vec4(c * mix(shade(vLight, vDepth), 1.0, uFullbright), 1.0);
}
`;

// Billboards and the weapon. A billboard has one depth, so all shading is done per vertex.
// aLight.y pulls the depth value towards the camera so a sprite standing against a wall is not
// cut by it; the screen position is unchanged.
export const SPRITE_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec2 aLight;      // x = light (negative = fullbright), y = depth bias in world units
uniform mat4 uMat;
uniform vec4 uParams;       // x, y = depth terms (ndc z = x + y / depth), z = fog on, w = extra light
${SHADE}
varying vec2 vUv;
varying float vShade;
void main() {
  vec4 p = uMat * vec4(aPos, 1.0);
  float d = max(p.w - aLight.y, p.w * 0.6);
  p.z = (uParams.x + uParams.y / d) * p.w;
  gl_Position = p;
  vUv = aUv;
  vShade = aLight.x < 0.0 ? 1.0 : shade(aLight.x + uParams.w, p.w * uParams.z);
}
`;

// Atlas coordinates need more than 11 bits, so the varying is highp where the GPU has it
// (every iPhone does). Without it the image is still right to within half a texel.
export const SPRITE_FS = `
precision mediump float;
${EMU}
#if defined(GL_FRAGMENT_PRECISION_HIGH) && !defined(EMU_MEDIUMP)
varying highp vec2 vUv;
#else
varying vec2 vUv;
#endif
uniform sampler2D uTex;
varying float vShade;
void main() {
  vec4 c = texture2D(uTex, q16(vUv));
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * vShade, 1.0);
}
`;

// Full-screen strip. u follows the view angle of each column so the sky turns with the world.
export const SKY_VS = `
attribute vec3 aPos;        // xy = clip position
uniform vec4 uSky;          // x = u at screen centre, y = tan(half horizontal fov), z = repeats / 2 pi, w = v scale
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos.xy, 0.0, 1.0);
  vUv = vec2(uSky.x + atan(aPos.x * uSky.y) * uSky.z, (1.0 - aPos.y) * uSky.w);
}
`;

export const SKY_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
}
`;
