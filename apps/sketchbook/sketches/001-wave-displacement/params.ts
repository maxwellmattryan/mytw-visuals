import { defineSchema, param } from '@mytw/schema'

/** Radians per second for a whole number of cycles per loop, so every wave loops seamlessly. */
export function loopSpeed(cycles: number, loopDuration: number): number {
	return (cycles * Math.PI * 2) / loopDuration
}

const cycles = (label: string, group: string, defaultValue: number, help: string) =>
	param.integer({
		label,
		default: defaultValue,
		min: 0,
		max: 8,
		loopSafe: true,
		group,
		help,
	})

/** Wave Displacement's parameters. Defaults reproduce the original hard-coded look. */
export const waveDisplacementSchema = defineSchema({
	// Loop
	loopDuration: param.integer({
		label: 'Loop duration',
		default: 8,
		min: 1,
		max: 30,
		unit: 's',
		group: 'Loop',
		help: 'Every wave completes whole cycles in this time. A recording is exactly one loop.',
	}),
	fps: param.integer({ label: 'FPS', default: 48, min: 1, max: 120, unit: 'fps', group: 'Loop' }),

	// Wave displacement
	primaryFreq: param.number({
		label: 'Primary frequency',
		default: 3,
		min: 0,
		max: 20,
		group: 'Wave',
		help: 'Sine wave cycles across the image.',
	}),
	primaryCycles: cycles('Primary cycles', 'Wave', 1, 'Primary wave cycles per loop.'),
	primaryAmplitude: param.number({
		label: 'Primary amplitude',
		default: 0.018,
		min: 0,
		max: 0.1,
		unit: 'UV',
		group: 'Wave',
		help: 'Displacement amount. 0.01 to 0.03 reads best.',
	}),
	secondaryFreq: param.number({
		label: 'Secondary frequency',
		default: 2,
		min: 0,
		max: 20,
		group: 'Wave',
	}),
	secondaryCycles: cycles('Secondary cycles', 'Wave', 1, 'Secondary wave cycles per loop.'),
	secondaryAmplitude: param.number({
		label: 'Secondary amplitude',
		default: 0.01,
		min: 0,
		max: 0.1,
		unit: 'UV',
		group: 'Wave',
	}),

	// Vertical pulse: displacement is stronger at the bottom and travels upward
	verticalPulseCycles: cycles(
		'Cycles',
		'Vertical pulse',
		2,
		'Pulses per loop. Displacement is stronger at the bottom and travels upward.'
	),
	verticalPulseFreq: param.number({
		label: 'Frequency',
		default: 5,
		min: 0,
		max: 20,
		group: 'Vertical pulse',
		help: 'Wave density along the vertical axis.',
	}),
	verticalPulseDepth: param.number({
		label: 'Depth',
		default: 0.6,
		min: 0,
		max: 1,
		group: 'Vertical pulse',
		help: '0 is no pulse, 1 is full bottom-up modulation.',
	}),

	// Hue shift: subtle color drift on its own cycle
	hueShiftAmount: param.number({
		label: 'Amount',
		default: 0.6,
		min: 0,
		max: Math.PI,
		unit: 'rad',
		group: 'Hue',
		help: 'Maximum hue rotation.',
	}),
	hueShiftCycles: cycles('Cycles', 'Hue', 1, 'Hue drift cycles per loop.'),

	// Chromatic aberration
	chromaticAmount: param.number({
		label: 'Amount',
		default: 0.006,
		min: 0,
		max: 0.05,
		unit: 'UV',
		group: 'Chromatic',
		help: 'Base RGB offset.',
	}),
	chromaticPulseCycles: cycles('Pulse cycles', 'Chromatic', 1, 'Pulses per loop.'),
	chromaticPulseDepth: param.number({
		label: 'Pulse depth',
		default: 0.85,
		min: 0,
		max: 1,
		group: 'Chromatic',
		help: '0 is steady, 1 pulses down to zero.',
	}),
})
