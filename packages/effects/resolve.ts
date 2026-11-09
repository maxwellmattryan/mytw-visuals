// Finds effect definitions for the panels: the bank first, then the project's custom effects.
import { createCustomEffect } from '@mytw/fx'
import type { CustomEffectResult, EffectDefinition } from '@mytw/fx'
import type { EffectInstance, Project, ProjectCustomEffect } from '@mytw/schema'

/** The built-in effects the panels offer, in browser order. `EFFECTS` from `@mytw/fx` by default. */
export type EffectBank = readonly EffectDefinition[]

// Documents are never mutated, so a custom effect entry is built once per object.
const built = new WeakMap<ProjectCustomEffect, CustomEffectResult>()

/** `createCustomEffect` for a stored custom effect, cached per entry object. */
export function buildCustomEffect(entry: ProjectCustomEffect): CustomEffectResult {
	let result = built.get(entry)
	if (!result) {
		result = createCustomEffect(entry)
		built.set(entry, result)
	}
	return result
}

/** The stored custom effect with this id, or `null`. */
export function customEntry(project: Project, id: string): ProjectCustomEffect | null {
	return project.customEffects?.find((entry) => entry.id === id) ?? null
}

/** The definition for an effect id: the bank first, then a valid custom effect, else `null`. */
export function resolveDefinition(
	project: Project,
	bank: EffectBank,
	effectId: string
): EffectDefinition | null {
	const builtin = bank.find((definition) => definition.id === effectId)
	if (builtin) return builtin
	const entry = customEntry(project, effectId)
	if (!entry) return null
	const result = buildCustomEffect(entry)
	return result.ok ? result.effect : null
}

/** Why an instance has no usable definition. */
export type InstanceProblem =
	| { readonly kind: 'unknown'; readonly effect: string }
	| { readonly kind: 'version'; readonly name: string; readonly version: number }

/** One stack row: the instance, its definition when it resolves at its version, or the problem. */
export interface StackRow {
	readonly instance: EffectInstance
	readonly definition: EffectDefinition | null
	readonly problem: InstanceProblem | null
}

export function resolveInstance(
	project: Project,
	bank: EffectBank,
	instance: EffectInstance
): StackRow {
	const definition = resolveDefinition(project, bank, instance.effect)
	if (!definition)
		return { instance, definition: null, problem: { kind: 'unknown', effect: instance.effect } }
	if (definition.version !== instance.version)
		return {
			instance,
			definition: null,
			problem: { kind: 'version', name: definition.name, version: instance.version },
		}
	return { instance, definition, problem: null }
}

/** The text a stack row shows in place of the effect name. */
export function rowLabel(row: StackRow): string {
	if (row.problem?.kind === 'unknown') return `Unknown effect ${row.problem.effect}`
	if (row.problem?.kind === 'version')
		return `${row.problem.name} needs version ${row.problem.version}`
	return row.definition?.name ?? row.instance.effect
}

export interface CatalogItem {
	readonly source: 'builtin' | 'custom'
	readonly id: string
	readonly name: string
	/** `null` for a custom effect that `createCustomEffect` rejects. */
	readonly definition: EffectDefinition | null
	/** The first error of a rejected custom effect. */
	readonly error: string | null
}

/** Whether an item matches a query: trimmed, case-insensitive, a substring of the name or id. */
function matches(item: CatalogItem, query: string): boolean {
	const needle = query.trim().toLowerCase()
	if (needle === '') return true
	return item.name.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)
}

/** The browser's items: every bank effect in bank order, then the custom effects, filtered. */
export function catalog(project: Project, bank: EffectBank, query: string): CatalogItem[] {
	const items: CatalogItem[] = bank.map((definition) => ({
		source: 'builtin',
		id: definition.id,
		name: definition.name,
		definition,
		error: null,
	}))
	for (const entry of project.customEffects ?? []) {
		const result = buildCustomEffect(entry)
		items.push({
			source: 'custom',
			id: entry.id,
			name: entry.name,
			definition: result.ok ? result.effect : null,
			error: result.ok ? null : (result.errors[0]?.message ?? 'Invalid custom effect'),
		})
	}
	return items.filter((item) => matches(item, query))
}
