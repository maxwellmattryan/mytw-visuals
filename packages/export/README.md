# @mytw/export

Frame-accurate export in the browser, with no dev server and no ffmpeg. It steps through a loop's frames deterministically, then encodes H.264 with WebCodecs and muxes an MP4. It can also write a PNG sequence as a zip, or a single PNG still. The package has no UI. The sketchbook calls it today, and the editor's export dialog will call it later.

```ts
import { createRenderer } from '@mytw/engine'
import { engineSource, EXPORT_PRESETS, exportVideo } from '@mytw/export'

const canvas = document.createElement('canvas')
const renderer = createRenderer(canvas, { width: 2, height: 2 })
// setImage and registerEffect as usual, then:
const source = engineSource(renderer, (phase) => frameAt(phase), canvas)
const { width, height, fps, quality } = EXPORT_PRESETS.spotifyCanvas
const result = await exportVideo(source, { width, height, fps, quality, frames: 225 })
// result.blob is a video/mp4 Blob
```

`apps/sketchbook/sketches/006-export-check/` is a working example. It exports Understory as an MP4, a PNG sequence or a still from `yarn build && yarn preview`.

## API

| Call                                             | Behaviour                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportVideo(source, options)`                   | Encodes H.264 (8-bit 4:2:0) in an MP4 with no audio track. Frame 0 is a keyframe, and then every `round(2 * fps)` frames. Resolves an `ExportResult` with `mimeType: 'video/mp4'` and the `codec` string it used. |
| `exportPngSequence(source, options)`             | Writes a zip, stored without compression, of `frame-00000.png`, `frame-00001.png` and so on. The index has 5 digits, or more when `frames > 99999`.                                                               |
| `exportStill(source, { width, height, phase })`  | Draws one phase and resolves a PNG `Blob`.                                                                                                                                                                        |
| `checkVideoSupport({ width, height, fps, ... })` | Resolves `{ ok: true, codec, bitrate }` or `{ ok: false, message }`. See [Supported browsers](#supported-browsers).                                                                                               |
| `engineSource(renderer, frameAt, canvas)`        | Adapts a `@mytw/engine` renderer into a `FrameSource`. Pass the renderer's canvas, since `Renderer` doesn't expose it.                                                                                            |
| `EXPORT_PRESETS`, `presetIssues(preset, opts)`   | Destination presets, and warnings when an export doesn't fit one. See [Presets](#presets).                                                                                                                        |
| `framePlan(frames, loopFrames, fps)`             | The phase, timestamp and duration of every frame. The exporters use it, and it's exported for previews and tests.                                                                                                 |

Each export function also takes an optional last `deps` argument. `exportVideo` reads `{ VideoEncoder, VideoFrame }` from it, and defaults to `globalThis`. The PNG exports read `{ createScratch }` from it, and default to a 2D `OffscreenCanvas`. Tests use this argument to inject the fakes in `testing/`.

### Options

| Option                | Type                                       | Notes                                                                                                                                    |
| --------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height`     | positive integers                          | Even for video.                                                                                                                          |
| `fps`                 | finite number in (0, 240]                  | 23.976 works. Timestamps are rounded to whole microseconds.                                                                              |
| `frames`              | positive integer                           | How many frames the export holds.                                                                                                        |
| `loopFrames`          | positive integer                           | Frames in one loop. Defaults to `frames`. With 450 frames and `loopFrames: 225`, the export plays the loop twice.                        |
| `bitrate` / `quality` | bits per second / `'low'` to `'very-high'` | Video only. Pass at most one. `quality` (default `'high'`) maps to `round(w * h * fps * bpp)`, with bpp 0.05, 0.1, 0.15 or 0.25.         |
| `signal`              | `AbortSignal`                              | Abort to cancel.                                                                                                                         |
| `onProgress`          | `({ done, total }) => void`                | Called after each frame is handed to the encoder or zip. `done` runs from 1 to `total = frames`.                                         |
| `destination`         | `WritableStream<{ type, data, position }>` | Streams the output as positioned writes, and `result.blob` is `null`. A `FileSystemWritableFileStream` from `showSaveFilePicker()` fits. |

Invalid options reject with `ExportError('invalid-options')` before `begin` is called, and the message names the field. A source canvas whose size after `begin` isn't `width`x`height` rejects the same way.

### Frame sources

A `FrameSource` is a canvas plus three calls. The exporter calls `begin({ width, height })` once, and then awaits `draw(phase, index)` for each frame. It reads the canvas straight after `draw` resolves, before it awaits anything else, so a WebGL canvas with `preserveDrawingBuffer: false` is read before compositing clears it. It calls `end()` once, in a `finally`.

`engineSource` sets the renderer to the export size in `begin` and restores the previous size in `end`. If `render` returns `false` because the context was lost, the export rejects with `ExportError('context-lost')` and doesn't retry the frame. Render exports into their own renderer and canvas, as `006-export-check` does, so a preview keeps its size.

### Frame stepping

Frame `i` shows loop phase `(i % loopFrames) / loopFrames` at timestamp `round(i * 1e6 / fps)` µs, and lasts until the next frame's timestamp. The last frame of a loop sits one step before phase 1, so phase 0 is never drawn twice and the loop is seamless by construction. Stepping never reads a clock, `requestAnimationFrame` or `performance.now()`, so a slow machine produces the same frames as a fast one, just more slowly.

