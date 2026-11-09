// State and gestures for the stage: the viewport and guides (view state only), the selected
// layer's gizmo, and framing gestures that edit base values through the document store, so undo
// covers them. No DOM or Svelte: the overlay feeds it stage-px points.
import type { Command } from '@mytw/document'
import type { Project, ProjectLayer } from '@mytw/schema'
import { compileScene } from '@mytw/scene'
import type { Scene } from '@mytw/scene'
import { layerPath, setAnimatable } from '../layers/commands'
import type { LayersController } from '../layers/controller'
import { findEdgeReveals } from './coverage'
import type { EdgeReveal } from './coverage'
import {
	angleDelta,
	angleFromUp,
	baseTransform,
	layerQuad,
	panTransform,
	rotateByScreenAngle,
	screenAngle,
	sourceSize,
	zoomTransformAbout,
} from './geometry'
import type { BaseTransform, Size, Vec2 } from './geometry'
import type { AspectGuide } from './guides'
import { actualSize, canvasToStage, fitView, panView, stageToCanvas, zoomViewAt } from './viewport'
import type { View } from './viewport'

export type GestureKind = 'move' | 'zoom' | 'rotate'

export interface StageControllerOptions {
	readonly layers: LayersController
	/**
	 * The host's compiled scene, for the edge warning. Without it the controller compiles the
	 * document itself. Return `null` when the document doesn't compile.
	 */
	readonly scene?: () => Scene | null
}

export interface SelectedLayer {
	readonly layer: ProjectLayer
	readonly index: number
	readonly transform: BaseTransform
	readonly source: Size
}

/** The gizmo in stage px. */
export interface Gizmo {
	readonly center: Vec2
	readonly ring: number
	readonly zoomHandle: Vec2
	/** Where the rotation handle's stem leaves the ring. */
	readonly stem: Vec2
	readonly rotateHandle: Vec2
	/** The source rectangle's corners, from source UV (0,0), (1,0), (1,1), (0,1). */
	readonly outline: readonly Vec2[]
	/** Whether the edge warning reports this layer. */
	readonly warn: boolean
}

export interface StageController {
	readonly view: View
	readonly stageSize: Size
	readonly output: Size
	setStageSize(width: number, height: number): void
	/** Zooms the viewport by `factor` about `stagePoint`, by default the stage centre. */
	zoomView(factor: number, stagePoint?: Vec2): void
	fit(): void
	actualSize(): void
	panViewBy(dx: number, dy: number): void
	readonly safeArea: boolean
	readonly aspect: AspectGuide | null
	toggleSafeArea(): void
	setAspect(ratio: AspectGuide | null): void
	readonly selected: SelectedLayer | null
	readonly gizmo: Gizmo | null
	/** What a pointerdown at `stagePoint` would grab, or `null` with nothing selected. */
	hitTest(stagePoint: Vec2): GestureKind | null
	readonly gesture: GestureKind | null
	/** Starts a pointer gesture. Returns `false` (and does nothing) with nothing selected. */
	beginGesture(kind: GestureKind, stagePoint: Vec2): boolean
	updateGesture(stagePoint: Vec2): void
	/** Ends the gesture as one undo step. */
	endGesture(): void
	/** Ends the gesture and restores the values from before it. */
	cancelGesture(): void
	/** Zooms the selected layer about the pointer; `deltaY` in px. */
	wheelZoom(deltaY: number, stagePoint: Vec2): void
	/** Rotates the selected layer by `delta / 10` degrees on screen. */
	wheelRotate(delta: number): void
	/** Moves the selected layer by output px, as if dragged. */
	nudge(dx: number, dy: number): void
	toggleMirror(axis: 'x' | 'y'): void
	/** The edge warning for the edited clip, top of the stack first. */
	readonly reveals: readonly EdgeReveal[]
	readonly hint: string | null
	subscribe(fn: () => void): () => void
	destroy(): void
}

export const RING_RADIUS = 64
export const ROTATE_RADIUS = 96
export const HANDLE_HIT = 10
/** The floor on handle distances, so a zoom drag through the centre can't divide by zero. */
const MIN_HANDLE_DISTANCE = 8
/** How long after its last event a wheel or nudge run is sealed into one undo step. */
export const RUN_IDLE_MS = 400
export const SELECT_HINT = 'Select a layer to frame it'

type Field = 'centerX' | 'centerY' | 'zoom' | 'rotation'
const CENTER: readonly Field[] = ['centerX', 'centerY']

function round6(value: number): number {
	return Math.round(value * 1e6) / 1e6
}

function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1])
}

interface Gesture {
	readonly kind: GestureKind
	readonly id: string
	readonly t0: BaseTransform
	readonly source: Size
	readonly start: Vec2
	readonly center: Vec2
	readonly scale: number
	readonly key: string
	lastAngle: number
	turned: number
	applied: boolean
}

