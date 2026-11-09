# @mytw/scene

Turns a project document (`@mytw/schema`, see [docs/project-format.md](../../docs/project-format.md)) into engine frames (`@mytw/engine`). It is pure: no GL, no DOM and no clock. The engine doesn't know the project format, and the format doesn't know the engine, so this package is the one place that maps one onto the other. The export and a later player share it.

```ts
import { createRenderer } from '@mytw/engine'
import { parseProject } from '@mytw/schema'
import { compileScene } from '@mytw/scene'

const parsed = parseProject(json)
if (!parsed.ok) throw new Error(parsed.issues[0].message)
const scene = compileScene(parsed.project)

const renderer = createRenderer(canvas, { width: scene.width, height: scene.height })
for (const hash of scene.images) renderer.setImage(hash, await bitmapFor(hash))
for (const effect of scene.effects) renderer.registerEffect(effect)
renderer.render(scene.frameAt(45))
```

`apps/sketchbook/sketches/006-understory-compare/` is a working example.

## API

| Export                             | Behaviour                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compileScene(project)`            | Checks what the engine needs, precomputes every modulator and binding, and returns a `Scene`. Throws `SceneError`.                                                                   |
| `scene.frameAt(f)`                 | The `RenderFrame` for integer frame `f` in `[0, frames)`. Throws `RangeError` for anything else, including `1.5` and `frames`. It allocates a new frame per call and keeps no state. |
| `scene.images`                     | The asset hashes that visible layers use. The renderer image id of a layer is its asset hash, so call `setImage(hash, source)` for each.                                             |
| `scene.effects`                    | One `EffectProgram` (`{ id, fragment }`) per effect definition the project uses, enabled or not, assembled with `assembleFragment` from `@mytw/fx`. Pass each to `registerEffect`.   |
| `frames`, `width`, `height`, `fps` | `timeline.frames` and the `output` fields.                                                                                                                                           |

The caller loads the image bytes, because where assets live (a folder, IndexedDB, a URL map) is the app's business.

### Errors

`SceneError` has a `path` into the project, in the validator's style:

| Path                 | When                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effects[2].effect`  | The effect bank (`getEffect`) has no effect with that id. Layer chains use their own path, such as `tracks[0].clips[0].layers[1].effects[0].effect`. |
| `effects[2].version` | The instance's `version` differs from the definition's.                                                                                              |
| `….mod[0].modulator` | A binding names a modulator the project doesn't have. `validateProject` reports this first.                                                          |

## Mapping

Every value follows [§ Semantics](../../docs/project-format.md#semantics):

- **Time.** `t = f / timeline.frames`. Each modulator is evaluated once per frame. Sine, triangle and noise use `x = cycles·t + phase` with the engine's `sineOut`, `triangleOut` and `noiseOut` (noise radius 1, the modulator's `seed`). Keyframes interpolate with `EASES[easing]` and hold outside their keys.
- **Bindings.** Starting from `value`, each binding applies in array order: `add` gives `v + amount·m` and `multiply` gives `v·(1 + amount·m)`. Bindings don't go through the engine's `compileTimeline`, which is additive only.
- **Background.** `output.background` as RGB 0–1 with alpha 1.
- **Tracks and clips.** Tracks composite bottom first. A track's active clip at `f` is the one with `start ≤ f < start + frames`. Its fade is `min(1, local/fadeIn, (frames − local)/fadeOut)`, leaving out a zero-length term. With no active clip a track adds no layers.
- **Layers.** `id`, `image: asset`, `visible`, `blend`, `edgeFeather: feather`, `opacity: clamp(opacity, 0, 1) · fade`. A `linear-gradient` mask becomes `{ kind: 'linear', from, to }`. Hidden layers stay in the frame with `visible: false`.
- **Transform.** `{ center: [centerX, centerY], zoom, rotation: r, mirrorX, mirrorY, fit: 'cover' }`, where `r = mirrorX !== mirrorY ? −rotation : rotation`. The format mirrors before it rotates and the engine rotates before it mirrors, and for a single-axis mirror `M·R(θ) = R(−θ)·M`. The engine's cover scale equals the format's `s = max(W/w, H/h)`.
- **Effects.** Each instance becomes `{ effect: id, enabled, uniforms: { ...uniformValues(definition, params), uPhase: t } }`. Animatable params are evaluated first, and booleans, strings and vec2 values pass through. `uniformValues` fills missing params with defaults and clamps numbers. Disabled instances stay in the chain with `enabled: false`.

## Not yet supported

- Effects with extra textures, such as `feedback` (`uPrevious`): the scene sets no `textures`, so their samplers are unbound.

## Tests

`packages/scene/__tests__/scene.test.ts` covers the Understory fixture at frames 0 and 45, every modulator shape and binding order, the transform against the format's formula, clips and fades, and the errors.
