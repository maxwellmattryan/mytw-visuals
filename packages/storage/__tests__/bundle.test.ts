import { describe, expect, it } from '@jest/globals'
import { IDBFactory } from 'fake-indexeddb'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { hashBytes } from '@mytw/assets'
import { PROJECT_SCHEMA_VERSION, serializeProject } from '@mytw/schema'
import {
	BUNDLE_FORMAT,
	BUNDLE_VERSION,
	createLocalProjectStore,
	exportProjectBundle,
	importProjectBundle,
	newProject,
	ProjectStoreError,
} from '@mytw/storage'
import type { ProjectStore, ProjectStoreErrorCode } from '@mytw/storage'

import { projectWithAssets, rawCount, readFixture } from '../testing/fixtures'

const IMAGE = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
const THUMBNAIL = new Uint8Array([137, 80, 78, 71, 9])

function openStore(factory = new IDBFactory()): Promise<ProjectStore> {
	return createLocalProjectStore({ indexedDB: factory, storage: null })
}

function zip(files: Record<string, Uint8Array | string>): Uint8Array {
	const entries: Record<string, Uint8Array> = {}
	for (const [name, content] of Object.entries(files))
		entries[name] = typeof content === 'string' ? strToU8(content) : content
	return zipSync(entries, { level: 0 })
}

const manifest = (bundleVersion = BUNDLE_VERSION) =>
	JSON.stringify({ format: BUNDLE_FORMAT, bundleVersion, missingAssets: [] })

/** Rewrites the first central-directory entry's declared uncompressed size. */
function declareSize(bytes: Uint8Array, size: number): Uint8Array {
	const copy = bytes.slice()
	const view = new DataView(copy.buffer)
	for (let i = 0; i < copy.length - 4; i++) {
		if (view.getUint32(i, true) === 0x02014b50) {
			view.setUint32(i + 24, size, true)
			return copy
		}
	}
	throw new Error('no central directory entry')
}

async function rejection(promise: Promise<unknown>): Promise<ProjectStoreError> {
	try {
		await promise
	} catch (error) {
		if (error instanceof ProjectStoreError) return error
		throw error
	}
	throw new Error('expected a rejection')
}

