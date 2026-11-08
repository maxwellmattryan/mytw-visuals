import { describe, expect, it, jest } from '@jest/globals'

import { defineSchema, param } from '@mytw/schema'

import { createSnapshotStore, STATUS, storageKeyFor } from '../snapshots'
import type { KeyValueStorage } from '../snapshots'
import { createPanelState, isCompareKey } from '../state'

function makeSchema() {
	return defineSchema({
		speed: param.number({ label: 'Speed', default: 1, min: 0, max: 4 }),
		count: param.integer({ label: 'Count', default: 3, min: 1, max: 12 }),
		shape: param.enum({ label: 'Shape', options: ['circle', 'square'], default: 'circle' }),
		fill: param.color({ label: 'Fill', default: '#ff8800' }),
		offset: param.vec2({ label: 'Offset', default: [0, 0], min: -200, max: 200 }),
	})
}

const DEFAULTS = { speed: 1, count: 3, shape: 'circle', fill: '#ff8800', offset: [0, 0] }

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
	const map = new Map<string, string>()
	return {
		map,
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value)
		},
	}
}

function open(storage: KeyValueStorage | null, key = 'mytw:panel:/sketches/test') {
	const state = createPanelState(makeSchema())
	const store = createSnapshotStore(state, storage, key)
	store.restore()
	return { state, store }
}

describe('snapshot store persistence', () => {
	it('restores current values per key', () => {
		const storage = memoryStorage()
		const first = open(storage, 'mytw:panel:/a')
		expect(first.store.status).toBeNull()
		first.state.set('speed', 2.5)
		first.state.set('offset', [10, -20])
		first.store.persist()

		const other = open(storage, 'mytw:panel:/b')
		other.state.set('count', 7)
		other.store.persist()

		const again = open(storage, 'mytw:panel:/a')
		expect(again.state.values).toEqual({ ...DEFAULTS, speed: 2.5, offset: [10, -20] })
		expect(again.store.status).toEqual({ kind: 'info', message: STATUS.restored })

		const otherAgain = open(storage, 'mytw:panel:/b')
		expect(otherAgain.state.values).toEqual({ ...DEFAULTS, count: 7 })
	})

	it('clamps restored values and counts adjustments', () => {
		const storage = memoryStorage()
		storage.setItem(
			'k',
			JSON.stringify({
				format: 'mytw-panel-store',
				version: 1,
				current: { speed: 9, count: 2.4, shape: 'hexagon', removed: true },
				snapshots: [],
			})
		)
		const { state, store } = open(storage, 'k')
		expect(state.values).toEqual({ ...DEFAULTS, speed: 4, count: 2 })
		expect(store.status).toEqual({ kind: 'info', message: 'Restored saved values (4 adjusted)' })
	})
})

