// Ordered migrations between project schema versions. Each step takes a document at `from` and
// returns one at `to`, which is always `from + 1`. See "Adding a version" in docs/project-format.md.
import { cloneData, issue } from './codec'
import type { ProjectIssue } from './codec'
import { PROJECT_SCHEMA_VERSION } from './project'
import { isRecord } from './rules'

export interface Migration {
	readonly from: number
	readonly to: number
	readonly description: string
	/** Receives a private copy, so it may change it in place. */
	migrate(doc: Record<string, unknown>): Record<string, unknown>
}

/** Every step from v1 up to `PROJECT_SCHEMA_VERSION`. */
export const MIGRATIONS: readonly Migration[] = [
	{
		from: 1,
		to: 2,
		description: 'Adds the sketch layer kind',
		migrate: (doc) => {
			doc.schemaVersion = 2
			return doc
		},
	},
	{
		from: 2,
		to: 3,
		description: 'Adds custom effects',
		migrate: (doc) => {
			doc.schemaVersion = 3
			return doc
		},
	},
]

export type MigrateProjectResult =
	| { ok: true; doc: Record<string, unknown>; from: number }
	| { ok: false; issue: ProjectIssue }

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message
	return typeof error === 'string' ? error : 'a non-Error value was thrown'
}

function migrationIssue(detail: string): MigrateProjectResult {
	return { ok: false, issue: issue('schemaVersion', 'migration', detail) }
}

/**
 * Runs the steps from the document's `schemaVersion` up to `latest`, in order, on a copy of the
 * document. Returns the document itself when it is already at `latest`. Never throws.
 */
export function migrateProject(
	doc: Record<string, unknown>,
	options: { migrations?: readonly Migration[]; latest?: number } = {}
): MigrateProjectResult {
	const { migrations = MIGRATIONS, latest = PROJECT_SCHEMA_VERSION } = options
	const from = doc.schemaVersion
	if (typeof from !== 'number' || !Number.isInteger(from) || from < 1)
		return {
			ok: false,
			issue: issue('schemaVersion', 'format', 'expected an integer version of at least 1'),
		}
	if (from > latest)
		return {
			ok: false,
			issue: issue(
				'schemaVersion',
				'newer-version',
				`saved by a newer version (v${from}), this app reads up to v${latest}`
			),
		}
	if (from === latest) return { ok: true, doc, from }

	const copy = cloneData(doc)
	if (!isRecord(copy)) return migrationIssue('could not copy the document')
	let current = copy
	for (let version = from; version < latest; version++) {
		const step = migrations.find((migration) => migration.from === version)
		if (!step) return migrationIssue(`no migration from v${version} to v${version + 1}`)
		if (step.to !== step.from + 1)
			return migrationIssue(
				`the migration from v${step.from} goes to v${step.to}, expected v${step.from + 1}`
			)
		let output: unknown
		try {
			output = step.migrate(current)
		} catch (error) {
			return migrationIssue(
				`the migration from v${step.from} to v${step.to} failed: ${describeError(error)}`
			)
		}
		const reached = isRecord(output) ? output.schemaVersion : undefined
		if (!isRecord(output) || reached !== step.to)
			return migrationIssue(
				`the migration from v${step.from} returned schemaVersion ${typeof reached === 'number' ? reached : typeof reached}, expected ${step.to}`
			)
		current = output
	}
	return { ok: true, doc: current, from }
}
