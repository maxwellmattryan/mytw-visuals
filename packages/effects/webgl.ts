import { compileEffect } from '@mytw/fx'
import type { CompileResult, EffectDefinition } from '@mytw/fx'
import { UNAVAILABLE_MESSAGE } from './controller'
import type { EffectCompile } from './controller'

/**
 * A compile check for the custom GLSL editor. It lazily makes one offscreen WebGL2 context, compiles
 * and links the effect with `compileEffect`, and deletes the program on success: it only checks.
 */
export function createWebGLCompile(): EffectCompile {
	let gl: WebGL2RenderingContext | null | undefined

	const context = (): WebGL2RenderingContext | null => {
		if (gl === undefined || gl?.isContextLost()) {
			try {
				gl = document.createElement('canvas').getContext('webgl2')
			} catch {
				gl = null
			}
		}
		return gl ?? null
	}

	return (effect: EffectDefinition): CompileResult => {
		const current = context()
		if (current === null)
			return { ok: false, errors: [{ line: null, message: UNAVAILABLE_MESSAGE }] }
		const result = compileEffect(current, effect)
		if (result.ok) current.deleteProgram(result.program)
		return result
	}
}
