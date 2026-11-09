import { describe, expect, it, jest } from '@jest/globals'
import type p5 from 'p5'

import { VERT_DEFAULT, compileShader, compileFilterShader } from '@lib/shaders'

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

// ── compileShader ───────────────────────────────────────────────────

describe('compileShader', () => {
	it('calls p.createShader with vert and frag and returns result', () => {
		const mockShader = { id: 'shader' }
		const p = { createShader: jest.fn(() => mockShader) }
		const result = compileShader(p as unknown as p5, 'vertSrc', 'fragSrc')
		expect(p.createShader).toHaveBeenCalledWith('vertSrc', 'fragSrc')
		expect(result).toBe(mockShader)
	})
})

// ── compileFilterShader ─────────────────────────────────────────────

describe('compileFilterShader', () => {
	it('calls p.createShader with VERT_DEFAULT and frag', () => {
		const mockShader = { id: 'filter' }
		const p = { createShader: jest.fn(() => mockShader) }
		const result = compileFilterShader(p as unknown as p5, 'fragSrc')
		expect(p.createShader).toHaveBeenCalledWith(VERT_DEFAULT, 'fragSrc')
		expect(result).toBe(mockShader)
	})
})
