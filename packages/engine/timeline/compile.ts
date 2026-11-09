import type { NoiseFn } from '@lib/math'

import { EASES, isEaseName, sampleTrack } from './keyframes'
import type { EaseFn, Track } from './keyframes'
import { noiseOut, seededNoise, sineOut, triangleOut } from './modulators'
import type { FrameState, TimelineDocument } from './types'

/** An invalid timeline document. `path` points at the offending field, e.g. `modulators.drift.cycles`. */
export class TimelineError extends Error {
	readonly path: string

	constructor(path: string, message: string) {
		super(`${path}: ${message}`)
		this.name = 'TimelineError'
		this.path = path
	}
}

/** A validated document with a flat evaluation plan. */
export interface Timeline {
	/** Every param id, in document order. */
	readonly paramIds: readonly string[]
	/**
	 * Resolve every param at loop `phase` (0 is the first frame, 1 is one full loop; not
	 * wrapped). Writes into `out` when given and returns it, reusing its vec2 arrays.
	 */
	evaluate(phase: number, out?: FrameState): FrameState
}

const SINE = 0
const TRIANGLE = 1
const NOISE = 2
const SHAPES: Readonly<Record<string, number>> = { sine: SINE, triangle: TRIANGLE, noise: NOISE }

/** One numeric value: a number param, or one component of a vec2 param. */
interface Channel {
	base: number
	track: Track | null
	min: number
	max: number
	/** Indexes into the modulator outputs, paired with `amounts`. */
	mods: number[]
	amounts: number[]
}

interface ModPlan {
	shape: number
	cycles: number
	phase: number
	radius: number
	noise: NoiseFn | null
}

type Entry =
	| { kind: 'static'; id: string; value: number | boolean | string }
	| { kind: 'number'; id: string; ch: number }
	| { kind: 'vec2'; id: string; x: number; y: number }

/** Loosely typed view of a param, for validating documents that came from JSON. */
interface RawParam {
	kind?: unknown
	value?: unknown
	min?: unknown
	max?: unknown
	keys?: unknown
}

interface RawKey {
	t?: unknown
	value?: unknown
	ease?: unknown
}

interface RawModulator {
	shape?: unknown
	cycles?: unknown
	phase?: unknown
	seed?: unknown
	radius?: unknown
	targets?: unknown
}

interface RawTarget {
	param?: unknown
	amount?: unknown
	component?: unknown
}

function fail(path: string, message: string): never {
	throw new TimelineError(path, message)
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v)
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isVec2(v: unknown): v is readonly [number, number] {
	return Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1])
}

function optionalFinite(v: unknown, path: string, fallback: number): number {
	if (v === undefined) return fallback
	if (!isFiniteNumber(v)) fail(path, 'must be a finite number')
	return v
}

/** Validate keyframes and build one track per component (1 for number, 2 for vec2). */
function buildTracks(keys: unknown, path: string, components: 1 | 2): Track[] | null {
	if (keys === undefined) return null
	if (!Array.isArray(keys)) fail(path, 'must be an array of keyframes')
	if (keys.length === 0) return null
	const n = keys.length
	const times = new Float64Array(n)
	const values = Array.from({ length: components }, () => new Float64Array(n))
	const eases: EaseFn[] = []
	keys.forEach((raw: unknown, i) => {
		const kpath = `${path}[${i}]`
		if (!isObject(raw)) fail(kpath, 'must be a keyframe object')
		const key: RawKey = raw
		if (!isFiniteNumber(key.t)) fail(`${kpath}.t`, 'must be a finite number')
		if (i > 0 && key.t <= times[i - 1])
			fail(`${kpath}.t`, 'keyframe times must be strictly ascending')
		times[i] = key.t
		if (components === 1) {
			if (!isFiniteNumber(key.value)) fail(`${kpath}.value`, 'must be a finite number')
			values[0][i] = key.value
		} else {
			if (!isVec2(key.value)) fail(`${kpath}.value`, 'must be two finite numbers')
			values[0][i] = key.value[0]
			values[1][i] = key.value[1]
		}
		if (key.ease !== undefined && !isEaseName(key.ease)) {
			fail(`${kpath}.ease`, `unknown ease '${String(key.ease)}'`)
		}
		eases.push(EASES[key.ease ?? 'linear'])
	})
	return values.map((v) => ({ times, values: v, eases }))
}

