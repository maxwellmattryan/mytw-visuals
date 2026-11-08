import { describe, expect, it, jest } from '@jest/globals'

import { affects, createDocumentStore, DocumentLoadError } from '@mytw/document'
import type {
	Command,
	CommandErrorCode,
	DocumentChange,
	DocumentValidation,
	Path,
} from '@mytw/document'

interface Layer {
	id: string
	opacity: number
}

interface Doc {
	name: string
	layers: Layer[]
	output: { width: number; fps: number }
}

const initial = (): Doc => ({
	name: 'demo',
	layers: [
		{ id: 'a', opacity: 1 },
		{ id: 'b', opacity: 0.5 },
		{ id: 'c', opacity: 0 },
	],
	output: { width: 1080, fps: 30 },
})

/** Requires `layers` to be an array of objects with a numeric `opacity` from 0 to 1. */
function validate(doc: unknown): DocumentValidation {
	if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
		return { ok: false, issues: ['document must be an object'] }
	}
	const layers: unknown = (doc as Record<string, unknown>).layers
	if (!Array.isArray(layers)) return { ok: false, issues: ['layers must be an array'] }
	const issues: string[] = []
	layers.forEach((layer: unknown, i) => {
		const opacity =
			typeof layer === 'object' && layer !== null
				? (layer as Record<string, unknown>).opacity
				: undefined
		if (typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
			issues.push(`layers[${i}].opacity must be a number from 0 to 1`)
		}
	})
	return issues.length > 0 ? { ok: false, issues } : { ok: true }
}

const storeOf = (doc: Doc = initial()) => createDocumentStore<Doc>({ document: doc, validate })

/** Lets a test pass a deliberately wrong command through the typed `apply`. */
const raw = (value: unknown) => value as Command

const opacityAt = (doc: Doc) => doc.layers.map((layer) => layer.opacity)

