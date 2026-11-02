/**
 * GLSL fragment shaders for p5 WebGL sketches.
 */

export type UniformName = string

export function FRAG_PASSTHROUGH(): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;

void main() {
  gl_FragColor = texture2D(uTexture, vTexCoord);
}
`
}

export function FRAG_CHROMATIC_ABERRATION(amount: UniformName = 'uAmount'): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float ${amount};

void main() {
  vec2 uv = vTexCoord;
  float r = texture2D(uTexture, uv + vec2(${amount}, 0.0)).r;
  float g = texture2D(uTexture, uv).g;
  float b = texture2D(uTexture, uv - vec2(${amount}, 0.0)).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
`
}

export function FRAG_SINE_DISPLACEMENT(
	amplitude: UniformName = 'uAmplitude',
	frequency: UniformName = 'uFrequency',
	time: UniformName = 'uTime'
): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float ${amplitude};
uniform float ${frequency};
uniform float ${time};

void main() {
  vec2 uv = vTexCoord;
  uv.x += sin(uv.y * ${frequency} + ${time}) * ${amplitude};
  uv.y += cos(uv.x * ${frequency} + ${time}) * ${amplitude};
  gl_FragColor = texture2D(uTexture, uv);
}
`
}

export function FRAG_FEEDBACK(decay: UniformName = 'uDecay'): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform sampler2D uPrevFrame;
uniform float ${decay};

void main() {
  vec4 current = texture2D(uTexture, vTexCoord);
  vec4 prev = texture2D(uPrevFrame, vTexCoord);
  gl_FragColor = mix(current, prev, ${decay});
}
`
}

export function FRAG_HUE_SHIFT(shift: UniformName = 'uShift'): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float ${shift};

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d+e)), d/(q.x+e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 color = texture2D(uTexture, vTexCoord);
  vec3 hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + ${shift});
  gl_FragColor = vec4(hsv2rgb(hsv), color.a);
}
`
}

export function FRAG_SCANLINES(
	intensity: UniformName = 'uIntensity',
	count: UniformName = 'uCount'
): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float ${intensity};
uniform float ${count};

void main() {
  vec4 color = texture2D(uTexture, vTexCoord);
  float scanline = sin(vTexCoord.y * ${count} * 3.14159) * ${intensity};
  gl_FragColor = vec4(color.rgb - scanline, color.a);
}
`
}

export function FRAG_VIGNETTE(
	intensity: UniformName = 'uIntensity',
	smoothness: UniformName = 'uSmoothness'
): string {
	return `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform float ${intensity};
uniform float ${smoothness};

void main() {
  vec4 color = texture2D(uTexture, vTexCoord);
  vec2 uv = vTexCoord;
  float d = distance(uv, vec2(0.5));
  float vignette = smoothstep(${intensity}, ${intensity} - ${smoothness}, d);
  gl_FragColor = vec4(color.rgb * vignette, color.a);
}
`
}
