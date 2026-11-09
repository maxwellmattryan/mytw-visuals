// Reading, validating and writing project documents. Modelled on parseValues in snapshot.ts: the
// envelope (format and version) is checked first, then the content.
import { cloneData, issue, quote } from './codec'
import type { ProjectIssue } from './codec'
import { migrateProject } from './migrate'
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, projectCodec } from './project'
import type { Project } from './project'
import { checkProject } from './project-check'
import { isRecord } from './rules'

export type ValidateProjectResult =
	| { ok: true; project: Project }
	| { ok: false; issues: ProjectIssue[] }

export type ParseProjectResult =
	| {
			ok: true
			project: Project
			/** The version the document was migrated from, or `null` when no step ran. */
			migratedFrom: number | null
	  }
	| { ok: false; issues: ProjectIssue[] }

type Envelope = { ok: true; doc: Record<string, unknown> } | { ok: false; issue: ProjectIssue }

function show(value: unknown): string {
	if (typeof value === 'string') return quote(value)
	if (typeof value === 'number' || typeof value === 'boolean' || value === null)
		return String(value)
	return typeof value
}

/** Checks that a value is a project object with a version this app can read. */
function readEnvelope(data: unknown): Envelope {
	if (!isRecord(data))
		return { ok: false, issue: issue('', 'format', `expected a ${PROJECT_FORMAT} object`) }
	if (!Object.hasOwn(data, 'format'))
		return {
			ok: false,
			issue: issue('format', 'format', `is missing, so this is not a ${PROJECT_FORMAT} document`),
		}
	if (data.format !== PROJECT_FORMAT)
		return {
			ok: false,
			issue: issue('format', 'format', `${show(data.format)} is not ${PROJECT_FORMAT}`),
		}
	const version = data.schemaVersion
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
		return {
			ok: false,
			issue: issue(
				'schemaVersion',
				'format',
				`expected an integer version of at least 1, got ${show(version)}`
			),
		}
	if (version > PROJECT_SCHEMA_VERSION)
		return {
			ok: false,
			issue: issue(
				'schemaVersion',
				'newer-version',
				`saved by a newer version (v${version}), this app reads up to v${PROJECT_SCHEMA_VERSION}`
			),
		}
	return { ok: true, doc: data }
}

/**
 * Checks a document at the current version, without migrating it: the envelope, then the
 * structure, then the cross-reference rules. Returns the same reference on success. Never throws.
 */
export function validateProject(doc: unknown): ValidateProjectResult {
	const envelope = readEnvelope(doc)
	if (!envelope.ok) return { ok: false, issues: [envelope.issue] }
	const issues: ProjectIssue[] = []
	if (!projectCodec.check(doc, '', issues)) return { ok: false, issues }
	const crossIssues = checkProject(doc)
	if (crossIssues.length > 0) return { ok: false, issues: crossIssues }
	return { ok: true, project: doc }
}

/**
 * Reads a project from JSON text or an already parsed value: checks the envelope, migrates to the
 * current version, validates, and returns a copy that shares no object with the input. Never
 * throws and never mutates the input.
 */
export function parseProject(input: unknown): ParseProjectResult {
	let data = input
	if (typeof input === 'string') {
		try {
			data = JSON.parse(input)
		} catch {
			return { ok: false, issues: [issue('', 'json', 'Not valid JSON')] }
		}
	}
	const envelope = readEnvelope(data)
	if (!envelope.ok) return { ok: false, issues: [envelope.issue] }
	const migrated = migrateProject(envelope.doc)
	if (!migrated.ok) return { ok: false, issues: [migrated.issue] }
	// Copy before validating, so the checked value is the one returned.
	const result = validateProject(cloneData(migrated.doc))
	if (!result.ok) return result
	const migratedFrom = migrated.from === PROJECT_SCHEMA_VERSION ? null : migrated.from
	return { ok: true, project: result.project, migratedFrom }
}

/** Serializes a project as JSON, pretty-printed with tabs. */
export function serializeProject(project: Project): string {
	return JSON.stringify(project, null, '\t')
}
