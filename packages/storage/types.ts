import type { AssetSource } from '@mytw/assets'
import type { Project, ProjectIssue } from '@mytw/schema'

export type ProjectStoreErrorCode =
	| 'not-found'
	| 'invalid-project'
	| 'newer-version'
	| 'invalid-name'
	| 'invalid-bundle'
	| 'quota-exceeded'
	| 'unavailable'
	| 'failed'

/** Every rejection from a `ProjectStore` or a bundle function. */
export class ProjectStoreError extends Error {
	readonly code: ProjectStoreErrorCode
	readonly issues: readonly ProjectIssue[]

	constructor(code: ProjectStoreErrorCode, message: string, issues: readonly ProjectIssue[] = []) {
		super(message)
		this.name = 'ProjectStoreError'
		this.code = code
		this.issues = issues
	}
}

/** What the project list shows, without reading the document. Timestamps are ISO strings. */
export interface ProjectMeta {
	readonly id: string
	readonly name: string
	readonly createdAt: string
	readonly updatedAt: string
	readonly schemaVersion: number
	readonly hasThumbnail: boolean
}

export interface OpenedProject {
	readonly meta: ProjectMeta
	readonly project: Project
	/** The version the stored document was migrated from, or `null` when it was current. */
	readonly migratedFrom: number | null
}

export interface Thumbnail {
	readonly bytes: Uint8Array
	readonly mimeType: string
}

export interface ImportProjectInput {
	readonly project: Project
	readonly assets: readonly Uint8Array[]
	readonly thumbnail: Thumbnail | null
}

/** What `navigator.storage` reports. `null` for anything the browser doesn't provide. */
export interface StorageStatus {
	readonly persisted: boolean | null
	readonly usage: number | null
	readonly quota: number | null
}

/**
 * Where projects live. The local implementation uses IndexedDB; a cloud backend can implement
 * the same interface later. Every method rejects with a `ProjectStoreError`.
 */
export interface ProjectStore extends AssetSource {
	/** Metadata for every project, newest `updatedAt` first. Never reads documents. */
	list(): Promise<ProjectMeta[]>
	/** Validates and stores `project` under a new id. */
	create(project: Project): Promise<ProjectMeta>
	/**
	 * Creates a project together with its asset bytes (deduplicated by hash) and thumbnail, all or
	 * nothing. Bundle import uses it so a failed import writes nothing.
	 */
	importProject(input: ImportProjectInput): Promise<ProjectMeta>
	/**
	 * Reads, migrates (writing the result back) and validates a project, and records it as the
	 * last opened one unless `remember` is `false` (bundle export reads without opening).
	 */
	open(id: string, options?: { remember?: boolean }): Promise<OpenedProject>
	/** Validates and writes the document, updating the meta name and `updatedAt`. */
	save(id: string, project: Project): Promise<ProjectMeta>
	rename(id: string, name: string): Promise<ProjectMeta>
	duplicate(id: string): Promise<ProjectMeta>
	/** Removes the project and the assets that only it referenced. */
	delete(id: string): Promise<void>
	/** Stores bytes by content hash and resolves the 64-hex hash. */
	putAsset(bytes: Uint8Array): Promise<string>
	/** The bytes for a 64-hex hash, or `null`. */
	read(hash: string): Promise<Uint8Array | null>
	setThumbnail(id: string, bytes: Uint8Array, mimeType: string): Promise<void>
	getThumbnail(id: string): Promise<Thumbnail | null>
	lastOpened(): Promise<string | null>
	setLastOpened(id: string | null): Promise<void>
	storageStatus(): Promise<StorageStatus>
	/** Asks the browser to keep data. Resolves its answer, or `null` when unsupported. */
	requestPersistence(): Promise<boolean | null>
}
