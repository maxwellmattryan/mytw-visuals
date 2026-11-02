import type p5 from 'p5'
import { VERT_DEFAULT } from './vertex'

/** Compile a shader from vertex + fragment GLSL strings. */
export function compileShader(p: p5, vert: string, frag: string): p5.Shader {
	return p.createShader(vert, frag)
}

/** Compile a filter shader (uses VERT_DEFAULT). */
export function compileFilterShader(p: p5, frag: string): p5.Shader {
	return p.createShader(VERT_DEFAULT, frag)
}
