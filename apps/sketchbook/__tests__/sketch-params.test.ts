import { describe, expect, it } from '@jest/globals'

import { defaults, validate } from '@mytw/schema'
import type { ParamDefs, Schema, ValidationIssue } from '@mytw/schema'

import { loopSpeed, waveDisplacementSchema } from '../sketches/001-wave-displacement/params'
import { understorySchema } from '../sketches/002-understory/params'

function issuesFor<P extends ParamDefs>(
	schema: Schema<P>,
	overrides: Record<string, unknown>
): ValidationIssue[] {
	const result = validate(schema, { ...defaults(schema), ...overrides })
	return result.ok ? [] : result.issues
}

function constraintIds(issues: ValidationIssue[]): string[] {
	return issues.flatMap((issue) => (issue.kind === 'constraint' ? [issue.constraint] : []))
}

describe('understory params', () => {
	it('understory params carry help text', () => {
		const help = understorySchema.params.driftAmp.help
		expect(typeof help).toBe('string')
		expect(help?.length).toBeGreaterThan(0)
	})

	it('understory defaults match the old CONFIG', () => {
		expect(defaults(understorySchema)).toEqual({
			fps: 30,
			loopFrames: 225,
			driftAmp: 0.012,
			ghostScale: 0.8,
			ghostContrary: false,
			driftCyclesX: 1,
			driftCyclesY: 1,
			driftPhase: 0,
			spin: 0,
			wobbleAmp: 0,
			wobbleCycles: 1,
			wobblePhase: 0,
			breatheAmp: 0.022,
			breatheCycles: 1,
			breathePhase: 0,
			baseZoom: 2,
			baseCenterX: 0.5,
			baseCenterY: 0.72,
			baseMirrorX: false,
			baseMirrorY: false,
			baseTilt: 0,
			ghostZoom: 3.4,
			ghostCenterX: 0.2,
			ghostCenterY: 0.25,
			ghostMirrorX: true,
			ghostMirrorY: false,
			ghostTilt: 0,
			ghostSpin: 0,
			ghostWobbleAmp: 0.03,
			ghostWobbleCycles: 1,
			ghostWobblePhase: 0,
			ghostFadeStart: 0,
			ghostFadeEnd: 1,
			intensity: 1,
			vignette: 0.2,
			feather: 0.06,
			hueShift: -15,
			causticAmp: 0.005,
			causticScale: 2,
			causticLoopRadius: 0.8,
			aberrationBase: 0.001,
			aberrationPulseAmp: 0.01,
			aberrationPulseCycles: 1,
			aberrationPulsePhase: 0,
		})
		expect(validate(understorySchema, defaults(understorySchema)).ok).toBe(true)
	})

	it.each([
		'driftCyclesX',
		'driftCyclesY',
		'spin',
		'wobbleCycles',
		'breatheCycles',
		'ghostSpin',
		'ghostWobbleCycles',
		'aberrationPulseCycles',
	])('understory rejects non-integer cycles: %s', (key) => {
		const issues = issuesFor(understorySchema, { [key]: 1.5 })
		expect(issues).toContainEqual(
			expect.objectContaining({ kind: 'param', param: key, code: 'integer' })
		)
	})

	it.each([
		['baseZoom', 'base-edge-free'],
		['ghostZoom', 'ghost-edge-free'],
	])('understory flags zoom too small for drift: %s', (key, id) => {
		// 1 / (1 - 2 * 0.012) is about 1.0246.
		expect(constraintIds(issuesFor(understorySchema, { [key]: 1.02 }))).toEqual([id])
		expect(constraintIds(issuesFor(understorySchema, { [key]: 1.03 }))).toEqual([])
		// A larger drift needs a larger zoom.
		expect(constraintIds(issuesFor(understorySchema, { [key]: 1.5, driftAmp: 0.2 }))).toContain(id)
	})

	it('understory flags an empty ghost fade span', () => {
		const issues = issuesFor(understorySchema, { ghostFadeStart: 0.4, ghostFadeEnd: 0.4 })
		expect(constraintIds(issues)).toEqual(['ghost-fade-span'])
		expect(
			constraintIds(issuesFor(understorySchema, { ghostFadeStart: 1, ghostFadeEnd: 0 }))
		).toEqual([])
	})
})

describe('wave displacement params', () => {
	it('wave displacement defaults match the old CONFIG', () => {
		const v = defaults(waveDisplacementSchema)
		expect(v).toEqual({
			loopDuration: 8,
			fps: 48,
			primaryFreq: 3,
			primaryCycles: 1,
			primaryAmplitude: 0.018,
			secondaryFreq: 2,
			secondaryCycles: 1,
			secondaryAmplitude: 0.01,
			verticalPulseCycles: 2,
			verticalPulseFreq: 5,
			verticalPulseDepth: 0.6,
			hueShiftAmount: 0.6,
			hueShiftCycles: 1,
			chromaticAmount: 0.006,
			chromaticPulseCycles: 1,
			chromaticPulseDepth: 0.85,
		})

		// The old radian-per-second speeds, bit for bit.
		expect(loopSpeed(1, 8)).toBe(Math.PI / 4)
		expect(loopSpeed(2, 8)).toBe(Math.PI / 2)
		expect(loopSpeed(v.primaryCycles, v.loopDuration)).toBe(Math.PI / 4)
		expect(loopSpeed(v.secondaryCycles, v.loopDuration)).toBe(Math.PI / 4)
		expect(loopSpeed(v.verticalPulseCycles, v.loopDuration)).toBe(Math.PI / 2)
		expect(loopSpeed(v.hueShiftCycles, v.loopDuration)).toBe(Math.PI / 4)
		expect(loopSpeed(v.chromaticPulseCycles, v.loopDuration)).toBe(Math.PI / 4)

		// The old recordFrames: one loop.
		expect(v.loopDuration * v.fps).toBe(384)
	})

	it.each([
		'primaryCycles',
		'secondaryCycles',
		'verticalPulseCycles',
		'hueShiftCycles',
		'chromaticPulseCycles',
	])('wave displacement rejects non-integer cycles: %s', (key) => {
		const issues = issuesFor(waveDisplacementSchema, { [key]: 1.5 })
		expect(issues).toContainEqual(
			expect.objectContaining({ kind: 'param', param: key, code: 'integer' })
		)
	})
})
