/**
 * Shared GLSL helpers. Bodies use only syntax that is valid in both GLSL ES 1.00 and 3.00 (no
 * texture lookups, no in/out/varying, no preprocessor directives), so p5 sketches written in
 * GLSL ES 1.00 can paste them in with `glslChunks`.
 */

export interface Chunk<K extends string = string> {
	readonly id: K
	/** Chunks whose definitions this chunk uses. They are emitted before it. */
	readonly requires: readonly K[]
	readonly glsl: string
}

const math = `const float PI = 3.14159265359;
const float TAU = 6.28318530718;

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * p;
}`

const noise = `// value-noise fbm
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}`

const color = `// rotate hue about the gray (1,1,1) axis — preserves luminance, no clipping
vec3 hueRotate(vec3 col, float angle) {
  vec3 k = vec3(0.57735);
  float c = cos(angle);
  return col * c + cross(k, col) * sin(angle) + k * dot(k, col) * (1.0 - c);
}`

const mask = `// 1.0 inside [0,1]^2, feathering to 0.0 at the borders
float edgeMask(vec2 uv, float f) {
  vec2 w = smoothstep(vec2(0.0), vec2(f), uv) * smoothstep(vec2(1.0), vec2(1.0) - f, uv);
  return w.x * w.y;
}`

export type ChunkId = 'math' | 'noise' | 'color' | 'mask'

/** The chunk library, keyed by id. */
export const CHUNKS: Readonly<Record<ChunkId, Chunk<ChunkId>>> = Object.freeze({
	math: Object.freeze({ id: 'math', requires: Object.freeze([]), glsl: math }),
	noise: Object.freeze({ id: 'noise', requires: Object.freeze([]), glsl: noise }),
	color: Object.freeze({ id: 'color', requires: Object.freeze([]), glsl: color }),
	mask: Object.freeze({ id: 'mask', requires: Object.freeze([]), glsl: mask }),
})

export function isChunkId(id: unknown): id is ChunkId {
	return typeof id === 'string' && Object.hasOwn(CHUNKS, id)
}

/**
 * Returns the requested chunks plus everything they require, dependencies first, each once. Throws
 * an `Error` naming an id that is not in the library.
 */
export function resolveChunks<K extends string>(
	ids: readonly K[],
	library: Readonly<Record<K, Chunk<K>>>
): Chunk<K>[] {
	const out: Chunk<K>[] = []
	const seen = new Set<string>()
	const visit = (id: K): void => {
		if (seen.has(id)) return
		if (!Object.hasOwn(library, id)) throw new Error(`Unknown chunk "${id}"`)
		seen.add(id)
		const chunk = library[id]
		for (const dep of chunk.requires) visit(dep)
		out.push(chunk)
	}
	for (const id of ids) visit(id)
	return out
}

/** GLSL source for the requested chunks and their dependencies, in dependency order. */
export function glslChunks(ids: readonly ChunkId[]): string {
	return resolveChunks(ids, CHUNKS)
		.map((chunk) => chunk.glsl)
		.join('\n\n')
}
