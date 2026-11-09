# mytw-visuals

An open source creative coding project that is today a p5.js sketchbook for generating visual content — looping animations, static compositions, and audio-reactive visuals — and is growing into a local-first visual editor for looping, release-ready music visuals. Mystic Twin, a record label, is its primary user, but it is not built exclusively for Mystic Twin. Written in strict TypeScript.

## Direction

The destination is a local-first editor that takes a visual from an image to an export without writing code, with code sketches staying available where sliders can't express an idea. The plan lives in [GitHub milestones](https://github.com/maxwellmattryan/mytw-visuals/milestones):

- **v0.2 Foundations:** Yarn workspaces, app versioning, open source groundwork
- **v0.3 Live panel:** schema-driven controls for tuning sketches in real time
- **v0.4 Engine:** projects as versioned data, rendered and exported by our engine
- **v0.5 Local editor:** build a visual from an image to an export without writing code

Committed scope stops at v0.5. Anything later is a parked idea, not a commitment.

## Name

The project stays `mytw-visuals`. Mystic Twin is its primary user, so the name is honest about where it came from, and a rename would touch the repo URL, tracker config, workspace scopes and capture path while the product is still a sketchbook. It costs little to revisit when the editor ships under its own product name. Despite the name, the project is not exclusive to the label.

## Setup

```sh
yarn install
```

Requires Node 22.18 or later: `yarn new` runs `apps/sketchbook/scripts/new-sketch.ts` directly with Node's native type stripping. Video conversion also requires `ffmpeg`.

## Development

Start the dev server:

```sh
yarn dev
```

Open `http://localhost:5173` to see the sketch picker.

## Create a New Sketch

```sh
yarn new --name my-sketch --template basic
```

Templates: `basic`, `shader`, `image`, `audio-reactive`. The `image` template loads the freely licensed `/images/sample.png`.

Sketches are created in `apps/sketchbook/sketches/NNN-name/` with auto-incrementing numbers, each with its own `index.html` and `sketch.ts`.

## Keyboard Shortcuts

| Key      | Action                               |
| -------- | ------------------------------------ |
| Hold `R` | Record PNG frames (dev only)         |
| `S`      | Save screenshot (PNG)                |
| `H`      | Hide or show the panel and transport |
| `B`      | Swap A and B in a compare            |

`R` and `S` do nothing while you type in a text field, and neither do `H` and `B`. `B` only acts during a snapshot compare.

## Parameter Panel

A sketch that defines its parameters with `@mytw/schema` gets a live control panel with one call. Read `panel.values` in `draw()`, and every change applies on the next frame:

```ts
import { mountPanel } from '@mytw/panel'

const panel = mountPanel(schema) // usually in setup()
p.draw = () => {
	p.circle(0, 0, panel.values.size)
}
```

The panel floats at the top left, outside the canvas, so recordings and screenshots never include it. Press `H` to hide it. `apps/sketchbook/sketches/003-panel-demo/` shows every control kind.

Give a parameter an optional `help` string to explain it. It is plain text, and the panel shows it as a muted line under the control.

Every template, and so every sketch from `yarn new`, starts with a small schema and a mounted panel.

### Snapshots

Panel values persist in the browser's `localStorage`, one entry per sketch, so a reload keeps your tweaks. Saved values are checked against the current schema when they load: unknown keys are dropped, missing ones get their default, and out-of-range numbers are clamped. The status line then says how many values it adjusted. Values are written 250 ms after the last change, never per frame.

The **Snapshots** section at the bottom of the panel (collapsed at first) keeps named settings:

- **Save** stores the current values under a name (`Snapshot N` when left empty). Each snapshot can be loaded, renamed or deleted.
- **Compare** keeps your current values as A and shows the snapshot as B. Press `B` or **Swap A/B** to flip between them, then **Keep A** or **Keep B**. Editing a control during a compare ends it and keeps what you see.
- **Copy JSON** copies the shown values. **Paste JSON** with **Apply**, or **Import file** (up to 1 MB), applies values from JSON. Values that don't fit are adjusted and listed, and input that can't be used is rejected with the reason.

The JSON is a small versioned envelope. A bare values object such as `{ "speed": 2 }` is accepted too:

```json
{
	"format": "mytw-params",
	"version": 1,
	"values": { "speed": 2, "count": 6 }
}
```

`serializeValues` and `parseValues` in `@mytw/schema` read and write it. A later format change bumps `version` and adds a migration, so older JSON keeps loading.

