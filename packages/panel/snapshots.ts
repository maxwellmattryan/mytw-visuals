// Persistence, named snapshots and A/B compare, with no DOM or Svelte imports so it runs in Node.
import { parseValues, serializeValues } from '@mytw/schema'
import type { ParamDefs, ParamValues, ValidationIssue } from '@mytw/schema'
import type { PanelState } from './state'

/** The part of `Storage` the panel uses, so tests and other backends can stand in for it. */
export interface KeyValueStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

/** `localStorage`, or `null` when it is missing or accessing it throws (some privacy modes). */
export function browserStorage(): KeyValueStorage | null {
	try {
		return globalThis.localStorage ?? null
	} catch {
		return null
	}
}

/** Stands in for a browser storage that can't be used, so the panel reports it. */
export const UNAVAILABLE_STORAGE: KeyValueStorage = {
	getItem() {
		throw new Error('Storage is unavailable')
	},
	setItem() {
		throw new Error('Storage is unavailable')
	},
}

const KEY_PREFIX = 'mytw:panel:'

/**
 * The storage key for a page. A trailing `index.html` and trailing slashes are dropped, so a
 * sketch's directory URL and its `index.html` share a key.
 */
export function storageKeyFor(pathname: string): string {
	const path = pathname.replace(/index\.html$/, '').replace(/\/+$/, '')
	return KEY_PREFIX + (path === '' ? '/' : path)
}

export const NAME_MAX_LENGTH = 80
const DETAILS_MAX = 5

export const STATUS = {
	restored: 'Restored saved values',
	unreadable: "Saved values couldn't be read",
	unavailable: 'Storage is unavailable. Changes last until reload.',
	writeFailed: "Couldn't save to storage. Changes last until reload.",
	applied: 'Applied values',
	emptyName: 'Enter a name',
} as const

export interface Status {
	kind: 'info' | 'error'
	message: string
	details?: string[]
}

export interface SnapshotMeta {
	readonly id: string
	readonly name: string
	readonly savedAt: string
}

export interface Comparing {
	readonly id: string
	readonly name: string
	/** The side the panel shows: `a` is the stashed current values, `b` the snapshot. */
	readonly side: 'a' | 'b'
}

export type RenameResult = { ok: true } | { ok: false; message: string }

/** The store the panel components use. Its methods never throw. */
export interface SnapshotStore {
	/** Newest first. */
	readonly snapshots: readonly SnapshotMeta[]
	readonly status: Status | null
	readonly comparing: Comparing | null
	/** Applies the stored current values, if any, and loads the snapshot list. Call once. */
	restore(): void
	/** Writes the current values (A during a compare) and the snapshots now. */
	persist(): void
	/** Saves the shown values as a new snapshot. An empty name uses `defaultName()`. */
	save(name?: string): SnapshotMeta
	/** The name an unnamed snapshot gets: `Snapshot N`. */
	defaultName(): string
	load(id: string): void
	rename(id: string, name: string): RenameResult
	remove(id: string): void
	/** Applies pasted or imported JSON. Returns whether it was accepted. */
	applyText(text: string): boolean
	/** The shown values as the `mytw-params` envelope. */
	copyText(): string
	/** Stashes the current values as A and shows the snapshot as B. */
	compare(id: string): void
	/** Toggles the shown side of a compare. */
	swap(): void
	/** Ends a compare, showing the given side, which becomes the current values. */
	keep(side: 'a' | 'b'): void
	/** Sets the status line, such as for a clipboard result the component got. */
	report(status: Status | null): void
	subscribe(fn: () => void): () => void
}

interface StoredSnapshot {
	id: string
	name: string
	savedAt: string
	/** Raw, exactly as saved. Clamped only when loaded or compared. */
	values: Record<string, unknown>
}

const STORE_FORMAT = 'mytw-panel-store'
const STORE_VERSION = 1

