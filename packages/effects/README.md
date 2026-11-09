# @mytw/effects

The effects panel and the effect properties panel for a project document. You browse the effect bank, put effects on a layer or on the whole composition, reorder, bypass and tune them, and write custom GLSL effects that live in the project, all without writing app code. Every document edit goes through a `@mytw/document` store as one command, so it gets undo and redo for free.

`apps/sketchbook/sketches/007-layers/` hosts both panels next to the layers panels, around a live engine preview. Start `yarn dev` and open `/sketches/007-layers/` to try it.

## Mounting

Hosts that don't use Svelte call `mountEffects`. It creates one controller and mounts both panels over it:

```ts
import { applyEffectPreview, mountEffects } from '@mytw/effects'
import { applySolo, mountLayers } from '@mytw/layers'

const layers = mountLayers({ store, assetStore, layersTarget, propertiesTarget })
const effects = mountEffects({
	store,
	stackTarget: document.getElementById('effects')!,
	propertiesTarget: document.getElementById('effect-properties')!,
	// bank: EFFECTS,                  optional, the built-in effects to offer
	// compile: createWebGLCompile(),  optional, checks custom GLSL on Apply
})

// Layer edits the layer the layers panel selects.
effects.controller.setLayer(layers.controller.selectedId)
layers.controller.subscribe(() => effects.controller.setLayer(layers.controller.selectedId))

// Each preview frame: the hover preview is view state, so apply it to the frame, never the document.
const frame = scene.frameAt(f)
renderer.render(
	applySolo(
		applyEffectPreview(frame, effects.controller.preview, f / scene.frames),
		layers.controller.solo
	)
)
```

The renderer must know every effect the preview might show. Register a program for every bank effect up front (`assembleFragment(definition).source`), and for each custom effect as soon as it exists, re-registering when its fragment changes. `007-layers/main.ts` does this.

Svelte hosts can mount `EffectsPanel` (props: `controller`) and `EffectProperties` (props: `controller`, `idPrefix`) themselves, sharing one `createEffectsController({ store, bank?, compile })`.

## Behaviour

- **Target.** The toggle at the top picks **Layer**, the `effects` chain of the layer passed to `setLayer(id)`, found by id anywhere in the project, or **Composition**, the document's top-level `effects` chain, which runs on the final composite. With Layer chosen and no existing layer, the stack says so and Add is disabled. Changing the target clears the selection and the preview.
- **Stack.** One row per instance, in apply order: the first one applied is at the top, as in the format's array. Each row has a bypass checkbox (checked = enabled, a bypassed row is dimmed), Move up, Move down and Remove. An instance whose effect doesn't resolve, or whose version differs from its definition, shows `Unknown effect <id>` or `<name> needs version <n>`. It can still be bypassed, moved and removed, and has no controls.
- **Add** appends an instance at the end of the chain (applied last), with every param at its default, `enabled: true`, the definition's `version`, and an id from `nextId` (`vignette`, `vignette-2`, …). The new instance is selected.
- **Remove** moves the selection to the row that took its place, else the row above, else nothing. **Move** at an end makes no command. **Bypass** writes `enabled`, which the scene and export already skip.
- **Browser.** Every bank effect in bank order, then the project's custom effects under **Custom**, each with an Edit button, then **New custom effect**. A custom effect that `createCustomEffect` rejects shows its first error and has no Add button. Search matches the trimmed, case-insensitive query as a substring of the name or id.
- **Live preview.** While the pointer is over a browser item, or it has keyboard focus, `controller.preview` holds that effect and the current target. `applyEffectPreview` appends it at its defaults to the target's chain of a `RenderFrame`. The preview is never written to the document, never undone, and export ignores it. It clears on leave, blur, Add, a target change, or when no target is available.
- **Properties.** With an instance selected, one control per param from the definition's schema, using `@mytw/panel`'s `ParamRow` and `Group`. Missing or invalid values show the default. For a modulated param (`{ value, mod }`), the control edits `value` and keeps `mod`. Edits to one param merge into one undo step (`mergeKey` `<instanceId>:<param>`), and changing the selection seals the merge. Values the schema rejects, including constraints such as vignette's "Inner must be less than outer", show on their field and leave the document unchanged. Reset all writes every default in one step.
- **Custom GLSL editor.** New custom effect adds `custom` (else `custom-2`, `custom-3`, …: the first id no built-in or custom effect uses), named `Custom effect`, with a passthrough `effect` function, and opens it in the editor, which replaces the controls. Edits change a draft only. **Apply** (or Mod+Enter in either text area) parses the params JSON, builds the effect with `createCustomEffect`, compiles it with the controller's `compile`, and writes it as one undo step only when all three succeed. Otherwise the document is unchanged and every error is listed, `Line <n>: <message>` for one with a line, which is also marked in the gutter. **Revert** reloads the stored effect. After undo or redo, a clean draft reloads and a dirty one is kept; if the effect is gone, the editor closes. **Delete** removes it unless an instance uses it. Custom GLSL that hangs the GPU is not guarded against.
- **Errors.** A rejected command shows on the effects panel's error line until the next successful command.
- **Undo.** The panels don't bind undo keys; the host does.