### Errors

Every rejection is an `ExportError` with a `code`.

| Code                   | When                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `invalid-options`      | A bad option, or a canvas that isn't the export size after `begin`.                                                           |
| `encoding-unavailable` | There is no `VideoEncoder`, or no H.264 config is supported at this size. The message is the one `checkVideoSupport` returns. |
| `encode-failed`        | The encoder's `error` callback fired, or the muxer, zip or `destination` failed. The original error is in `cause`.            |
| `context-lost`         | `engineSource` couldn't draw because the WebGL context was lost.                                                              |
| `cancelled`            | The `signal` was aborted. If it was already aborted when the export started, the export rejects before `begin`.               |

On any failure or cancel, the exporter stops drawing, closes the encoder, cancels the muxer or zip, aborts `destination` and calls `end()`. A cancelled export never leaves a partial file behind.

## Presets

| Preset                         | Size      | fps | Quality  | Length    |
| ------------------------------ | --------- | --- | -------- | --------- |
| `EXPORT_PRESETS.spotifyCanvas` | 1080x1920 | 30  | `'high'` | 3 to 8 s  |
| `EXPORT_PRESETS.instagramReel` | 1080x1920 | 30  | `'high'` | 3 to 90 s |

`presetIssues(preset, { frames, fps })` returns warnings, such as `Loop is 9.00 s, over the 8 s Spotify Canvas limit.`, and an empty array when the export fits. The length check reuses `checkLoopTarget` from `@lib/loop`.

## Supported browsers

| Output              | Needs                               | Browsers                                                                                                   |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| MP4 (H.264)         | WebCodecs `VideoEncoder` with H.264 | Chrome and Edge 94+, Safari 16.4+, and Firefox 130+ on desktop where the platform provides H.264 encoding. |
| PNG sequence, still | canvas `convertToBlob` or `toBlob`  | Any browser that runs the engine.                                                                          |

The runtime check is authoritative. `checkVideoSupport` tries High, then Main, then Constrained Baseline profile at the lowest level whose frame size and macroblock rate fit (3.1 up to 6.2), and keeps the first config `VideoEncoder.isConfigSupported` accepts. When none is accepted, or `VideoEncoder` is missing, the message is:

> This browser can't encode H.264 video at `<w>`x`<h>`. Use a recent Chrome, Edge or Safari, or export a PNG sequence instead.

## Memory

- **Video**: the exporter closes each `VideoFrame` right after `encode()`, so at most one is open at a time. It waits for the encoder's `dequeue` event while `encodeQueueSize` is 4 or more (`MAX_ENCODE_QUEUE`), and it awaits the muxer before drawing the next frame.
- **PNG**: frames are copied into one reused 2D canvas and encoded one at a time.
- **With `destination`**: output bytes stream out as they're written, and no `Blob` is built. Video uses Mediabunny's `StreamTarget` in 16 MiB chunks, with the `moov` box at the end.
- **Without `destination`**: the output is collected in memory, so memory grows with the encoded file size but never with the raw frame count. Video puts the `moov` box at the front (`fastStart: 'in-memory'`), which upload sites prefer. A 225-frame Spotify Canvas MP4 is about 5 MB, but its PNG sequence is about 430 MB, so pass a `destination` for long PNG exports.

## Muxing library

The MP4 container comes from [Mediabunny](https://mediabunny.dev) `1.65.2`, pinned exactly. It succeeds `mp4-muxer`, which npm marks deprecated in its favour. It is pure TypeScript, needs no WASM, tree-shakes to what we import, and handles fast start, streaming targets and fractional frame rates. Mediabunny is licensed MPL-2.0. That licence is file-level copyleft, so using it unmodified as a dependency is compatible with this MIT project. Only changes to Mediabunny's own files would have to be shared under the MPL.

We use Mediabunny only to mux (`Output`, `Mp4OutputFormat`, `EncodedVideoPacketSource`) and, in tests, to parse the result with `Input`. We run our own `VideoEncoder` instead of Mediabunny's `CanvasSource`. That way we own backpressure, keyframe placement and cancellation, and Node tests can inject a fake encoder.

The zip comes from [fflate](https://github.com/101arrowz/fflate) `0.8.3` (MIT), pinned exactly. `ZipPassThrough` stores entries without compression, since PNG data is already compressed.

## The capture route

The dev server's `/api/capture` route, `SketchCapture` and `convert.sh` stay as they are. They record p5 sketches in development. p5 sketches don't render through the engine until #17, and the route is dev-only, so it never ships in a production build. Engine content, and anything built for production, uses `@mytw/export`. We'll revisit removing the route after #17.

## Testing

`testing/fake-webcodecs.ts` has a fake `VideoEncoder` with a controllable output delay, a real `encodeQueueSize` and `dequeue` events. Its first chunk carries a valid avcC for 1080x1920. It also has a fake `VideoFrame` that counts open frames. `testing/fake-canvas.ts` has a canvas that records which frame was drawn into it and can clear itself one task after each draw, as a WebGL canvas does. It also has a recording `FrameSource` with seeded delays, and PNG deps that encode the frame index. The video tests run the real Mediabunny muxer and parse its output.
