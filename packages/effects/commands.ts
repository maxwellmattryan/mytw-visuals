// Command builders for effect chains and custom effects. Each takes the current project and returns
// a `Command` for the document store, or `null` when the edit would change nothing. None of them
// mutates the project.
import type { Command, JsonValue } from '@mytw/document'
import { createInstance, getEffect } from '@mytw/fx'
import type { ChunkId, EffectDefinition } from '@mytw/fx'
import type { EffectInstance, Project, ProjectCustomEffect } from '@mytw/schema'
// The module, not the `@mytw/layers` barrel, which exports Svelte components Jest can't load.
import { nextId } from '../layers/ids'
import type { EffectBank } from './resolve'
import { chainAt, chainPath } from './target'
import type { EffectTarget } from './target'

/** The GLSL a new custom effect starts with: a passthrough. */
export const CUSTOM_TEMPLATE_GLSL = `vec4 effect(vec2 uv) {
  return texture(uInput, uv);
}`

export const CUSTOM_BASE_ID = 'custom'
export const CUSTOM_DEFAULT_NAME = 'Custom effect'

/** Plain JSON for a command value. */
function json(value: unknown): JsonValue {
	return JSON.parse(JSON.stringify(value)) as JsonValue
}

function inRange(chain: readonly unknown[], index: number): boolean {
	return Number.isInteger(index) && index >= 0 && index < chain.length
}

/**
 * Appends a new instance of `definition` to the target's chain (applied last), with every param at
 * its default and an id from `nextId`. `null` when the target's layer doesn't exist.
 */
export function addEffect(
	project: Project,
	target: EffectTarget,
	definition: EffectDefinition
): { command: Command; id: string } | null {
	const path = chainPath(project, target)
	const chain = chainAt(project, target)
	if (path === null || chain === null) return null
	const id = nextId(project, definition.id)
	const instance = createInstance(definition, id)
	return { command: { op: 'insert', path: [...path, chain.length], value: json(instance) }, id }
}

export function removeEffect(
	project: Project,
	target: EffectTarget,
	index: number
): Command | null {
	const path = chainPath(project, target)
	const chain = chainAt(project, target)
	if (path === null || chain === null || !inRange(chain, index)) return null
	return { op: 'remove', path: [...path, index] }
}

/** Moves the instance at `from` to `to`. `null` when either is out of range or they're equal. */
export function moveEffectTo(
	project: Project,
	target: EffectTarget,
	from: number,
	to: number
): Command | null {
	const path = chainPath(project, target)
	const chain = chainAt(project, target)
	if (path === null || chain === null || from === to) return null
	if (!inRange(chain, from) || !inRange(chain, to)) return null
	return { op: 'move', path, from, to }
}

/** Enables or bypasses the instance at `index`. `null` when it already has that state. */
export function setEffectEnabled(
	project: Project,
	target: EffectTarget,
	index: number,
	enabled: boolean
): Command | null {
	const path = chainPath(project, target)
	const chain = chainAt(project, target)
	if (path === null || chain === null || !inRange(chain, index)) return null
	if (chain[index].enabled === enabled) return null
	return { op: 'set', path: [...path, index, 'enabled'], value: enabled }
}

/**
 * `custom`, else the first free `custom-2`, `custom-3`, …: an id no bank effect, built-in effect
 * or existing custom effect uses.
 */
export function nextCustomId(project: Project, bank: EffectBank): string {
	const used = new Set<string>([
		...bank.map((definition) => definition.id),
		...(project.customEffects ?? []).map((entry) => entry.id),
	])
	const taken = (id: string) => used.has(id) || getEffect(id) !== undefined
	if (!taken(CUSTOM_BASE_ID)) return CUSTOM_BASE_ID
	for (let n = 2; ; n++) {
		const id = `${CUSTOM_BASE_ID}-${n}`
		if (!taken(id)) return id
	}
}

/** Adds a new custom effect with the template GLSL, version 1, no params and no chunks. */
export function addCustomEffect(
	project: Project,
	bank: EffectBank
): { command: Command; id: string } {
	const id = nextCustomId(project, bank)
	const entry: ProjectCustomEffect = {
		id,
		version: 1,
		name: CUSTOM_DEFAULT_NAME,
		glsl: CUSTOM_TEMPLATE_GLSL,
		params: {},
		chunks: [],
	}
	const existing = project.customEffects
	const command: Command =
		existing === undefined
			? { op: 'set', path: ['customEffects'], value: json([entry]) }
			: { op: 'insert', path: ['customEffects', existing.length], value: json(entry) }
	return { command, id }
}

/** The editable fields of a custom effect. The id and version never change. */
export interface CustomEffectData {
	readonly name: string
	readonly glsl: string
	readonly params: Readonly<Record<string, JsonValue>>
	readonly chunks: readonly ChunkId[]
}

/** Writes new data to a custom effect. `null` when it doesn't exist or nothing changes. */
export function updateCustomEffect(
	project: Project,
	id: string,
	data: CustomEffectData
): Command | null {
	const index = project.customEffects?.findIndex((entry) => entry.id === id) ?? -1
	if (index === -1 || !project.customEffects) return null
	const current = project.customEffects[index]
	const next = json({
		...current,
		name: data.name,
		glsl: data.glsl,
		params: data.params,
		chunks: data.chunks,
	})
	if (JSON.stringify(next) === JSON.stringify(json(current))) return null
	return { op: 'set', path: ['customEffects', index], value: next }
}

/** Removes a custom effect. `null` when it doesn't exist. Check `customEffectUsage` first. */
export function deleteCustomEffect(project: Project, id: string): Command | null {
	const index = project.customEffects?.findIndex((entry) => entry.id === id) ?? -1
	if (index === -1) return null
	return { op: 'remove', path: ['customEffects', index] }
}

/** How many instances, in every layer chain and the global chain, use this effect id. */
export function customEffectUsage(project: Project, id: string): number {
	const count = (chain: readonly EffectInstance[]) =>
		chain.filter((instance) => instance.effect === id).length
	let total = count(project.effects)
	for (const track of project.tracks)
		for (const clip of track.clips) for (const layer of clip.layers) total += count(layer.effects)
	return total
}