Two `mountPanel` options control persistence:

```ts
mountPanel(schema, {
	storageKey: 'my-sketch', // defaults to a key from location.pathname
	storage: null, // turns persistence off; snapshots then last until reload
})
```

`storage` also accepts any object with `getItem` and `setItem`. If storage is unavailable or holds data the panel can't read, the panel starts from defaults. If a write fails, such as when storage is full, your values stay as they are. Either way the status line says so, and values and snapshots keep working in memory until reload.

## Transport

A looping sketch reads its phase from a `LoopClock` instead of `p.frameCount`, and mounts a transport to play, pause, step and scrub the loop:

```ts
import { LOOP_TARGETS, LoopClock } from '@lib/loop'
import { mountTransport } from '@mytw/panel'

const clock = new LoopClock({ loopFrames: 225, fps: 30 }) // in setup()
mountTransport(clock, cap, { redraw: () => p.redraw(), target: LOOP_TARGETS.spotifyCanvas })
p.draw = () => {
	const phase = clock.next() // in [0, 1), once per draw()
}
```

The transport floats at the bottom right, outside the canvas, so recordings and screenshots never include it. `H` hides and shows it along with the panel. It has:

- **Play/Pause**, **Step back** and **Step forward** (each step pauses), and a **Loop phase** scrub that pauses and seeks. The readout shows the 0-based frame, such as `Frame 12 / 225`.
- The loop length, such as `225 frames · 7.50 s at 30 fps`. Sketches 001 and 002 set it in the panel's Loop group.
- **Target**: `None`, `Spotify Canvas (3–8 s)` or `Custom` with a max length in seconds. A warning shows when the loop is outside the target. Both bounds are inclusive.
- **Record loop** records exactly one loop: it starts a session, jumps to frame 0 and stops by itself after `loopFrames` frames. Like hold-`R`, it needs `yarn dev`. Changing the loop length or FPS while it runs stops the recording.
- **Check seam** draws the two frames on each side of the loop point and compares them. `Seam` is the mean RGB difference (0–255) between the last frame and the first, and `step` is the mean difference across the neighbouring steps. The loop is flagged as jumping when the seam is over twice the step and over 1. It then returns to the frame you were on.

## Timeline

`@mytw/engine` resolves a timeline document at a loop phase. A document has flat params (such as `base.zoom`), each with a base value or keyframe track, and shared sine, triangle or noise modulators that add to any number of params with their own amounts. Modulators run whole cycles per loop and results are clamped to each param's bounds. Evaluation is pure and needs no DOM, so previews and exports agree frame for frame, and phase 1 equals phase 0 when `loopIssues` finds nothing:

```ts
import { evaluate, loopIssues } from '@mytw/engine'

// doc: { params: { 'base.zoom': { kind: 'number', value: 1 } }, modulators: { breathe: … } }
const state = evaluate(doc, clock.phase) // { 'base.zoom': 1.02 }
const loopSafe = loopIssues(doc).length === 0 // every keyframe track ends where it starts
```

## Export

- **Video**: Hold `R` to record, release to stop. A red dot shows while recording. Each frame is POSTed as a PNG to the dev server, which writes it to `~/Downloads/mytw-captures/<session>/`. Convert a session to MP4 by hand with `yarn convert <dir>`; the console prints the exact command. Recording needs `yarn dev`, and there is no fallback download. The capture endpoints only accept same-origin requests with a timestamp session name.
- **One loop**: In a sketch with a transport, **Record loop** records exactly `loopFrames` frames from phase 0, then stops by itself.
- **Screenshot**: Press `S` to save a PNG of the current frame.

## Project Format

A project is a versioned JSON document (`"format": "mytw-project"`) that describes a looping visual as data: output size, timeline, content-addressed image assets, modulators, tracks of clips and layers, and effect chains. Nothing renders it yet. `@mytw/schema` reads, validates, migrates and writes it with `parseProject`, `validateProject`, `migrateProject` and `serializeProject`. See [docs/project-format.md](docs/project-format.md) for the full v1 specification, including how to add a version. Example documents live in `packages/schema/fixtures/`.

## TypeScript

All code, including config files, is strict TypeScript with no `any` or type-check suppressions. `yarn build` runs `tsc --noEmit` over every workspace first, so a type error fails the build before Vite runs.

Import shared code from nested modules with extensionless `@lib` specifiers. The alias resolves in Vite, `tsc` and Jest:

