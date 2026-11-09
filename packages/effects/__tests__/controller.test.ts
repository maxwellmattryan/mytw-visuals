import { describe, expect, it, jest } from '@jest/globals'

import { defineEffect, EFFECTS } from '@mytw/fx'
import type { CompileResult, EffectDefinition } from '@mytw/fx'
import { defineSchema, param } from '@mytw/schema'
import type { Project, ProjectCustomEffect } from '@mytw/schema'

import { loadUnderstory, storeFor } from '../../layers/testing/fixtures'
import { CUSTOM_TEMPLATE_GLSL } from '../commands'
import { createEffectsController, UNAVAILABLE_MESSAGE } from '../controller'
import type { EffectsControllerOptions } from '../controller'
import { createEffectModel } from '../properties'

/** A stand-in for the WebGL compile check: `oops` on a line is a compile error on that line. */
function fakeCompile(effect: EffectDefinition): CompileResult {
	const lines = effect.glsl.split('\n')
	const errors = lines.flatMap((text, i) =>
		text.includes('oops') ? [{ line: i + 1, message: "'oops' : undeclared identifier" }] : []
	)
	return errors.length > 0 ? { ok: false, errors } : { ok: true, program: {} as WebGLProgram }
}

function setup(
	project: Project = loadUnderstory(),
	options: Partial<EffectsControllerOptions> = {}
) {
	const store = storeFor(project)
	const controller = createEffectsController({ store, compile: fakeCompile, ...options })
	return { store, controller }
}

const chainIds = (controller: ReturnType<typeof setup>['controller']) =>
	controller.chain.map((instance) => instance.id)

const custom = (overrides: Partial<ProjectCustomEffect> = {}): ProjectCustomEffect => ({
	id: 'fade',
	version: 1,
	name: 'Soft Fade',
	glsl: 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv) * (1.0 - uAmount);\n}',
	params: { amount: { kind: 'number', label: 'Amount', default: 0.1, min: 0, max: 1 } },
	chunks: [],
	...overrides,
})

