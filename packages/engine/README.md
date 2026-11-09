# @mytw/engine

A UI-free renderer that turns one frame description into pixels with raw WebGL2 and no p5. The editor, the exporter and the player share it.

The engine reads no clock and keeps no animation state. The caller resolves every value for a moment in time into a `RenderFrame`, and the engine draws it at a fixed output resolution. It never reads the canvas's display size.

```ts
import { createRenderer } from '@mytw/engine'

const renderer = createRenderer(canvas, { width: 1080, height: 1920 })
renderer.setImage('photo', image)
renderer.render({
	layers: [
		{ id: 'base', image: 'photo', transform: { zoom: 2, center: [0.5, 0.72] } },
		{
			id: 'ghost',
			image: 'photo',
			transform: { zoom: 3.4, center: [0.2, 0.25], mirrorX: true },
			blend: 'multiply',
			mask: { kind: 'linear', from: [0.5, 0], to: [0.5, 1] },
		},
	],
})
```

`apps/sketchbook/sketches/004-engine-demo/` is a working example.

## API

| Call                                                                | Behaviour                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRenderer(canvas, { width, height, preserveDrawingBuffer? })` | Takes an `HTMLCanvasElement` or an `OffscreenCanvas`, sets its `width`/`height` to the output size and gets a `webgl2` context with `alpha: false`, `premultipliedAlpha: true`, `antialias: false`, `depth: false`, `stencil: false` and `preserveDrawingBuffer` (default `false`). Throws `EngineError('webgl2-unavailable')` without WebGL2. |
| `createRendererFromContext(canvas, gl, options)`                    | The same, from a context you already hold. Tests pass a fake here.                                                                                                                                                                                                                                                                             |
| `setSize(width, height)`                                            | Changes the output resolution: canvas attributes, viewport and pooled buffers. Sizes must be positive integers (`EngineError('invalid-size')`). CSS display size is the caller's business.                                                                                                                                                     |
| `setImage(id, source)`                                              | Uploads or replaces the texture for `id`. Any number of layers, image masks and effect textures can use one id, and each layer frames it through its own transform. The renderer keeps `source` to re-upload after a context loss, so don't close or neuter it while it is registered.                                                         |
| `deleteImage(id)`                                                   | Frees the texture.                                                                                                                                                                                                                                                                                                                             |
| `registerEffect({ id, fragment })`                                  | Compiles an effect. Re-registering an id replaces it. A compile or link failure throws `EngineError('shader-compile')` with the driver's info log in `message`, and earlier registrations stay usable.                                                                                                                                         |
| `render(frame)`                                                     | Validates the frame, then draws it. Returns `false`, drawing nothing, while the context is lost, and `true` otherwise.                                                                                                                                                                                                                         |
| `onRestored(cb)`                                                    | Calls `cb` after a context restore. Returns an unsubscribe function.                                                                                                                                                                                                                                                                           |
| `dispose()`                                                         | Frees every GPU resource and listener. See [Dispose](#dispose).                                                                                                                                                                                                                                                                                |
| `width`, `height`, `contextLost`                                    | Read-only state.                                                                                                                                                                                                                                                                                                                               |

The package also exports the pure helpers `planFrame`, `layerToSourceMatrix`, `fitSize` and `BLEND_STATES`, and the `EngineError` class with its `code`.

### Errors

Every error is an `EngineError` with a `code`:

| Code                 | When                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `webgl2-unavailable` | `createRenderer` gets no WebGL2 context.                                                              |
| `shader-compile`     | An effect fails to compile or link.                                                                   |
| `unknown-effect`     | A frame uses an effect id that isn't registered.                                                      |
| `unknown-image`      | A layer, image mask or effect texture uses an image id that isn't set.                                |
| `uniform-type`       | An effect uniform value has the wrong number of components, or the uniform's type can't take a value. |
| `invalid-size`       | An output size is not a positive integer.                                                             |
| `disposed`           | `render`, `setImage`, `registerEffect` or `setSize` is called after `dispose`.                        |

`render` checks what it is about to draw before any draw call, and its messages name the layer or effect index and the id, such as `layer 1 ("ghost"): unknown image "photo"`. Hidden layers and disabled effects aren't checked, because they aren't drawn.

## Frame data

```ts
type Vec2 = readonly [number, number]
type BlendMode = 'normal' | 'multiply' | 'screen' | 'add'
type Fit = 'cover' | 'contain' | 'stretch'