export function createStageController(options: StageControllerOptions): StageController {
	const { layers } = options
	const store = layers.store
	const subscribers = new Set<() => void>()
	let stageSize: Size = { width: 0, height: 0 }
	let view: View = { scale: 1, x: 0, y: 0, fitted: true }
	let safeArea = false
	let aspect: AspectGuide | null = null
	let gesture: Gesture | null = null
	let gestures = 0
	let runTimer: ReturnType<typeof setTimeout> | null = null
	let selectedId = layers.selectedId
	let destroyed = false

	// The edge warning, memoized on the document and the scene.
	let memoDoc: Project | null = null
	let memoScene: Scene | null = null
	let memoReveals: readonly EdgeReveal[] = []
	let ownSceneDoc: Project | null = null
	let ownScene: Scene | null = null

	const notify = () => {
		for (const fn of [...subscribers]) fn()
	}

	const output = (): Size => ({
		width: store.document.output.width,
		height: store.document.output.height,
	})

	const selected = (): SelectedLayer | null => {
		const id = layers.selectedId
		if (id === null) return null
		const list = layers.layers
		const index = list.findIndex((layer) => layer.id === id)
		if (index === -1) return null
		const layer = list[index]
		return {
			layer,
			index,
			transform: baseTransform(layer),
			source: sourceSize(store.document, layer),
		}
	}

	/** The canvas centre in stage px. */
	const centre = (): Vec2 => {
		const out = output()
		return canvasToStage(view, [out.width / 2, out.height / 2])
	}

	/** A stage point to output px relative to the canvas centre. */
	const toCentred = (point: Vec2): Vec2 => {
		const out = output()
		const [x, y] = stageToCanvas(view, point)
		return [x - out.width / 2, y - out.height / 2]
	}

	const scene = (): Scene | null => {
		const doc = store.document
		if (options.scene) return options.scene()
		if (ownSceneDoc !== doc) {
			ownSceneDoc = doc
			try {
				ownScene = compileScene(doc)
			} catch {
				ownScene = null
			}
		}
		return ownScene
	}

	const reveals = (): readonly EdgeReveal[] => {
		const doc = store.document
		let current: Scene | null
		try {
			current = scene()
		} catch {
			current = null
		}
		if (doc === memoDoc && current === memoScene) return memoReveals
		memoDoc = doc
		memoScene = current
		try {
			memoReveals = findEdgeReveals(doc, current, layers.ref)
		} catch {
			memoReveals = []
		}
		return memoReveals
	}

	const clearRun = () => {
		if (runTimer !== null) clearTimeout(runTimer)
		runTimer = null
	}

	/** Seals the store and ends any wheel or nudge run. */
	const seal = () => {
		clearRun()
		store.seal()
	}

	const scheduleSeal = () => {
		clearRun()
		runTimer = setTimeout(() => {
			runTimer = null
			store.seal()
		}, RUN_IDLE_MS)
	}

	/**
	 * Writes `fields` of `target` to the layer, rounded to 1e-6, as one command merged under
	 * `mergeKey`. Returns whether a command was applied.
	 */
	const write = (
		id: string,
		target: BaseTransform,
		fields: readonly Field[],
		mergeKey: string
	): boolean => {
		const index = layers.layers.findIndex((layer) => layer.id === id)
		if (index === -1) return false
		const base = [...layerPath(layers.ref, index), 'transform']
		const commands: Command[] = []
		for (const field of fields) {
			const command = setAnimatable(store.document, [...base, field], round6(target[field]))
			if (command) commands.push(command)
		}
		if (commands.length === 0) return false
		const command: Command = commands.length === 1 ? commands[0] : { op: 'batch', commands }
		const result = store.apply(command, { mergeKey })
		if (!result.ok) {
			layers.setError(result.error.message)
			return false
		}
		return true
	}

	/** One event of a wheel or nudge run on the selected layer. */
	const runEdit = (
		kind: 'wheel-zoom' | 'wheel-rotate' | 'nudge',
		fields: readonly Field[],
		edit: (sel: SelectedLayer) => BaseTransform
	) => {
		if (destroyed || gesture) return
		const sel = selected()
		if (!sel) return
		write(sel.layer.id, edit(sel), fields, `stage:${sel.layer.id}:${kind}`)
		scheduleSeal()
	}

	const gizmo = (): Gizmo | null => {
		const sel = selected()
		if (!sel) return null
		const out = output()
		const c = centre()
		const phi = screenAngle(sel.transform)
		const dir: Vec2 = [Math.sin(phi), -Math.cos(phi)]
		const outline = layerQuad(sel.transform, out, sel.source).map((p) =>
			canvasToStage(view, [p[0] + out.width / 2, p[1] + out.height / 2])
		)
		return {
			center: c,
			ring: RING_RADIUS,
			zoomHandle: [c[0] + RING_RADIUS, c[1]],
			stem: [c[0] + dir[0] * RING_RADIUS, c[1] + dir[1] * RING_RADIUS],
			rotateHandle: [c[0] + dir[0] * ROTATE_RADIUS, c[1] + dir[1] * ROTATE_RADIUS],
			outline,
			warn: reveals().some((reveal) => reveal.layerId === sel.layer.id),
		}
	}

	const setView = (next: View) => {
		view = next
		notify()
	}

	const stopLayers = layers.subscribe(() => {
		if (layers.selectedId !== selectedId) {
			selectedId = layers.selectedId
			if (runTimer !== null) seal()
			if (gesture && gesture.id !== selectedId) {
				gesture = null
				store.seal()
			}
		}
		notify()
	})

	return {
		get view() {
			return view
		},
		get stageSize() {
			return stageSize
		},
		get output() {
			return output()
		},
		setStageSize(width, height) {
			if (width === stageSize.width && height === stageSize.height) return
			stageSize = { width, height }
			if (view.fitted) view = fitView(stageSize, output())
			notify()
		},
		zoomView(factor, stagePoint) {
			setView(zoomViewAt(view, factor, stagePoint ?? [stageSize.width / 2, stageSize.height / 2]))
		},
		fit() {
			setView(fitView(stageSize, output()))
		},
		actualSize() {
			setView(actualSize(stageSize, output()))
		},
		panViewBy(dx, dy) {
			setView(panView(view, dx, dy))
		},
		get safeArea() {
			return safeArea
		},
		get aspect() {
			return aspect
		},
		toggleSafeArea() {
			safeArea = !safeArea
			notify()
		},
		setAspect(ratio) {
			if (ratio === aspect) return
			aspect = ratio
			notify()
		},
		get selected() {
			return selected()
		},
		get gizmo() {
			return gizmo()
		},
		hitTest(stagePoint) {
			const g = gizmo()
			if (!g) return null
			if (distance(stagePoint, g.rotateHandle) <= HANDLE_HIT) return 'rotate'
			if (distance(stagePoint, g.zoomHandle) <= HANDLE_HIT) return 'zoom'
			return 'move'
		},
		get gesture() {
			return gesture?.kind ?? null
		},
		beginGesture(kind, stagePoint) {
			if (destroyed) return false
			const sel = selected()
			if (!sel) return false
			seal()
			const center = centre()
			const angle = angleFromUp([stagePoint[0] - center[0], stagePoint[1] - center[1]])
			gesture = {
				kind,
				id: sel.layer.id,
				t0: sel.transform,
				source: sel.source,
				start: stagePoint,
				center,
				scale: view.scale,
				key: `stage:${++gestures}`,
				lastAngle: angle,
				turned: 0,
				applied: false,
			}
			notify()
			return true
		},
		updateGesture(point) {
			const g = gesture
			if (!g || destroyed) return
			const out = output()
			let target: BaseTransform
			let fields: readonly Field[]
			if (g.kind === 'move') {
				const delta: Vec2 = [(point[0] - g.start[0]) / g.scale, (point[1] - g.start[1]) / g.scale]
				target = panTransform(g.t0, out, g.source, delta)
				fields = CENTER
			} else if (g.kind === 'zoom') {
				const factor =
					Math.max(distance(point, g.center), MIN_HANDLE_DISTANCE) /
					Math.max(distance(g.start, g.center), MIN_HANDLE_DISTANCE)
				target = zoomTransformAbout(g.t0, out, g.source, factor, [0, 0])
				fields = ['zoom']
			} else {
				const angle = angleFromUp([point[0] - g.center[0], point[1] - g.center[1]])
				g.turned += angleDelta(angle, g.lastAngle)
				g.lastAngle = angle
				target = rotateByScreenAngle(g.t0, g.turned)
				fields = ['rotation']
			}
			if (write(g.id, target, fields, g.key)) g.applied = true
		},
		endGesture() {
			if (!gesture) return
			gesture = null
			store.seal()
			notify()
		},
		cancelGesture() {
			const g = gesture
			if (!g) return
			gesture = null
			store.seal()
			// The merge key is unique to this gesture, so the top undo step is its own.
			if (g.applied) store.undo()
			notify()
		},
		wheelZoom(deltaY, stagePoint) {
			runEdit('wheel-zoom', ['zoom', ...CENTER], (sel) =>
				zoomTransformAbout(
					sel.transform,
					output(),
					sel.source,
					Math.exp(-deltaY / 500),
					toCentred(stagePoint)
				)
			)
		},
		wheelRotate(delta) {
			runEdit('wheel-rotate', ['rotation'], (sel) =>
				rotateByScreenAngle(sel.transform, ((delta / 10) * Math.PI) / 180)
			)
		},
		nudge(dx, dy) {
			runEdit('nudge', CENTER, (sel) => panTransform(sel.transform, output(), sel.source, [dx, dy]))
		},
		toggleMirror(axis) {
			if (destroyed || gesture) return
			const sel = selected()
			if (!sel) return
			const field = axis === 'x' ? 'mirrorX' : 'mirrorY'
			seal()
			const result = store.apply({
				op: 'set',
				path: [...layerPath(layers.ref, sel.index), 'transform', field],
				value: !sel.transform[field],
			})
			store.seal()
			if (!result.ok) layers.setError(result.error.message)
		},
		get reveals() {
			return reveals()
		},
		get hint() {
			return selected() ? null : SELECT_HINT
		},
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
		destroy() {
			if (destroyed) return
			destroyed = true
			clearRun()
			stopLayers()
			subscribers.clear()
			gesture = null
		},
	}
}