## Adding an effect needs no editor change

The browser lists the controller's `bank` (`EFFECTS` from `@mytw/fx` by default), and the properties panel builds its controls from each definition's param schema. An effect added to `packages/fx` (see "Adding an effect" in its README) appears in the browser, can be added, and gets controls for every param kind (number, integer, boolean, enum, color, vec2) with no change to this package.

## Keyboard

With a stack row focused:

| Keys                        | Action                        |
| --------------------------- | ----------------------------- |
| ArrowUp / ArrowDown         | Select the row above or below |
| Alt+ArrowUp / Alt+ArrowDown | Move the effect up or down    |
| Delete / Backspace          | Remove the effect             |
| Space                       | Toggle bypass                 |

In the GLSL and Params text areas, Mod+Enter applies the draft.

## API

- `createEffectsController({ store, bank?, compile })`: the shared state (`project`, `scope`, `layerId`, `target`, `chain`, `rows`, `selectedId`, `selected`, `query`, `catalog`, `preview`, `error`, `editor`) and actions (`setLayer`, `setScope`, `select`, `setQuery`, `add`, `remove`, `move`, `toggleEnabled`, `setPreview`, `newCustomEffect`, `openEditor`, `closeEditor`, `editDraft`, `applyDraft`, `revertDraft`, `deleteCustom`), plus `subscribe` and `destroy`. `compile` is injected, so tests pass a fake.
- Command builders: `addEffect`, `removeEffect`, `moveEffectTo`, `setEffectEnabled`, `addCustomEffect`, `updateCustomEffect`, `deleteCustomEffect`. Each takes the current project and returns a `@mytw/document` command (or `{ command, id }`), or `null` for a no-op. They never mutate. Also `customEffectUsage`, `nextCustomId` and `CUSTOM_TEMPLATE_GLSL`.
- `resolveDefinition(project, bank, id)`: the bank first, then a valid custom effect. `catalog(project, bank, query)`: the browser's items. `resolveInstance`, `rowLabel`, `buildCustomEffect` (a cached `createCustomEffect`).
- `findLayer`, `chainPath`, `chainAt` for an `EffectTarget` (`{ kind: 'layer', layerId }` or `{ kind: 'global' }`).
- `createEffectModel(controller)`: the properties panel's `PanelModel`.
- `applyEffectPreview(frame, preview, phase)`: returns a new `RenderFrame` with the preview appended, or the same frame.
- `createWebGLCompile()`: a compile check on one lazily made offscreen WebGL2 context. Without WebGL2 it fails with `WebGL2 is unavailable, so the effect can't be checked.`

## Tests

`packages/effects/__tests__/` covers the command builders (`commands.test.ts`), the controller's browser, chain edits, preview and custom effects with a fake compile (`controller.test.ts`), the properties model (`properties.test.ts`) and `applyEffectPreview` (`preview.test.ts`). The Svelte components and `createWebGLCompile` are checked by `svelte-check` and by hand in `/sketches/007-layers/`.
