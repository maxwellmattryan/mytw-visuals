# @mytw/layers

The layers panel and the layer properties panel for one clip of a project document. You add images, arrange them into a stack, and tune each layer's opacity, blend, framing and mask without writing code. Every document edit goes through a `@mytw/document` store as one command, so it gets undo and redo for free.

`apps/sketchbook/sketches/007-layers/` hosts both panels around a live engine preview. Start `yarn dev` and open `/sketches/007-layers/` to try it.

## Mounting

Hosts that don't use Svelte call `mountLayers`. It creates one controller and mounts both panels over it:

```ts
import { MemoryAssetSource } from '@mytw/assets'
import { createDocumentStore } from '@mytw/document'
import { applySolo, mountLayers } from '@mytw/layers'

const store = createDocumentStore<Project>({ document: project, validate })
const assets = new MemoryAssetSource()

const { controller, destroy } = mountLayers({
	store,
	assetStore: assets,
	layersTarget: document.getElementById('layers')!,
	propertiesTarget: document.getElementById('properties')!,
	ref: { track: 0, clip: 0 }, // optional, this is the default
})

// Each preview frame: solo is view state, so apply it to the frame, never the document.
renderer.render(applySolo(scene.frameAt(frame), controller.solo))
```

Svelte hosts can mount `LayersPanel` (props: `controller`) and `LayerProperties` (props: `controller`, `idPrefix`) themselves, sharing one `createLayersController({ store, assetStore, ref? })`.

The `assetStore` only needs `add(bytes: Uint8Array): Promise<string>`, returning the bare SHA-256 hex of the bytes. `MemoryAssetSource` from `@mytw/assets` satisfies it. Bytes live only in the host's store; the document holds the asset entry (`sha256:<hex>`, mime type, size and name).

## Behaviour

- **Which layers.** The panels edit the layers of the clip at `ref` (`{ track, clip }`, array indexes). If that clip doesn't exist, the list is empty, and the first image added creates track `track-1` with clip `clip-1` spanning the whole timeline.
- **Order.** Rows run top of the stack first, the reverse of the format's `layers` array.
- **Adding images.** Add image, or drop files on the panel. PNG, JPEG and WebP files become one image layer each, on top of the stack, with neutral defaults. All files from one pick or drop are one undo step, and the last one is selected. Other files are skipped with an error, and the accepted ones are still added. An asset entry is written only when its hash is new.
- **Duplicate** inserts a deep copy directly above the original, with fresh layer and effect ids and the name `<name> copy`.
- **Delete** removes the layer but keeps its asset, so undo can bring it back. The selection moves to the layer below, else the new bottom layer, else nothing.
- **Rename** trims the text and cuts it to 200 characters. Empty text removes `name`, so the row shows the layer id.
- **Hide** sets the layer's `visible` field: document state, undoable, and export respects it.
- **Solo** is view state in the controller. It is never written to the document, never undone, and export ignores it. While any layer is soloed, `applySolo` hides every layer outside the set. A hidden layer stays hidden even when soloed. Solo ids whose layer is gone are dropped.
- **Properties.** Opacity, blend and feather (Layer), center, zoom, rotation and mirroring (Framing), and an optional linear-gradient mask (Mask). The controls are `@mytw/panel`'s `ParamRow` and `Group` over a `PanelModel` built from `LAYER_SCHEMA`. Edits to one field merge into one undo step (`mergeKey` `<layerId>:<param>`), and changing the selection seals the merge. For a modulated field (`{ value, mod }`), the control edits `value` and keeps `mod`. Reset all writes the neutral values in one step and keeps the mask.
- **Errors.** Rejected imports and commands show on the panel's error line. Values the schema rejects show on their field and leave the document unchanged.
- **Undo.** After `store.undo()` or `store.redo()`, both panels re-read the document. If the selected layer no longer exists, the selection clears. The panels don't bind undo keys; the host does.

## Keyboard

With a row focused (not the rename input):

| Keys                        | Action                                 |
| --------------------------- | -------------------------------------- |
| ArrowUp / ArrowDown         | Select the row above or below          |
| Alt+ArrowUp / Alt+ArrowDown | Move the layer up or down              |
| Delete / Backspace          | Delete the layer                       |
| Mod+D                       | Duplicate the layer                    |
| F2 / Enter                  | Rename (Enter commits, Escape cancels) |

## API

- `createLayersController(options)`: the shared state (`project`, `layers`, `selectedId`, `solo`, `error`, `busy`) and actions (`select`, `toggleSolo`, `toggleVisible`, `rename`, `move`, `moveTo`, `duplicate`, `remove`, `setBlend`, `importFiles`), plus `subscribe` and `destroy`.
- Command builders: `addImageLayers`, `duplicateLayer`, `deleteLayer`, `renameLayer`, `moveLayer`, `setLayerVisible`, `setLayerBlend`, `setAnimatable`, `setField`, `addMask`, `removeMask`. Each takes the current project and returns a `@mytw/document` command, or `null` for a no-op. They never mutate.
- `importImageFiles(files, assetStore)`: sniffs and stores the files, returning `{ images, errors }`.
- `applySolo(frame, ids)`: returns a new `RenderFrame` with solo applied.
- `nextId(project, base)`: a valid id unused by any track, clip, layer or effect (`base`, then `base-2`, `base-3`, …).
- `LAYER_SCHEMA`, `createLayerModel(controller)`, `NEUTRAL`, `DEFAULT_MASK`, `clipAt`, `layersPath`.
