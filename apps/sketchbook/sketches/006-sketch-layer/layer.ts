import { defineSchema, param } from '@mytw/schema'
import { defineSketch } from '@mytw/sketch'

const TAU = Math.PI * 2

// The basic template's schema and draw, as a sketch layer: the engine supplies the frame, so the
// draw reads `t` instead of p5's clock, and p.random / p.noise give the same values every render.
const schema = defineSchema({
	background: param.color({ label: 'Background', default: '#000000' }),
	showBackground: param.boolean({ label: 'Show background', default: false }),
	count: param.integer({ label: 'Count', default: 12, min: 1, max: 64, step: 1 }),
	size: param.number({ label: 'Size', default: 0.04, min: 0.005, max: 0.2, step: 0.005 }),
	cycles: param.integer({ label: 'Cycles', default: 1, min: 1, max: 8, step: 1, loopSafe: true }),
})

export const basicLayer = defineSketch({
	id: 'basic-orbits',
	version: 1,
	name: 'Basic (as a layer)',
	params: schema,
	draw: (p, { t, width, height, params }) => {
		// Unpainted pixels stay transparent, so the layer blends over what's below it.
		if (params.showBackground) p.background(params.background)
		const short = Math.min(width, height)
		const a = t * TAU
		p.noStroke()
		for (let i = 0; i < params.count; i++) {
			// Seeded per render, so every orbit keeps its start, radius and color.
			const start = p.random(TAU)
			const radius = short * p.random(0.12, 0.42)
			const warm = p.random(140, 255)
			// Sampling noise on a circle makes the wobble loop with t.
			const wobble = p.noise(i * 0.7, 1 + Math.cos(a), 1 + Math.sin(a))
			const angle = start + a * params.cycles * (i % 2 === 0 ? 1 : -1)
			const r = radius * (0.8 + 0.4 * wobble)
			p.fill(255, warm, 255 - warm * 0.5, 230)
			p.circle(
				width / 2 + Math.cos(angle) * r,
				height / 2 + Math.sin(angle) * r,
				short * params.size
			)
		}
	},
})
