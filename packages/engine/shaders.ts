/**
 * Built-in GLSL ES 3.00 sources. Every texture holds row 0 = top, and UV runs
 * from (0,0) top-left to (1,1) bottom-right.
 */

/**
 * Shared by every program. A unit quad at attribute 0 gives the output UV
 * `vUv`. Offscreen passes map UV y to clip y as `2y - 1`; the present pass sets
 * `uFlipY = 1` for `1 - 2y`. Layers map `vUv` to source UV with `uSrcMatrix`.
 */
export const VERTEX = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform float uFlipY;
uniform mat3 uSrcMatrix;
out vec2 vUv;
out vec2 vSrc;
void main() {
	vUv = aPos;
	vSrc = (uSrcMatrix * vec3(aPos, 1.0)).xy;
	float y = mix(2.0 * aPos.y - 1.0, 1.0 - 2.0 * aPos.y, uFlipY);
	gl_Position = vec4(2.0 * aPos.x - 1.0, y, 0.0, 1.0);
}
`

/** Mask kinds as `uMaskKind` values. */
export const MASK_KIND = { none: 0, linear: 1, radial: 2, image: 3 } as const

const MASK = `
uniform int uMaskKind;
uniform vec4 uMaskParams;
uniform float uMaskInvert;
uniform int uMaskChannel;
uniform sampler2D uMaskImage;
uniform float uAspect;

float maskValue(vec2 u) {
	float m;
	if (uMaskKind == 1) {
		vec2 a = uMaskParams.xy;
		vec2 d = uMaskParams.zw - a;
		float t = clamp(dot(u - a, d) / max(dot(d, d), 1e-12), 0.0, 1.0);
		m = 1.0 - smoothstep(0.0, 1.0, t);
	} else if (uMaskKind == 2) {
		float dist = length((u - uMaskParams.xy) * vec2(uAspect, 1.0));
		m = 1.0 - smoothstep(uMaskParams.z, uMaskParams.w, dist);
	} else if (uMaskKind == 3) {
		vec4 c = texture(uMaskImage, u);
		vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
		m = uMaskChannel == 1 ? c.a : dot(rgb, vec3(0.2126, 0.7152, 0.0722));
	} else {
		return 1.0;
	}
	return uMaskInvert > 0.5 ? 1.0 - m : m;
}
`

/**
 * Samples the layer image at source UV, transparent outside [0,1]², with an
 * optional feathered edge. With `uApplyMask = 1` it also applies the mask and
 * opacity (a direct layer pass).
 */
export const LAYER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vSrc;
uniform sampler2D uImage;
uniform float uFeather;
uniform float uOpacity;
uniform float uApplyMask;
out vec4 outColor;
${MASK}
void main() {
	vec2 s = vSrc;
	float k = step(0.0, s.x) * step(s.x, 1.0) * step(0.0, s.y) * step(s.y, 1.0);
	if (uFeather > 0.0) {
		vec2 w = smoothstep(vec2(0.0), vec2(uFeather), s) * (1.0 - smoothstep(vec2(1.0 - uFeather), vec2(1.0), s));
		k *= w.x * w.y;
	}
	if (uApplyMask > 0.5) {
		k *= uOpacity * maskValue(vUv);
	}
	outColor = texture(uImage, s) * k;
}
`

/** Draws a processed layer temp with its mask and opacity. */
export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform float uOpacity;
out vec4 outColor;
${MASK}
void main() {
	outColor = texture(uInput, vUv) * (uOpacity * maskValue(vUv));
}
`

/** Copies the final accumulation buffer to the canvas, opaque. */
export const PRESENT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
out vec4 outColor;
void main() {
	outColor = vec4(texture(uInput, vUv).rgb, 1.0);
}
`
