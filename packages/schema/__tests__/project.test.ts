import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import {
	PROJECT_FORMAT,
	PROJECT_SCHEMA_VERSION,
	parseProject,
	serializeProject,
	validateProject,
} from '@mytw/schema'
import type {
	Project,
	ProjectImageLayer,
	ProjectIssue,
	ProjectIssueCode,
	ProjectSketchLayer,
} from '@mytw/schema'

const HASH = `sha256:${'ab'.repeat(32)}`
const OTHER_HASH = `sha256:${'cd'.repeat(32)}`
const UPPER_HASH = `sha256:${'AB'.repeat(32)}`
const LAYER = 'tracks[0].clips[0].layers[0]'
const SKETCH = 'tracks[0].clips[0].layers[1]'

/** A valid sketch layer, added after the image layer by `addSketch`. */
const sketchLayer: ProjectSketchLayer = {
	id: 'orbits',
	kind: 'sketch',
	sketch: 'basic-orbits',
	version: 1,
	seed: 7,
	params: {
		format: 'mytw-params',
		version: 1,
		values: { count: 12, size: 0.5, showBackground: false, background: '#000000', at: [0, 1] },
	},
	visible: true,
	opacity: 1,
	blend: 'screen',
	feather: 0,
	transform: {
		centerX: 0.5,
		centerY: 0.5,
		zoom: 1,
		rotation: 0,
		mirrorX: false,
		mirrorY: false,
	},
	effects: [],
}

/** A small valid document that every variant starts from. */
const base: Project = {
	format: PROJECT_FORMAT,
	schemaVersion: PROJECT_SCHEMA_VERSION,
	name: 'Test',
	output: { width: 1080, height: 1080, fps: 30, background: '#000000' },
	timeline: { mode: 'loop', frames: 60 },
	assets: { [HASH]: { kind: 'image', mimeType: 'image/png', width: 100, height: 200 } },
	modulators: {
		'drift-x': { shape: 'sine', cycles: 1, phase: 0 },
		fade: {
			shape: 'keyframes',
			keys: [
				{ at: 0, value: 0, easing: 'linear' },
				{ at: 0.5, value: 1, easing: 'easeInOutQuad' },
				{ at: 1, value: 0, easing: 'linear' },
			],
		},
	},
	tracks: [
		{
			id: 'main',
			kind: 'visual',
			clips: [
				{
					id: 'clip',
					start: 0,
					frames: 60,
					fadeIn: 0,
					fadeOut: 0,
					layers: [
						{
							id: 'base',
							kind: 'image',
							asset: HASH,
							visible: true,
							opacity: { value: 1, mod: [{ modulator: 'fade', amount: -0.5, mode: 'add' }] },
							blend: 'normal',
							feather: 0.05,
							transform: {
								centerX: {
									value: 0.5,
									mod: [{ modulator: 'drift-x', amount: 0.01, mode: 'add' }],
								},
								centerY: 0.5,
								zoom: 1.5,
								rotation: 0,
								mirrorX: false,
								mirrorY: false,
							},
							mask: { kind: 'linear-gradient', from: [0.5, 0], to: [0.5, 1] },
							effects: [],
						},
					],
				},
			],
		},
	],
	effects: [
		{
			id: 'vignette',
			effect: 'vignette',
			version: 1,
			enabled: true,
			params: { amount: 0.2, invert: false, mode: 'soft', center: [0.5, 0.5] },
		},
	],
}

function copy(project: Project): Project {
	const result = parseProject(serializeProject(project))
	if (!result.ok) throw new Error(result.issues.map((found) => found.message).join('\n'))
	return result.project
}

/** A copy of the base document with one change. `Reflect` writes values the types don't allow. */
function withPatch(mutate: (doc: Project) => void): Project {
	const doc = copy(base)
	mutate(doc)
	return doc
}

function firstLayer(doc: Project): ProjectImageLayer {
	const layer = doc.tracks[0].clips[0].layers[0]
	if (layer.kind !== 'image') throw new Error('expected the image layer first')
	return layer
}

/** Adds a copy of `sketchLayer` and returns it, so a row can change it. */
function addSketch(doc: Project): ProjectSketchLayer {
	const layer: ProjectSketchLayer = JSON.parse(JSON.stringify(sketchLayer))
	doc.tracks[0].clips[0].layers.push(layer)
	return layer
}

function issuesOf(input: unknown): ProjectIssue[] {
	const result = parseProject(input)
	return result.ok ? [] : result.issues
}

type Expected = { path: string; code: ProjectIssueCode; message?: string }
type Row = [label: string, mutate: (doc: Project) => void, expected: Expected]