interface StoredRecord {
	format: typeof STORE_FORMAT
	version: typeof STORE_VERSION
	current: Record<string, unknown> | null
	snapshots: StoredSnapshot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredSnapshot(value: unknown): value is StoredSnapshot {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.savedAt === 'string' &&
		isRecord(value.values)
	)
}

/** Returns the stored record, or `null` when the data has an unrecognised shape. */
function readRecord(text: string): StoredRecord | null {
	let data: unknown
	try {
		data = JSON.parse(text)
	} catch {
		return null
	}
	if (!isRecord(data) || data.format !== STORE_FORMAT || data.version !== STORE_VERSION) return null
	const { current, snapshots } = data
	if (current !== null && !isRecord(current)) return null
	if (!Array.isArray(snapshots) || !snapshots.every(isStoredSnapshot)) return null
	return { format: STORE_FORMAT, version: STORE_VERSION, current, snapshots }
}

/** A deep copy of plain JSON values, so stored and shown values never share arrays. */
function copyValues(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(values)) {
		const value = values[key]
		out[key] = Array.isArray(value) ? [...value] : value
	}
	return out
}

let counter = 0

function newId(): string {
	const crypto = globalThis.crypto
	if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
	counter += 1
	return Date.now().toString(36) + counter.toString(36)
}

function cleanName(name: string): string {
	return name.trim().slice(0, NAME_MAX_LENGTH).trim()
}

/** The issue messages to list under a status: at most five, then a count of the rest. */
export function issueDetails(issues: readonly ValidationIssue[]): string[] | undefined {
	if (issues.length === 0) return undefined
	const shown = issues.slice(0, DETAILS_MAX).map((issue) => issue.message)
	if (issues.length > DETAILS_MAX) shown.push(`…and ${issues.length - DETAILS_MAX} more`)
	return shown
}

function adjustedText(message: string, count: number): string {
	return count > 0 ? `${message} (${count} adjusted)` : message
}

/**
 * Creates the snapshot store for a panel. `storage: null` keeps everything in memory. Storage
 * failures never throw: they set the status and the store keeps working in memory.
 */
