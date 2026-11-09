// Shared test fixtures for packages/layers/__tests__. Node only.
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { createDocumentStore } from '@mytw/document'
import type { DocumentStore, DocumentValidation } from '@mytw/document'
import { parseProject, validateProject } from '@mytw/schema'
import type { Project } from '@mytw/schema'

import type { ImageFile } from '../import'

const FIXTURE = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../schema/fixtures/v1/understory.json'
)

export const UNDERSTORY_HASH =
	'sha256:740b8530c50ed203aa2ecb3ef2ecd24e100b1fef711424f2c8033bb6b724384b'

export function loadUnderstory(): Project {
	const result = parseProject(readFileSync(FIXTURE, 'utf8'))
	if (!result.ok) throw new Error(result.issues.map((found) => found.message).join('\n'))
	return result.project
}

/** The Understory project with no tracks. */
export function emptyProject(): Project {
	return { ...loadUnderstory(), tracks: [] }
}

export function validateDocument(doc: unknown): DocumentValidation {
	const result = validateProject(doc)
	return result.ok ? { ok: true } : { ok: false, issues: result.issues }
}

export function storeFor(project: Project = loadUnderstory()): DocumentStore<Project> {
	return createDocumentStore<Project>({ document: project, validate: validateDocument })
}

/** Whether a document passes `validateProject`, with its issues for a readable failure. */
export function issuesOf(doc: unknown): unknown[] {
	const result = validateProject(doc)
	return result.ok ? [] : result.issues
}

function ascii(text: string): number[] {
	return [...text].map((char) => char.charCodeAt(0))
}

function u16be(value: number): number[] {
	return [(value >>> 8) & 0xff, value & 0xff]
}

function u32be(value: number): number[] {
	return [...u16be(value >>> 16), ...u16be(value)]
}

function u16le(value: number): number[] {
	return [value & 0xff, (value >>> 8) & 0xff]
}

function u32le(value: number): number[] {
	return [...u16le(value), ...u16le(value >>> 16)]
}

/** A PNG signature and IHDR chunk. `seed` varies the bytes, and so the hash. */
export function pngBytes(width: number, height: number, seed = 0): Uint8Array {
	return new Uint8Array([
		0x89,
		...ascii('PNG\r\n\x1a\n'),
		...u32be(13),
		...ascii('IHDR'),
		...u32be(width),
		...u32be(height),
		8,
		6,
		0,
		0,
		0,
		...u32be(seed),
	])
}

/** SOI, then a baseline start-of-frame segment. */
export function jpegBytes(width: number, height: number): Uint8Array {
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xc0,
		...u16be(17),
		8,
		...u16be(height),
		...u16be(width),
		3,
		...new Array<number>(9).fill(0),
	])
}

/** A lossless WebP header. */
export function webpBytes(width: number, height: number): Uint8Array {
	const payload = [0x2f, ...u32le((width - 1) | ((height - 1) << 14))]
	return new Uint8Array([
		...ascii('RIFF'),
		...u32le(payload.length + 12),
		...ascii('WEBP'),
		...ascii('VP8L'),
		...u32le(payload.length),
		...payload,
	])
}

/** A file-like object, as the import reads one. */
export function fileOf(name: string, bytes: Uint8Array | string): ImageFile {
	const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
	return {
		name,
		arrayBuffer: async () => data.slice().buffer,
	}
}
