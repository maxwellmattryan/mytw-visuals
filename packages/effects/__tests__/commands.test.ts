import { describe, expect, it } from '@jest/globals'

import type { Command } from '@mytw/document'
import { EFFECTS, getEffect } from '@mytw/fx'
import type { EffectDefinition } from '@mytw/fx'
import type { Project } from '@mytw/schema'

import { issuesOf, loadUnderstory, storeFor } from '../../layers/testing/fixtures'
import {
	addCustomEffect,
	addEffect,
	CUSTOM_TEMPLATE_GLSL,
	customEffectUsage,
	deleteCustomEffect,
	moveEffectTo,
	nextCustomId,
	removeEffect,
	setEffectEnabled,
	updateCustomEffect,
} from '../commands'
import { chainAt, chainPath, findLayer } from '../target'
import type { EffectTarget } from '../target'

const GLOBAL: EffectTarget = { kind: 'global' }
const GHOST: EffectTarget = { kind: 'layer', layerId: 'ghost' }

function effect(id: string): EffectDefinition {
	const definition = getEffect(id)
	if (!definition) throw new Error(`no effect ${id}`)
	return definition
}

/** Applies a command through a store and returns the new document. */
function applied(project: Project, command: Command | null): Project {
	if (command === null) throw new Error('expected a command')
	const store = storeFor(project)
	const result = store.apply(command)
	if (!result.ok) throw new Error(result.error.message)
	return store.document
}

const ids = (project: Project, target: EffectTarget) =>
	(chainAt(project, target) ?? []).map((instance) => instance.id)

describe('effect chain commands', () => {
	it('finds chains by target', () => {
		const project = loadUnderstory()
		expect(findLayer(project, 'ghost')?.path).toEqual(['tracks', 0, 'clips', 0, 'layers', 1])
		expect(findLayer(project, 'nope')).toBeNull()
		expect(chainPath(project, GLOBAL)).toEqual(['effects'])
		expect(chainPath(project, GHOST)).toEqual(['tracks', 0, 'clips', 0, 'layers', 1, 'effects'])
		expect(chainPath(project, { kind: 'layer', layerId: 'nope' })).toBeNull()
		expect(chainAt(project, GLOBAL)).toBe(project.effects)
		expect(chainAt(project, GHOST)).toEqual([])
		expect(chainAt(project, { kind: 'layer', layerId: 'nope' })).toBeNull()
	})

	it('builds add, remove, move and bypass commands for layer and global chains', () => {
		const start = loadUnderstory()
		expect(ids(start, GLOBAL)).toEqual(['caustic', 'vignette', 'aberration', 'hue'])

		// Add appends at the end, at defaults, with an id from nextId.
		const vignette = effect('vignette')
		const onGhost = addEffect(start, GHOST, vignette)
		expect(onGhost?.id).toBe('vignette-2')
		let project = applied(start, onGhost?.command ?? null)
		expect(chainAt(project, GHOST)).toEqual([
			{
				id: 'vignette-2',
				effect: 'vignette',
				version: 1,
				enabled: true,
				params: { amount: 0.2, inner: 0.35, outer: 0.95 },
			},
		])
		const scan = addEffect(project, GLOBAL, effect('scanlines'))
		expect(scan?.id).toBe('scanlines')
		project = applied(project, scan?.command ?? null)
		expect(ids(project, GLOBAL)).toEqual(['caustic', 'vignette', 'aberration', 'hue', 'scanlines'])
		expect(addEffect(project, { kind: 'layer', layerId: 'nope' }, vignette)).toBeNull()

		// Move, with ends and no-ops returning null.
		project = applied(project, moveEffectTo(project, GLOBAL, 4, 0))
		expect(ids(project, GLOBAL)).toEqual(['scanlines', 'caustic', 'vignette', 'aberration', 'hue'])
		expect(moveEffectTo(project, GLOBAL, 0, -1)).toBeNull()
		expect(moveEffectTo(project, GLOBAL, 4, 5)).toBeNull()
		expect(moveEffectTo(project, GLOBAL, 2, 2)).toBeNull()
		expect(moveEffectTo(project, GHOST, 0, 1)).toBeNull()

		// Bypass writes enabled, and the same state is a no-op.
		project = applied(project, setEffectEnabled(project, GHOST, 0, false))
		expect(chainAt(project, GHOST)?.[0].enabled).toBe(false)
		expect(setEffectEnabled(project, GHOST, 0, false)).toBeNull()
		expect(setEffectEnabled(project, GHOST, 3, true)).toBeNull()

		// Remove splices out one instance.
		project = applied(project, removeEffect(project, GLOBAL, 1))
		expect(ids(project, GLOBAL)).toEqual(['scanlines', 'vignette', 'aberration', 'hue'])
		project = applied(project, removeEffect(project, GHOST, 0))
		expect(ids(project, GHOST)).toEqual([])
		expect(removeEffect(project, GHOST, 0)).toBeNull()

		expect(issuesOf(project)).toEqual([])
		// None of the builders mutated their input.
		expect(start).toEqual(loadUnderstory())
	})

	it('builds custom effect commands', () => {
		const start = loadUnderstory()
		expect(nextCustomId(start, EFFECTS)).toBe('custom')
		const first = addCustomEffect(start, EFFECTS)
		expect(first.command).toMatchObject({ op: 'set', path: ['customEffects'] })
		let project = applied(start, first.command)
		expect(project.customEffects).toEqual([
			{
				id: 'custom',
				version: 1,
				name: 'Custom effect',
				glsl: CUSTOM_TEMPLATE_GLSL,
				params: {},
				chunks: [],
			},
		])
		const second = addCustomEffect(project, EFFECTS)
		expect(second).toMatchObject({ id: 'custom-2', command: { op: 'insert' } })
		project = applied(project, second.command)
		// A bank effect named `custom-3` is skipped too.
		expect(nextCustomId(project, [{ ...effect('vignette'), id: 'custom-3' }])).toBe('custom-4')

		const params = { amount: { kind: 'number', label: 'Amount', default: 0.1, min: 0, max: 1 } }
		const data = {
			name: 'Fade',
			glsl: 'vec4 effect(vec2 uv) { return vec4(0.0); }',
			params,
			chunks: [],
		}
		project = applied(project, updateCustomEffect(project, 'custom-2', data))
		expect(project.customEffects?.[1]).toEqual({ id: 'custom-2', version: 1, ...data })
		expect(updateCustomEffect(project, 'custom-2', data)).toBeNull()
		expect(updateCustomEffect(project, 'missing', data)).toBeNull()

		expect(customEffectUsage(project, 'custom-2')).toBe(0)
		const used = applied(project, {
			op: 'insert',
			path: ['effects', 0],
			value: { id: 'fade', effect: 'custom-2', version: 1, enabled: true, params: {} },
		})
		expect(customEffectUsage(used, 'custom-2')).toBe(1)
		expect(customEffectUsage(used, 'vignette')).toBe(1)

		project = applied(project, deleteCustomEffect(project, 'custom'))
		expect(project.customEffects?.map((entry) => entry.id)).toEqual(['custom-2'])
		expect(deleteCustomEffect(project, 'custom')).toBeNull()
		expect(issuesOf(project)).toEqual([])
	})
})