interface LayerTransform {
	center?: Vec2 // source UV shown at the layer's anchor; default [0.5, 0.5]
	offset?: Vec2 // anchor position relative to output centre, output UV units; default [0, 0]
	zoom?: number // > 0; default 1
	rotation?: number // radians, positive = clockwise on screen; default 0
	mirrorX?: boolean // default false
	mirrorY?: boolean // default false
	fit?: Fit // default 'cover'
}

type Mask =
	| { kind: 'linear'; from: Vec2; to: Vec2; invert?: boolean } // output UV
	| { kind: 'radial'; center: Vec2; inner: number; outer: number; invert?: boolean } // radii in output-height units
	| { kind: 'image'; image: string; channel?: 'alpha' | 'luminance'; invert?: boolean } // default 'luminance'

interface RenderLayer {
	id: string
	image: string // image id from setImage
	transform?: LayerTransform
	edgeFeather?: number // source UV units, default 0 (hard edge)
	opacity?: number // 0-1, default 1
	blend?: BlendMode // default 'normal'
	mask?: Mask
	effects?: readonly EffectInstance[]
	visible?: boolean // default true
}

interface RenderFrame {
	background?: readonly [number, number, number, number] // RGBA 0-1, default [0, 0, 0, 1]; alpha is forced to 1
	layers: readonly RenderLayer[] // bottom (index 0) to top
	effects?: readonly EffectInstance[] // global passes after compositing
}
```

A layer is skipped when `visible` is `false` or `opacity <= 0`.

## Coordinate system

- Output UV and source UV both run from (0,0) at the top-left to (1,1) at the bottom-right.
- Every texture the engine holds stores row 0 at the top. Images upload with `UNPACK_FLIP_Y_WEBGL = false` and premultiplied alpha. Offscreen passes map UV y to clip y as `2y - 1`, and only the final present pass to the canvas flips (`1 - 2y`).
- A layer maps output UV `u` to source UV `s` like this, with output aspect `Ao = W/H` and source aspect `As = w/h`:

  1. `p = (u - 0.5 - offset) * (Ao, 1)`
  2. `p = R(-rotation) * p`, where `R(θ) = [[cos θ, -sin θ], [sin θ, cos θ]]` in y-down coordinates
  3. `p = p / zoom`
  4. `p.x *= mirrorX ? -1 : 1`, and `p.y` likewise with `mirrorY`
  5. the source size in output-height units is `S`:
     - cover: `As >= Ao ? (As, 1) : (Ao, Ao/As)`
     - contain: `As >= Ao ? (Ao, Ao/As) : (As, 1)`
     - stretch: `(Ao, 1)`
  6. `s = p / S + center`

  `layerToSourceMatrix(transform, output, source)` returns this affine map as a column-major `Float32Array(9)`, and the vertex shader applies it per vertex.

- Outside `[0,1]²` a layer is transparent. With `edgeFeather = f > 0`, alpha is multiplied by `smoothstep(0,f,s.x)·smoothstep(1,1-f,s.x)·smoothstep(0,f,s.y)·smoothstep(1,1-f,s.y)`. Sampling is `LINEAR` with `CLAMP_TO_EDGE` and no mipmaps.

### Masks

A mask gives a value `m` in [0,1] that multiplies the layer's premultiplied colour, together with `opacity`. `invert` uses `1 - m`.

- **linear**: `t = clamp(dot(u - from, to - from) / dot(to - from, to - from), 0, 1)`, then `m = 1 - smoothstep(0, 1, t)`. It is 1 at `from` and 0 at `to`. Understory's ghost fade is `{ kind: 'linear', from: [0.5, fadeStart], to: [0.5, fadeEnd] }` on a multiply layer.
- **radial**: `d = length((u - center) * (Ao, 1))`, then `m = 1 - smoothstep(inner, outer, d)`.
- **image**: the image's luminance (`dot(rgb, (0.2126, 0.7152, 0.0722))` on un-premultiplied colour) or alpha, sampled at `u`. The image is stretched over the output.

### Blending

Blends act on premultiplied colour in sRGB-encoded values, with no linearisation, using fixed-function `blendFunc` and `FUNC_ADD`. `BLEND_STATES` exports the factors.

| Mode     | Source factor | Destination factor    | Result over an opaque destination |
| -------- | ------------- | --------------------- | --------------------------------- |
| normal   | `ONE`         | `ONE_MINUS_SRC_ALPHA` | `s + d(1-αs)`                     |
| multiply | `DST_COLOR`   | `ONE_MINUS_SRC_ALPHA` | `s·d + d(1-αs)`                   |
| screen   | `ONE`         | `ONE_MINUS_SRC_COLOR` | `s + d - s·d`                     |
| add      | `ONE`         | `ONE`                 | `s + d`                           |

Opacity `o` and mask `m` are already folded into `s`, so multiply gives `mix(d, s·d, o·m)`. The backdrop is always opaque, so these results are exact.

## Effects

An effect is a complete GLSL ES 3.00 fragment shader (starting with `#version 300 es`) that follows this contract:

