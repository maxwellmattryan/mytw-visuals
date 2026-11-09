# Project format (v1)

A project is one versioned JSON document that describes a looping visual: its output size, its timeline, the images it uses, the modulators that animate it, its tracks of clips and layers, and its effect chains. The document is independent of the code that renders it. Commands, the evaluator, the render graph, asset storage and the effect bank all read and write this one format.

This page specifies format v1. `@mytw/schema` (`packages/schema/`) implements it:

| Export                       | What it does                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_FORMAT`             | `"mytw-project"`                                                                                                                                                                                                                                            |
| `PROJECT_SCHEMA_VERSION`     | `1`, the latest version this code reads                                                                                                                                                                                                                     |
| `parseProject(input)`        | Reads JSON text or a parsed value: checks the envelope, migrates, validates, and returns a copy that shares no object with the input. Never throws.                                                                                                         |
| `validateProject(doc)`       | Validates a document at the current version, without migrating. Returns the same reference on success.                                                                                                                                                      |
| `serializeProject(project)`  | `JSON.stringify(project, null, '\t')`                                                                                                                                                                                                                       |
| `migrateProject(doc, opts?)` | Runs the migration steps from the document's version up to the latest. Never throws, never mutates its input.                                                                                                                                               |
| `MIGRATIONS`                 | The ordered migration steps. Empty in v1.                                                                                                                                                                                                                   |
| Types                        | `Project`, `ProjectAsset`, `ProjectTrack`, `ProjectClip`, `ProjectLayer`, `LayerTransform`, `LayerMask`, `AnimatableNumber`, `ModBinding`, `Modulator`, `EffectInstance`, `ProjectIssue`, `ProjectIssueCode`, `ParseProjectResult`, `ValidateProjectResult` |

The types are inferred from the validator's codecs (`packages/schema/project.ts`), so the checks and the types can't drift. The validator has no dependencies.

Example documents live in `packages/schema/fixtures/v1/`: `minimal.json` is the smallest valid project, and `understory.json` expresses sketch 002 (see [Understory](#understory)).

```json
{
	"format": "mytw-project",
	"schemaVersion": 1,
	"name": "Minimal",
	"output": { "width": 1080, "height": 1080, "fps": 30, "background": "#000000" },
	"timeline": { "mode": "loop", "frames": 60 },
	"assets": {},
	"modulators": {},
	"tracks": [],
	"effects": []
}
```

## Conventions

- Every field is required unless it is marked optional. Optional fields are omitted when unset. An optional field holding `undefined` (possible only in a parsed object, never in JSON) counts as absent.
- "Integer" means a JSON number with no fractional part. "Number" means a finite number: `NaN` and `Infinity` are rejected.
- Ranges are written `[min, max]`. A parenthesis marks an exclusive bound, so `[0, 1)` excludes 1, and an open end is `Infinity`.
- **Ids** match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`: a letter or digit, then up to 63 letters, digits, `_` or `-`. Track, clip, layer and effect ids are unique across the whole document. Modulator ids are the keys of `modulators`, so they are unique by construction.
- **UV coordinates** have their origin at the top left, with x to the right and y down. Source UV spans the layer's image as `[0, 1]²`. Canvas UV spans the output canvas as `[0, 1]²`.
- The "Neutral" column in each table gives the value that leaves the result unchanged, or the usual starting value.

## Document