export function createSnapshotStore<P extends ParamDefs>(
	state: PanelState<P>,
	storage: KeyValueStorage | null,
	key: string
): SnapshotStore {
	const schema = state.schema
	let entries: StoredSnapshot[] = []
	let status: Status | null = null
	let comparing: Comparing | null = null
	// During a compare: the stashed current values (A) and the snapshot's clamped values (B).
	let stashA: Record<string, unknown> | null = null
	let valuesB: Record<string, unknown> | null = null
	// False once storage proves unusable on read, so later writes don't fail again and again.
	let writable = storage !== null
	let writeFailing = false
	// Set while the store applies values itself, so its change listener doesn't end the compare.
	let applying = false
	const subscribers = new Set<() => void>()

	const notify = () => {
		for (const fn of subscribers) fn()
	}

	const setStatus = (next: Status | null) => {
		status = next
		notify()
	}

	const applyOwn = (values: Readonly<Record<string, unknown>>) => {
		applying = true
		try {
			state.replaceAll(values as ParamValues<P>)
		} finally {
			applying = false
		}
	}

	const endCompare = () => {
		comparing = null
		stashA = null
		valuesB = null
	}

	// Any change the store didn't make (an edit, reset, load or paste) ends a compare and keeps
	// the shown values plus the change.
	state.onChange(() => {
		if (applying || comparing === null) return
		endCompare()
		notify()
	})

	const write = () => {
		if (storage === null || !writable) return
		const record: StoredRecord = {
			format: STORE_FORMAT,
			version: STORE_VERSION,
			current: stashA ?? copyValues(state.values),
			snapshots: entries,
		}
		try {
			storage.setItem(key, JSON.stringify(record))
		} catch {
			if (!writeFailing) {
				writeFailing = true
				setStatus({ kind: 'error', message: STATUS.writeFailed })
			}
			return
		}
		if (writeFailing) {
			writeFailing = false
			if (status?.message === STATUS.writeFailed) setStatus(null)
		}
	}

	const find = (id: string) => entries.find((entry) => entry.id === id)

	/** Applies values through `parseValues`, reporting adjustments. Ends any compare. */
	const applyParsed = (input: unknown, message: string): boolean => {
		const result = parseValues(schema, input)
		if (!result.ok) {
			setStatus({ kind: 'error', message: result.message })
			return false
		}
		state.replaceAll(result.values)
		setStatus({
			kind: 'info',
			message: adjustedText(message, result.adjusted.length),
			details: issueDetails(result.adjusted),
		})
		return true
	}

	const keep = (side: 'a' | 'b') => {
		if (comparing === null || stashA === null || valuesB === null) return
		const shown = comparing.side
		const next = side === 'a' ? stashA : valuesB
		endCompare()
		if (side !== shown) applyOwn(next)
		notify()
		write()
	}

	return {
		get snapshots() {
			return entries
		},
		get status() {
			return status
		},
		get comparing() {
			return comparing
		},
		restore() {
			if (storage === null) return
			let text: string | null
			try {
				text = storage.getItem(key)
			} catch {
				writable = false
				setStatus({ kind: 'error', message: STATUS.unavailable })
				return
			}
			if (text === null) return
			const record = readRecord(text)
			if (record === null) {
				setStatus({ kind: 'error', message: STATUS.unreadable })
				return
			}
			entries = record.snapshots
			if (record.current === null) {
				notify()
				return
			}
			const result = parseValues(schema, record.current)
			if (!result.ok) {
				setStatus({ kind: 'error', message: STATUS.unreadable })
				return
			}
			applyOwn(result.values)
			setStatus({ kind: 'info', message: adjustedText(STATUS.restored, result.adjusted.length) })
		},
		persist: write,
		defaultName: () => `Snapshot ${entries.length + 1}`,
		save(name = '') {
			const entry: StoredSnapshot = {
				id: newId(),
				name: cleanName(name) || `Snapshot ${entries.length + 1}`,
				savedAt: new Date().toISOString(),
				values: copyValues(state.values),
			}
			entries = [entry, ...entries]
			notify()
			write()
			return { id: entry.id, name: entry.name, savedAt: entry.savedAt }
		},
		load(id) {
			const entry = find(id)
			if (entry) applyParsed(entry.values, `Loaded "${entry.name}"`)
		},
		rename(id, name) {
			const entry = find(id)
			if (!entry) return { ok: true }
			const clean = cleanName(name)
			if (clean === '') return { ok: false, message: STATUS.emptyName }
			entries = entries.map((e) => (e.id === id ? { ...e, name: clean } : e))
			if (comparing?.id === id) comparing = { ...comparing, name: clean }
			notify()
			write()
			return { ok: true }
		},
		remove(id) {
			if (!find(id)) return
			entries = entries.filter((entry) => entry.id !== id)
			if (comparing?.id === id) keep('a')
			notify()
			write()
		},
		applyText: (text) => applyParsed(text, STATUS.applied),
		copyText: () => serializeValues(copyValues(state.values)),
		compare(id) {
			const entry = find(id)
			if (!entry) return
			const result = parseValues(schema, entry.values)
			if (!result.ok) {
				setStatus({ kind: 'error', message: result.message })
				return
			}
			stashA ??= copyValues(state.values)
			valuesB = result.values
			comparing = { id, name: entry.name, side: 'b' }
			applyOwn(valuesB)
			if (result.adjusted.length > 0)
				setStatus({
					kind: 'info',
					message: adjustedText(`Comparing with "${entry.name}"`, result.adjusted.length),
					details: issueDetails(result.adjusted),
				})
			else notify()
		},
		swap() {
			if (comparing === null || stashA === null || valuesB === null) return
			const side = comparing.side === 'a' ? 'b' : 'a'
			comparing = { ...comparing, side }
			applyOwn(side === 'a' ? stashA : valuesB)
			notify()
		},
		keep,
		report: setStatus,
		subscribe(fn) {
			subscribers.add(fn)
			return () => {
				subscribers.delete(fn)
			}
		},
	}
}
