# Contributing to mytw-visuals

## Before you start

Check the [milestones](https://github.com/maxwellmattryan/mytw-visuals/milestones) and [existing issues](https://github.com/maxwellmattryan/mytw-visuals/issues) to see what is planned. Committed scope stops at v0.5, and items under Later are parked.

File bugs with the Bug Report form. Blank issues are disabled and the Task form is for maintainers, so raise a feature idea by commenting on a relevant issue first.

## Setup

You need Node 22.18 or later and Yarn (not npm). `ffmpeg` is only needed for video conversion.

```sh
yarn install
yarn dev
```

Run every command from the repo root.

## Making changes

Branch from `develop`, open your PR against `develop` and fill in the PR template. Create new sketches with `yarn new`:

```sh
yarn new --name my-sketch --template basic
```

## Checks to run before a PR

```sh
yarn build
yarn lint
npx prettier --check .
yarn test
```

`yarn format` fixes anything Prettier reports. CI runs the same four checks.

## Code style

- Strict TypeScript with no `any` or type-check suppressions
- Tabs, no semicolons, single quotes, trailing commas (es5)
- Shared code imported through extensionless `@lib` specifiers, such as `@lib/layout`
- Tests in `packages/lib/__tests__/`, `packages/schema/__tests__/`, `packages/panel/__tests__/`, `packages/engine/__tests__/`, `packages/assets/__tests__/`, `packages/fx/__tests__/`, `packages/sketch/__tests__/` and `packages/layers/__tests__/`
- Shared GLSL helpers come from `glslChunks` in `@mytw/fx`, never copied into a sketch. To add an effect, follow "Adding an effect" in [`packages/fx/README.md`](packages/fx/README.md).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`), because release tooling will derive changelogs and versions from them.

## Assets and licensing

Contributed code is licensed under [MIT](LICENSE).

Do not use label artwork in new sketches or tests. Use `/images/sample.png` or an image you may license.

Any new asset needs a row in [`apps/sketchbook/assets/LICENSE.md`](apps/sketchbook/assets/LICENSE.md), and you must have the right to license it.
