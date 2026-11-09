export interface Size {
	readonly width: number
	readonly height: number
}

/**
 * The largest `output`-shaped rectangle that fits in `box` minus `padding` on each side, in whole
 * CSS pixels (contain fit). `{ width: 0, height: 0 }` when there is no room or no output.
 */
export function fitRect(output: Size, box: Size, padding = 16): Size {
	const room = { width: box.width - 2 * padding, height: box.height - 2 * padding }
	if (!(room.width >= 1 && room.height >= 1 && output.width > 0 && output.height > 0))
		return { width: 0, height: 0 }
	const scale = Math.min(room.width / output.width, room.height / output.height)
	// At least 1 px, so an extreme ratio still shows as a line rather than vanishing.
	return {
		width: Math.max(1, Math.floor(output.width * scale)),
		height: Math.max(1, Math.floor(output.height * scale)),
	}
}