describe('snapshots', () => {
	it('saves, loads, renames and deletes snapshots', () => {
		const storage = memoryStorage()
		const { state, store } = open(storage)
		expect(store.defaultName()).toBe('Snapshot 1')

		state.set('speed', 2)
		const first = store.save('')
		expect(first.name).toBe('Snapshot 1')
		state.set('speed', 3)
		const second = store.save(`  ${'x'.repeat(100)}  `)
		expect(second.name).toBe('x'.repeat(80))
		const third = store.save('Snapshot 1')
		expect(store.snapshots.map((s) => s.id)).toEqual([third.id, second.id, first.id])
		expect(third.id).not.toBe(first.id)

		const listener = jest.fn()
		state.onChange(listener)
		store.load(first.id)
		expect(state.values.speed).toBe(2)
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledWith(state.values, null)
		expect(store.status).toEqual({ kind: 'info', message: 'Loaded "Snapshot 1"' })

		expect(store.rename(second.id, '   ')).toEqual({ ok: false, message: STATUS.emptyName })
		expect(store.snapshots[1].name).toBe('x'.repeat(80))
		expect(store.rename(second.id, ' Bright ')).toEqual({ ok: true })
		expect(store.snapshots[1].name).toBe('Bright')

		store.remove(third.id)
		expect(store.snapshots.map((s) => s.name)).toEqual(['Bright', 'Snapshot 1'])

		const reopened = open(storage)
		expect(reopened.store.snapshots.map((s) => s.name)).toEqual(['Bright', 'Snapshot 1'])
		reopened.store.load(reopened.store.snapshots[0].id)
		expect(reopened.state.values.speed).toBe(3)
	})

	it('keeps snapshot values raw and clamps them on load', () => {
		const storage = memoryStorage()
		storage.setItem(
			'k',
			JSON.stringify({
				format: 'mytw-panel-store',
				version: 1,
				current: null,
				snapshots: [{ id: 's1', name: 'Old', savedAt: '', values: { speed: 7, extra: 1 } }],
			})
		)
		const { state, store } = open(storage, 'k')
		store.load('s1')
		expect(state.values.speed).toBe(4)
		expect(store.status).toEqual({
			kind: 'info',
			message: 'Loaded "Old" (2 adjusted)',
			details: ['"speed": 7 is outside [0, 4]', '"extra" is not a param'],
		})
		store.persist()
		const saved = JSON.parse(storage.map.get('k') ?? '')
		expect(saved.snapshots[0].values).toEqual({ speed: 7, extra: 1 })
	})

	it('applies pasted JSON and reports rejections and adjustments', () => {
		const { state, store } = open(null)
		state.set('count', 5)
		expect(store.applyText('nope')).toBe(false)
		expect(store.status).toEqual({ kind: 'error', message: 'Not valid JSON' })
		expect(state.values.count).toBe(5)

		const many = { speed: 9, count: 99, shape: 'x', fill: 'red', offset: [999, 0], a: 1, b: 2 }
		expect(store.applyText(JSON.stringify(many))).toBe(true)
		expect(store.status?.message).toBe('Applied values (7 adjusted)')
		expect(store.status?.details).toHaveLength(6)
		expect(store.status?.details?.[5]).toBe('…and 2 more')

		state.set('speed', 2)
		expect(store.applyText(store.copyText())).toBe(true)
		expect(store.status).toEqual({ kind: 'info', message: 'Applied values' })
		expect(state.values.speed).toBe(2)
	})
})

describe('compare', () => {
	it('compares A and B', () => {
		const storage = memoryStorage()
		const { state, store } = open(storage)
		state.set('speed', 2)
		const snap = store.save('B side')
		state.set('speed', 3)
		store.persist()

		const listener = jest.fn()
		state.onChange(listener)
		store.compare(snap.id)
		expect(store.comparing).toEqual({ id: snap.id, name: 'B side', side: 'b' })
		expect(state.values.speed).toBe(2)

		store.persist()
		expect(JSON.parse(storage.map.get('mytw:panel:/sketches/test') ?? '').current.speed).toBe(3)

		store.swap()
		expect(store.comparing?.side).toBe('a')
		expect(state.values.speed).toBe(3)
		store.swap()
		expect(state.values.speed).toBe(2)
		expect(listener).toHaveBeenCalledTimes(3)

		store.keep('a')
		expect(store.comparing).toBeNull()
		expect(state.values.speed).toBe(3)

		store.compare(snap.id)
		store.keep('b')
		expect(store.comparing).toBeNull()
		expect(state.values.speed).toBe(2)
		expect(open(storage).state.values.speed).toBe(2)

		state.set('speed', 1)
		store.compare(snap.id)
		store.remove(snap.id)
		expect(store.comparing).toBeNull()
		expect(state.values.speed).toBe(1)
	})

	it('edit during compare keeps shown values', () => {
		const { state, store } = open(memoryStorage())
		state.set('speed', 2)
		const first = store.save('first')
		state.set('count', 9)
		const second = store.save('second')
		state.set('speed', 4)
		state.set('count', 1)

		store.compare(first.id)
		store.compare(second.id)
		expect(store.comparing?.name).toBe('second')
		expect(state.values).toMatchObject({ speed: 2, count: 9 })
		store.swap()
		expect(state.values).toMatchObject({ speed: 4, count: 1 })
		store.swap()

		state.set('shape', 'square')
		expect(store.comparing).toBeNull()
		expect(state.values).toMatchObject({ speed: 2, count: 9, shape: 'square' })
		store.swap()
		expect(state.values).toMatchObject({ speed: 2, count: 9, shape: 'square' })
	})
})

