# mytw-visuals

p5.js creative coding sketchbook for generating visual content — looping animations, static compositions, and audio-reactive visuals. Written in strict TypeScript.

## Setup

```sh
yarn install
```

Requires Node 22.18 or later: `yarn new` runs `scripts/new-sketch.ts` directly with Node's native type stripping. Video conversion also requires `ffmpeg`.

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

Templates: `basic`, `shader`, `image`, `audio-reactive`

Sketches are created in `sketches/NNN-name/` with auto-incrementing numbers, each with its own `index.html` and `sketch.ts`.

## Keyboard Shortcuts

| Key      | Action                       |
| -------- | ---------------------------- |
| Hold `R` | Record PNG frames (dev only) |
| `S`      | Save screenshot (PNG)        |

## Export

- **Video**: Hold `R` to record, release to stop. A red dot shows while recording. Each frame is POSTed as a PNG to the dev server, which writes it to `~/Downloads/mytw-captures/<session>/`. Convert a session to MP4 by hand with `./scripts/convert.sh <dir>`; the console prints the exact command. Recording needs `yarn dev`, and there is no fallback download. The capture endpoints only accept same-origin requests with a timestamp session name.
- **Screenshot**: Press `S` to save a PNG of the current frame.

## TypeScript

All code, including config files, is strict TypeScript with no `any` or type-check suppressions. `yarn build` runs `tsc --noEmit` first, so a type error fails the build before Vite runs.

Import shared code from nested modules with extensionless `@lib` specifiers. The alias resolves in Vite, `tsc` and Jest:

```ts
import { createCanvas, SIZES } from '@lib/layout'
```

## Project Structure

```
lib/              shared modules (math, colors, shaders, layout, image, capture), each with an index.ts barrel
picker/           sketch picker script loaded by the root index.html
vite-plugins/     dev server plugins (sketch list, capture endpoints)
templates/        sketch templates (basic, shader, image, audio-reactive)
sketches/         individual sketches (NNN-name/)
scripts/          CLI tools (new-sketch.ts, convert.sh)
assets/           static files served at root (images/, fonts/)
```

## Lint & Format

```sh
yarn lint
yarn format
```

## Build

```sh
yarn build
```

Type-checks, then produces `dist/` with all sketch entry points.