describe('createEffectsController', () => {
	it('browses and searches the bank and custom effects', () => {
		const broken = custom({ id: 'broken', name: 'Broken', glsl: 'void main() {}' })
		const { controller } = setup({ ...loadUnderstory(), customEffects: [custom(), broken] })
		const listener = jest.fn()
		controller.subscribe(listener)

		expect(controller.catalog.map((item) => [item.source, item.id])).toEqual([
			...EFFECTS.map((definition) => ['builtin', definition.id]),
			['custom', 'fade'],
			['custom', 'broken'],
		])
		expect(controller.catalog[2]).toMatchObject({ name: 'Vignette', error: null })
		const items = controller.catalog
		expect(items.find((item) => item.id === 'fade')?.definition?.name).toBe('Soft Fade')
		expect(items.find((item) => item.id === 'broken')).toMatchObject({
			definition: null,
			error: 'Effect "broken": glsl must define vec4 effect(vec2 uv)',
		})

		// Trimmed, case-insensitive substring of the name or the id.
		controller.setQuery('  VIGN ')
		expect(listener).toHaveBeenCalled()
		expect(controller.catalog.map((item) => item.id)).toEqual(['vignette'])
		controller.setQuery('shift')
		expect(controller.catalog.map((item) => item.id)).toEqual(['hue-shift'])
		controller.setQuery('soft')
		expect(controller.catalog.map((item) => item.id)).toEqual(['fade'])
		controller.setQuery('-')
		expect(controller.catalog.map((item) => item.id)).toEqual(
			EFFECTS.filter((definition) => definition.id.includes('-')).map((definition) => definition.id)
		)
		controller.setQuery('nothing like this')
		expect(controller.catalog).toEqual([])
		controller.setQuery('   ')
		expect(controller.catalog).toHaveLength(EFFECTS.length + 2)
	})

	it('shows a new bank effect with no editor changes', () => {
		const tint = defineEffect({
			id: 'test-tint',
			version: 2,
			name: 'Test tint',
			params: defineSchema({
				strength: param.number({ label: 'Strength', default: 0.5, min: 0, max: 1 }),
				steps: param.integer({ label: 'Steps', default: 3, min: 1, max: 8 }),
				color: param.color({ label: 'Color', default: '#ff8800' }),
				invert: param.boolean({ label: 'Invert', default: false }),
				mode: param.enum({ label: 'Mode', options: ['mix', 'add'], default: 'mix' }),
				origin: param.vec2({ label: 'Origin', default: [0.5, 0.5] }),
			}),
			glsl: 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv);\n}',
		})
		const { store, controller } = setup(loadUnderstory(), { bank: [tint] })
		expect(controller.catalog.map((item) => item.id)).toEqual(['test-tint'])

		controller.setScope('global')
		controller.add('test-tint')
		expect(store.document.effects.at(-1)).toEqual({
			id: 'test-tint',
			effect: 'test-tint',
			version: 2,
			enabled: true,
			params: {
				strength: 0.5,
				steps: 3,
				color: '#ff8800',
				invert: false,
				mode: 'mix',
				origin: [0.5, 0.5],
			},
		})
		expect(controller.selectedId).toBe('test-tint')

		const model = createEffectModel(controller)
		expect(Object.keys(model.schema.params)).toEqual([
			'strength',
			'steps',
			'color',
			'invert',
			'mode',
			'origin',
		])
		expect(model.set('mode', 'add')).toEqual({ ok: true })
		expect(model.set('origin', [0.25, 0.75])).toEqual({ ok: true })
		expect(model.set('color', '#00ff00')).toEqual({ ok: true })
		expect(model.set('invert', true)).toEqual({ ok: true })
		expect(model.set('steps', 5)).toEqual({ ok: true })
		expect(store.document.effects.at(-1)?.params).toMatchObject({
			mode: 'add',
			origin: [0.25, 0.75],
			color: '#00ff00',
			invert: true,
			steps: 5,
		})
		// The fixture's built-in instances aren't in this bank, so they show as unknown.
		expect(controller.rows[0]).toMatchObject({
			definition: null,
			problem: { kind: 'unknown', effect: 'caustic-warp' },
		})
		model.destroy()
	})

	it('edits the layer and composition chains with undo', () => {
		const { store, controller } = setup()

		// Layer with no layer: no target, and Add makes no command.
		expect(controller.scope).toBe('layer')
		expect(controller.target).toBeNull()
		expect(controller.chain).toEqual([])
		const apply = jest.spyOn(store, 'apply')
		controller.add('vignette')
		expect(apply).not.toHaveBeenCalled()
		controller.setLayer('missing')
		expect(controller.target).toBeNull()

		controller.setLayer('ghost')
		expect(controller.target).toEqual({ kind: 'layer', layerId: 'ghost' })
		controller.add('vignette')
		controller.add('scanlines')
		expect(chainIds(controller)).toEqual(['vignette-2', 'scanlines'])
		expect(controller.selectedId).toBe('scanlines')
		const ghost = () => store.document.tracks[0].clips[0].layers[1].effects
		expect(ghost().map((instance) => instance.id)).toEqual(['vignette-2', 'scanlines'])

		// Move: each one undo step; at an end, no command.
		apply.mockClear()
		controller.move('scanlines', 1)
		controller.move('vignette-2', -1)
		expect(apply).not.toHaveBeenCalled()
		controller.move('scanlines', -1)
		expect(chainIds(controller)).toEqual(['scanlines', 'vignette-2'])
		store.undo()
		expect(chainIds(controller)).toEqual(['vignette-2', 'scanlines'])

		// Bypass.
		controller.toggleEnabled('vignette-2')
		expect(controller.chain[0].enabled).toBe(false)
		store.undo()
		expect(controller.chain[0].enabled).toBe(true)

		// Remove moves the selection to the row that took its place, else the row above.
		controller.select('vignette-2')
		controller.remove('vignette-2')
		expect(chainIds(controller)).toEqual(['scanlines'])
		expect(controller.selectedId).toBe('scanlines')
		controller.remove('scanlines')
		expect(controller.selectedId).toBeNull()
		store.undo()
		store.undo()
		expect(chainIds(controller)).toEqual(['vignette-2', 'scanlines'])
		controller.select('scanlines')
		controller.remove('scanlines')
		expect(controller.selectedId).toBe('vignette-2')
		// Removing an unselected row keeps the selection.
		store.undo()
		controller.select('vignette-2')
		controller.remove('scanlines')
		expect(controller.selectedId).toBe('vignette-2')

		// Changing the target clears the selection; the composition chain is the global one.
		controller.setScope('global')
		expect(controller.selectedId).toBeNull()
		expect(controller.target).toEqual({ kind: 'global' })
		expect(chainIds(controller)).toEqual(['caustic', 'vignette', 'aberration', 'hue'])
		controller.add('scanlines')
		expect(chainIds(controller)).toEqual(['caustic', 'vignette', 'aberration', 'hue', 'scanlines'])
		expect(controller.selectedId).toBe('scanlines')
		controller.move('caustic', 1)
		controller.toggleEnabled('hue')
		controller.remove('vignette')
		expect(chainIds(controller)).toEqual(['caustic', 'aberration', 'hue', 'scanlines'])
		expect(store.document.effects.map((instance) => instance.enabled)).toEqual([
			true,
			true,
			false,
			true,
		])
		store.undo()
		store.undo()
		store.undo()
		store.undo()
		expect(store.document.effects).toEqual(loadUnderstory().effects)
		expect(controller.selectedId).toBeNull()

		// Selecting seals the merge run; selecting an unknown id selects nothing.
		const seal = jest.spyOn(store, 'seal')
		controller.select('hue')
		expect(seal).toHaveBeenCalledTimes(1)
		controller.select('nope')
		expect(controller.selectedId).toBeNull()

		// A layer that disappears leaves no target.
		controller.setScope('layer')
		store.apply({ op: 'remove', path: ['tracks', 0, 'clips', 0, 'layers', 1] })
		expect(controller.target).toBeNull()
		expect(controller.rows).toEqual([])

		// A rejected command shows on the error line until the next success.
		controller.setScope('global')
		apply.mockImplementationOnce(() => ({
			ok: false,
			error: { code: 'invalid', message: 'rejected' },
		}))
		controller.toggleEnabled('hue')
		expect(controller.error).toBe('rejected')
		controller.toggleEnabled('hue')
		expect(controller.error).toBeNull()
		controller.destroy()
	})

	it('keeps the preview out of the document', () => {
		const { store, controller } = setup({ ...loadUnderstory(), customEffects: [custom()] })
		const before = store.document

		// No target: no preview.
		controller.setPreview('vignette')
		expect(controller.preview).toBeNull()

		controller.setLayer('base')
		controller.setPreview('vignette')
		expect(controller.preview).toMatchObject({
			target: { kind: 'layer', layerId: 'base' },
			definition: { id: 'vignette' },
		})
		controller.setPreview('fade')
		expect(controller.preview?.definition.name).toBe('Soft Fade')
		controller.setPreview('unknown')
		expect(controller.preview).toBeNull()
		controller.setPreview(null)
		expect(controller.preview).toBeNull()

		// The preview never reaches the document or the history.
		controller.setPreview('vignette')
		expect(store.document).toBe(before)
		expect(store.canUndo).toBe(false)

		// It clears on a target change, and on Add.
		controller.setScope('global')
		expect(controller.preview).toBeNull()
		controller.setPreview('scanlines')
		expect(controller.preview?.target).toEqual({ kind: 'global' })
		controller.add('scanlines')
		expect(controller.preview).toBeNull()
		expect(store.document.effects.at(-1)?.effect).toBe('scanlines')

		// And when no target is available any more.
		controller.setScope('layer')
		controller.setPreview('vignette')
		expect(controller.preview).not.toBeNull()
		store.apply({ op: 'remove', path: ['tracks', 0, 'clips', 0, 'layers', 0] })
		expect(controller.preview).toBeNull()
	})

	it('creates, applies and deletes custom effects', () => {
		const { store, controller } = setup()

		controller.newCustomEffect()
		expect(store.document.customEffects).toEqual([
			{
				id: 'custom',
				version: 1,
				name: 'Custom effect',
				glsl: CUSTOM_TEMPLATE_GLSL,
				params: {},
				chunks: [],
			},
		])
		expect(controller.editor).toEqual({
			id: 'custom',
			name: 'Custom effect',
			glsl: CUSTOM_TEMPLATE_GLSL,
			paramsText: '{}',
			chunks: [],
			errors: [],
			dirty: false,
		})
		controller.newCustomEffect()
		expect(controller.editor?.id).toBe('custom-2')
		store.undo()
		// The open effect is gone, so the editor closes.
		expect(controller.editor).toBeNull()
		controller.openEditor('custom')

		// Edits change only the draft.
		const before = store.document
		controller.editDraft({
			name: 'Tint',
			glsl: 'vec4 effect(vec2 uv) {\n  vec4 c = texture(uInput, uv);\n  return oops;\n}',
		})
		expect(controller.editor).toMatchObject({ name: 'Tint', dirty: true })
		expect(store.document).toBe(before)

		// A compile error keeps the document and lists the error on its line.
		expect(controller.applyDraft()).toBe(false)
		expect(store.document).toBe(before)
		expect(controller.editor?.errors).toEqual([
			{ line: 3, message: "'oops' : undeclared identifier" },
		])

		// Bad params JSON gives one Params error.
		controller.editDraft({ paramsText: '{ "amount": ' })
		expect(controller.applyDraft()).toBe(false)
		expect(controller.editor?.errors).toHaveLength(1)
		expect(controller.editor?.errors[0].line).toBeNull()
		expect(controller.editor?.errors[0].message).toMatch(/^Params: /)

		// createCustomEffect errors have no line.
		controller.editDraft({
			paramsText: '{ "amount": { "kind": "slider", "label": "Amount", "default": 1 } }',
		})
		expect(controller.applyDraft()).toBe(false)
		expect(controller.editor?.errors[0]).toMatchObject({ line: null, message: /^Param "amount"/ })
		expect(store.document).toBe(before)

		// Fixed: Apply writes one undo step and clears the errors.
		controller.editDraft({
			glsl: 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv) * uAmount;\n}',
			paramsText:
				'{ "amount": { "kind": "number", "label": "Amount", "default": 0.1, "min": 0, "max": 1 } }',
			chunks: ['math'],
		})
		expect(controller.applyDraft()).toBe(true)
		expect(store.document.customEffects?.[0]).toEqual({
			id: 'custom',
			version: 1,
			name: 'Tint',
			glsl: 'vec4 effect(vec2 uv) {\n  return texture(uInput, uv) * uAmount;\n}',
			params: { amount: { kind: 'number', label: 'Amount', default: 0.1, min: 0, max: 1 } },
			chunks: ['math'],
		})
		expect(controller.editor).toMatchObject({ errors: [], dirty: false, name: 'Tint' })
		expect(controller.catalog.at(-1)).toMatchObject({ id: 'custom', name: 'Tint', error: null })

		// Undo reloads a clean draft; a dirty draft is kept.
		store.undo()
		expect(controller.editor?.name).toBe('Custom effect')
		store.redo()
		expect(controller.editor?.name).toBe('Tint')
		controller.editDraft({ name: 'Draft' })
		store.undo()
		expect(controller.editor).toMatchObject({ name: 'Draft', dirty: true })
		controller.revertDraft()
		expect(controller.editor).toMatchObject({ name: 'Custom effect', dirty: false })
		store.redo()

		// Delete is refused while an instance uses the effect.
		controller.setScope('global')
		controller.add('custom')
		expect(store.document.effects.at(-1)).toMatchObject({
			effect: 'custom',
			params: { amount: 0.1 },
		})
		const withInstance = store.document
		controller.deleteCustom()
		expect(store.document).toBe(withInstance)
		expect(controller.editor?.errors).toEqual([
			{ line: null, message: '"Tint" is used by 1 effect(s). Remove them first.' },
		])
		controller.remove('custom')
		controller.deleteCustom()
		expect(store.document.customEffects).toEqual([])
		expect(controller.editor).toBeNull()
		store.undo()
		expect(store.document.customEffects?.map((entry) => entry.id)).toEqual(['custom'])

		// Without WebGL2, Apply reports the single unavailable error.
		const offline = setup(store.document, {
			compile: () => ({ ok: false, errors: [{ line: null, message: UNAVAILABLE_MESSAGE }] }),
		})
		offline.controller.openEditor('custom')
		offline.controller.editDraft({ name: 'Other' })
		expect(offline.controller.applyDraft()).toBe(false)
		expect(offline.controller.editor?.errors).toEqual([
			{ line: null, message: "WebGL2 is unavailable, so the effect can't be checked." },
		])
		controller.closeEditor()
		expect(controller.editor).toBeNull()
	})
})