```ts
import { createCanvas, SIZES } from '@lib/layout'
```

Import the parameter schema from `@mytw/schema`, its package name. It has no DOM or p5 dependency, and `yarn build` type-checks it without DOM types:

```ts
import { defineSchema, param } from '@mytw/schema'
```

### Document Store

`@mytw/document` routes every edit to a project document through one path of plain JSON commands, which gives undo and redo. Like `@mytw/schema`, it has no DOM or WebGL dependency. Create a store from a starting document and a validator that returns `{ ok: true }` or `{ ok: false, issues }`:

```ts
import { affects, createDocumentStore } from '@mytw/document'

const store = createDocumentStore({ document: initialDoc, validate: validateProject })

store.apply({ op: 'set', path: ['layers', 0, 'opacity'], value: 0.5 })
store.undo()
```

The commands are `set`, `remove`, `insert`, `move` and `batch`. A path is an array of object keys and array indexes. `apply` checks the command, applies it and runs the validator as one step: when anything fails it returns `{ ok: false, error }` with `error.code` set to `'malformed'`, `'path'` or `'invalid'`, and the document stays as it was. A batch is all or nothing, and it undoes as one step.

Pass a `mergeKey` to fold a continuous drag into one undo step, and call `seal()` on pointer-up to end it:

```ts
store.apply({ op: 'set', path: ['layers', 0, 'opacity'], value }, { mergeKey: 'layer-0.opacity' })
store.seal()
```

Subscribers get each committed change with the paths it touched, so a view can skip the changes that don't concern it:

```ts
const unsubscribe = store.subscribe((change) => {
	if (affects(change, ['layers', 0])) redrawLayer(0)
})
```

Documents are never mutated. Each change builds a new root and keeps the identity of unchanged subtrees. `store.load(doc)` replaces the document and clears history.

Load images for WebGL2 with `@mytw/assets`. Assets are addressed by the SHA-256 of their bytes, and textures use a top-left origin with v growing downward, so shaders need no Y flip. A missing or broken asset never throws: it loads as a magenta/black checker and reports the issue. The `005-asset-check` sketch is a manual check page for it.

```ts
import { ImageAssets, MemoryAssetSource } from '@mytw/assets'
```

## Project Structure

```
packages/
  lib/            shared modules (math, colors, shaders, layout, image, capture), each with an index.ts barrel
  schema/         parameter definitions, constraints, clamping and validation, and the project format (@mytw/schema)
  panel/          Svelte 5 control panel generated from a schema, mounted with mountPanel (@mytw/panel)
  assets/         image loading by content hash into WebGL2 textures, no UI or p5 (@mytw/assets)
  engine/         UI-free WebGL2 renderer: frame data, render graph, effects (@mytw/engine)
  document/       document store: JSON commands, undo and redo, change notifications (@mytw/document)
  engine/         timeline and modulation evaluator, no DOM (@mytw/engine)
apps/
  sketchbook/     the sketchbook app and Vite root
    index.html    sketch picker page, served at /
    picker/       sketch picker script loaded by index.html
    vite-plugins/ dev server plugins (sketch list, capture endpoints)
    templates/    sketch templates (basic, shader, image, audio-reactive)
    sketches/     individual sketches (NNN-name/)
    scripts/      CLI tools (new-sketch.ts, convert.sh)
    assets/       static files served at root (images/, fonts/), with their own LICENSE.md
scripts/          repo-level CLI tools (check-pr-title.ts)
docs/             specifications (project-format.md)
```

This is a Yarn workspace. Run every command from the repo root, where `package.json`, `tsconfig.json`, `jest.config.ts` and `eslint.config.ts` cover all workspaces.

## Lint & Format

```sh
yarn lint
yarn format
```

## Build

```sh
yarn build
```

Type-checks, then produces `apps/sketchbook/dist/` with all sketch entry points.

## Versioning and Releases

The repo shares one SemVer version, and release-please cuts `vX.Y.Z` releases from Conventional Commit PR titles. See [RELEASING.md](RELEASING.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, checks, commit style and the rules for adding assets.

## License

Code is licensed under [MIT](LICENSE). Assets are licensed separately, file by file, in [`apps/sketchbook/assets/LICENSE.md`](apps/sketchbook/assets/LICENSE.md): the Mystic Twin artwork is all rights reserved, and the sample image is CC0-1.0. The Mystic Twin name and logos are not licensed.
