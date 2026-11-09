// Project bundles: one zip holding a project, its images and its thumbnail. See README.md.
import { hashBytes, isContentHash } from '@mytw/assets'
import { parseProject, serializeProject } from '@mytw/schema'
import type { ProjectIssue } from '@mytw/schema'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { ProjectStoreError } from './types'
import type { ProjectMeta, ProjectStore, Thumbnail } from './types'

export const BUNDLE_FORMAT = 'mytw-bundle'
export const BUNDLE_VERSION = 1
export const BUNDLE_EXTENSION = '.mytw.zip'
/** The largest bundle file import accepts. */
export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024
/** The largest total uncompressed size import accepts, read from the zip before inflating. */
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024

const MANIFEST = 'mytw-bundle.json'
const PROJECT = 'project.json'
const ASSET_PREFIX = 'assets/'
const HASH_PREFIX = 'sha256:'

const THUMBNAIL_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
}
const THUMBNAIL_FILE = /^thumbnail\.(png|webp|jpg)$/
const THUMBNAIL_TYPES: Readonly<Record<string, string>> = {
	png: 'image/png',
	webp: 'image/webp',
	jpg: 'image/jpeg',
}

export interface BundleManifest {
	readonly format: typeof BUNDLE_FORMAT
	readonly bundleVersion: number
	/** Asset keys (`sha256:<hex>`) the project references but the bundle doesn't contain. */
	readonly missingAssets: readonly string[]
}

export interface ExportedBundle {
	readonly bytes: Uint8Array
	readonly fileName: string
}

export interface ImportedBundle {
	readonly meta: ProjectMeta
	/** Asset keys the project references with no file in the bundle. */
	readonly missingAssets: readonly string[]
}

/** A file-name-safe slug of a project name, `project` when nothing is left. */
export function bundleFileName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return `${slug || 'project'}${BUNDLE_EXTENSION}`
}

function invalidBundle(message: string, issues: readonly ProjectIssue[] = []): ProjectStoreError {
	return new ProjectStoreError('invalid-bundle', message, issues)
}

/** Zips a stored project with every referenced asset the store has and its thumbnail. */
export async function exportProjectBundle(
	store: ProjectStore,
	id: string
): Promise<ExportedBundle> {
	const { project } = await store.open(id, { remember: false })
	const files: Zippable = {}
	const missingAssets: string[] = []
	for (const key of Object.keys(project.assets)) {
		const hash = key.slice(HASH_PREFIX.length)
		const bytes = await store.read(hash)
		if (bytes) files[`${ASSET_PREFIX}${hash}`] = bytes
		else missingAssets.push(key)
	}
	const thumbnail = await store.getThumbnail(id)
	const extension = thumbnail ? THUMBNAIL_EXTENSIONS[thumbnail.mimeType] : undefined
	if (thumbnail && extension) files[`thumbnail.${extension}`] = thumbnail.bytes
	const manifest: BundleManifest = {
		format: BUNDLE_FORMAT,
		bundleVersion: BUNDLE_VERSION,
		missingAssets,
	}
	files[MANIFEST] = strToU8(JSON.stringify(manifest, null, '\t'))
	files[PROJECT] = strToU8(serializeProject(project))
	// Images are compressed already, so entries are stored.
	const bytes = zipSync(files, { level: 0 })
	return { bytes, fileName: bundleFileName(project.name) }
}

function readJson(bytes: Uint8Array, name: string): unknown {
	try {
		return JSON.parse(strFromU8(bytes))
	} catch {
		throw invalidBundle(`${name} in the bundle is not valid JSON`)
	}
}

function checkManifest(bytes: Uint8Array | undefined): void {
	if (!bytes) throw invalidBundle(`The bundle has no ${MANIFEST} manifest`)
	const manifest = readJson(bytes, MANIFEST)
	if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest))
		throw invalidBundle(`${MANIFEST} is not an object`)
	const { format, bundleVersion } = manifest as Record<string, unknown>
	if (format !== BUNDLE_FORMAT)
		throw invalidBundle(`${MANIFEST} is not a ${BUNDLE_FORMAT} manifest`)
	if (typeof bundleVersion !== 'number' || !Number.isInteger(bundleVersion) || bundleVersion < 1)
		throw invalidBundle(`${MANIFEST} has no valid bundleVersion`)
	if (bundleVersion > BUNDLE_VERSION)
		throw invalidBundle(
			`The bundle came from a newer version of the app (bundle v${bundleVersion}, this app reads v${BUNDLE_VERSION})`
		)
}

/** Unzips after checking the declared sizes, so nothing is inflated past the limit. */
function unzipBundle(bytes: Uint8Array): Record<string, Uint8Array> {
	if (bytes.byteLength > MAX_BUNDLE_BYTES) throw invalidBundle('The bundle is larger than 512 MiB')
	let declared = 0
	try {
		unzipSync(bytes, {
			filter: (file) => {
				declared += file.originalSize
				return false
			},
		})
	} catch {
		throw invalidBundle('The file is not a zip bundle')
	}
	if (declared > MAX_UNCOMPRESSED_BYTES)
		throw invalidBundle('The bundle unpacks to more than 1 GiB')
	try {
		return unzipSync(bytes)
	} catch {
		throw invalidBundle('The zip bundle is damaged')
	}
}

/**
 * Checks and stores a bundle as a new project. Everything is checked before anything is written,
 * and the project, its assets and thumbnail are stored together.
 */
export async function importProjectBundle(
	store: ProjectStore,
	bytes: Uint8Array
): Promise<ImportedBundle> {
	const files = unzipBundle(bytes)
	checkManifest(files[MANIFEST])
	const projectBytes = files[PROJECT]
	if (!projectBytes) throw invalidBundle(`The bundle has no ${PROJECT}`)
	const parsed = parseProject(strFromU8(projectBytes))
	if (!parsed.ok) {
		const first = parsed.issues[0]
		const detail = first ? `${first.path || 'project'}: ${first.message}` : 'it failed validation'
		throw new ProjectStoreError(
			'invalid-project',
			`The bundle's project is not valid (${detail})`,
			parsed.issues
		)
	}
	const project = parsed.project

	const assets = new Map<string, Uint8Array>()
	let thumbnail: Thumbnail | null = null
	for (const [name, content] of Object.entries(files)) {
		if (name.endsWith('/')) continue
		if (name.startsWith(ASSET_PREFIX)) {
			const hash = name.slice(ASSET_PREFIX.length)
			if (!isContentHash(hash))
				throw invalidBundle(`The asset ${JSON.stringify(name)} is not named by its content hash`)
			if ((await hashBytes(content)) !== hash)
				throw invalidBundle(`The bytes of ${name} don't match its hash`)
			assets.set(hash, content)
			continue
		}
		const match = THUMBNAIL_FILE.exec(name)
		if (match) thumbnail = { bytes: content, mimeType: THUMBNAIL_TYPES[match[1]] }
	}

	const referenced: Uint8Array[] = []
	const missingAssets: string[] = []
	for (const key of Object.keys(project.assets)) {
		const content = assets.get(key.slice(HASH_PREFIX.length))
		if (content) referenced.push(content)
		else missingAssets.push(key)
	}
	const meta = await store.importProject({ project, assets: referenced, thumbnail })
	return { meta, missingAssets }
}
