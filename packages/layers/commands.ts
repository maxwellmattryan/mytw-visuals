// Command builders. Each takes the current project and returns a `Command` for the document store,
// or `null` when the edit would change nothing. None of them mutates the project.
import type { Command, JsonValue, Path } from '@mytw/document'
import type {
	LayerMask,
	LayerTransform,
	Project,
	ProjectClip,
	ProjectImageLayer,
	ProjectLayer,
	ProjectTrack,
} from '@mytw/schema'
import { nextId } from './ids'
import type { ImportedImage } from './import'
import { clipAt, layersPath } from './target'
import type { ClipRef } from './target'

export type BlendMode = ProjectLayer['blend']

/** The longest layer name the format allows. */
export const MAX_NAME_LENGTH = 200

/** The format's Neutral column for every field the properties panel resets. */
export const NEUTRAL = {
	opacity: 1,
	blend: 'normal',
	feather: 0,
	centerX: 0.5,
	centerY: 0.5,
	zoom: 1,
	rotation: 0,
	mirrorX: false,
	mirrorY: false,
} as const satisfies Record<string, number | boolean | BlendMode>

export const NEUTRAL_TRANSFORM: LayerTransform = {
	centerX: NEUTRAL.centerX,
	centerY: NEUTRAL.centerY,
	zoom: NEUTRAL.zoom,
	rotation: NEUTRAL.rotation,
	mirrorX: NEUTRAL.mirrorX,
	mirrorY: NEUTRAL.mirrorY,
}

/** Fully visible at the top, faded out by the bottom. */
export const DEFAULT_MASK: LayerMask = { kind: 'linear-gradient', from: [0.5, 0], to: [0.5, 1] }

/**
 * Project values are plain JSON by construction (they passed `validateProject`), but their inferred
 * types carry optional keys, which `JsonValue` can't express.
 */
function json(value: unknown): JsonValue {
	return value as JsonValue
}

/** A layer's label: its `name`, else its `id`. */
export function displayName(layer: ProjectLayer): string {
	return layer.name ?? layer.id
}

export function layerAt(project: Project, ref: ClipRef, index: number): ProjectLayer | null {
	return clipAt(project, ref)?.layers[index] ?? null
}

export function layerPath(ref: ClipRef, index: number): Path {
	return [...layersPath(ref), index]
}

/** A deep copy of plain JSON data (project values always are). */
function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

/** Cuts text to the format's name limit. */
function cutName(text: string): string {
	return text.slice(0, MAX_NAME_LENGTH)
}

export interface AddImageLayersResult {
	readonly command: Command
	/** The new layer ids, bottom first. */
	readonly ids: readonly string[]
	/** Where the layers went: `ref`, or the clip this command creates. */
	readonly ref: ClipRef
}

/**
 * Adds one image layer per import on top of the clip's stack, in order, and writes each asset entry
 * the project doesn't hold yet. When the clip doesn't exist, it also appends track `track-1` holding
 * clip `clip-1`. Returns `null` for an empty import.
 */
export function addImageLayers(
	project: Project,
	ref: ClipRef,
	imports: readonly ImportedImage[]
): AddImageLayersResult | null {
	if (imports.length === 0) return null
	const commands: Command[] = []
	const reserved = new Set<string>()
	let target = ref
	let start: number
	const clip = clipAt(project, ref)
	if (clip) {
		start = clip.layers.length
	} else {
		const trackId = nextId(project, 'track-1')
		reserved.add(trackId)
		const clipId = nextId(project, 'clip-1', reserved)
		reserved.add(clipId)
		const newClip: ProjectClip = {
			id: clipId,
			start: 0,
			frames: project.timeline.frames,
			fadeIn: 0,
			fadeOut: 0,
			layers: [],
		}
		const track: ProjectTrack = { id: trackId, kind: 'visual', clips: [newClip] }
		target = { track: project.tracks.length, clip: 0 }
		start = 0
		commands.push({ op: 'insert', path: ['tracks', target.track], value: json(track) })
	}

	const written = new Set<string>()
	const ids: string[] = []
	imports.forEach((image, i) => {
		if (!Object.hasOwn(project.assets, image.hash) && !written.has(image.hash)) {
			written.add(image.hash)
			commands.push({ op: 'set', path: ['assets', image.hash], value: json(image.asset) })
		}
		const id = nextId(project, 'layer', reserved)
		reserved.add(id)
		ids.push(id)
		const name = image.layerName !== undefined ? cutName(image.layerName) : ''
		const layer: ProjectImageLayer = {
			id,
			...(name !== '' ? { name } : {}),
			kind: 'image',
			asset: image.hash,
			visible: true,
			opacity: NEUTRAL.opacity,
			blend: NEUTRAL.blend,
			feather: NEUTRAL.feather,
			transform: { ...NEUTRAL_TRANSFORM },
			effects: [],
		}
		commands.push({ op: 'insert', path: layerPath(target, start + i), value: json(layer) })
	})
	return { command: { op: 'batch', commands }, ids, ref: target }
}

