# @mytw/fx

Effects as data. An effect is an id, a version, a short GLSL function and a parameter schema. The package turns that into a complete GLSL ES 3.00 fragment shader, so the panel, presets and the WebGL2 engine can handle any effect the same way.

```ts
import { EFFECTS, getEffect, compileEffect, uniformValues } from '@mytw/fx'
```

The package has no p5 dependency. Its only GL code is `compileEffect`.

## Defining an effect

```ts
import { defineSchema, param } from '@mytw/schema'
import { defineEffect } from '@mytw/fx'

export const posterize = defineEffect({
	id: 'posterize',
	version: 1,
	name: 'Posterize',
	params: defineSchema({
		levels: param.integer({ label: 'Levels', default: 8, min: 2, max: 64 }),
	}),
	glsl: `vec4 effect(vec2 uv) {
  vec4 color = texture(uInput, uv);
  float n = float(uLevels);
  return vec4(floor(color.rgb * n) / n, color.a);
}`,
})
```

| Field      | Meaning                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`       | Kebab-case and unique, such as `hue-shift`. Stacks and projects refer to the effect by it.                                     |
| `version`  | An integer >= 1. Bump it when a change alters what saved params mean, so instances can be migrated later.                      |
| `name`     | Display name.                                                                                                                  |
| `glsl`     | GLSL ES 3.00 that defines `vec4 effect(vec2 uv)`. It can add its own helper functions, but not uniforms, `main` or `#version`. |
| `params`   | A `Schema` from `defineSchema` in `@mytw/schema`. Defaults, ranges and constraints come from it.                               |
| `textures` | Optional extra image inputs, such as `['previous']`.                                                                           |
| `chunks`   | Optional shared helpers to include, such as `['math', 'noise']`.                                                               |

`defineEffect` returns a frozen `EffectDefinition`. It throws `EffectDefinitionError`, with a message naming the effect, when:

- the id is not kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
- the version is not an integer >= 1
- a param key or texture name does not match `^[a-z][A-Za-z0-9]*$`
- two uniform names collide, or one collides with a built-in uniform
- a chunk id is unknown
- the glsl has no `vec4 effect(vec2 ...)` function

## Uniforms

The package generates every declaration, so the effect's GLSL only uses them.

| Uniform                    | Meaning               |
| -------------------------- | --------------------- |
| `uniform sampler2D uInput` | The input image       |
| `uniform float uPhase`     | Loop phase in [0, 1)  |
| `uniform vec2 uResolution` | Output size in pixels |

Each param becomes a uniform named `u` plus its key with the first letter capitalized (`amount` → `uAmount`), and each texture becomes a `sampler2D` named the same way (`previous` → `uPrevious`).

| Param kind | GLSL type | Value passed             |
| ---------- | --------- | ------------------------ |
| `number`   | `float`   | the number               |
| `integer`  | `int`     | the number               |
| `boolean`  | `bool`    | the boolean              |
| `enum`     | `int`     | the index into `options` |
| `color`    | `vec3`    | 0–1 RGB, from `hexToVec` |
| `vec2`     | `vec2`    | the pair                 |

`uniformValues(effect, values)` turns a value object into `{ uAmount: 0.2, uMode: 1, … }` with this mapping, ready for `gl.uniform*`. Missing or invalid values fall back to their defaults and numbers are clamped to their range.

`assembleFragment(effect)` returns `{ source, bodyStartLine }`: the full shader and the line where the effect's own GLSL starts. Its `main` writes `effect(vUv)` to the output. `EFFECT_VERTEX` is the matching vertex shader, with `in vec3 aPosition; in vec2 aTexCoord; out vec2 vUv;` and positions in 0–1.

Animate from `uPhase`, never from wall-clock time, and multiply it by whole cycle counts (`param.integer` or `loopSafe`) so the loop is seamless.

## Built-in effects

`EFFECTS` lists them and `getEffect(id)` returns one or `undefined`. Each is version 1, and its defaults leave the image unchanged or change it only slightly.

| id                     | Params (default)                                                              | Textures   | Chunks          |
| ---------------------- | ----------------------------------------------------------------------------- | ---------- | --------------- |
| `passthrough`          | none                                                                          |            |                 |
| `chromatic-aberration` | `amount` 0–0.05 (0.001), `mode` `radial` or `horizontal` (`radial`)           |            |                 |
| `vignette`             | `amount` 0–1 (0.2), `inner` 0–1.5 (0.35), `outer` 0–1.5 (0.95), inner < outer |            |                 |
| `hue-shift`            | `degrees` −180–180 (0)                                                        |            | `color`         |
| `caustic-warp`         | `amount` 0–0.05 (0.005), `scale` 0.1–10 (2), `loopRadius` 0–4 (0.8)           |            | `math`, `noise` |
| `sine-displacement`    | `amplitude` 0–0.2 (0.01), `frequency` 0–100 (10), `cycles` integer −8–8 (1)   |            | `math`          |
| `feedback`             | `decay` 0–1 (0.5)                                                             | `previous` |                 |
| `scanlines`            | `intensity` 0–1 (0.1), `count` 1–2000 (400)                                   |            | `math`          |

