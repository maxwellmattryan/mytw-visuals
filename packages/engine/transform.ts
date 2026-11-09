import type { Fit, LayerTransform } from './types'

export interface Size {
	width: number
	height: number
}

/**
 * The source's size in output-height units for a fit mode, where `Ao` is the
 * output aspect and `As` the source aspect (width / height).
 */
export function fitSize(fit: Fit, outputAspect: number, sourceAspect: number): [number, number] {
	const ao = outputAspect
	const as = sourceAspect
	switch (fit) {
		case 'cover':
			return as >= ao ? [as, 1] : [ao, ao / as]
		case 'contain':
			return as >= ao ? [ao, ao / as] : [as, 1]
		case 'stretch':
			return [ao, 1]
	}
}

/**
 * The affine map from output UV to source UV for a layer, as a column-major 3x3
 * matrix. Both UV spaces run from (0,0) top-left to (1,1) bottom-right:
 *
 * 1. `p = (u - 0.5 - offset) * (Ao, 1)`
 * 2. `p = R(-rotation) * p`
 * 3. `p = p / zoom`
 * 4. mirror flips the sign of `p.x` / `p.y`
 * 5. `s = p / S + center`, with `S` from `fitSize`
 *
 * Pass `out` to reuse an array instead of allocating one, or a `Float64Array` for full precision.
 */
export function layerToSourceMatrix(
	transform: LayerTransform | undefined,
	output: Size,
	source: Size,
	out?: Float32Array
): Float32Array
export function layerToSourceMatrix(
	transform: LayerTransform | undefined,
	output: Size,
	source: Size,
	out: Float64Array
): Float64Array
export function layerToSourceMatrix(
	transform: LayerTransform | undefined,
	output: Size,
	source: Size,
	out: Float32Array | Float64Array = new Float32Array(9)
): Float32Array | Float64Array {
	const t = transform ?? {}
	const [cx, cy] = t.center ?? [0.5, 0.5]
	const [ox, oy] = t.offset ?? [0, 0]
	const zoom = t.zoom ?? 1
	const rotation = t.rotation ?? 0
	const ao = output.width / output.height
	const [sx, sy] = fitSize(t.fit ?? 'cover', ao, source.width / source.height)

	const c = Math.cos(rotation)
	const s = Math.sin(rotation)
	const dx = (t.mirrorX ? -1 : 1) / (zoom * sx)
	const dy = (t.mirrorY ? -1 : 1) / (zoom * sy)

	// L = diag(dx, dy) * R(-rotation) * diag(Ao, 1), with R(-θ) = [[c, s], [-s, c]].
	const l00 = dx * c * ao
	const l01 = dx * s
	const l10 = -dy * s * ao
	const l11 = dy * c

	// s = L * (u - (0.5 + offset)) + center
	const ux = 0.5 + ox
	const uy = 0.5 + oy
	out[0] = l00
	out[1] = l10
	out[2] = 0
	out[3] = l01
	out[4] = l11
	out[5] = 0
	out[6] = cx - (l00 * ux + l01 * uy)
	out[7] = cy - (l10 * ux + l11 * uy)
	out[8] = 1
	return out
}