/**
 * Inserts a deep copy of a layer directly above it. The copy gets a fresh layer id, fresh effect
 * ids and the name `<display name> copy`, and is otherwise identical.
 */
export function duplicateLayer(
	project: Project,
	ref: ClipRef,
	index: number
): { command: Command; id: string } | null {
	const layer = layerAt(project, ref, index)
	if (!layer) return null
	const reserved = new Set<string>()
	const id = nextId(project, layer.id)
	reserved.add(id)
	const effects = layer.effects.map((effect) => {
		const effectId = nextId(project, effect.id, reserved)
		reserved.add(effectId)
		return { ...cloneJson(effect), id: effectId }
	})
	const copy: ProjectLayer = {
		...cloneJson(layer),
		id,
		name: cutName(`${displayName(layer)} copy`),
		effects,
	}
	return {
		command: { op: 'insert', path: layerPath(ref, index + 1), value: json(copy) },
		id,
	}
}

/** Removes a layer. Its asset stays in `assets`, which undo needs. */
export function deleteLayer(project: Project, ref: ClipRef, index: number): Command | null {
	if (!layerAt(project, ref, index)) return null
	return { op: 'remove', path: layerPath(ref, index) }
}

/**
 * Renames a layer. The text is trimmed and cut to 200 characters. Empty text removes `name`, so
 * the layer shows its id. Text equal to the current display name changes nothing.
 */
export function renameLayer(
	project: Project,
	ref: ClipRef,
	index: number,
	text: string
): Command | null {
	const layer = layerAt(project, ref, index)
	if (!layer) return null
	const name = cutName(text.trim()).trim()
	const path = [...layerPath(ref, index), 'name']
	if (name === '') return layer.name === undefined ? null : { op: 'remove', path }
	if (name === displayName(layer)) return null
	return { op: 'set', path, value: name }
}

/** Moves a layer from array index `from` to `to` (bottom is 0). */
export function moveLayer(
	project: Project,
	ref: ClipRef,
	from: number,
	to: number
): Command | null {
	const clip = clipAt(project, ref)
	if (!clip || from === to) return null
	const count = clip.layers.length
	if (from < 0 || from >= count || to < 0 || to >= count) return null
	return { op: 'move', path: layersPath(ref), from, to }
}

export function setLayerVisible(
	project: Project,
	ref: ClipRef,
	index: number,
	visible: boolean
): Command | null {
	const layer = layerAt(project, ref, index)
	if (!layer || layer.visible === visible) return null
	return { op: 'set', path: [...layerPath(ref, index), 'visible'], value: visible }
}

export function setLayerBlend(
	project: Project,
	ref: ClipRef,
	index: number,
	blend: BlendMode
): Command | null {
	const layer = layerAt(project, ref, index)
	if (!layer || layer.blend === blend) return null
	return { op: 'set', path: [...layerPath(ref, index), 'blend'], value: blend }
}

function valueAt(root: unknown, path: Path): unknown {
	let node = root
	for (const segment of path) {
		if (typeof node !== 'object' || node === null) return undefined
		node = (node as Record<string | number, unknown>)[segment]
	}
	return node
}

function isModulated(value: unknown): value is { value: number; mod: unknown[] } {
	return typeof value === 'object' && value !== null && 'value' in value && 'mod' in value
}

/** The number an animatable field holds: itself, or the `value` of `{ value, mod }`. */
export function animatableValue(value: unknown): number | undefined {
	if (typeof value === 'number') return value
	return isModulated(value) ? value.value : undefined
}

/**
 * Sets an animatable number. When the field holds `{ value, mod }`, only `value` changes and the
 * bindings stay. Returns `null` when the number is already `value`.
 */
export function setAnimatable(project: Project, path: Path, value: number): Command | null {
	const current = valueAt(project, path)
	if (animatableValue(current) === value) return null
	if (isModulated(current)) return { op: 'set', path: [...path, 'value'], value }
	return { op: 'set', path, value }
}

export function setField(path: Path, value: JsonValue): Command {
	return { op: 'set', path, value }
}

export function addMask(ref: ClipRef, index: number): Command {
	return setField([...layerPath(ref, index), 'mask'], json(DEFAULT_MASK))
}

export function removeMask(ref: ClipRef, index: number): Command {
	return { op: 'remove', path: [...layerPath(ref, index), 'mask'] }
}