| Field           | Type                               | Rule                                                                          | Neutral |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- | ------- |
| `format`        | `"mytw-project"`                   | literal                                                                       |         |
| `schemaVersion` | integer                            | `1` for this version. See [Versions](#versions).                              |         |
| `name`          | string                             | 1 to 200 characters. Display only.                                            |         |
| `output`        | [Output](#output)                  |                                                                               |         |
| `timeline`      | [Timeline](#timeline)              |                                                                               |         |
| `assets`        | record of [Asset](#assets)         | keyed by content hash                                                         | `{}`    |
| `modulators`    | record of [Modulator](#modulators) | keyed by id                                                                   | `{}`    |
| `tracks`        | [Track](#tracks)`[]`               | may be empty. The first track is the bottom of the stack.                     | `[]`    |
| `effects`       | [EffectInstance](#effects)`[]`     | the global post chain, applied to the final composite in order. May be empty. | `[]`    |
| `extensions`    | optional record of JSON            | see [Unknown fields and extensions](#unknown-fields-and-extensions)           | absent  |

### Output

| Field        | Type    | Rule                                                                 | Meaning                                  |
| ------------ | ------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `width`      | integer | `[1, 8192]`                                                          | canvas width in pixels                   |
| `height`     | integer | `[1, 8192]`                                                          | canvas height in pixels                  |
| `fps`        | integer | `[1, 120]`                                                           | frames per second of playback and export |
| `background` | string  | `#rrggbb`, either case (the `COLOR_PATTERN` of the parameter schema) | the colour every frame starts from       |

### Timeline

| Field    | Type                     | Rule           | Meaning                                                                               |
| -------- | ------------------------ | -------------- | ------------------------------------------------------------------------------------- |
| `mode`   | `"loop"` or `"sequence"` |                | `loop` plays seamlessly from the last frame back to the first. `sequence` plays once. |
| `frames` | integer                  | `[1, 1000000]` | the length in frames. Duration in seconds is `frames / output.fps`.                   |

## Assets

Assets are content-addressed. The key of each entry in `assets` is `sha256:` followed by the SHA-256 of the file's raw bytes as 64 lowercase hex digits, matching `^sha256:[0-9a-f]{64}$`. For example, `shasum -a 256 image.png` prints the digits. The document stores only the hash and the metadata below, never the file. Storage (#15) resolves a hash to bytes.

| Field        | Type                                            | Rule                                    | Meaning                    |
| ------------ | ----------------------------------------------- | --------------------------------------- | -------------------------- |
| `kind`       | `"image"`                                       | the only kind in v1                     |                            |
| `mimeType`   | `"image/png"`, `"image/jpeg"` or `"image/webp"` |                                         | how to decode the bytes    |
| `width`      | integer                                         | at least 1                              | intrinsic width in pixels  |
| `height`     | integer                                         | at least 1                              | intrinsic height in pixels |
| `name`       | optional string                                 | 1 to 255 characters, with no `/` or `\` | the original file name     |
| `extensions` | optional record of JSON                         |                                         |                            |

`name` is display-only and is never used to find a file. No asset field holds a path, a URL or embedded data. Assets that no layer uses are allowed.

## Modulators

A modulator is a named, loop-aware signal. Bindings ([Animatable numbers](#animatable-numbers-and-bindings)) read it. The `shape` field selects the kind:

| Shape                  | Fields                                   | Rules                                                                           |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `"sine"`, `"triangle"` | `cycles`, `phase`, `extensions?`         | `cycles` is an integer in `[0, 64]`. `phase` is a number in `[0, 1)`, in turns. |
| `"noise"`              | `cycles`, `phase`, `seed`, `extensions?` | as above, and `seed` is an integer that picks the noise field                   |
| `"keyframes"`          | `keys`, `extensions?`                    | `keys` has at least 1 key, each `{ at, value, easing }`                         |

A key's `at` is a number in `[0, 1]`, the loop phase it sits at. `value` is any finite number. `easing` is one of `"linear"`, `"easeInOutQuad"`, `"easeOutCubic"`, `"easeInCubic"`, `"easeInOutCubic"`, `"easeOutExpo"` or `"easeInOutExpo"`. The names other than `linear` are the functions in `packages/lib/math/easing.ts`, and `linear` is `e(u) = u`.

A modulator with `cycles: 0` is constant. Modulators that nothing binds are allowed.

## Tracks

| Field        | Type                    | Rule                                               |
| ------------ | ----------------------- | -------------------------------------------------- |
| `id`         | id                      |                                                    |
| `kind`       | `"visual"`              | the only kind in v1                                |
| `clips`      | [Clip](#clips)`[]`      | may be empty. Clips in one track must not overlap. |
| `extensions` | optional record of JSON |                                                    |

## Clips

| Field        | Type                    | Rule                                                 | Neutral     |
| ------------ | ----------------------- | ---------------------------------------------------- | ----------- |
| `id`         | id                      |                                                      |             |
| `start`      | integer                 | at least 0. The first frame the clip draws.          | `0`         |
| `frames`     | integer                 | at least 1. `start + frames <= timeline.frames`.     |             |
| `fadeIn`     | integer                 | at least 0, in frames                                | `0` (a cut) |
| `fadeOut`    | integer                 | at least 0, in frames. `fadeIn + fadeOut <= frames`. | `0` (a cut) |
| `layers`     | [Layer](#layers)`[]`    | the first layer is the bottom                        |             |
| `extensions` | optional record of JSON |                                                      |             |

## Layers

v1 has one layer kind, `"image"`, which draws an asset.

| Field        | Type                                            | Rule                                                | Neutral                |
| ------------ | ----------------------------------------------- | --------------------------------------------------- | ---------------------- |
| `id`         | id                                              |                                                     |                        |
| `name`       | optional string                                 | 1 to 200 characters. Display only.                  | absent                 |
| `kind`       | `"image"`                                       |                                                     |                        |
| `asset`      | content hash                                    | a key of `assets`                                   |                        |
| `visible`    | boolean                                         | `false` skips the layer entirely                    | `true`                 |
| `opacity`    | AnimatableNumber                                | value in `[0, 1]`                                   | `1`                    |
| `blend`      | `"normal"`, `"multiply"`, `"screen"` or `"add"` | see [Blends](#blends)                               | `"normal"`             |
| `feather`    | number (not animatable)                         | `[0, 0.5]`, in source UV                            | `0` (a hard edge)      |
| `transform`  | [Transform](#transform)                         |                                                     |                        |
| `mask`       | optional [Mask](#mask)                          |                                                     | absent (fully visible) |
| `effects`    | [EffectInstance](#effects)`[]`                  | the layer's own chain, applied before it is blended | `[]`                   |
| `extensions` | optional record of JSON                         |                                                     |                        |

### Transform

| Field      | Type             | Rule               | Neutral           |
| ---------- | ---------------- | ------------------ | ----------------- |
| `centerX`  | AnimatableNumber | finite, source UV  | `0.5`             |
| `centerY`  | AnimatableNumber | finite, source UV  | `0.5`             |
| `zoom`     | AnimatableNumber | value `> 0`        | `1` (a cover fit) |
| `rotation` | AnimatableNumber | finite, in radians | `0`               |
| `mirrorX`  | boolean          |                    | `false`           |
| `mirrorY`  | boolean          |                    | `false`           |

### Mask

| Field  | Type                | Rule                                                |
| ------ | ------------------- | --------------------------------------------------- |
| `kind` | `"linear-gradient"` | the only kind in v1                                 |
| `from` | `[x, y]`            | finite numbers, in canvas UV                        |
| `to`   | `[x, y]`            | finite numbers, in canvas UV, different from `from` |

## Animatable numbers and bindings

An **AnimatableNumber** is either a bare finite number, or `{ value, mod }`, where `value` is a finite number and `mod` is a list of bindings (it may be empty). A field's range rule applies to the bare number or to `value`, never to the modulated result.

A **ModBinding** is `{ modulator, amount, mode }`. `modulator` is a key of `modulators`, `amount` is a finite number, and `mode` is `"add"` or `"multiply"`.

## Effects

An **EffectInstance** is one step in an effect chain, either the global chain (`effects` on the document) or a layer's chain.

| Field        | Type                    | Rule                                                                                                                      |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`         | id                      |                                                                                                                           |
| `effect`     | string                  | the effect's name: `^[a-z0-9]+(-[a-z0-9]+)*$`, such as `hue-shift`                                                        |
| `version`    | integer                 | at least 1, the version of the effect's own parameter schema                                                              |
| `enabled`    | boolean                 | `false` skips the step                                                                                                    |
| `params`     | record                  | keys match `^[A-Za-z][A-Za-z0-9]*$`. Each value is an AnimatableNumber, a boolean, a string or a `[number, number]` pair. |
| `extensions` | optional record of JSON |                                                                                                                           |

v1 checks only this structure. Checking `params` against the named effect's own schema, and migrating between effect versions, belongs to the effect registry (#16).

## Semantics

The validator does not enforce what follows, but the evaluator (#13), the render graph (#14) and asset loading (#15) implement it. `@mytw/scene` (`packages/scene/`) maps a project onto engine frames by these rules.

### Time

Frame `f` is an integer in `[0, timeline.frames)`. Loop phase is `t = f / timeline.frames`, so `t` is in `[0, 1)` and frame `timeline.frames` would be frame 0 again. Every animated value is a function of `t`, never of wall-clock time, so export can step through frames deterministically. The same `t` applies in `sequence` mode, where the seam is not required to match.

### Periodic modulators

A sine, triangle or noise modulator outputs a value in `[-1, 1]`, equal to `shape(x)` with `x = cycles·t + phase`, and each shape has period 1:

- **Sine**: `sin(2π·x)`.
- **Triangle**: peaks at `x = 0.25` and bottoms out at `x = 0.75`, like the sine: `1 − 4·min(u, 1 − u)` with `u = frac(x − 0.25)`.
- **Noise**: smooth seeded noise sampled along a closed circle at angle `2π·x`, scaled to `[-1, 1]`. Because the path is closed, it returns to its start, so it loops. `seed` picks the noise field. #13 pins the noise function and the circle's radius.

Because `cycles` is an integer, `x` advances by a whole number of periods over one loop, so every periodic modulator is seamless in loop mode by construction.

### Keyframes

A keyframes modulator outputs its interpolated `value` directly, not scaled to `[-1, 1]`. Before the first key it holds the first value, and after the last key it holds the last value. Between key `i` and key `i + 1` it outputs `vᵢ + (vᵢ₊₁ − vᵢ)·eᵢ(u)`, where `u = (t − atᵢ) / (atᵢ₊₁ − atᵢ)` and `eᵢ` is key `i`'s easing: each key's easing shapes the segment that starts at it. The last key's easing is unused. In loop mode the first and last values must be equal (the `seam` rule), so the hold across the loop point is continuous.

### Bindings

Let `v` be an AnimatableNumber's `value` and `m` a bound modulator's output at the current `t`. An `add` binding gives `v + amount·m`. A `multiply` binding gives `v · (1 + amount·m)`. Bindings apply in array order, each to the result of the previous one. A bare number has no bindings and is constant.

After modulation, a layer's opacity is clamped to `[0, 1]`. Other fields are used as computed.

### Modulator sharing

Several bindings can name one modulator. That is how layers move in unison: each layer binds the same modulator with its own `amount`. A negative `amount` moves a layer the opposite way.

### Transform

The transform is a camera on the source image. The source point `(centerX, centerY)` lands at the canvas centre. `zoom` 1 is a cover fit that preserves the source aspect ratio, so the image just covers the canvas, and higher values magnify. `rotation` is in radians, and a positive rotation turns the image clockwise on screen. The mirrors flip in canvas space before the rotation.

The exact mapping, for a canvas of `W × H` pixels and a source of `w × h` pixels:

- Let `p` be the canvas pixel position relative to the canvas centre, with y down.
- Let `s = max(W / w, H / h)`, the cover-fit scale.
- Let `M = diag(mirrorX ? −1 : 1, mirrorY ? −1 : 1)`.
- Let `R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]]`, which with y down samples the source so that the image appears turned clockwise by `θ`.
- Then `sourcePx = R(rotation)·(M·p) / (zoom·s)` and `sourceUv = center + sourcePx / (w, h)`, dividing component by component.

### Layer edges

Outside the source bounds (`sourceUv` outside `[0, 1]²`) the layer is transparent. Inside them, `feather` softens the edge: with `(u, v)` the source UV and `f = feather`, the layer's alpha is the product of one ramp per edge, `smoothstep(0, f, u)·smoothstep(0, f, 1 − u)·smoothstep(0, f, v)·smoothstep(0, f, 1 − v)`. Near a corner two ramps multiply, so the corner is slightly softer than either edge. The engine and the Understory sketch both use this product. A `feather` of 0 is a hard edge.

### Mask

A linear-gradient mask sets the layer's visibility from canvas UV `q`. Let `t = clamp(dot(q − from, to − from) / |to − from|², 0, 1)`, the projection of `q` onto the line from `from` to `to`. Visibility is `1 − smoothstep(0, 1, t)`: 1 at `from` and 0 at `to`. The mask is in canvas space, so the transform does not move it.

### Blends

Each frame starts as `output.background`. Tracks composite bottom first (the first track is the bottom), and within a track the active clip's layers composite bottom first. A layer runs its own `effects` chain, then blends over the result below with the standard formulas, where `b` is the colour below and `c` the layer colour, per channel in `[0, 1]`:

| Blend      | `blend(b, c)`         |
| ---------- | --------------------- |
| `normal`   | `c`                   |
| `multiply` | `b·c`                 |
| `screen`   | `1 − (1 − b)·(1 − c)` |
| `add`      | `min(b + c, 1)`       |

The result is `mix(b, blend(b, c), a)`, where the coverage `a` is the product of the layer's edge alpha, its opacity, its mask visibility and its clip's fade. Finally, the document's `effects` chain runs on the composite, in order. A step with `enabled: false` and a layer with `visible: false` are skipped.

### Clips

A clip draws its layers over frames `[start, start + frames)` and nothing outside them. Let `local = f − start`. Its fade factor is `min(1, local / fadeIn, (frames − local) / fadeOut)`, leaving out a term whose fade is 0: it ramps linearly up from transparent over the first `fadeIn` frames and down to transparent over the last `fadeOut` frames. A fade of 0 is a cut.

## Rules that span fields

These run only when the structure is valid. Each rule reports its own issue code.

| Code        | Rule                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reference` | Every layer `asset` is a key of `assets`, and every binding's `modulator` is a key of `modulators`.                                                                                                    |
| `duplicate` | Ids are unique across all tracks, clips, layers and effects (layer and global) in the document.                                                                                                        |
| `timeline`  | A clip satisfies `start + frames <= timeline.frames` and `fadeIn + fadeOut <= frames`. Clips in one track don't overlap. Clips that touch, where one starts on the frame after another ends, are fine. |
| `order`     | Keyframe `at` values are strictly increasing.                                                                                                                                                          |
| `seam`      | In loop mode, a keyframes modulator's first and last values are equal.                                                                                                                                 |
| `range`     | A mask's `from` and `to` differ.                                                                                                                                                                       |

Unused assets and modulators are allowed.

## Unknown fields and extensions

Every object is strict. A key the format doesn't define is an `unknown` issue, and the document is rejected. This keeps typos and fields from newer versions from being silently dropped.

The one exception is the optional `extensions` object, allowed on the document and on assets, tracks, clips, layers, effects and modulators. Its keys are any non-empty strings, and each value must be JSON: `null`, a boolean, a finite number, a string, an array or a plain object, checked recursively and nested at most 64 levels deep. Anything else, such as `NaN`, `undefined` or a `Date` in a parsed object, is a `type` issue. Extensions are preserved verbatim through parse, migrate and serialize, and the format never reads them. Tools that need to store their own data use extensions, ideally under a namespaced key such as `"com.example.tool"`.

Keys are always kept as own data, never followed: a `"__proto__"` key in `extensions` stays an ordinary key and never changes any object's prototype.

## Validation issues

`parseProject` and `validateProject` return `{ ok: false, issues }` for a document they reject. An issue is `{ path, code, message }`.

- **Path.** Object keys are joined with `.`, array indexes use `[i]`, and record keys (assets, modulators, effect params, extensions) are always written as `[JSON.stringify(key)]`. The root is `''`. Examples: `tracks[0].clips[0].layers[1].transform.zoom.value`, `modulators["drift-x"].cycles`.
- **Message.** `` `${path || 'document'}: ${detail}` ``, such as `output.fps: is missing` or `name: has 0 characters, expected 1 to 200`.
- **Collection.** The validator collects every issue in document order, reports at most one issue per value, and never throws. The cross-field rules run only once the structure is valid. The envelope checks (`json`, `format`, `newer-version`, `migration`) stop at their first issue.

| Code            | Meaning                                                                            | Example detail                                                 |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `json`          | The input text is not JSON.                                                        | `Not valid JSON`                                               |
| `format`        | Not a `mytw-project` document, or `schemaVersion` is not an integer of at least 1. | `"mytw-params" is not mytw-project`                            |
| `newer-version` | `schemaVersion` is higher than this code reads.                                    | `saved by a newer version (v2), this app reads up to v1`       |
| `migration`     | A migration step is missing, threw, or returned the wrong `schemaVersion`.         | `no migration from v2 to v3`                                   |
| `missing`       | A required field is absent.                                                        | `is missing`                                                   |
| `unknown`       | A field the format doesn't define.                                                 | `is not a known field`                                         |
| `type`          | The wrong JSON type, or a value that isn't JSON.                                   | `expected a finite number`                                     |
| `range`         | A number outside its range, or a mask with `from` equal to `to`.                   | `0.6 is outside [0, 0.5]`                                      |
| `integer`       | A fractional number where an integer is required.                                  | `expected an integer, got 1.5`                                 |
| `pattern`       | A string or record key that doesn't match its pattern.                             | `"./a.png" is not a sha256 content hash`                       |
| `option`        | A string that isn't one of the allowed values.                                     | `"overlay" is not one of normal, multiply, screen, add`        |
| `length`        | A string or list that is too short or too long.                                    | `has 0 characters, expected 1 to 200`                          |
| `reference`     | A layer asset or binding modulator that doesn't exist.                             | `no asset "sha256:…"`, `no modulator "drift-x"`                |
| `duplicate`     | An id already used elsewhere in the document.                                      | `id "base" is already used at tracks[0].clips[0].layers[0].id` |
| `timeline`      | A clip past the timeline end, fades longer than the clip, or overlapping clips.    | `overlaps clip "intro"`                                        |
| `order`         | Keyframes out of order.                                                            | `0.2 is not after the previous key at 0.5`                     |
| `seam`          | A loop keyframes modulator whose last value differs from its first.                | `the loop ends at 1 but starts at 0, so it jumps at the seam`  |

## Versions

`schemaVersion` is the version of this format. It is separate from the app's SemVer version. Any change to the format bumps `schemaVersion` and adds a migration, so older projects keep opening.

- A document whose `schemaVersion` is lower than `PROJECT_SCHEMA_VERSION` is migrated step by step to the latest version when it is parsed, and `parseProject` reports the version it started from as `migratedFrom`.
- A document whose `schemaVersion` is higher than `PROJECT_SCHEMA_VERSION` is rejected with `newer-version`. It is never partially read, because fields this code doesn't know could change what the rest means.
- `validateProject` checks the current version only. Commands use it on documents they already hold.

### Adding a version

To change the format from v`n` to v`n + 1`:

1. **Constant.** Bump `PROJECT_SCHEMA_VERSION` in `packages/schema/project.ts` and change the codecs there. The exported types follow from the codecs.
2. **Migration.** Append a step `{ from: n, to: n + 1, description, migrate }` to `MIGRATIONS` in `packages/schema/migrate.ts`. `migrate` receives a private copy of a v`n` document, which it may change in place, and returns a v`n + 1` document with `schemaVersion: n + 1`. It must not throw on any valid v`n` document. Test it in `packages/schema/__tests__/migrate.test.ts`.
3. **Fixtures.** Add `packages/schema/fixtures/v<n + 1>/` with documents written in the new version, and keep every older fixture unchanged. The fixture test parses every `fixtures/v*/*.json` through the full pipeline, so the old fixtures prove that older documents still open.
4. **Changelog.** Add an entry to [Changelog](#changelog) below that says what changed and how the migration maps old documents, and update the rest of this page.

## Reserved for later

These arrive with a version bump and a migration. v1 rejects each one, as an unknown field or an unknown option:

- an `"audio"` track kind (#32)
- a top-level `formats` key, for per-format framing and parameter overrides (#31)
- a top-level `publish` key
- `"sketch"` and `"video"` layer kinds (#17, #27). A sketch layer will embed the parameter values envelope (`{ "format": "mytw-params", "version": 1, "values": { … } }`, from `packages/schema/snapshot.ts`) as is.

## Understory

`packages/schema/fixtures/v1/understory.json` expresses sketch 002, Understory, at its default parameters (`defaults(understorySchema)` from `apps/sketchbook/sketches/002-understory/params.ts`). `apps/sketchbook/__tests__/understory-project.test.ts` checks the fixture against those defaults. The sketch's phases are in radians and the format's are in turns, so a format phase is `param / 2π`, plus an offset where the sketch uses cosine. The sketch's shader UV is y-up (p5's `vTexCoord` is 0 at the bottom) and it samples a buffer drawn with a Y-flip, while the format is y-down in canvas and source. So a y position becomes `1 − y`, a y offset changes sign, and a rotation changes sign. The [comparison](#comparison) confirmed each of these against the p5 original.

| Sketch param                                       | Document field                                                                                                                                 | Default value in the fixture |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| (fixed 1080 × 1920 canvas)                         | `output.width`, `output.height`                                                                                                                | 1080, 1920                   |
| `fps`                                              | `output.fps`                                                                                                                                   | 30                           |
| (black background)                                 | `output.background`                                                                                                                            | `#000000`                    |
| `loopFrames`                                       | `timeline.frames`, and the clip's `frames`                                                                                                     | 225                          |
| (artwork `mytw-002_base.png`)                      | the one asset, keyed by its SHA-256                                                                                                            | 1688 × 3000 PNG              |
| `driftCyclesX`, `driftPhase`                       | `modulators["drift-x"]`: sine, `cycles`, `phase = driftPhase / 2π`                                                                             | 1, 0                         |
| `driftCyclesY`, `driftPhase`                       | `modulators["drift-y"]`: sine, `cycles`, `phase = driftPhase / 2π + 0.25` (cos is sin a quarter turn on)                                       | 1, 0.25                      |
| `breatheCycles`, `breathePhase`                    | `modulators["breathe"]`: sine                                                                                                                  | 1, 0                         |
| `ghostWobbleCycles`, `ghostWobblePhase`            | `modulators["ghost-wobble"]`: sine                                                                                                             | 1, 0                         |
| `aberrationPulseCycles`, `aberrationPulsePhase`    | `modulators["aberration-pulse"]`: sine, `phase = aberrationPulsePhase / 2π + 0.75` (−cos is sin three quarters on)                             | 1, 0.75                      |
| `baseCenterX`, `baseCenterY`                       | `base` layer `transform.centerX.value`, and `transform.centerY.value = 1 − baseCenterY`                                                        | 0.5, 0.28                    |
| `driftAmp`                                         | `base` layer `drift-x` binding amount `driftAmp` and `drift-y` binding amount `−driftAmp` (`add`)                                              | 0.012, −0.012                |
| `baseZoom`                                         | `base` layer `transform.zoom.value`                                                                                                            | 2                            |
| `breatheAmp`                                       | `breathe` binding amount (`multiply`) on both layers' zoom                                                                                     | 0.022                        |
| `baseMirrorX`, `baseMirrorY`                       | `base` layer `transform.mirrorX`, `transform.mirrorY`                                                                                          | false, false                 |
| `ghostCenterX`, `ghostCenterY`                     | `ghost` layer `transform.centerX.value`, and `transform.centerY.value = 1 − ghostCenterY`                                                      | 0.2, 0.75                    |
| `driftAmp × ghostScale`, sign from `ghostContrary` | `ghost` layer `drift-x` binding amount `a` and `drift-y` binding amount `−a`, where `a` is negative when `ghostContrary` is on                 | 0.0096, −0.0096              |
| `ghostZoom`                                        | `ghost` layer `transform.zoom.value`                                                                                                           | 3.4                          |
| `ghostTilt`                                        | `ghost` layer `transform.rotation.value = −ghostTilt`                                                                                          | 0                            |
| `ghostWobbleAmp`                                   | `ghost-wobble` binding amount `−ghostWobbleAmp` on the ghost's rotation                                                                        | −0.03                        |
| `ghostMirrorX`, `ghostMirrorY`                     | `ghost` layer `transform.mirrorX`, `transform.mirrorY`                                                                                         | true, false                  |
| `ghostFadeStart`, `ghostFadeEnd`                   | `ghost` layer `mask`: `from: [0.5, 1 − ghostFadeStart]`, `to: [0.5, 1 − ghostFadeEnd]`                                                         | 1, 0 (the `from` and `to` y) |
| `intensity`                                        | `ghost` layer `opacity` (the ghost blends with `multiply`)                                                                                     | 1                            |
| `feather`                                          | both layers' `feather`                                                                                                                         | 0.06                         |
| `causticAmp`, `causticScale`, `causticLoopRadius`  | effect `caustic` (`caustic-warp`) params `amount`, `scale`, `loopRadius`                                                                       | 0.005, 2, 0.8                |
| `vignette`                                         | effect `vignette` param `amount`                                                                                                               | 0.2                          |
| `aberrationBase`, `aberrationPulseAmp`             | effect `aberration` (`chromatic-aberration`) param `amount`: `value = base + pulse / 2`, bound to `aberration-pulse` with `amount = pulse / 2` | 0.006, 0.005                 |
| `hueShift`                                         | effect `hue` (`hue-shift`) param `degrees`                                                                                                     | -15                          |

The base layer's rotation is 0: its tilt, spin and wobble default to 0. `spin`, `ghostSpin`, `baseTilt`, `wobbleAmp`, `wobbleCycles` and `wobblePhase` have no binding in the fixture at their defaults.

### Comparison

The Understory proof (#19) renders the p5 original and this fixture side by side and diffs them. Run `yarn dev`, then open `/sketches/006-understory-compare/?run`. The page draws the original with sketch 002's own render module (`sketches/002-understory/render.ts`) at `defaults(understorySchema)`. It draws the fixture through `@mytw/scene` and `@mytw/engine`, with no Understory-specific code. Both render at 1080 × 1920 and pixel density 1. The page logs its report as JSON under `[understory-compare]`. **Record side by side** streams a 2160 × 1920 loop to the capture server for `yarn convert`.

**Threshold.** At each of the frames 0, 45, 90, 135, 180 and 224, the mean absolute difference over R, G and B must be at most 2 (on 0–255). At most 1% of pixels may have a channel that differs by more than 16. Alpha is ignored. The threshold is fixed, so don't loosen it to make a frame pass.

**Results** (the `[understory-compare]` console report from `?run`, headless Chrome on Apple silicon, after the corrections below):

| Frame | Phase  | Mean abs | Max | Over 16 | Result |
| ----- | ------ | -------- | --- | ------- | ------ |
| 0     | 0      | 0.370    | 70  | 0.011%  | pass   |
| 45    | 0.2    | 0.738    | 53  | 0.070%  | pass   |
| 90    | 0.4    | 0.613    | 22  | 0.006%  | pass   |
| 135   | 0.6    | 0.616    | 22  | 0.010%  | pass   |
| 180   | 0.8    | 0.734    | 45  | 0.028%  | pass   |
| 224   | 0.9956 | 0.374    | 82  | 0.014%  | pass   |

The overall verdict is pass. A full loop (225 frames at 30 fps), recorded side by side, shows no visible difference between the halves. Its seam, from frame 224 to frame 0, is a normal one-frame step.

**Corrections the comparison settled.** With the fixture as first written, every frame failed (mean abs 23–25, with 73–77% of pixels over 16), because the framing was upside down.

- **Center Y**: the sketch measures center Y up from the bottom of the image, so the fixture uses `1 − y` and negates the y drift.
- **Mask**: the sketch's fade runs in y-up screen space, so the ghost mask runs from `[0.5, 1]` to `[0.5, 0]`. With center Y and the mask flipped, mean abs fell to 1.6–2.4, with 2.0–4.2% of pixels over 16.
- **Rotation sign**: the sketch's `rot()` turns the other way in y-down space, so the fixture negates the ghost wobble's amount. This lowered the two frames with the most wobble: frame 45 from 2.42 to 2.09 and frame 135 from 2.26 to 2.04.

**Remaining differences.** None of them is visible in playback.

- **Rotation in unscaled UV.** The sketch rotates the ghost in UV units that aren't aspect-corrected, so its wobble shears the ghost slightly. The format rotates in pixel space. Ghost edges move by a pixel or two at the peak of the wobble, which is why frames 45 and 180 have about twice the mean abs of frame 0. Not visible.
- **Post-passes at the canvas edge.** The caustic warp and the chromatic aberration are global passes on the composite, and they clamp to the edge column when they sample past the canvas. The sketch samples the source image beyond the canvas edge instead. This shows as a column a few pixels wide at the left edge, and it gives the max of 70–82 at frames 0 and 224. Barely visible, and only if you know where to look.
- **Warp before or after compositing.** The sketch warps the layer lookups and leaves the mask and the vignette unwarped. The format warps the composite, so the warp also moves the mask and the vignette by a few pixels. Both are smooth gradients, so the difference stays below one level. Not visible.
- **Aberration by resampling.** The sketch recomposes the whole frame once per channel, while `chromatic-aberration` resamples the composite. With the caustic warp off on both sides, also turning off the aberration changes mean abs by 0.02. Not visible.
- **Cover fit and precision.** The source is 1688 × 3000 and the canvas is 1080 × 1920, so the format's cover fit and the sketch's stretched UV differ in scale by 0.03%, which is under 0.2 px. The sketch also uses `mediump`. With every effect off and the ghost hidden on both sides, mean abs is 0.10. Not visible.

**Engine gaps found:**

- **Fixed**: `caustic-warp` sampled its noise in the host's UV. In the engine's y-down UV, its field was flipped relative to the p5 original it was ported from, and four of the six frames failed (up to 4.1% of pixels over 16). `packages/fx/effects/causticWarp.ts` now lays the noise out y-up and flips the y displacement. Its params and version are unchanged.
- **Fixed**: `layerToSourceMatrix` accepts a `Float64Array` as `out` (`packages/engine/transform.ts`), so tests can check the mapping to 1e-9.
- **Fixed**: `SketchCapture` only logged a failed start to the console. It now keeps the reason in `startError` (`packages/lib/capture/sketch-capture.ts`), and the compare page shows it.
- **Checked, no gap**: fx fragments declare `out vec4 fxColor`, while the engine README's example uses `outColor`. A single `out` binds to location 0, and every Understory effect compiled and rendered in the engine unchanged.
- **To file**: "fx: define the UV orientation effects see in each host". p5 hosts give y-up UV and the engine gives y-down. `sine-displacement` and `scanlines` depend on the orientation too.
- **To file**: "engine: let effect passes sample past the canvas edge (overscan)". This is the edge column described above.
- **To file**: "scene: bind effect texture inputs such as feedback's previous frame". `@mytw/scene` sets no `textures` yet.
- **To file**: "sketchbook: update 004-engine-demo to the corrected Understory framing". The demo still uses the uncorrected center Y and mask.

## Changelog

- **v1**: the first version of the format.
