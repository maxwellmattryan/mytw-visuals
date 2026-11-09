import { describe, expect, it } from '@jest/globals'

import type { CompileResult } from '@mytw/fx'
import { loadUnderstory, storeFor } from '../../layers/testing/fixtures'
import { MODULATED_HELP } from '../../layers/properties'
import { createEffectsController } from '../controller'
import { createEffectModel } from '../properties'

const compile = (): CompileResult => ({ ok: true, program: {} as WebGLProgram })

function setup() {
	const project = loadUnderstory()
	project.effects[1].params = { amount: 0.2, inner: 7 }
	const store = storeFor(project)
	const controller = createEffectsController({ store, compile })
	controller.setScope('global')
	const model = createEffectModel(controller)
	const params = (id: string) => store.document.effects.find((fx) => fx.id === id)?.params
	return { store, controller, model, params }
}

describe('effect model', () => {
	it('edits params through the schema', () => {
		const { store, controller, model, params } = setup()

		// Nothing selected: no controls.
		expect(model.instance).toBeNull()
		expect(model.schema.params).toEqual({})
		expect(model.set('amount', 0.5)).toEqual({ ok: false, message: 'No effect selected' })

		// Values come from the instance; missing or invalid ones show the default.
		controller.select('vignette')
		expect(model.definition?.id).toBe('vignette')
		expect(Object.keys(model.schema.params)).toEqual(['amount', 'inner', 'outer'])
		expect(model.values).toEqual({ amount: 0.2, inner: 1.5, outer: 0.95 })

		// Edits to one param merge into one undo step.
		expect(model.set('amount', 0.3)).toEqual({ ok: true })
		expect(model.setText('amount', '0.4')).toEqual({ ok: true })
		expect(params('vignette')?.amount).toBe(0.4)
		expect(model.values.amount).toBe(0.4)
		store.undo()
		expect(params('vignette')?.amount).toBe(0.2)

		// A schema rejection or a constraint shows on the field and leaves the document unchanged.
		const before = store.document
		expect(model.set('amount', 2)).toMatchObject({ ok: false })
		expect(model.errors.amount).toBeDefined()
		expect(model.setText('amount', 'abc')).toEqual({ ok: false, message: 'Enter a number' })
		expect(model.set('outer', 0.5)).toEqual({
			ok: false,
			message: 'Inner must be less than outer',
		})
		expect(model.errors.outer).toBe('Inner must be less than outer')
		expect(store.document).toBe(before)
		expect(model.set('inner', 0.3)).toEqual({ ok: true })
		expect(model.set('outer', 0.5)).toEqual({ ok: true })
		expect(model.errors.outer).toBeUndefined()
		expect(params('vignette')).toEqual({ amount: 0.2, inner: 0.3, outer: 0.5 })

		// Reset all writes every default in one step.
		model.resetAll()
		expect(params('vignette')).toEqual({ amount: 0.2, inner: 0.35, outer: 0.95 })
		store.undo()
		expect(params('vignette')).toEqual({ amount: 0.2, inner: 0.3, outer: 0.5 })

		// A modulated param edits its value, keeps mod and shows the help text.
		controller.select('aberration')
		expect([...model.modulated]).toEqual(['amount'])
		expect(model.schema.params.amount.help).toBe(MODULATED_HELP)
		expect(model.values.amount).toBe(0.006)
		expect(model.set('amount', 0.01)).toEqual({ ok: true })
		expect(params('aberration')?.amount).toEqual({
			value: 0.01,
			mod: [{ modulator: 'aberration-pulse', amount: 0.005, mode: 'add' }],
		})

		// Changing the selection seals the merge, so the next edit is its own step.
		controller.select('hue')
		controller.select('aberration')
		expect(model.set('amount', 0.02)).toEqual({ ok: true })
		store.undo()
		expect(params('aberration')?.amount).toMatchObject({ value: 0.01 })
		store.undo()
		expect(params('aberration')?.amount).toMatchObject({ value: 0.006 })

		// Unresolved instances have no controls.
		store.apply({
			op: 'insert',
			path: ['effects', 0],
			value: { id: 'ghosty', effect: 'no-such', version: 1, enabled: true, params: {} },
		})
		controller.select('ghosty')
		expect(model.instance?.id).toBe('ghosty')
		expect(model.definition).toBeNull()
		expect(controller.selected?.problem).toEqual({ kind: 'unknown', effect: 'no-such' })
		expect(model.schema.params).toEqual({})
		model.destroy()
	})
})
