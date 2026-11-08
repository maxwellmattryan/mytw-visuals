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

| Key      | Action                       |
| -------- | ---------------------------- |
| Hold `R` | Record PNG frames (dev only) |
| `S`      | Save screenshot (PNG)        |

## Export

- **Video**: Hold `R` to record, release to stop. A red dot shows while recording. Each frame is POSTed as a PNG to the dev server, which writes it to `~/Downloads/mytw-captures/<session>/`. Convert a session to MP4 by hand with `yarn convert <dir>`; the console prints the exact command. Recording needs `yarn dev`, and there is no fallback download. The capture endpoints only accept same-origin requests with a timestamp session name.
- **Screenshot**: Press `S` to save a PNG of the current frame.

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

## Project Structure

```
packages/
  lib/            shared modules (math, colors, shaders, layout, image, capture), each with an index.ts barrel
  schema/         parameter definitions, constraints, clamping and validation (@mytw/schema)
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