describe('@mytw/document store', () => {
	const primitives: { name: string; command: Command; expected: (doc: Doc) => unknown }[] = [
		{
			name: 'set replaces an object key',
			command: { op: 'set', path: ['layers', 1, 'opacity'], value: 0.25 },
			expected: (doc) => ({
				...doc,
				layers: [doc.layers[0], { id: 'b', opacity: 0.25 }, doc.layers[2]],
			}),
		},
		{
			name: 'set adds an object key',
			command: { op: 'set', path: ['output', 'height'], value: 1920 },
			expected: (doc) => ({ ...doc, output: { width: 1080, fps: 30, height: 1920 } }),
		},
		{
			name: 'set replaces an array element',
			command: { op: 'set', path: ['layers', 0], value: { id: 'z', opacity: 0.1 } },
			expected: (doc) => ({ ...doc, layers: [{ id: 'z', opacity: 0.1 }, ...doc.layers.slice(1)] }),
		},
		{
			name: 'set at [] replaces the document',
			command: { op: 'set', path: [], value: { name: 'new', layers: [] } },
			expected: () => ({ name: 'new', layers: [] }),
		},
		{
			name: 'remove deletes an object key',
			command: { op: 'remove', path: ['output', 'fps'] },
			expected: (doc) => ({ ...doc, output: { width: 1080 } }),
		},
		{
			name: 'remove splices an array element',
			command: { op: 'remove', path: ['layers', 1] },
			expected: (doc) => ({ ...doc, layers: [doc.layers[0], doc.layers[2]] }),
		},
		{
			name: 'insert adds at the start of an array',
			command: { op: 'insert', path: ['layers', 0], value: { id: 'n', opacity: 1 } },
			expected: (doc) => ({ ...doc, layers: [{ id: 'n', opacity: 1 }, ...doc.layers] }),
		},
		{
			name: 'insert appends at the array length',
			command: { op: 'insert', path: ['layers', 3], value: { id: 'n', opacity: 1 } },
			expected: (doc) => ({ ...doc, layers: [...doc.layers, { id: 'n', opacity: 1 }] }),
		},
		{
			name: 'move reorders array elements forward',
			command: { op: 'move', path: ['layers'], from: 0, to: 2 },
			expected: (doc) => ({ ...doc, layers: [doc.layers[1], doc.layers[2], doc.layers[0]] }),
		},
		{
			name: 'move reorders array elements backward',
			command: { op: 'move', path: ['layers'], from: 2, to: 0 },
			expected: (doc) => ({ ...doc, layers: [doc.layers[2], doc.layers[0], doc.layers[1]] }),
		},
	]

	it.each(primitives)('applies each primitive command: $name', ({ command, expected }) => {
		const store = storeOf()
		expect(store.apply(command)).toEqual({ ok: true })
		expect(store.document).toEqual(expected(initial()))
		expect(store.canUndo).toBe(true)
	})

	it.each(primitives)('commands survive a JSON round trip: $name', ({ command }) => {
		const direct = storeOf()
		const roundTripped = storeOf()
		direct.apply(command)
		roundTripped.apply(JSON.parse(JSON.stringify(command)) as Command)
		expect(roundTripped.document).toEqual(direct.document)
	})

	class Point {
		x = 1
	}
	const cyclic: Record<string, unknown> = { id: 'cycle' }
	cyclic.self = cyclic
	const sparse: number[] = []
	sparse[2] = 3

	const rejections: { name: string; command: unknown; code: CommandErrorCode }[] = [
		{ name: 'not an object', command: 'set', code: 'malformed' },
		{ name: 'unknown op', command: { op: 'replace', path: [], value: 1 }, code: 'malformed' },
		{ name: 'missing value', command: { op: 'set', path: ['name'] }, code: 'malformed' },
		{ name: 'extra field', command: { op: 'remove', path: ['name'], value: 1 }, code: 'malformed' },
		{ name: 'path not an array', command: { op: 'remove', path: 'name' }, code: 'malformed' },
		{
			name: 'fractional segment',
			command: { op: 'remove', path: ['layers', 0.5] },
			code: 'malformed',
		},
		{
			name: 'fractional move index',
			command: { op: 'move', path: ['layers'], from: 0.5, to: 1 },
			code: 'malformed',
		},
		{ name: 'batch without a list', command: { op: 'batch', commands: {} }, code: 'malformed' },
		{
			name: 'undefined value',
			command: { op: 'set', path: ['name'], value: undefined },
			code: 'malformed',
		},
		{
			name: 'function value',
			command: { op: 'set', path: ['name'], value: () => 1 },
			code: 'malformed',
		},
		{ name: 'NaN value', command: { op: 'set', path: ['name'], value: NaN }, code: 'malformed' },
		{
			name: 'Infinity value',
			command: { op: 'set', path: ['name'], value: { n: Infinity } },
			code: 'malformed',
		},
		{
			name: 'class instance value',
			command: { op: 'set', path: ['name'], value: new Point() },
			code: 'malformed',
		},
		{
			name: 'Date value',
			command: { op: 'set', path: ['name'], value: new Date(0) },
			code: 'malformed',
		},
		{
			name: 'cyclic value',
			command: { op: 'set', path: ['name'], value: cyclic },
			code: 'malformed',
		},
		{
			name: 'sparse array value',
			command: { op: 'set', path: ['name'], value: sparse },
			code: 'malformed',
		},
		{ name: 'missing key', command: { op: 'set', path: ['missing', 'x'], value: 1 }, code: 'path' },
		{
			name: 'remove a missing key',
			command: { op: 'remove', path: ['output', 'height'] },
			code: 'path',
		},
		{
			name: 'index on an object',
			command: { op: 'set', path: ['output', 0], value: 1 },
			code: 'path',
		},
		{
			name: 'key on an array',
			command: { op: 'set', path: ['layers', 'first'], value: 1 },
			code: 'path',
		},
		{
			name: 'into a primitive',
			command: { op: 'set', path: ['name', 'x'], value: 1 },
			code: 'path',
		},
		{
			name: 'set past the array end',
			command: { op: 'set', path: ['layers', 3], value: { opacity: 1 } },
			code: 'path',
		},
		{ name: 'negative index', command: { op: 'remove', path: ['layers', -1] }, code: 'path' },
		{
			name: 'insert past the length',
			command: { op: 'insert', path: ['layers', 4], value: { opacity: 1 } },
			code: 'path',
		},
		{
			name: 'insert into an object',
			command: { op: 'insert', path: ['output', 0], value: 1 },
			code: 'path',
		},
		{
			name: 'move out of range',
			command: { op: 'move', path: ['layers'], from: 0, to: 3 },
			code: 'path',
		},
		{
			name: 'move on an object',
			command: { op: 'move', path: ['output'], from: 0, to: 0 },
			code: 'path',
		},
		{ name: 'remove the root', command: { op: 'remove', path: [] }, code: 'path' },
		{
			name: '__proto__ key',
			command: { op: 'set', path: ['__proto__', 'polluted'], value: true },
			code: 'path',
		},
		{
			name: 'set __proto__',
			command: { op: 'set', path: ['output', '__proto__'], value: {} },
			code: 'path',
		},
		{
			name: 'inherited key',
			command: { op: 'set', path: ['output', 'toString', 'x'], value: 1 },
			code: 'path',
		},
		{
			name: 'validator rejection',
			command: { op: 'set', path: ['layers', 0, 'opacity'], value: 2 },
			code: 'invalid',
		},
		{
			name: 'validator rejects a removed key',
			command: { op: 'remove', path: ['layers'] },
			code: 'invalid',
		},
	]

	it.each(rejections)('rejects invalid commands atomically: $name', ({ command, code }) => {
		const store = storeOf()
		store.apply({ op: 'set', path: ['name'], value: 'edited' })
		store.apply({ op: 'set', path: ['name'], value: 'again' })
		store.undo()
		const before = store.document
		const listener = jest.fn()
		store.subscribe(listener)

		const result = store.apply(raw(command))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe(code)
			expect(result.error.message).not.toBe('')
		}
		expect(store.document).toBe(before)
		expect(store.canUndo).toBe(true)
		expect(store.canRedo).toBe(true)
		expect(listener).not.toHaveBeenCalled()
	})

	it('rejects invalid commands atomically: validator issues and constructor keys', () => {
		const store = storeOf()
		const invalid = store.apply({ op: 'set', path: ['layers', 2, 'opacity'], value: -1 })
		expect(invalid).toEqual({
			ok: false,
			error: {
				code: 'invalid',
				message: expect.any(String),
				issues: ['layers[2].opacity must be a number from 0 to 1'],
			},
		})

		const empty = createDocumentStore<Record<string, unknown>>({
			document: {},
			validate: () => ({ ok: true }),
		})
		const before = empty.document
		const result = empty.apply({ op: 'set', path: ['constructor', 'prototype', 'x'], value: 1 })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error.code).toBe('path')
		expect(empty.apply({ op: 'remove', path: ['constructor'] }).ok).toBe(false)
		expect(empty.document).toBe(before)
		expect(({} as Record<string, unknown>).x).toBeUndefined()
		expect(Object.prototype).not.toHaveProperty('polluted')
	})

	it('rejects a batch atomically', () => {
		const store = storeOf()
		const before = store.document
		const listener = jest.fn()
		store.subscribe(listener)

		const result = store.apply({
			op: 'batch',
			commands: [
				{ op: 'set', path: ['name'], value: 'renamed' },
				{ op: 'remove', path: ['layers', 0] },
				{ op: 'set', path: ['layers', 9, 'opacity'], value: 0.5 },
			],
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.code).toBe('path')
			expect(result.error.message.startsWith('commands[2]')).toBe(true)
		}
		expect(store.document).toBe(before)
		expect(store.document).toEqual(initial())
		expect(store.canUndo).toBe(false)
		expect(listener).not.toHaveBeenCalled()

		const malformed = store.apply(
			raw({ op: 'batch', commands: [{ op: 'remove', path: ['name'] }, { op: 'nope' }] })
		)
		expect(malformed.ok).toBe(false)
		if (!malformed.ok) expect(malformed.error.message.startsWith('commands[1]')).toBe(true)
	})

	it('undoes a batch as one step', () => {
		const store = storeOf()
		const original = store.document
		const result = store.apply({
			op: 'batch',
			commands: [
				{ op: 'insert', path: ['layers', 0], value: { id: 'n', opacity: 0.2 } },
				{ op: 'set', path: ['layers', 1, 'opacity'], value: 0.3 },
				{ op: 'move', path: ['layers'], from: 0, to: 3 },
				{
					op: 'batch',
					commands: [
						{ op: 'remove', path: ['output', 'fps'] },
						{ op: 'set', path: ['name'], value: 'batched' },
					],
				},
			],
		})
		expect(result).toEqual({ ok: true })
		const after = store.document
		expect(after.name).toBe('batched')
		expect(after.layers.map((layer) => layer.id)).toEqual(['a', 'b', 'c', 'n'])
		expect(opacityAt(after)).toEqual([0.3, 0.5, 0, 0.2])

		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)

		expect(store.redo()).toBe(true)
		expect(store.document).toEqual(after)
		expect(store.canRedo).toBe(false)
	})

	it('undo and redo', () => {
		const store = storeOf()
		expect(store.undo()).toBe(false)
		expect(store.redo()).toBe(false)
		expect(store.canUndo).toBe(false)
		expect(store.canRedo).toBe(false)

		const states = [store.document]
		for (const value of [0.1, 0.2, 0.3]) {
			store.apply({ op: 'set', path: ['layers', 0, 'opacity'], value })
			states.push(store.document)
		}

		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(states[2])
		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(states[1])
		expect(store.redo()).toBe(true)
		expect(store.document).toEqual(states[2])
		expect(store.canRedo).toBe(true)

		store.apply({ op: 'set', path: ['name'], value: 'branch' })
		expect(store.canRedo).toBe(false)
		expect(store.redo()).toBe(false)

		expect(store.undo()).toBe(true)
		expect(store.undo()).toBe(true)
		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(states[0])
		expect(store.undo()).toBe(false)

		const listener = jest.fn()
		const fresh = storeOf()
		fresh.subscribe(listener)
		fresh.undo()
		fresh.redo()
		expect(fresh.apply({ op: 'batch', commands: [] })).toEqual({ ok: true })
		expect(fresh.canUndo).toBe(false)
		expect(listener).not.toHaveBeenCalled()

		fresh.apply({ op: 'set', path: ['name'], value: 'demo' })
		expect(fresh.canUndo).toBe(true)
	})

	it('merges continuous edits with a mergeKey', () => {
		const store = storeOf()
		const original = store.document
		const drag = (value: number, mergeKey = 'layer-0.opacity') =>
			store.apply({ op: 'set', path: ['layers', 0, 'opacity'], value }, { mergeKey })

		for (let i = 1; i <= 10; i++) drag(i / 10)
		expect(store.document.layers[0].opacity).toBe(1)
		expect(store.undo()).toBe(true)
		expect(store.document).toEqual(original)
		expect(store.canUndo).toBe(false)
		expect(store.redo()).toBe(true)
		expect(store.document.layers[0].opacity).toBe(1)

		// After redo, the same key starts a new step.
		drag(0.5)
		store.undo()
		expect(store.document.layers[0].opacity).toBe(1)

		// A different key starts a new step.
		drag(0.4)
		drag(0.3, 'layer-1.opacity')
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.4)

		// seal() starts a new step.
		drag(0.2)
		store.seal()
		drag(0.1)
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.2)

		// undo breaks the run.
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.4)
		drag(0.6)
		drag(0.7)
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.4)

		// An apply without a key breaks the run.
		drag(0.8)
		store.apply({ op: 'set', path: ['name'], value: 'x' })
		drag(0.9)
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.8)

		// A merged run that edits several paths undoes in the right order.
		const multi = storeOf()
		multi.apply(
			{ op: 'insert', path: ['layers', 3], value: { id: 'd', opacity: 0.1 } },
			{ mergeKey: 'k' }
		)
		multi.apply({ op: 'set', path: ['layers', 3, 'opacity'], value: 0.9 }, { mergeKey: 'k' })
		multi.apply({ op: 'move', path: ['layers'], from: 3, to: 0 }, { mergeKey: 'k' })
		multi.undo()
		expect(multi.document).toEqual(initial())
	})

	it('notifies subscribers with changed paths', () => {
		const store = storeOf()
		const changes: DocumentChange<Doc>[] = []
		const unsubscribe = store.subscribe((change) => changes.push(change))
		const start = store.document

		store.apply({
			op: 'batch',
			commands: [
				{ op: 'set', path: ['layers', 1, 'opacity'], value: 0.9 },
				{ op: 'move', path: ['layers'], from: 0, to: 2 },
			],
		})
		expect(changes).toHaveLength(1)
		expect(changes[0]).toEqual({
			document: store.document,
			previous: start,
			paths: [['layers', 1, 'opacity'], ['layers']],
			source: 'apply',
		})
		expect(changes[0].document).toBe(store.document)
		expect(changes[0].previous).toBe(start)

		const afterBatch = store.document
		store.apply({ op: 'set', path: ['output', 'fps'], value: 60 })
		expect(store.document.layers).toBe(afterBatch.layers)
		expect(store.document.output).not.toBe(afterBatch.output)
		expect(start.output.fps).toBe(30)

		const beforeLayerEdit = store.document
		store.apply({ op: 'set', path: ['layers', 0, 'opacity'], value: 0.1 })
		expect(store.document.layers[1]).toBe(beforeLayerEdit.layers[1])
		expect(store.document.layers[2]).toBe(beforeLayerEdit.layers[2])
		expect(store.document.output).toBe(beforeLayerEdit.output)
		expect(beforeLayerEdit.layers[0].opacity).toBe(0.9)

		store.undo()
		store.redo()
		store.load(initial())
		expect(changes.map((change) => change.source)).toEqual([
			'apply',
			'apply',
			'apply',
			'undo',
			'redo',
			'load',
		])
		expect(changes[3].paths).toEqual([['layers', 0, 'opacity']])
		expect(changes[5].paths).toEqual([[]])

		// A listener that unsubscribes another during notification does not break the loop.
		const second = jest.fn()
		let unsubscribeSecond = () => {}
		store.subscribe(() => unsubscribeSecond())
		unsubscribeSecond = store.subscribe(second)
		store.apply({ op: 'set', path: ['name'], value: 'loop' })
		expect(changes).toHaveLength(7)

		unsubscribe()
		store.apply({ op: 'set', path: ['name'], value: 'quiet' })
		expect(changes).toHaveLength(7)
		const callsAfterRemoval = second.mock.calls.length
		store.apply({ op: 'set', path: ['name'], value: 'quieter' })
		expect(second.mock.calls.length).toBe(callsAfterRemoval)
	})

	it('affects matches related paths', () => {
		const change: DocumentChange<Doc> = {
			document: initial(),
			previous: initial(),
			paths: [['layers', 1, 'opacity']],
			source: 'apply',
		}
		const cases: [Path, boolean][] = [
			[['layers', 1, 'opacity'], true],
			[['layers', 1], true],
			[['layers'], true],
			[[], true],
			[['layers', 1, 'opacity', 'deep'], true],
			[['layers', 0], false],
			[['layers', 1, 'id'], false],
			[['output'], false],
			[['layers', '1'], false],
		]
		for (const [path, expected] of cases)
			expect([path, affects(change, path)]).toEqual([path, expected])

		const root: DocumentChange<Doc> = { ...change, paths: [[]] }
		expect(affects(root, ['output', 'fps'])).toBe(true)
	})

	it('copies command values', () => {
		const store = storeOf()
		const layer = { id: 'n', opacity: 0.5, tags: ['x'] }
		store.apply({ op: 'insert', path: ['layers', 0], value: layer })
		layer.opacity = 9
		layer.tags.push('y')
		expect(store.document.layers[0]).toEqual({ id: 'n', opacity: 0.5, tags: ['x'] })

		const path: (string | number)[] = ['layers', 0, 'opacity']
		store.apply({ op: 'set', path, value: 0.25 })
		path[2] = 'id'
		store.undo()
		expect(store.document.layers[0].opacity).toBe(0.5)

		const start = initial()
		const fromStart = storeOf(start)
		start.layers[0].opacity = 7
		expect(fromStart.document.layers[0].opacity).toBe(1)
	})

	it('load replaces the document and clears history', () => {
		const store = storeOf()
		store.apply({ op: 'set', path: ['name'], value: 'one' })
		store.apply({ op: 'set', path: ['name'], value: 'two' })
		store.undo()
		expect(store.canUndo).toBe(true)
		expect(store.canRedo).toBe(true)

		const next: Doc = { name: 'loaded', layers: [], output: { width: 1, fps: 1 } }
		store.load(next)
		expect(store.document).toEqual(next)
		expect(store.canUndo).toBe(false)
		expect(store.canRedo).toBe(false)
		expect(store.undo()).toBe(false)

		const invalid = { ...initial(), layers: [{ id: 'a', opacity: 3 }] }
		expect(() => store.load(invalid)).toThrow(DocumentLoadError)
		expect(store.document).toEqual(next)

		expect(() => storeOf(invalid)).toThrow(DocumentLoadError)
		try {
			storeOf(invalid)
		} catch (error) {
			expect((error as DocumentLoadError).issues).toEqual([
				'layers[0].opacity must be a number from 0 to 1',
			])
		}
		const notJson = { ...initial(), extra: () => 1 }
		expect(() => createDocumentStore({ document: notJson, validate })).toThrow(DocumentLoadError)
	})
})
