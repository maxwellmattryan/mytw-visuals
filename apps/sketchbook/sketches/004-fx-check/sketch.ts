import { compileEffect, createCustomEffect, EFFECTS } from '@mytw/fx'
import type { EffectDefinition, EffectError } from '@mytw/fx'

// Compiles every built-in effect with real WebGL2, plus one custom effect that is broken on
// purpose (an undeclared identifier on line 2 of its glsl), and lists the results.

const broken = createCustomEffect({
	id: 'broken-custom',
	version: 1,
	name: 'Broken custom',
	glsl: ['vec4 effect(vec2 uv) {', '  return texture(uInput, uv) * notDeclared;', '}'].join('\n'),
	params: {},
})

function describeErrors(errors: readonly EffectError[]): string {
	return errors
		.map((error) => (error.line === null ? error.message : `line ${error.line}: ${error.message}`))
		.join('; ')
}

function row(list: HTMLElement, text: string, ok: boolean): void {
	const item = document.createElement('li')
	item.textContent = text
	item.style.color = ok ? '#7c7' : '#e77'
	list.append(item)
}

const heading = document.createElement('h1')
heading.textContent = 'fx compile check'
const list = document.createElement('ul')
document.body.append(heading, list)

const gl = document.createElement('canvas').getContext('webgl2')
if (!gl) {
	row(list, 'WebGL2 is not available in this browser', false)
} else {
	const effects: EffectDefinition[] = [...EFFECTS]
	if (broken.ok) effects.push(broken.effect)
	else row(list, `broken-custom — ${describeErrors(broken.errors)}`, false)

	for (const effect of effects) {
		const result = compileEffect(gl, effect)
		if (result.ok) {
			row(list, `${effect.id} — OK`, true)
			gl.deleteProgram(result.program)
		} else {
			row(list, `${effect.id} — ${describeErrors(result.errors)}`, false)
		}
	}
}