class CompiledTimeline implements Timeline {
	readonly paramIds: readonly string[]
	private readonly entries: readonly Entry[]
	private readonly channels: readonly Channel[]
	private readonly mods: readonly ModPlan[]
	private readonly modOut: Float64Array
	private readonly chOut: Float64Array

	constructor(entries: Entry[], channels: Channel[], mods: ModPlan[]) {
		this.paramIds = entries.map((e) => e.id)
		this.entries = entries
		this.channels = channels
		this.mods = mods
		this.modOut = new Float64Array(mods.length)
		this.chOut = new Float64Array(channels.length)
	}

	evaluate(phase: number, out?: FrameState): FrameState {
		if (typeof phase !== 'number' || !Number.isFinite(phase)) {
			throw new RangeError(`phase must be a finite number, got ${String(phase)}`)
		}
		const { mods, modOut, channels, chOut, entries } = this
		for (let m = 0; m < mods.length; m++) {
			const mod = mods[m]
			const x = mod.cycles * phase + mod.phase
			modOut[m] =
				mod.shape === SINE
					? sineOut(x)
					: mod.shape === TRIANGLE
						? triangleOut(x)
						: noiseOut(mod.noise as NoiseFn, mod.radius, x)
		}
		for (let c = 0; c < channels.length; c++) {
			const ch = channels[c]
			let v = ch.track === null ? ch.base : sampleTrack(ch.track, phase)
			for (let k = 0; k < ch.mods.length; k++) v += ch.amounts[k] * modOut[ch.mods[k]]
			chOut[c] = Math.min(Math.max(v, ch.min), ch.max)
		}
		const state: FrameState = out ?? {}
		for (let e = 0; e < entries.length; e++) {
			const entry = entries[e]
			if (entry.kind === 'static') {
				state[entry.id] = entry.value
			} else if (entry.kind === 'number') {
				state[entry.id] = chOut[entry.ch]
			} else {
				const prev = state[entry.id]
				if (Array.isArray(prev) && prev.length === 2) {
					prev[0] = chOut[entry.x]
					prev[1] = chOut[entry.y]
				} else {
					state[entry.id] = [chOut[entry.x], chOut[entry.y]]
				}
			}
		}
		return state
	}
}

/**
 * Validate a timeline document and precompute a flat evaluation plan: one numeric channel
 * per number param and two per vec2 param, each with its keyframe track, bounds and the
 * modulators that drive it. Throws `TimelineError` for an invalid document.
 */
