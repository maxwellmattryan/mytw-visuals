import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { MIGRATIONS, migrateProject, parseProject } from '@mytw/schema'
import type { Migration } from '@mytw/schema'

type Doc = Record<string, unknown>

function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null) {
		for (const child of Object.values(value)) deepFreeze(child)
		Object.freeze(value)
	}
	return value
}

function v1(): Doc {
	return deepFreeze({
		format: 'mytw-project',
		schemaVersion: 1,
		name: 'Old',
		tracks: [{ id: 'a' }],
	})
}

/** Synthetic steps: v1 → v2 renames `name` to `title`, v2 → v3 adds `tags`. */
function steps(calls: string[] = []): Migration[] {
	return [
		{
			from: 1,
			to: 2,
			description: 'rename name to title',
			migrate: ({ name, ...rest }) => {
				calls.push('1→2')
				return { ...rest, title: name, schemaVersion: 2 }
			},
		},
		{
			from: 2,
			to: 3,
			description: 'add tags',
			migrate: (doc) => {
				calls.push('2→3')
				doc.tags = []
				doc.schemaVersion = 3
				return doc
			},
		},
	]
}

function migrationMessage(doc: Doc, migrations: Migration[], latest: number) {
	const result = migrateProject(doc, { migrations, latest })
	return result.ok ? undefined : result.issue
}

describe('migrateProject', () => {
	it('migrates v1 to v2 by bumping the version only', () => {
		expect(MIGRATIONS.map(({ from, to }) => [from, to])).toEqual([[1, 2]])
		const fixture = readFileSync(
			resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/v1/understory.json'),
			'utf8'
		)
		const input = JSON.parse(fixture)
		const result = parseProject(fixture)
		if (!result.ok) throw new Error(result.issues[0].message)
		expect(result.migratedFrom).toBe(1)
		expect(result.project).toEqual({ ...input, schemaVersion: 2 })
		expect(migrateProject(v1())).toEqual({ ok: true, from: 1, doc: { ...v1(), schemaVersion: 2 } })
	})

	it('runs the steps in order up to latest, on a copy', () => {
		const calls: string[] = []
		const doc = v1()
		// Listed out of order, so the run order comes from the versions.
		const result = migrateProject(doc, { migrations: steps(calls).reverse(), latest: 3 })
		expect(result).toEqual({
			ok: true,
			from: 1,
			doc: {
				format: 'mytw-project',
				schemaVersion: 3,
				title: 'Old',
				tracks: [{ id: 'a' }],
				tags: [],
			},
		})
		expect(calls).toEqual(['1→2', '2→3'])
		expect(doc).toEqual(v1())
		expect(result.ok && result.doc.tracks).not.toBe(doc.tracks)
	})

	it('starts from the document version', () => {
		const calls: string[] = []
		const doc = deepFreeze({ format: 'mytw-project', schemaVersion: 2, title: 'Mid' })
		const result = migrateProject(doc, { migrations: steps(calls), latest: 3 })
		expect(result.ok && result.from).toBe(2)
		expect(calls).toEqual(['2→3'])
	})

	it('returns the document unchanged when no migration is needed', () => {
		const latest = deepFreeze({ format: 'mytw-project', schemaVersion: 2, name: 'Now' })
		expect(migrateProject(latest)).toEqual({ ok: true, doc: latest, from: 2 })
		const doc = v1()
		const result = migrateProject(doc, { migrations: steps(), latest: 1 })
		expect(result.ok && result.doc).toBe(doc)
		expect(result.ok && result.from).toBe(1)
	})

	it('reports a missing step', () => {
		expect(migrationMessage(v1(), steps().slice(0, 1), 3)).toEqual({
			path: 'schemaVersion',
			code: 'migration',
			message: 'schemaVersion: no migration from v2 to v3',
		})
	})

	it('reports a step that throws, without throwing', () => {
		const throwing = (thrown: unknown): Migration => ({
			from: 1,
			to: 2,
			description: 'throws',
			migrate: () => {
				throw thrown
			},
		})
		expect(migrationMessage(v1(), [throwing(new Error('boom'))], 2)).toEqual(
			expect.objectContaining({ code: 'migration', message: expect.stringContaining('boom') })
		)
		expect(migrationMessage(v1(), [throwing({ odd: true })], 2)).toEqual(
			expect.objectContaining({ code: 'migration' })
		)
		// Changing the frozen input in place would throw, so steps must get a copy.
		const inPlace: Migration = {
			from: 1,
			to: 2,
			description: 'in place',
			migrate: (doc) => Object.assign(doc, { schemaVersion: 2 }),
		}
		expect(migrateProject(v1(), { migrations: [inPlace], latest: 2 }).ok).toBe(true)
	})

	it('reports a step whose output has the wrong schemaVersion', () => {
		const wrong: Migration = {
			from: 1,
			to: 2,
			description: 'forgets the version',
			migrate: (doc) => ({ ...doc }),
		}
		expect(migrationMessage(v1(), [wrong], 2)).toEqual(
			expect.objectContaining({ path: 'schemaVersion', code: 'migration' })
		)
		const skipping: Migration = {
			...wrong,
			to: 3,
			migrate: (doc) => ({ ...doc, schemaVersion: 3 }),
		}
		expect(migrationMessage(v1(), [skipping], 3)).toEqual(
			expect.objectContaining({ code: 'migration' })
		)
	})

	it('rejects versions it cannot migrate from', () => {
		expect(migrationMessage({ schemaVersion: 4 }, steps(), 3)).toEqual(
			expect.objectContaining({ code: 'newer-version' })
		)
		expect(migrationMessage({ schemaVersion: 0 }, steps(), 3)).toEqual(
			expect.objectContaining({ code: 'format' })
		)
	})
})
