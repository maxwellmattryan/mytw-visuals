// Promise helpers over IndexedDB requests and transactions, mapping failures to ProjectStoreError.
import { ProjectStoreError } from './types'

/** Reads `name` and `message` without `instanceof`: a `DOMException` may come from another realm. */
function field(error: unknown, key: 'name' | 'message'): string | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	const value: unknown = (error as Record<string, unknown>)[key]
	return typeof value === 'string' ? value : undefined
}

function describe(error: unknown): string {
	if (typeof error === 'string') return error
	return field(error, 'message') || field(error, 'name') || 'an unknown error'
}

/** Maps any failure to a `ProjectStoreError`: `QuotaExceededError` by name, the rest as `failed`. */
export function toStoreError(error: unknown): ProjectStoreError {
	if (error instanceof ProjectStoreError) return error
	if (field(error, 'name') === 'QuotaExceededError')
		return new ProjectStoreError(
			'quota-exceeded',
			'Storage is full. Export projects you want to keep and delete others to free space.'
		)
	return new ProjectStoreError('failed', `Storage failed: ${describe(error)}`)
}

/** Resolves with the request's result, or rejects with its error. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error ?? new Error('the request failed'))
	})
}

/**
 * Runs `body` in one transaction and resolves with its result once the transaction commits. If
 * `body` rejects, the transaction aborts and nothing it wrote is kept. `body` must only await
 * requests made in `tx`, or the transaction commits early.
 */
export function transact<T>(
	db: IDBDatabase,
	stores: readonly string[],
	mode: IDBTransactionMode,
	body: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
	return new Promise((resolve, reject) => {
		let tx: IDBTransaction
		try {
			tx = db.transaction([...stores], mode)
		} catch (error) {
			reject(toStoreError(error))
			return
		}
		let result: { value: T } | undefined
		let failure: { error: unknown } | undefined
		tx.oncomplete = () => {
			if (result) resolve(result.value)
			else reject(toStoreError(failure?.error ?? new Error('the transaction ended early')))
		}
		tx.onabort = () => reject(toStoreError(failure?.error ?? tx.error))
		let started: Promise<T>
		try {
			started = body(tx)
		} catch (error) {
			started = Promise.reject(error)
		}
		started.then(
			(value) => {
				result = { value }
			},
			(error: unknown) => {
				failure = { error }
				try {
					tx.abort()
				} catch {
					// Already finished or aborting: onabort reports the failure.
				}
			}
		)
	})
}

/** Opens a database, running `upgrade` with the old version when it must be created or upgraded. */
export function openDatabase(
	factory: IDBFactory,
	name: string,
	version: number,
	upgrade: (db: IDBDatabase, oldVersion: number) => void
): Promise<IDBDatabase> {
	const unavailable = (error: unknown) =>
		new ProjectStoreError(
			'unavailable',
			`Projects can't be stored in this browser: ${describe(error)}`
		)
	return new Promise((resolve, reject) => {
		let req: IDBOpenDBRequest
		try {
			req = factory.open(name, version)
		} catch (error) {
			reject(unavailable(error))
			return
		}
		req.onupgradeneeded = (event) => upgrade(req.result, event.oldVersion)
		req.onsuccess = () => {
			const db = req.result
			// Lets a newer version of the app, open in another tab, upgrade the database.
			db.onversionchange = () => db.close()
			resolve(db)
		}
		req.onerror = () => reject(unavailable(req.error ?? 'the database could not be opened'))
	})
}