## Chunks

`CHUNKS` holds the shared GLSL helpers:

| Chunk   | Defines                                   |
| ------- | ----------------------------------------- |
| `math`  | `PI`, `TAU`, `rot(vec2 p, float a)`       |
| `noise` | `hash`, `vnoise`, `fbm` (value-noise fbm) |
| `color` | `hueRotate(vec3 col, float angle)`        |
| `mask`  | `edgeMask(vec2 uv, float feather)`        |

A chunk can list `requires`. `glslChunks(ids)` returns the source of the requested chunks and everything they require, in dependency order, each once. Chunk bodies are valid in both GLSL ES 1.00 and 3.00, so a p5 sketch can paste them into its own shader:

```ts
const FRAG = `
precision mediump float;
varying vec2 vTexCoord;
${glslChunks(['math', 'noise'])}
void main() { … }
`
```

## Stacks

A stack is plain, JSON-serializable data: `EffectStack = readonly EffectInstance[]`, where an instance is `{ id, effect, version, enabled, params }`. `id` is the instance id and `effect` the definition id. These pure functions return a new array and never mutate their input:

- `createInstance(effect, id)`: a new instance, enabled, with the schema defaults.
- `moveEffect(stack, id, toIndex)`: moves an instance, clamping `toIndex` to the stack. An unknown id returns the same stack.
- `setEnabled(stack, id, enabled)`: bypasses or re-enables an instance. An unknown id returns the same stack.
- `activeEffects(stack)`: the enabled instances, in order. An empty result renders as passthrough.

## Custom effects

`createCustomEffect(data)` builds an effect from project data, the escape hatch for GLSL that sliders can't express. `data` has the same fields as `defineEffect`, except `params` is a plain record of param definitions (`{ amount: { kind: 'number', label: 'Amount', default: 0.1 } }`). It never throws and returns `{ ok: true, effect }` or `{ ok: false, errors }`, where each error is `{ line: number | null, message }`. Data problems have `line: null`: input that isn't an object, missing or wrong-typed fields, an id used by a built-in, an invalid param, an unknown chunk, and every `EffectDefinitionError` and `SchemaDefinitionError`.

Only compile errors are handled. Custom GLSL that hangs the GPU is not guarded against.

## Compiling

```ts
const result = compileEffect(gl, effect) // gl: WebGL2RenderingContext
if (result.ok) gl.useProgram(result.program)
else for (const e of result.errors) console.warn(e.line, e.message)
```

`compileEffect` compiles `EFFECT_VERTEX` and the assembled fragment, then links them. It never throws:

- Info-log lines like `ERROR: 0:<line>: <msg>` become errors whose `line` is relative to the effect's own `glsl`, where line 1 is its first line. The line is `null` for errors in generated code and for log lines that don't match the pattern.
- A link failure is one error holding the link log.
- If the context can't create a shader or program, the error is `WebGL context unavailable`. If a GL call throws, such as after context loss, the error holds its message.

On failure it deletes everything it created. On success it deletes the shader objects, and the caller owns the program.

`yarn dev` and `/sketches/004-fx-check/` compile every built-in, plus a deliberately broken custom effect, with real WebGL2.

## Adding an effect

1. Create `packages/fx/effects/<camelCaseId>.ts` and export `defineEffect({ … })`, following the existing files. Start with `version: 1`.
2. Write only `vec4 effect(vec2 uv)`. Read the input with `texture(uInput, uv)`, use the generated uniforms, and take helpers from chunks instead of copying them.
3. Pick defaults that leave the image unchanged or nearly so, give every number a `min` and `max`, and make any value multiplied by `uPhase` a whole number (`param.integer` or `loopSafe`).
4. Add it to `EFFECTS` in `packages/fx/effects/index.ts`. The tests in `__tests__/effects.test.ts` then parse its shader with `@shaderfrog/glsl-parser`, check a uniform for each param and validate its defaults, with no further edits.
5. If it belongs in the built-in table above, add it there and to the `table` in `effects.test.ts`.
6. Run `yarn test`, then `yarn dev` and open `/sketches/004-fx-check/` to confirm it compiles on a real GPU.

To add a chunk, add its GLSL and id to `chunks.ts`, list any `requires`, and keep the body valid in GLSL ES 1.00 and 3.00: no `texture`/`texture2D`, no `in`/`out`/`varying` and no `#` directives.

Changing a published effect's params in a way that changes saved values needs a version bump.
