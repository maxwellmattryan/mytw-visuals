// Framing geometry, by the format's § Transform: `u = c + R(θ)·M·p / (z·s) ⊘ (w, h)`. A point `p`
// is always in output px relative to the canvas centre, with y down. No DOM, no Svelte.
import type { Project, ProjectLayer } from '@mytw/schema'
import { animatableValue } from '../layers/commands'

export type Vec2 = readonly [number, number]

export interface Size {
	readonly width: number
	readonly height: number
}

/** A layer's framing with every animatable field reduced to its base value. */
export interface BaseTransform {
	readonly centerX: number
	readonly centerY: number
	readonly zoom: number
	readonly rotation: number
	readonly mirrorX: boolean
	readonly mirrorY: boolean
}

/** The properties panel's zoom range. */
export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 100

/** The base values of a layer's transform: a `{ value, mod }` field gives its `value`. */
export function baseTransform(layer: ProjectLayer): BaseTransform {
	const tf = layer.transform
	return {
		centerX: animatableValue(tf.centerX) ?? 0.5,
		centerY: animatableValue(tf.centerY) ?? 0.5,
		zoom: animatableValue(tf.zoom) ?? 1,
		rotation: animatableValue(tf.rotation) ?? 0,
		mirrorX: tf.mirrorX,
		mirrorY: tf.mirrorY,
	}
}

/** The asset's size for an image layer, the output size for a sketch layer (or a missing asset). */
export function sourceSize(project: Project, layer: ProjectLayer): Size {
	const output = { width: project.output.width, height: project.output.height }
	if (layer.kind !== 'image') return output
	const asset = Object.hasOwn(project.assets, layer.asset) ? project.assets[layer.asset] : undefined
	return asset ? { width: asset.width, height: asset.height } : output
}

/** The cover-fit scale `s = max(W/w, H/h)`. */
function coverScale(output: Size, source: Size): number {
	return Math.max(output.width / source.width, output.height / source.height)
}

/** `R(θ)·v` with the format's `R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]]`. */
function rotate(theta: number, [x, y]: Vec2): Vec2 {
	const c = Math.cos(theta)
	const s = Math.sin(theta)
	return [c * x + s * y, -s * x + c * y]
}

function mirror(t: BaseTransform, [x, y]: Vec2): Vec2 {
	return [t.mirrorX ? -x : x, t.mirrorY ? -y : y]
}

/** The source UV offset `R(θ)·M·p / (z·s) ⊘ (w, h)` for a canvas offset `p`, at zoom `zoom`. */
function sourceOffset(t: BaseTransform, output: Size, source: Size, p: Vec2, zoom: number): Vec2 {
	const [x, y] = rotate(t.rotation, mirror(t, p))
	const k = zoom * coverScale(output, source)
	return [x / (k * source.width), y / (k * source.height)]
}

/** The source UV under canvas point `p`. */
export function canvasToSource(t: BaseTransform, output: Size, source: Size, p: Vec2): Vec2 {
	const [dx, dy] = sourceOffset(t, output, source, p, t.zoom)
	return [t.centerX + dx, t.centerY + dy]
}

/** The canvas point that shows source UV `u`: `p = M·R(−θ)·((u − c) ⊙ (w, h))·z·s`. */
export function sourceToCanvas(t: BaseTransform, output: Size, source: Size, u: Vec2): Vec2 {
	const k = t.zoom * coverScale(output, source)
	const d: Vec2 = [(u[0] - t.centerX) * source.width * k, (u[1] - t.centerY) * source.height * k]
	return mirror(t, rotate(-t.rotation, d))
}

/** The source rectangle's corners on the canvas, from source UV (0,0), (1,0), (1,1), (0,1). */
export function layerQuad(t: BaseTransform, output: Size, source: Size): [Vec2, Vec2, Vec2, Vec2] {
	return [
		sourceToCanvas(t, output, source, [0, 0]),
		sourceToCanvas(t, output, source, [1, 0]),
		sourceToCanvas(t, output, source, [1, 1]),
		sourceToCanvas(t, output, source, [0, 1]),
	]
}

/** Moves the image by `deltaPx` output px: the source point under a dragged pointer stays under it. */
export function panTransform(
	t0: BaseTransform,
	output: Size,
	source: Size,
	deltaPx: Vec2
): BaseTransform {
	const [dx, dy] = sourceOffset(t0, output, source, deltaPx, t0.zoom)
	return { ...t0, centerX: t0.centerX - dx, centerY: t0.centerY - dy }
}

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Scales zoom by `factor`, clamped to `[0.01, 100]`, keeping the source point under canvas point
 * `anchorPx` fixed: `c' = c + R(θ)·M·a / s ⊘ (w, h) · (1/z − 1/z')`.
 */
export function zoomTransformAbout(
	t0: BaseTransform,
	output: Size,
	source: Size,
	factor: number,
	anchorPx: Vec2
): BaseTransform {
	const zoom = clampZoom(t0.zoom * factor)
	const [ax, ay] = sourceOffset(t0, output, source, anchorPx, 1)
	const k = 1 / t0.zoom - 1 / zoom
	return { ...t0, zoom, centerX: t0.centerX + ax * k, centerY: t0.centerY + ay * k }
}

/** Whether exactly one mirror is on, which flips the on-screen sense of `rotation`. */
function singleMirror(t: BaseTransform): boolean {
	return t.mirrorX !== t.mirrorY
}

/** The on-screen rotation `φ`, clockwise: `θ`, or `−θ` with a single mirror. */
export function screenAngle(t: BaseTransform): number {
	return singleMirror(t) ? -t.rotation : t.rotation
}

/** Turns the image on screen by `dPhi` radians clockwise, about the canvas centre. */
export function rotateByScreenAngle(t0: BaseTransform, dPhi: number): BaseTransform {
	return { ...t0, rotation: t0.rotation + (singleMirror(t0) ? -dPhi : dPhi) }
}

/** The angle of `v` clockwise from straight up, with y down, in `(−π, π]`. */
export function angleFromUp([x, y]: Vec2): number {
	return Math.atan2(x, -y)
}

/** `a − b` wrapped into `(−π, π]`. */
export function angleDelta(a: number, b: number): number {
	let d = a - b
	while (d > Math.PI) d -= 2 * Math.PI
	while (d <= -Math.PI) d += 2 * Math.PI
	return d
}
