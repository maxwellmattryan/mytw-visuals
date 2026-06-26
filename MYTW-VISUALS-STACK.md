### mytw-visuals

**Path:** `~/dev/mystic-twin/repos/mytw-visuals`
**Purpose:** p5.js creative coding sketchbook for generating animated visuals and static compositions for social media content.

**Stack:**

- **p5.js** in instance mode (`new p5((p) => { ... })`)
- **Vite** for dev server and builds — sketches are auto-discovered as independent entry points
- **Custom capture pipeline** — PNG frame capture → tar archive → ffmpeg conversion to MP4 via dev server
- **GLSL fragment shaders** for real-time image processing (displacement, chromatic aberration, hue shift, etc.)
- **Shared utility library** (`lib/`) — math/easing, color palettes, shader helpers, layout presets, image processing
- **Sketch templates** for scaffolding new sketches (basic, shader, image, audio-reactive)
- Plain JavaScript, ES modules
- ESLint + Prettier + lint-staged pre-commit hook
- Jest for unit testing

**Output Dimensions:**

- Instagram post: 1080x1080
- Instagram/TikTok story/reel: 1080x1920
- YouTube/landscape: 1920x1080
- Twitter/X: 1200x675

**Recording Shortcuts:**

- `R` — start/stop recording (red dot indicator when active)
- `S` — save a single frame as PNG
- MP4 exports are saved to `~/Downloads` via the dev server (falls back to a `.tar` download if unavailable)
