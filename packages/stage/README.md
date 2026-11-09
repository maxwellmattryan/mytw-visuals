# @mytw/stage

Direct manipulation on the canvas: frame the selected layer by dragging it, with on-canvas handles, scroll to zoom and rotate, mirror buttons, an edge warning, safe-area and aspect guides, and a viewport that zooms and pans without touching the output. It builds on the `LayersController` from `@mytw/layers`: it reads the selection and the clip from it, and every framing edit is a document-store command, so undo works as for any other edit.

```ts
import { mountLayers } from '@mytw/layers'
import { mountStage } from '@mytw/stage'

const { controller: layers } = mountLayers({ store, assetStore, layersTarget, propertiesTarget })
// `stage` is positioned and clips overflow; `canvas` is the renderer's canvas inside it.
const { controller, destroy } = mountStage({ layers, stage, canvas, scene: () => scene })
```

`apps/sketchbook/sketches/007-layers/` is the host and manual test page. Svelte hosts can render `StageOverlay` with a controller from `createStageController` instead.

The package has pure modules (`geometry`, `viewport`, `guides`, `coverage`, `controller`: no DOM, no Svelte, tested in Node) and one component. The pure modules import from `../layers/commands` and `../layers/controller` directly, because Jest can't load the `@mytw/layers` barrel, which exports Svelte components.

## Never in exports

Everything the stage draws is in an SVG overlay that is a sibling of the renderer's canvas, never in the canvas. The viewport, guides, hint and warning are view state and never enter the document. Exports render the document in their own renderer (`@mytw/export`), so the controls can't appear in them. The demo page's **Export still** button proves it.

## Coordinate spaces

| Space     | Meaning                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Output px | Pixels of the project's `output.width × output.height`. The geometry uses them relative to the canvas centre, y down. |
| Stage px  | CSS pixels from the stage element's top-left corner.                                                                  |
| Source UV | The source image, `(0,0)` top-left to `(1,1)` bottom-right.                                                           |

The framing math is the format's [§ Transform](../../docs/project-format.md#transform): with `s = max(W/w, H/h)` and `M` the mirror matrix, the source UV under canvas point `p` is `u = c + R(θ)·M·p / (z·s) ⊘ (w, h)`. A sketch layer's source size is the output size. `canvasToSource` is cross-checked against the engine's `layerToSourceMatrix` in the tests.

The viewport is `{ scale, x, y, fitted }`: the canvas keeps its `W×H` drawing buffer and the overlay sets its CSS box to `W·scale × H·scale` at stage px `(x, y)`. **Fit** leaves 16 px on each side and refits on resize until the view is zoomed or panned. `scale` stays in `[0.05, 16]`.

## Gestures

Every layer gesture edits the base value of an animatable field through `setAnimatable`, so `{ value, mod }` keeps its bindings. The gizmo and outline show the base framing, not the modulated value of the current frame. Results derive from the values at the gesture's start plus the total pointer delta, are rounded to 1e-6, and zoom stays in `[0.01, 100]`.

| Input                         | Effect                                                                                       | Undo                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Drag (not on a handle)        | Moves the selected layer; the source point under the pointer stays under it                  | One step per drag (`stage:<n>`)              |
| Drag the square on the ring   | Scales zoom by the ratio of distances from the canvas centre (each floored at 8 px)          | One step per drag                            |
| Drag the circle on the stem   | Turns the layer on screen with the pointer, about the canvas centre                          | One step per drag                            |
| Escape during a drag          | Cancels it and restores the values from before it                                            | Nothing left                                 |
| Wheel                         | Zooms the layer by `exp(−deltaY / 500)` about the pointer                                    | One step per run (`stage:<id>:wheel-zoom`)   |
| Alt+wheel                     | Rotates the layer by `delta / 10` degrees on screen                                          | One step per run (`stage:<id>:wheel-rotate`) |
| Arrow keys (Shift for 10)     | Moves the layer by 1 output px, as if dragged                                                | One step per run (`stage:<id>:nudge`)        |
| Mirror X / Mirror Y           | Toggles `mirrorX` / `mirrorY` (the format mirrors about the canvas centre)                   | One step per click                           |
| Ctrl/Cmd+wheel or pinch, −, + | Zooms the viewport (`exp(−deltaY / 100)` about the pointer, or 1.25× about the stage centre) | None: view state                             |
| Space+drag or middle drag     | Pans the viewport 1:1                                                                        | None: view state                             |
| Fit, 100%, Safe area, Aspect  | Fits the view, shows it at scale 1, or toggles the guides                                    | None: view state                             |

A run of wheel or nudge events is sealed 400 ms after its last event. Hit priority is the rotation handle, then the zoom handle, then move, with a 10 px hit radius. With a single mirror the on-screen angle is `−rotation` (format § Transform), so the rotation handle sits at `φ = −θ` and dragging it writes `θ₀ − Δφ`. Clicking the canvas doesn't select layers: every cover-fit layer covers the whole canvas, so the layers panel selects.

## Edge warning

`findEdgeReveals(project, scene, ref)` checks each image layer of the edited clip at every frame where the clip is active. It maps the four canvas corners to source UV with the engine's `layerToSourceMatrix` on `scene.frameAt(f)`, so it shares the renderer's math. The layer covers at `f` when all four land in `[0, 1]²` (tolerance 1e-9).

- A layer that covers at some frames and not at others is reported: its motion uncovers an edge.
- A layer that never covers isn't reported, since it is framed small on purpose.
- Feather and masks are ignored. A missing clip or a scene that doesn't compile reports nothing.

The stage lists `Motion reveals the edge of <name> on <n> of <total> frames, first at frame <f>` per layer, top of the stack first, and draws a reported selected layer's outline amber. The controller memoizes the result on the document and the scene.

## Guides

`safeAreas(output)` gives the centred action-safe (90%) and title-safe (80%) rectangles. `aspectRect(output, ratio)` gives the largest centred rectangle of `1:1`, `4:5`, `9:16` or `16:9`; the overlay dims the area outside it by 40%.

## Tests

`packages/stage/__tests__/` covers the geometry (including the engine cross-check), the viewport, the guides, the edge warning and the controller's gestures and undo steps on the Understory fixture. `StageOverlay` is checked by hand on the demo page.