- It declares `in vec2 vUv;` (output UV, y down), `uniform sampler2D uInput;` (premultiplied RGBA, row 0 at the top) and `out vec4 outColor;` (premultiplied).
- The engine sets `uResolution` (`vec2`, output pixels) when the shader declares it.

```glsl
#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform float uAmount;
out vec4 outColor;
void main() {
	vec4 c = texture(uInput, vUv);
	outColor = vec4(c.rgb * (1.0 - uAmount), c.a);
}
```

A frame uses an effect through an `EffectInstance`:

```ts
interface EffectInstance {
	effect: string // id from registerEffect
	enabled?: boolean // false bypasses the instance
	uniforms?: Record<string, number | boolean | readonly number[]>
	textures?: Record<string, string> // sampler uniform name -> image id
}
```

- Instances run in array order. A layer's effects run on the transformed, feathered layer before its mask, opacity and blend. A frame's effects run on the composited image.
- Values are set by the type the program reports: `float` and `vec2`-`vec4` with `uniform1f` and `uniform{2..4}fv`, `int` and `bool` with `uniform1i`. A value needs as many numbers as the type has components (a single number or boolean counts as one). A mismatch throws `EngineError('uniform-type')` before anything is drawn.
- Names the program doesn't declare are ignored, because drivers strip unused uniforms.
- Each `textures` entry binds an image to a texture unit from 1 up. Unit 0 is `uInput`.

## Render graph

`planFrame(frame)` is a pure function, with no GL, that returns `{ passes, buffers }`. Buffers are symbolic output-size slots `0..buffers-1`:

1. `clear` slot 0, the accumulation buffer, to the background.
2. For each drawn layer, in order:
   - With no enabled effects, one `layer` pass draws the transformed image with feather, mask and opacity straight onto slot 0, with the layer's blend.
   - Otherwise, a `layer` pass draws the transformed, feathered image into a cleared temp slot with blending off. Each enabled effect is an `effect` pass that ping-pongs between temp slots 1 and 2. A `composite` pass then draws the last temp onto slot 0, applying mask, opacity and blend.
3. Each enabled global effect is an `effect` pass that ping-pongs between slots 0 and 1.
4. `present` draws the final slot to the canvas, flipping Y.

A frame never needs more than 3 slots, whatever its layer count. The renderer keeps the slots in a framebuffer pool (RGBA8 texture plus framebuffer) across frames and, on `setSize`, frees only those that no longer match, so rendering an unchanged frame again creates no GL objects.

## Context loss

On `webglcontextlost` the renderer calls `preventDefault()` and enters the lost state: `contextLost` is `true` and `render` returns `false` without drawing. `render` also returns `false` as soon as the driver reports the loss, before the event arrives.

On `webglcontextrestored` it rebuilds every GPU resource (built-in programs, geometry, image textures from the retained sources and registered effects) and empties the framebuffer pool without deleting the stale handles. It then calls the `onRestored` listeners, so a paused caller can redraw.

`setImage`, `deleteImage` and `registerEffect` called while lost update the retained state and take effect on restore. An effect registered while lost compiles on restore. If it fails then, it is dropped and logged with `console.error`, and a frame that uses it throws `unknown-effect`.

## Dispose

`dispose()` deletes every texture, framebuffer, program, shader, buffer and vertex array the renderer created and removes its canvas listeners. Calling it twice is a no-op. Afterwards `render`, `setImage`, `registerEffect` and `setSize` throw `EngineError('disposed')`. It doesn't force a context loss, so the caller can reuse the canvas.

## Tests

`__tests__/` covers the maths, the planner and the renderer. Renderer tests run against `testing/fake-gl.ts`, a recording stand-in for WebGL2 and a canvas, so they need no GPU.
