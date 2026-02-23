# mytw-visuals

p5.js creative coding sketchbook for generating visual content — looping animations, static compositions, and audio-reactive visuals.

## Setup

```sh
yarn install
```

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

Sketches are created in `sketches/NNN-name/` with auto-incrementing numbers.

## Keyboard Shortcuts

| Key | Action                  |
| --- | ----------------------- |
| `R` | Toggle recording (WebM) |
| `S` | Save screenshot (PNG)   |

## Export

- **Video**: Press `R` to start recording, `R` again to stop. A `.webm` file downloads automatically.
- **Screenshot**: Press `S` to save a PNG of the current frame.

## Project Structure

```
lib/              shared utilities (math, colors, shaders, layout, capture)
templates/        sketch templates (basic, shader, image, audio-reactive)
sketches/         individual sketches (NNN-name/)
scripts/          CLI tools (new-sketch.js)
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

Produces `dist/` with all sketch entry points.
