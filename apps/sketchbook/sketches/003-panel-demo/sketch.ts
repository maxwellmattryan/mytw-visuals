import p5 from 'p5'
import { SIZES, createCanvas, centerCanvas } from '@lib/layout'
import { createCapture } from '@lib/capture'
import type { SketchCapture } from '@lib/capture'
import { mountPanel } from '@mytw/panel'
import type { Panel } from '@mytw/panel'
import { defineSchema, param } from '@mytw/schema'

// One control of every kind, so this sketch doubles as the panel's reference example.
const schema = defineSchema(
	{
		speed: param.number({ label: 'Speed', default: 1, min: 0, max: 4 }),
		count: param.integer({ label: 'Count', default: 6, min: 1, max: 12 }),
		paused: param.boolean({ label: 'Paused', default: false }),
		shape: param.enum({
			label: 'Shape',
			options: ['circle', 'square', 'triangle'],
			default: 'circle',
			group: 'Shape',
		}),
		size: param.number({
			label: 'Size',
			default: 120,
			min: 10,
			max: 300,
			unit: 'px',
			group: 'Shape',
		}),
		offset: param.vec2({ label: 'Offset', default: [0, 0], min: -200, max: 200, group: 'Shape' }),
		fill: param.color({ label: 'Fill', default: '#f2c14e', group: 'Color' }),
		background: param.color({ label: 'Background', default: '#101820', group: 'Color' }),
		cycles: param.number({
			label: 'Cycles',
			default: 2,
			min: 1,
			max: 8,
			loopSafe: true,
			group: 'Loop',
		}),
		jitter: param.number({ label: 'Jitter', default: 0, group: 'Loop' }),
	},
	{
		constraints: [
			{
				id: 'size-fits',
				message: 'size × count must be at most 1200',
				params: ['size', 'count'],
				check: (v) => v.size * v.count <= 1200,
			},
		],
	}
)

const LOOP_FRAMES = 240
const RING_RADIUS = 320

const sketch = (p: p5) => {
	let cnv: p5.Renderer
	let cap: SketchCapture
	let panel: Panel<typeof schema.params>
	// Loop frame, advanced only while not paused.
	let frame = 0
	// Ring rotation in radians, advanced by `speed` while not paused.
	let angle = 0

	p.setup = () => {
		cnv = createCanvas(p, SIZES.SQUARE)
		cap = createCapture(cnv.elt)
		cap.bindKeys(p)
		panel = mountPanel(schema)
	}

	p.draw = () => {
		const v = panel.values
		if (!v.paused) {
			frame = (frame + 1) % LOOP_FRAMES
			angle += (v.speed * p.TWO_PI) / LOOP_FRAMES
		}
		const phase = frame / LOOP_FRAMES

		p.background(v.background)
		p.noStroke()
		p.fill(v.fill)
		p.translate(p.width / 2 + v.offset[0], p.height / 2 + v.offset[1])
		p.rotate(angle)

		for (let i = 0; i < v.count; i++) {
			const a = (i / v.count) * p.TWO_PI
			// Integer `cycles` keeps the pulse seamless across the loop.
			const pulse = 0.75 + 0.25 * Math.sin(p.TWO_PI * (v.cycles * phase + i / v.count))
			const wobble = v.jitter * (p.noise(i * 10, phase * 4) - 0.5) * 100
			const s = v.size * pulse
			p.push()
			p.translate(Math.cos(a) * (RING_RADIUS + wobble), Math.sin(a) * (RING_RADIUS + wobble))
			p.rotate(a)
			if (v.shape === 'circle') p.circle(0, 0, s)
			else if (v.shape === 'square') p.square(-s / 2, -s / 2, s)
			else p.triangle(0, -s / 2, s / 2, s / 2, -s / 2, s / 2)
			p.pop()
		}

		cap.capture()
	}

	p.windowResized = () => {
		centerCanvas(p, cnv)
	}
}

new p5(sketch)