describe('storage failures', () => {
	const throwing = (): never => {
		throw new Error('SecurityError')
	}
	const stored = (text: string): KeyValueStorage => ({ getItem: () => text, setItem: () => {} })

	it.each<[string, KeyValueStorage, string]>([
		['getItem throws', { getItem: throwing, setItem: throwing }, STATUS.unavailable],
		['setItem throws', { getItem: () => null, setItem: throwing }, STATUS.writeFailed],
		['corrupt JSON', stored('{ not json'), STATUS.unreadable],
		['an unrecognised shape', stored('{"format":"other","version":1}'), STATUS.unreadable],
		[
			'snapshots of the wrong type',
			stored('{"format":"mytw-panel-store","version":1,"current":null,"snapshots":{}}'),
			STATUS.unreadable,
		],
	])('survives %s', (_name, storage, message) => {
		const setItem = jest.spyOn(storage, 'setItem')
		const { state, store } = open(storage)
		expect(state.values).toEqual(DEFAULTS)
		expect(store.snapshots).toEqual([])
		expect(setItem).not.toHaveBeenCalled()

		state.set('speed', 2)
		expect(() => store.persist()).not.toThrow()
		expect(store.status).toEqual({ kind: 'error', message })

		const snap = store.save('kept')
		state.set('speed', 3)
		expect(() => store.load(snap.id)).not.toThrow()
		expect(state.values.speed).toBe(2)
		expect(store.snapshots.map((s) => s.name)).toEqual(['kept'])
	})

	it('reports a write failure once per streak', () => {
		let fail = true
		const map = new Map<string, string>()
		const storage: KeyValueStorage = {
			getItem: (key) => map.get(key) ?? null,
			setItem: (key, value) => {
				if (fail) throw new Error('quota')
				map.set(key, value)
			},
		}
		const { state, store } = open(storage)
		const statuses = jest.fn()
		store.subscribe(() => statuses(store.status?.message))
		state.set('speed', 2)
		store.persist()
		store.persist()
		expect(statuses.mock.calls.filter(([m]) => m === STATUS.writeFailed)).toHaveLength(1)
		expect(store.status).toEqual({ kind: 'error', message: STATUS.writeFailed })

		fail = false
		store.persist()
		expect(store.status).toBeNull()
		fail = true
		store.persist()
		expect(store.status).toEqual({ kind: 'error', message: STATUS.writeFailed })
	})

	it('keeps snapshots in memory with storage off', () => {
		const { state, store } = open(null)
		expect(store.status).toBeNull()
		state.set('speed', 2)
		const snap = store.save()
		store.persist()
		expect(store.status).toBeNull()
		state.set('speed', 1)
		store.load(snap.id)
		expect(state.values.speed).toBe(2)
	})
})

describe('storageKeyFor', () => {
	it.each([
		['/sketches/002-understory/', 'mytw:panel:/sketches/002-understory'],
		['/sketches/002-understory', 'mytw:panel:/sketches/002-understory'],
		['/sketches/002-understory/index.html', 'mytw:panel:/sketches/002-understory'],
		['/', 'mytw:panel:/'],
		['/index.html', 'mytw:panel:/'],
		['', 'mytw:panel:/'],
	])('storageKeyFor %s', (path, expected) => {
		expect(storageKeyFor(path)).toBe(expected)
	})
})

describe('isCompareKey', () => {
	const key = (
		k: string,
		mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
	) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

	it.each([
		['b', key('b'), { tagName: 'BODY' }, true],
		['B', key('B'), { tagName: 'BUTTON' }, true],
		['b with no active element', key('b'), null, true],
		['another key', key('h'), { tagName: 'BODY' }, false],
		['Ctrl+B', key('b', { ctrlKey: true }), { tagName: 'BODY' }, false],
		['Meta+B', key('b', { metaKey: true }), { tagName: 'BODY' }, false],
		['Alt+B', key('b', { altKey: true }), { tagName: 'BODY' }, false],
		['b in an input', key('b'), { tagName: 'INPUT' }, false],
		['b in a textarea', key('b'), { tagName: 'TEXTAREA' }, false],
		['b in a contenteditable', key('b'), { tagName: 'DIV', isContentEditable: true }, false],
	])('isCompareKey %s', (_name, event, active, expected) => {
		expect(isCompareKey(event, active)).toBe(expected)
	})
})
