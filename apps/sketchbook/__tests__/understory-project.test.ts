import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { defaults, parseProject } from '@mytw/schema'
import type { AnimatableNumber, ModBinding, Project, ProjectLayer } from '@mytw/schema'

import { understorySchema } from '../sketches/002-understory/params'

const FIXTURE = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../packages/schema/fixtures/v1/understory.json'
)

const TAU = Math.PI * 2
const d = defaults(understorySchema)

function loadFixture(): Project {
	const result = parseProject(readFileSync(FIXTURE, 'utf8'))
	if (!result.ok) throw new Error(result.issues.map((found) => found.message).join('\n'))
	return result.project
}

const project = loadFixture()
const layers = project.tracks[0].clips[0].layers

function layer(id: string): ProjectLayer {
	const found = layers.find((candidate) => candidate.id === id)
	if (!found) throw new Error(`no layer ${id}`)
	return found
}

function valueOf(value: AnimatableNumber): number {
	return typeof value === 'number' ? value : value.value
}

function bindingsOf(value: AnimatableNumber): ModBinding[] {
	return typeof value === 'number' ? [] : value.mod
}

/** The single binding on a value, which every bound Understory value has. */
function binding(value: AnimatableNumber): ModBinding {
	const mod = bindingsOf(value)
	expect(mod).toHaveLength(1)
	return mod[0]
}

function expectBinding(value: AnimatableNumber, modulator: string, amount: number, mode: string) {
	const found = binding(value)
	expect(found.modulator).toBe(modulator)
	expect(found.amount).toBeCloseTo(amount, 10)
	expect(found.mode).toBe(mode)
}

/** The sketch's phases are in radians, the format's are in turns. */
function turns(radians: number, offset: number): number {
	return (radians / TAU + offset) % 1
}

