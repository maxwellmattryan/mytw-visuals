import type { Project } from '@mytw/schema'
import { describeError, SketchError } from './errors'
import { projectUsesSketches } from './project'
import type { SketchRuntime } from './types'

/** Imports p5 and the runtime. Rejects with `SketchError('p5-unavailable')` if that fails. */
export async function loadSketchRuntime(): Promise<SketchRuntime> {
	try {
		return (await import('./runtime')).runtime
	} catch (cause) {
		throw new SketchError('p5-unavailable', `Could not load p5: ${describeError(cause)}`, {
			cause,
		})
	}
}

/** Loads the runtime only when the project has a sketch layer, and resolves to null otherwise. */
export async function loadSketchRuntimeFor(project: Project): Promise<SketchRuntime | null> {
	return projectUsesSketches(project) ? loadSketchRuntime() : null
}