describe('project bundles', () => {
	it('round trip', async () => {
		const source = await openStore()
		const hash = await source.putAsset(IMAGE)
		const meta = await source.create(projectWithAssets('My Project! (final)', [hash]))
		await source.setThumbnail(meta.id, THUMBNAIL, 'image/png')
		await source.setLastOpened(null)

		const exported = await exportProjectBundle(source, meta.id)
		expect(exported.fileName).toBe('my-project-final.mytw.zip')
		expect(await source.lastOpened()).toBeNull()
		const methods: Record<string, number> = {}
		const files = unzipSync(exported.bytes, {
			filter: (file) => {
				methods[file.name] = file.compression
				return true
			},
		})
		expect(Object.keys(files).sort()).toEqual(
			[`assets/${hash}`, 'mytw-bundle.json', 'project.json', 'thumbnail.png'].sort()
		)
		expect(Object.values(methods).every((method) => method === 0)).toBe(true)
		expect(JSON.parse(strFromU8(files['mytw-bundle.json']))).toEqual({
			format: BUNDLE_FORMAT,
			bundleVersion: BUNDLE_VERSION,
			missingAssets: [],
		})
		expect(files[`assets/${hash}`]).toEqual(IMAGE)

		const targetFactory = new IDBFactory()
		const target = await openStore(targetFactory)
		const imported = await importProjectBundle(target, exported.bytes)
		expect(imported.missingAssets).toEqual([])
		expect(imported.meta.name).toBe('My Project! (final)')
		expect(imported.meta.id).not.toBe(meta.id)
		expect(imported.meta.hasThumbnail).toBe(true)
		expect((await target.open(imported.meta.id)).project).toEqual(
			(await source.open(meta.id)).project
		)
		expect(await target.read(hash)).toEqual(IMAGE)
		expect(await target.getThumbnail(imported.meta.id)).toEqual({
			bytes: THUMBNAIL,
			mimeType: 'image/png',
		})

		// Importing again stores a second project but no second copy of the asset.
		const again = await importProjectBundle(target, exported.bytes)
		expect(again.meta.id).not.toBe(imported.meta.id)
		expect(await target.list()).toHaveLength(2)
		expect(await rawCount(targetFactory, 'assets')).toBe(1)

		// A v1 project.json migrates on import.
		const v1 = await importProjectBundle(
			target,
			zip({
				'mytw-bundle.json': manifest(),
				'project.json': JSON.stringify(readFixture('v1/minimal.json')),
			})
		)
		expect(v1.meta.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
		expect((await target.open(v1.meta.id)).project.name).toBe('Minimal')

		// A missing asset is listed on export and import rather than failing.
		const absent = '0'.repeat(64)
		const damaged = await source.create(projectWithAssets('Damaged', [hash, absent]))
		const partial = await exportProjectBundle(source, damaged.id)
		const partialFiles = unzipSync(partial.bytes)
		expect(JSON.parse(strFromU8(partialFiles['mytw-bundle.json'])).missingAssets).toEqual([
			`sha256:${absent}`,
		])
		expect(partialFiles[`assets/${absent}`]).toBeUndefined()
		const restored = await importProjectBundle(target, partial.bytes)
		expect(restored.missingAssets).toEqual([`sha256:${absent}`])
		expect(Object.keys((await target.open(restored.meta.id)).project.assets)).toHaveLength(2)
	})

	it('names an empty slug "project"', async () => {
		const store = await openStore()
		const meta = await store.create(newProject('!!!'))
		expect((await exportProjectBundle(store, meta.id)).fileName).toBe('project.mytw.zip')
	})

	const project = serializeProject(newProject('Bundled'))
	const wrongHash = 'f'.repeat(64)
	const cases: Array<{
		name: string
		bytes: () => Promise<Uint8Array>
		code: ProjectStoreErrorCode
		message: RegExp
	}> = [
		{
			name: 'non-zip input',
			bytes: async () => strToU8('not a zip at all'),
			code: 'invalid-bundle',
			message: /not a zip/,
		},
		{
			name: 'a newer bundleVersion',
			bytes: async () =>
				zip({ 'mytw-bundle.json': manifest(BUNDLE_VERSION + 1), 'project.json': project }),
			code: 'invalid-bundle',
			message: /newer version/,
		},
		{
			name: 'a missing manifest',
			bytes: async () => zip({ 'project.json': project }),
			code: 'invalid-bundle',
			message: /mytw-bundle\.json/,
		},
		{
			name: 'a missing project.json',
			bytes: async () => zip({ 'mytw-bundle.json': manifest() }),
			code: 'invalid-bundle',
			message: /project\.json/,
		},
		{
			name: "an asset whose bytes don't match its name",
			bytes: async () =>
				zip({
					'mytw-bundle.json': manifest(),
					'project.json': project,
					[`assets/${await hashBytes(IMAGE)}`]: IMAGE,
					[`assets/${wrongHash}`]: IMAGE,
				}),
			code: 'invalid-bundle',
			message: /don't match/,
		},
		{
			name: 'a non-hash asset name',
			bytes: async () =>
				zip({ 'mytw-bundle.json': manifest(), 'project.json': project, 'assets/photo.png': IMAGE }),
			code: 'invalid-bundle',
			message: /content hash/,
		},
		{
			name: 'a declared uncompressed size over the limit',
			bytes: async () =>
				declareSize(zip({ 'mytw-bundle.json': manifest(), 'project.json': project }), 0x7fffffff),
			code: 'invalid-bundle',
			message: /1 GiB/,
		},
		{
			name: 'an invalid project',
			bytes: async () =>
				zip({
					'mytw-bundle.json': manifest(),
					'project.json': JSON.stringify({ ...newProject(), output: { width: 0 } }),
				}),
			code: 'invalid-project',
			message: /not valid/,
		},
	]

	it.each(cases)('import rejects $name and writes nothing', async ({ bytes, code, message }) => {
		const factory = new IDBFactory()
		const store = await openStore(factory)
		const error = await rejection(importProjectBundle(store, await bytes()))
		expect(error.code).toBe(code)
		expect(error.message).toMatch(message)
		if (code === 'invalid-project') expect(error.issues.length).toBeGreaterThan(0)
		expect(await store.list()).toEqual([])
		expect(await rawCount(factory, 'assets')).toBe(0)
	})
})