describe('Understory project fixture', () => {
	it('fixture matches the sketch defaults', () => {
		expect(project.name).toBe('Understory')
		expect(project.output).toEqual({ width: 1080, height: 1920, fps: d.fps, background: '#000000' })
		expect(project.timeline).toEqual({ mode: 'loop', frames: d.loopFrames })
		expect(project.tracks).toHaveLength(1)
		expect(project.tracks[0]).toMatchObject({ id: 'main', kind: 'visual' })
		expect(project.tracks[0].clips[0]).toMatchObject({
			id: 'understory',
			start: 0,
			frames: d.loopFrames,
			fadeIn: 0,
			fadeOut: 0,
		})

		const periodic = (key: string) => {
			const modulator = project.modulators[key]
			if (modulator.shape !== 'sine') throw new Error(`${key} is not a sine`)
			return modulator
		}
		const expectedModulators: [string, number, number][] = [
			['drift-x', d.driftCyclesX, turns(d.driftPhase, 0)],
			['drift-y', d.driftCyclesY, turns(d.driftPhase, 0.25)],
			['breathe', d.breatheCycles, turns(d.breathePhase, 0)],
			['ghost-wobble', d.ghostWobbleCycles, turns(d.ghostWobblePhase, 0)],
			['aberration-pulse', d.aberrationPulseCycles, turns(d.aberrationPulsePhase, 0.75)],
		]
		for (const [key, cycles, phase] of expectedModulators) {
			expect(periodic(key).cycles).toBe(cycles)
			expect(periodic(key).phase).toBeCloseTo(phase, 10)
		}

		const base = layer('base')
		expect(base).toMatchObject({ name: 'Base', blend: 'normal', opacity: 1, visible: true })
		expect(base.feather).toBeCloseTo(d.feather, 10)
		expect(base.effects).toEqual([])
		expect(base.mask).toBeUndefined()
		expect(valueOf(base.transform.centerX)).toBeCloseTo(d.baseCenterX, 10)
		expect(valueOf(base.transform.centerY)).toBeCloseTo(d.baseCenterY, 10)
		expect(valueOf(base.transform.zoom)).toBeCloseTo(d.baseZoom, 10)
		expect(base.transform.rotation).toBe(0)
		expect(base.transform.mirrorX).toBe(d.baseMirrorX)
		expect(base.transform.mirrorY).toBe(d.baseMirrorY)
		expectBinding(base.transform.centerX, 'drift-x', d.driftAmp, 'add')
		expectBinding(base.transform.centerY, 'drift-y', d.driftAmp, 'add')
		expectBinding(base.transform.zoom, 'breathe', d.breatheAmp, 'multiply')

		const ghost = layer('ghost')
		const ghostDrift = d.driftAmp * d.ghostScale * (d.ghostContrary ? -1 : 1)
		expect(ghost).toMatchObject({ name: 'Ghost', blend: 'multiply', visible: true })
		expect(valueOf(ghost.opacity)).toBeCloseTo(d.intensity, 10)
		expect(ghost.feather).toBeCloseTo(d.feather, 10)
		expect(ghost.effects).toEqual([])
		expect(ghost.mask).toEqual({
			kind: 'linear-gradient',
			from: [0.5, d.ghostFadeStart],
			to: [0.5, d.ghostFadeEnd],
		})
		expect(valueOf(ghost.transform.centerX)).toBeCloseTo(d.ghostCenterX, 10)
		expect(valueOf(ghost.transform.centerY)).toBeCloseTo(d.ghostCenterY, 10)
		expect(valueOf(ghost.transform.zoom)).toBeCloseTo(d.ghostZoom, 10)
		expect(valueOf(ghost.transform.rotation)).toBeCloseTo(d.ghostTilt, 10)
		expect(ghost.transform.mirrorX).toBe(d.ghostMirrorX)
		expect(ghost.transform.mirrorY).toBe(d.ghostMirrorY)
		expectBinding(ghost.transform.centerX, 'drift-x', ghostDrift, 'add')
		expectBinding(ghost.transform.centerY, 'drift-y', ghostDrift, 'add')
		expectBinding(ghost.transform.zoom, 'breathe', d.breatheAmp, 'multiply')
		expectBinding(ghost.transform.rotation, 'ghost-wobble', d.ghostWobbleAmp, 'add')

		expect(project.effects.map((effect) => [effect.id, effect.effect])).toEqual([
			['caustic', 'caustic-warp'],
			['vignette', 'vignette'],
			['aberration', 'chromatic-aberration'],
			['hue', 'hue-shift'],
		])
		for (const effect of project.effects)
			expect(effect).toMatchObject({ version: 1, enabled: true })
		const [caustic, vignette, aberration, hue] = project.effects.map((effect) => effect.params)
		expect(caustic).toEqual({
			amount: expect.closeTo(d.causticAmp, 10),
			scale: expect.closeTo(d.causticScale, 10),
			loopRadius: expect.closeTo(d.causticLoopRadius, 10),
		})
		expect(vignette).toEqual({ amount: expect.closeTo(d.vignette, 10) })
		expect(hue).toEqual({ degrees: expect.closeTo(d.hueShift, 10) })
		const pulse = aberration.amount
		if (typeof pulse !== 'number' && typeof pulse !== 'object') throw new Error('amount')
		if (Array.isArray(pulse)) throw new Error('amount is a tuple')
		expect(valueOf(pulse)).toBeCloseTo(d.aberrationBase + d.aberrationPulseAmp / 2, 10)
		expectBinding(pulse, 'aberration-pulse', d.aberrationPulseAmp / 2, 'add')
	})

	it('layers share drift and breathe modulators', () => {
		const modulatorsOf = (found: ProjectLayer) =>
			[found.transform.centerX, found.transform.centerY, found.transform.zoom].map(
				(value) => binding(value).modulator
			)
		expect(modulatorsOf(layer('base'))).toEqual(['drift-x', 'drift-y', 'breathe'])
		expect(modulatorsOf(layer('ghost'))).toEqual(modulatorsOf(layer('base')))
		for (const key of ['drift-x', 'drift-y', 'breathe'])
			expect(Object.hasOwn(project.modulators, key)).toBe(true)
	})
})
