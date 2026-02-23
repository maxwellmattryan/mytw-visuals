import { jest } from '@jest/globals'

import {
	VERT_DEFAULT,
	FRAG_PASSTHROUGH,
	FRAG_CHROMATIC_ABERRATION,
	FRAG_SINE_DISPLACEMENT,
	FRAG_FEEDBACK,
	FRAG_HUE_SHIFT,
	FRAG_SCANLINES,
	FRAG_VIGNETTE,
	compileShader,
	compileFilterShader,
} from '../shaders.js'

// ── VERT_DEFAULT ────────────────────────────────────────────────────

describe('VERT_DEFAULT', () => {
	it('is a string', () => {
		expect(typeof VERT_DEFAULT).toBe('string')
	})

	it('contains expected GLSL keywords', () => {
		expect(VERT_DEFAULT).toContain('attribute')
		expect(VERT_DEFAULT).toContain('varying')
		expect(VERT_DEFAULT).toContain('gl_Position')
	})
})

// ── Fragment shader generators ──────────────────────────────────────

const fragGenerators = [
	['FRAG_PASSTHROUGH', FRAG_PASSTHROUGH, [], []],
	['FRAG_CHROMATIC_ABERRATION', FRAG_CHROMATIC_ABERRATION, ['uAmount'], ['myAmt']],
	[
		'FRAG_SINE_DISPLACEMENT',
		FRAG_SINE_DISPLACEMENT,
		['uAmplitude', 'uFrequency', 'uTime'],
		['myAmp', 'myFreq', 'myTime'],
	],
	['FRAG_FEEDBACK', FRAG_FEEDBACK, ['uDecay'], ['myDecay']],
	['FRAG_HUE_SHIFT', FRAG_HUE_SHIFT, ['uShift'], ['myShift']],
	['FRAG_SCANLINES', FRAG_SCANLINES, ['uIntensity', 'uCount'], ['myInt', 'myCnt']],
	['FRAG_VIGNETTE', FRAG_VIGNETTE, ['uIntensity', 'uSmoothness'], ['myInt', 'mySmooth']],
]

describe.each(fragGenerators)('%s', (_name, fn, defaultParams, customParams) => {
	it('returns a string', () => {
		expect(typeof fn()).toBe('string')
	})

	it('contains precision mediump float', () => {
		expect(fn()).toContain('precision mediump float')
	})

	it('contains gl_FragColor', () => {
		expect(fn()).toContain('gl_FragColor')
	})

	if (defaultParams.length > 0) {
		it('contains default parameter names', () => {
			const src = fn()
			for (const param of defaultParams) {
				expect(src).toContain(param)
			}
		})

		it('interpolates custom parameter names', () => {
			const src = fn(...customParams)
			for (const param of customParams) {
				expect(src).toContain(param)
			}
		})
	}
})

// ── compileShader ───────────────────────────────────────────────────

describe('compileShader', () => {
	it('calls p.createShader with vert and frag and returns result', () => {
		const mockShader = { id: 'shader' }
		const p = { createShader: jest.fn(() => mockShader) }
		const result = compileShader(p, 'vertSrc', 'fragSrc')
		expect(p.createShader).toHaveBeenCalledWith('vertSrc', 'fragSrc')
		expect(result).toBe(mockShader)
	})
})

// ── compileFilterShader ─────────────────────────────────────────────

describe('compileFilterShader', () => {
	it('calls p.createShader with VERT_DEFAULT and frag', () => {
		const mockShader = { id: 'filter' }
		const p = { createShader: jest.fn(() => mockShader) }
		const result = compileFilterShader(p, 'fragSrc')
		expect(p.createShader).toHaveBeenCalledWith(VERT_DEFAULT, 'fragSrc')
		expect(result).toBe(mockShader)
	})
})
