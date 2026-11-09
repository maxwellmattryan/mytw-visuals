// Test helpers shared by the storage tests: fixtures and direct database access.
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import type { Project } from '@mytw/schema'

import { DB_NAME, newProject } from '../local-store'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures')

/** A fixture document as raw JSON, for example `v1/minimal.json`. */
export function readFixture(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(resolve(FIXTURES, path), 'utf8')) as Record<string, unknown>
}

/** A valid current project that references each bare hex hash as an image asset. */
export function projectWithAssets(name: string, hashes: readonly string[]): Project {
	const assets: Project['assets'] = {}
	for (const hash of hashes)
		assets[`sha256:${hash}`] = {
			kind: 'image',
			mimeType: 'image/png',
			width: 1,
			height: 1,
			name: 'image.png',
		}
	return { ...newProject(name), assets }
}

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolvePromise, reject) => {
		const req = factory.open(DB_NAME)
		req.onsuccess = () => resolvePromise(req.result)
		req.onerror = () => reject(req.error)
	})
}

function run<T>(
	factory: IDBFactory,
	store: string,
	mode: IDBTransactionMode,
	make: (objects: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	return openRaw(factory).then(
		(db) =>
			new Promise<T>((resolvePromise, reject) => {
				const req = make(db.transaction(store, mode).objectStore(store))
				req.onsuccess = () => {
					db.close()
					resolvePromise(req.result)
				}
				req.onerror = () => {
					db.close()
					reject(req.error)
				}
			})
	)
}

/** Writes a record straight into an object store, bypassing the ProjectStore. */
export function rawPut(factory: IDBFactory, store: string, value: unknown): Promise<IDBValidKey> {
	return run(factory, store, 'readwrite', (objects) => objects.put(value))
}

/** Reads a record straight from an object store. */
export function rawGet(factory: IDBFactory, store: string, key: string): Promise<unknown> {
	return run<unknown>(factory, store, 'readonly', (objects) => objects.get(key))
}

/** The number of records in an object store. */
export function rawCount(factory: IDBFactory, store: string): Promise<number> {
	return run(factory, store, 'readonly', (objects) => objects.count())
}
