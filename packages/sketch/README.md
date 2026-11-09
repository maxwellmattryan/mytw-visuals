# @mytw/sketch

Code sketches as layers. A p5 sketch draws into its own canvas, and the engine composites that canvas as an ordinary layer, so blends, masks, opacity, transforms and effects apply to it as they do to an image. The caller supplies the frame, so a sketch drawn at the same frame twice gives the same pixels and exports stay frame-accurate.

```ts
import { defineSchema, param } from '@mytw/schema'
import { defineSketch, loadSketchRuntime } from '@mytw/sketch'

const orbits = defineSketch({
	id: 'orbits',
	version: 1,
	name: 'Orbits',
	params: defineSchema({ count: param.integer({ label: 'Count', default: 12, min: 1, max: 64 }) }),
	draw: (p, { t, width, height, params }) => {
		for (let i = 0; i < params.count; i++) {
			const angle = p.random(Math.PI * 2) + t * Math.PI * 2
			p.circle(width / 2 + Math.cos(angle) * 300, height / 2 + Math.sin(angle) * 300, 20)
		}
	},
})

const runtime = await loadSketchRuntime()
const sketch = await runtime.createSketchLayer(orbits, { width: 1080, height: 1920, seed: 7 })

// Each frame:
renderer.setImage('orbits', sketch.render({ frame, frames: 225, fps: 30 }))
renderer.render({
	layers: [
		{ id: 'base', image: 'photo' },
		{ id: 'orbits', image: 'orbits', blend: 'screen' },
	],
})
```

`apps/sketchbook/sketches/006-sketch-layer/` is a working example.

## Determinism

A sketch's output must depend only on its definition, its params, the seed and the requested time. In `draw`:

- Animate from `t` (loop phase in `[0, 1)`) or `frame`. Never read `p.frameCount`, `p.millis()`, `Date` or `Math.random`.
- Use `p.random` and `p.noise`. The runtime calls `p.randomSeed(seed)` and `p.noiseSeed(seed)` before every draw, so they return the same values each time a frame is drawn.
- Don't keep state between draws. Frames can be drawn in any order, and the same frame more than once.
- For a seamless loop, use whole cycle counts of `t`, and sample noise on a circle, such as `p.noise(x, Math.cos(t * TAU), Math.sin(t * TAU))`.

The runtime also calls `p.clear()` before every draw, and p5 resets the transform matrix, so nothing carries over. Pixels the sketch doesn't paint stay transparent, so the layer composites with alpha.

## API

| Call                                                        | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defineSketch({ id, version, name, params, setup?, draw })` | Validates a sketch and returns it frozen. `params` is a `Schema` from `@mytw/schema`, so `mountPanel(definition.params)` gives the sketch a panel. Throws `SketchDefinitionError`, naming the sketch, when `id` isn't kebab-case, `version` isn't an integer >= 1, or `draw` isn't a function.                                                                                                                           |
| `draw(p, frame)`                                            | Gets the p5 instance and a `SketchFrame`: `{ t, frame, frames, fps, seconds, width, height, seed, params }`, where `t = frame / frames`, `seconds = frame / fps` and `params` holds the current values.                                                                                                                                                                                                                  |
| `setup(p, { width, height })`                               | Optional, and may be async, such as to load images. Runs once after the canvas exists.                                                                                                                                                                                                                                                                                                                                   |
| `loadSketchRuntime()`                                       | Imports p5 and the runtime, and resolves to a `SketchRuntime`.                                                                                                                                                                                                                                                                                                                                                           |
| `loadSketchRuntimeFor(project)`                             | Resolves to `null`, without importing p5, when the project has no sketch layer, and to `loadSketchRuntime()` otherwise.                                                                                                                                                                                                                                                                                                  |
| `projectUsesSketches(project)`                              | `true` if and only if any clip in any track has a layer with `kind: 'sketch'`.                                                                                                                                                                                                                                                                                                                                           |
| `runtime.createSketchLayer(definition, options)`            | `options` is `{ width, height, seed?, params? }`. Resolves once p5's setup and the definition's `setup` have finished. The canvas is exactly `width × height` pixels (pixel density 1), hidden, and never drawn by p5's own loop. `seed` defaults to 0. `params` takes a `mytw-params` envelope or a bare values object, read through `parseValues`, and falls back to the schema defaults when it's absent or rejected. |
| `instance.render({ frame, frames, fps })`                   | Seeds, clears and draws one frame synchronously, and returns `instance.canvas`.                                                                                                                                                                                                                                                                                                                                          |
| `instance.setParams(input)`                                 | Returns `parseValues`' result. On `ok: true` the next render uses the new values, and on `ok: false` the values stay as they were.                                                                                                                                                                                                                                                                                       |
| `instance.values`, `instance.canvas`, `instance.seed`       | Read-only state.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `instance.dispose()`                                        | Removes the p5 instance and its canvas. A second call does nothing.                                                                                                                                                                                                                                                                                                                                                      |
| `createSketchRuntime(P5)`                                   | Builds a runtime on a p5 constructor you bring, such as a fake in tests.                                                                                                                                                                                                                                                                                                                                                 |

## Compositing

The engine needs no sketch support. Each frame, call `renderer.setImage(layerId, instance.render(time))` and list a `RenderLayer` with `image: layerId`. Calling `setImage` again with the same canvas re-uploads it into the existing texture. Since the sketch renders at output size, the neutral transform shows it 1:1.

In a project document, a layer with `kind: "sketch"` records the sketch id, its param schema `version`, the `seed` and the param envelope. See [Sketch layers](../../docs/project-format.md#sketch-layers).

## Loading p5 only when needed

Importing `@mytw/sketch`, `defineSketch` and `projectUsesSketches` never evaluate p5. Only `runtime.ts` imports p5 as a value, and `loadSketchRuntime` imports it dynamically, so a bundler splits p5 into its own chunk and projects without sketch layers never fetch it. ESLint enforces this: a value import of `p5` anywhere else in the package fails lint, and `import type` is allowed.

## Errors

Every runtime error is a `SketchError` with a `code`:

| Code             | When                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `p5-unavailable` | The dynamic p5 import fails.                                                                                           |
| `setup-failed`   | The definition's `setup` throws or rejects. The p5 instance is removed before the promise rejects.                     |
| `invalid-time`   | `frames` is not an integer >= 1, `frame` is not an integer in `[0, frames)`, or `fps` is not a finite number > 0.      |
| `draw-failed`    | `draw` throws (the message names the sketch id and the frame, and `cause` keeps the error), or p5 didn't run the draw. |
| `disposed`       | `render` or `setParams` is called after `dispose`.                                                                     |