function expectIssue(input: unknown, expected: Expected) {
	expect(issuesOf(input)).toContainEqual(expect.objectContaining(expected))
}

describe('parseProject', () => {
	it('accepts the base document', () => {
		expect(issuesOf(base)).toEqual([])
		expect(validateProject(base)).toEqual({ ok: true, project: base })
	})

	const structural: Row[] = [
		[
			'a missing field',
			(doc) => Reflect.deleteProperty(doc.output, 'fps'),
			{ path: 'output.fps', code: 'missing', message: 'output.fps: is missing' },
		],
		[
			'a missing root field',
			(doc) => Reflect.deleteProperty(doc, 'tracks'),
			{ path: 'tracks', code: 'missing', message: 'tracks: is missing' },
		],
		[
			'a wrong type',
			(doc) => Reflect.set(doc.output, 'width', '1080'),
			{ path: 'output.width', code: 'type', message: 'output.width: expected a finite number' },
		],
		[
			'a wrong type for an object',
			(doc) => Reflect.set(doc, 'timeline', []),
			{ path: 'timeline', code: 'type', message: 'timeline: expected an object' },
		],
		[
			'a range violation',
			(doc) => (firstLayer(doc).feather = 0.6),
			{
				path: `${LAYER}.feather`,
				code: 'range',
				message: `${LAYER}.feather: 0.6 is outside [0, 0.5]`,
			},
		],
		[
			'a range violation on an animated value',
			(doc) => (firstLayer(doc).transform.zoom = { value: 0, mod: [] }),
			{
				path: `${LAYER}.transform.zoom.value`,
				code: 'range',
				message: `${LAYER}.transform.zoom.value: 0 is outside (0, Infinity]`,
			},
		],
		[
			'a phase of one whole turn',
			(doc) => (doc.modulators['drift-x'] = { shape: 'sine', cycles: 1, phase: 1 }),
			{
				path: 'modulators["drift-x"].phase',
				code: 'range',
				message: 'modulators["drift-x"].phase: 1 is outside [0, 1)',
			},
		],
		[
			'a non-integer cycles value',
			(doc) => (doc.modulators['drift-x'] = { shape: 'sine', cycles: 1.5, phase: 0 }),
			{
				path: 'modulators["drift-x"].cycles',
				code: 'integer',
				message: 'modulators["drift-x"].cycles: expected an integer, got 1.5',
			},
		],
		[
			'a bad blend option',
			(doc) => Reflect.set(firstLayer(doc), 'blend', 'overlay'),
			{
				path: `${LAYER}.blend`,
				code: 'option',
				message: `${LAYER}.blend: "overlay" is not one of normal, multiply, screen, add`,
			},
		],
		[
			'a reserved track kind',
			(doc) => Reflect.set(doc.tracks[0], 'kind', 'audio'),
			{ path: 'tracks[0].kind', code: 'option' },
		],
		[
			'an empty name',
			(doc) => (doc.name = ''),
			{ path: 'name', code: 'length', message: 'name: has 0 characters, expected 1 to 200' },
		],
		[
			'an empty keyframes list',
			(doc) => (doc.modulators.fade = { shape: 'keyframes', keys: [] }),
			{ path: 'modulators["fade"].keys', code: 'length' },
		],
		['a bad id', (doc) => (doc.tracks[0].id = '-main'), { path: 'tracks[0].id', code: 'pattern' }],
		[
			'a bad effect param key',
			(doc) => (doc.effects[0].params['1x'] = 1),
			{ path: 'effects[0].params["1x"]', code: 'pattern' },
		],
		[
			'a bad effect param value',
			(doc) => Reflect.set(doc.effects[0].params, 'amount', null),
			{ path: 'effects[0].params["amount"]', code: 'type' },
		],
		[
			'a sketch layer with an asset',
			(doc) => Reflect.set(addSketch(doc), 'asset', HASH),
			{ path: `${SKETCH}.asset`, code: 'unknown' },
		],
		[
			'a bad sketch name',
			(doc) => (addSketch(doc).sketch = 'Basic_Orbits'),
			{
				path: `${SKETCH}.sketch`,
				code: 'pattern',
				message: `${SKETCH}.sketch: "Basic_Orbits" is not a sketch id (lowercase letters and digits, joined by -)`,
			},
		],
		[
			'a sketch version below 1',
			(doc) => (addSketch(doc).version = 0),
			{ path: `${SKETCH}.version`, code: 'range' },
		],
		[
			'a sketch params envelope of another format',
			(doc) => Reflect.set(addSketch(doc).params, 'format', 'other'),
			{ path: `${SKETCH}.params.format`, code: 'option' },
		],
		[
			'a sketch param value that is an object',
			(doc) => Reflect.set(addSketch(doc).params.values, 'count', { value: 1, mod: [] }),
			{
				path: `${SKETCH}.params.values["count"]`,
				code: 'type',
				message: `${SKETCH}.params.values["count"]: expected a number, boolean, string or [number, number]`,
			},
		],
		[
			'a bad sketch param key',
			(doc) => (addSketch(doc).params.values['1x'] = 1),
			{ path: `${SKETCH}.params.values["1x"]`, code: 'pattern' },
		],
		[
			'a non-integer sketch seed',
			(doc) => (addSketch(doc).seed = 0.5),
			{ path: `${SKETCH}.seed`, code: 'integer' },
		],
	]

	it.each(structural)('reports structural issues: %s', (_label, mutate, expected) => {
		expectIssue(withPatch(mutate), expected)
	})

	it('accepts a sketch layer next to an image layer', () => {
		const doc = withPatch((patched) => {
			addSketch(patched)
		})
		expect(issuesOf(doc)).toEqual([])
		const result = parseProject(serializeProject(doc))
		expect(result.ok && result.project.tracks[0].clips[0].layers[1]).toEqual(sketchLayer)
	})

	it('reports structural issues once per value, in document order', () => {
		const doc = withPatch((patched) => {
			Reflect.set(patched.output, 'width', 1.5)
			patched.name = ''
		})
		expect(issuesOf(doc).map((found) => found.path)).toEqual(['name', 'output.width'])
	})

	it('rejects unknown fields', () => {
		const cases: [mutate: (doc: Project) => void, path: string][] = [
			[(doc) => Reflect.set(doc, 'formats', {}), 'formats'],
			[(doc) => Reflect.set(firstLayer(doc), 'color', 'red'), `${LAYER}.color`],
			[(doc) => Reflect.set(firstLayer(doc).transform, 'skew', 0), `${LAYER}.transform.skew`],
		]
		for (const [mutate, path] of cases) {
			expect(issuesOf(withPatch(mutate))).toEqual([
				{ path, code: 'unknown', message: `${path}: is not a known field` },
			])
		}
	})

	it('preserves extensions', () => {
		const extensions = {
			'com.example/tool': { nested: [1, 'two', null, true, { deep: [] }] },
			note: 'kept as is',
		}
		const doc = withPatch((patched) => {
			patched.extensions = extensions
			firstLayer(patched).extensions = { locked: true }
			patched.effects[0].extensions = { preset: 'soft' }
			patched.modulators['drift-x'] = { shape: 'sine', cycles: 1, phase: 0, extensions: { a: 1 } }
		})
		const first = parseProject(doc)
		if (!first.ok) throw new Error(first.issues[0].message)
		const second = parseProject(serializeProject(first.project))
		if (!second.ok) throw new Error(second.issues[0].message)
		expect(second.project).toEqual(doc)
		expect(second.project.extensions).toEqual(extensions)
		expect(firstLayer(second.project).extensions).toEqual({ locked: true })
	})

	it('rejects extension values that are not JSON', () => {
		const cases: [unknown, string][] = [
			[{ bad: Number.NaN }, 'extensions["bad"]'],
			[{ list: [1, undefined] }, 'extensions["list"][1]'],
			[{ when: new Date(0) }, 'extensions["when"]'],
		]
		for (const [extensions, path] of cases) {
			const doc = withPatch((patched) => Reflect.set(patched, 'extensions', extensions))
			expect(issuesOf(doc)).toEqual([expect.objectContaining({ path, code: 'type' })])
		}
	})

	it('rejects extension values nested too deeply', () => {
		let deep: unknown = 1
		for (let i = 0; i < 1000; i++) deep = [deep]
		const doc = withPatch((patched) => Reflect.set(patched, 'extensions', { deep }))
		expect(issuesOf(doc)).toEqual([expect.objectContaining({ code: 'type' })])
		expect(issuesOf(serializeProject(doc))).toEqual([expect.objectContaining({ code: 'type' })])
	})

	const crossReference: Row[] = [
		[
			'an asset key that is not a content hash',
			(doc) => (doc.assets['./a.png'] = doc.assets[HASH]),
			{
				path: 'assets["./a.png"]',
				code: 'pattern',
				message: 'assets["./a.png"]: "./a.png" is not a sha256 content hash',
			},
		],
		[
			'an asset key in uppercase hex',
			(doc) => (doc.assets[UPPER_HASH] = doc.assets[HASH]),
			{ path: `assets[${JSON.stringify(UPPER_HASH)}]`, code: 'pattern' },
		],
		[
			'a layer asset that is a path',
			(doc) => (firstLayer(doc).asset = './a.png'),
			{
				path: `${LAYER}.asset`,
				code: 'pattern',
				message: `${LAYER}.asset: "./a.png" is not a sha256 content hash`,
			},
		],
		[
			'an asset name with a slash',
			(doc) => (doc.assets[HASH] = { ...doc.assets[HASH], name: 'images/a.png' }),
			{ path: `assets[${JSON.stringify(HASH)}].name`, code: 'pattern' },
		],
		[
			'an asset name with a backslash',
			(doc) => (doc.assets[HASH] = { ...doc.assets[HASH], name: 'images\\a.png' }),
			{ path: `assets[${JSON.stringify(HASH)}].name`, code: 'pattern' },
		],
		[
			'a well-formed hash missing from assets',
			(doc) => (firstLayer(doc).asset = OTHER_HASH),
			{
				path: `${LAYER}.asset`,
				code: 'reference',
				message: `${LAYER}.asset: no asset "${OTHER_HASH}"`,
			},
		],
		[
			'an unknown modulator',
			(doc) =>
				(firstLayer(doc).transform.centerY = {
					value: 0.5,
					mod: [{ modulator: 'nope', amount: 1, mode: 'add' }],
				}),
			{
				path: `${LAYER}.transform.centerY.mod[0].modulator`,
				code: 'reference',
				message: `${LAYER}.transform.centerY.mod[0].modulator: no modulator "nope"`,
			},
		],
		[
			'an unknown modulator in an effect param',
			(doc) =>
				(doc.effects[0].params.amount = {
					value: 0.2,
					mod: [{ modulator: 'nope', amount: 1, mode: 'multiply' }],
				}),
			{ path: 'effects[0].params["amount"].mod[0].modulator', code: 'reference' },
		],
		[
			'a duplicate id across a layer and an effect',
			(doc) => (doc.effects[0].id = 'base'),
			{
				path: 'effects[0].id',
				code: 'duplicate',
				message: `effects[0].id: id "base" is already used at ${LAYER}.id`,
			},
		],
		[
			'a clip past the timeline end',
			(doc) => (doc.tracks[0].clips[0].start = 1),
			{ path: 'tracks[0].clips[0].frames', code: 'timeline' },
		],
		[
			'fades longer than the clip',
			(doc) => Object.assign(doc.tracks[0].clips[0], { fadeIn: 40, fadeOut: 30 }),
			{ path: 'tracks[0].clips[0].fadeOut', code: 'timeline' },
		],
		[
			'two overlapping clips',
			(doc) => {
				const [clip] = doc.tracks[0].clips
				clip.frames = 30
				doc.tracks[0].clips.push({ ...clip, id: 'second', start: 20, layers: [] })
			},
			{
				path: 'tracks[0].clips[1].start',
				code: 'timeline',
				message: 'tracks[0].clips[1].start: overlaps clip "clip"',
			},
		],
		[
			'unordered keyframes',
			(doc) => {
				const fade = doc.modulators.fade
				if (fade.shape === 'keyframes') fade.keys[1].at = 0
			},
			{ path: 'modulators["fade"].keys[1].at', code: 'order' },
		],
		[
			'a loop keyframe seam',
			(doc) => {
				const fade = doc.modulators.fade
				if (fade.shape === 'keyframes') fade.keys[2].value = 1
			},
			{ path: 'modulators["fade"].keys[2].value', code: 'seam' },
		],
		[
			'a mask with from equal to to',
			(doc) => (firstLayer(doc).mask = { kind: 'linear-gradient', from: [0.5, 0], to: [0.5, 0] }),
			{ path: `${LAYER}.mask.to`, code: 'range' },
		],
	]

	it.each(crossReference)('reports cross-reference issues: %s', (_label, mutate, expected) => {
		expectIssue(withPatch(mutate), expected)
	})

	it('allows clips that touch, unused assets and modulators, and seams outside loop mode', () => {
		const doc = withPatch((patched) => {
			const [clip] = patched.tracks[0].clips
			clip.frames = 30
			patched.tracks[0].clips.push({ ...clip, id: 'second', start: 30, layers: [] })
			patched.assets[OTHER_HASH] = patched.assets[HASH]
			patched.modulators.unused = { shape: 'noise', cycles: 2, phase: 0.5, seed: 7 }
			patched.timeline.mode = 'sequence'
			const fade = patched.modulators.fade
			if (fade.shape === 'keyframes') fade.keys[2].value = 1
		})
		expect(issuesOf(doc)).toEqual([])
	})

	it('rejects non-project and newer documents', () => {
		const cases: [input: unknown, path: string, code: ProjectIssueCode][] = [
			['{"format": ', '', 'json'],
			['[]', '', 'format'],
			[withPatch((doc) => Reflect.set(doc, 'format', 'mytw-params')), 'format', 'format'],
			[withPatch((doc) => Reflect.deleteProperty(doc, 'format')), 'format', 'format'],
			[withPatch((doc) => Reflect.set(doc, 'schemaVersion', 0)), 'schemaVersion', 'format'],
			[withPatch((doc) => Reflect.set(doc, 'schemaVersion', 1.5)), 'schemaVersion', 'format'],
			[withPatch((doc) => Reflect.set(doc, 'schemaVersion', '1')), 'schemaVersion', 'format'],
			[withPatch((doc) => Reflect.set(doc, 'schemaVersion', 3)), 'schemaVersion', 'newer-version'],
		]
		for (const [input, path, code] of cases) {
			expect(issuesOf(input)).toEqual([expect.objectContaining({ path, code })])
		}
		expect(issuesOf('not json')).toEqual([
			{ path: '', code: 'json', message: 'document: Not valid JSON' },
		])
		expect(issuesOf(withPatch((doc) => Reflect.set(doc, 'schemaVersion', 3)))).toEqual([
			{
				path: 'schemaVersion',
				code: 'newer-version',
				message: 'schemaVersion: saved by a newer version (v3), this app reads up to v2',
			},
		])
	})

	it('round-trips through serialize', () => {
		const fixture = readFileSync(
			resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/v1/understory.json'),
			'utf8'
		)
		const parsed = parseProject(fixture)
		if (!parsed.ok) throw new Error(parsed.issues[0].message)
		expect(parsed.migratedFrom).toBe(1)
		const text = serializeProject(parsed.project)
		expect(text.startsWith('{\n\t"format": "mytw-project",\n\t"schemaVersion": 2,')).toBe(true)
		expect(JSON.parse(text)).toEqual({ ...JSON.parse(fixture), schemaVersion: 2 })
		const again = parseProject(text)
		expect(again.ok && again.project).toEqual(parsed.project)

		const input = copy(base)
		const before = serializeProject(input)
		const result = parseProject(input)
		if (!result.ok) throw new Error(result.issues[0].message)
		expect(result.migratedFrom).toBeNull()
		expect(result.project).toEqual(input)
		expect(serializeProject(input)).toBe(before)
		const inputObjects = objectsIn(input)
		const shared = [...objectsIn(result.project)].filter((found) => inputObjects.has(found))
		expect(shared).toEqual([])
	})

	it('does not follow __proto__ keys', () => {
		const text = serializeProject(base).replace(
			/^\{/,
			'{"extensions":{"__proto__":{"polluted":true}},'
		)
		const result = parseProject(text)
		if (!result.ok) throw new Error(result.issues[0].message)
		const { extensions } = result.project
		expect(extensions && Object.hasOwn(extensions, '__proto__')).toBe(true)
		expect(extensions && Object.getPrototypeOf(extensions)).toBe(Object.prototype)
		expect(Reflect.get(extensions ?? {}, 'polluted')).toBeUndefined()
		expect(Reflect.get(result.project, 'polluted')).toBeUndefined()
		expect(Reflect.get({}, 'polluted')).toBeUndefined()
		expect(serializeProject(result.project)).toContain('"__proto__": {')
	})

	it('types the parsed project', () => {
		const result = parseProject(serializeProject(base))
		if (!result.ok) throw new Error(result.issues[0].message)
		const project: Project = result.project
		const width: number = project.output.width
		expect(width).toBe(1080)
	})
})

describe('validateProject', () => {
	it('returns the same reference and does not migrate', () => {
		const doc = copy(base)
		const result = validateProject(doc)
		expect(result.ok && result.project).toBe(doc)
	})

	it('reports cross-reference issues only when the structure is valid', () => {
		const doc = withPatch((patched) => {
			patched.effects[0].id = 'base'
			patched.name = ''
		})
		expect(validateProject(doc)).toEqual({
			ok: false,
			issues: [expect.objectContaining({ path: 'name', code: 'length' })],
		})
	})
})

/** Every object and array reachable from a value. */
function objectsIn(value: unknown, found = new Set<object>()): Set<object> {
	if (typeof value !== 'object' || value === null || found.has(value)) return found
	found.add(value)
	for (const child of Object.values(value)) objectsIn(child, found)
	return found
}