export function compileTimeline(doc: TimelineDocument): Timeline {
	if (!isObject(doc)) fail('', 'document must be an object')
	if (!isObject(doc.params)) fail('params', 'must be an object')
	if (!isObject(doc.modulators)) fail('modulators', 'must be an object')

	const entries: Entry[] = []
	const channels: Channel[] = []
	/** Channel indexes of each animatable param: one for number, two for vec2. */
	const paramChannels = new Map<string, number[]>()

	const addChannel = (base: number, track: Track | null, min: number, max: number): number => {
		channels.push({ base, track, min, max, mods: [], amounts: [] })
		return channels.length - 1
	}

	for (const id of Object.keys(doc.params)) {
		const path = `params.${id}`
		const raw: unknown = doc.params[id]
		if (!isObject(raw)) fail(path, 'must be a param object')
		const p: RawParam = raw
		if (p.kind === 'number' || p.kind === 'vec2') {
			const min = optionalFinite(p.min, `${path}.min`, -Infinity)
			const max = optionalFinite(p.max, `${path}.max`, Infinity)
			if (min > max) fail(`${path}.max`, 'must not be less than min')
			if (p.kind === 'number') {
				if (!isFiniteNumber(p.value)) fail(`${path}.value`, 'must be a finite number')
				const tracks = buildTracks(p.keys, `${path}.keys`, 1)
				const ch = addChannel(p.value, tracks?.[0] ?? null, min, max)
				paramChannels.set(id, [ch])
				entries.push({ kind: 'number', id, ch })
			} else {
				if (!isVec2(p.value)) fail(`${path}.value`, 'must be two finite numbers')
				const tracks = buildTracks(p.keys, `${path}.keys`, 2)
				const x = addChannel(p.value[0], tracks?.[0] ?? null, min, max)
				const y = addChannel(p.value[1], tracks?.[1] ?? null, min, max)
				paramChannels.set(id, [x, y])
				entries.push({ kind: 'vec2', id, x, y })
			}
			continue
		}
		if (p.keys !== undefined)
			fail(`${path}.keys`, `a ${String(p.kind)} param cannot have keyframes`)
		if (p.kind === 'integer') {
			if (!isFiniteNumber(p.value)) fail(`${path}.value`, 'must be a finite number')
			entries.push({ kind: 'static', id, value: p.value })
		} else if (p.kind === 'boolean') {
			if (typeof p.value !== 'boolean') fail(`${path}.value`, 'must be a boolean')
			entries.push({ kind: 'static', id, value: p.value })
		} else if (p.kind === 'enum' || p.kind === 'color') {
			if (typeof p.value !== 'string') fail(`${path}.value`, 'must be a string')
			entries.push({ kind: 'static', id, value: p.value })
		} else {
			fail(`${path}.kind`, `unknown kind '${String(p.kind)}'`)
		}
	}

	const mods: ModPlan[] = []
	for (const id of Object.keys(doc.modulators)) {
		const path = `modulators.${id}`
		const raw: unknown = doc.modulators[id]
		if (!isObject(raw)) fail(path, 'must be a modulator object')
		const m: RawModulator = raw
		const shape =
			typeof m.shape === 'string' && Object.hasOwn(SHAPES, m.shape) ? SHAPES[m.shape] : -1
		if (shape < 0) fail(`${path}.shape`, `unknown shape '${String(m.shape)}'`)
		if (!(typeof m.cycles === 'number' && Number.isInteger(m.cycles) && m.cycles > 0)) {
			fail(`${path}.cycles`, 'must be a positive integer so the loop is seamless')
		}
		const phase = optionalFinite(m.phase, `${path}.phase`, 0)
		const radius = optionalFinite(m.radius, `${path}.radius`, 1)
		const seed = optionalFinite(m.seed, `${path}.seed`, 0)
		if (!Number.isInteger(seed)) fail(`${path}.seed`, 'must be an integer')
		if (!Array.isArray(m.targets)) fail(`${path}.targets`, 'must be an array')
		const index = mods.length
		mods.push({
			shape,
			cycles: m.cycles,
			phase,
			radius,
			noise: shape === NOISE ? seededNoise(seed) : null,
		})

		m.targets.forEach((rawTarget: unknown, j) => {
			const tpath = `${path}.targets[${j}]`
			if (!isObject(rawTarget)) fail(tpath, 'must be a target object')
			const target: RawTarget = rawTarget
			const param = target.param
			if (typeof param !== 'string' || !Object.hasOwn(doc.params, param)) {
				fail(`${tpath}.param`, `unknown param '${String(param)}'`)
			}
			const chs = paramChannels.get(param)
			if (chs === undefined) {
				fail(
					`${tpath}.param`,
					`param '${param}' is ${doc.params[param].kind} and cannot be modulated`
				)
			}
			let ch: number
			if (chs.length === 2) {
				if (target.component !== 0 && target.component !== 1) {
					fail(`${tpath}.component`, 'a vec2 target needs component 0 or 1')
				}
				ch = chs[target.component]
			} else {
				if (target.component !== undefined) {
					fail(`${tpath}.component`, 'a number target must not set component')
				}
				ch = chs[0]
			}
			if (!isFiniteNumber(target.amount)) fail(`${tpath}.amount`, 'must be a finite number')
			channels[ch].mods.push(index)
			channels[ch].amounts.push(target.amount)
		})
	}

	return new CompiledTimeline(entries, channels, mods)
}
