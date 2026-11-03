# Releasing

The whole repo shares one [SemVer](https://semver.org/) version, tagged `vX.Y.Z`. [release-please](https://github.com/googleapis/release-please) runs as a GitHub Action, and nothing is published to npm.

## The Flow

1. Every push to `develop` runs `.github/workflows/release-please.yml`.
2. If there are releasable commits since the last release, release-please opens or updates one PR titled `chore(develop): release <version>`. It changes the three `package.json` versions, `.release-please-manifest.json` and `CHANGELOG.md`.
3. Merging that PR runs the workflow again, which creates the `vX.Y.Z` tag and publishes a GitHub Release with the changelog entry as its notes.

With no releasable commit since the last release, no release PR opens and an open one isn't updated.

## Milestones and Versions

Merge the release PR at the end of a milestone, so v0.2 Foundations is `v0.2.0` and v0.3 Live panel is `v0.3.0`. A `fix:`-only release between milestones is a patch.

## What Bumps What

Before 1.0:

| Commit                                                                    | Bump          |
| ------------------------------------------------------------------------- | ------------- |
| `feat:` or a breaking change (`feat!:`, `BREAKING CHANGE:` footer)        | minor         |
| `fix:`                                                                    | patch         |
| `docs:`, `chore:`, `refactor:` and other types, or non-conventional lines | no release PR |

Many `feat:` commits in one release PR still bump the minor version once.

## The PR Title Rule

This repo only squash-merges, with the PR title as the commit subject and a blank body, so PR titles are exactly what release-please reads. Branch commits don't matter and aren't checked.

Every PR runs the `Conventional Commit` check from `.github/workflows/ci.pr-title.yml`, which fails on a title like `Add a thing`. The accepted format is:

```
<type>[(scope)][!]: <description>
```

The types are `feat`, `fix`, `perf`, `revert`, `docs`, `style`, `refactor`, `test`, `build`, `ci` and `chore`.

Issue titles matter too: a Forge PR title defaults to the job title, which defaults to the issue title. The issue forms start titles with `feat: ` and `fix: `. Change the type when it doesn't fit.

## Forcing a Version

A milestone with no `feat:` commit won't be proposed as a minor release. Force the version with a commit that has a `Release-As` footer:

```sh
git commit --allow-empty -m "chore: release 0.3.0" -m "Release-As: 0.3.0"
```

Squash merges use a blank body, so a footer on a branch commit doesn't reach `develop`. Add it to the squash commit's body when merging, or push the commit to `develop` directly if your permissions allow it.

## The Release PR Has No CI

The workflow uses the default `GITHUB_TOKEN`, and PRs and pushes made with that token don't trigger other workflows. The diff is only versions and the changelog, and merging it pushes to `develop`, which runs full CI. To check a release PR by hand first:

```sh
git fetch origin
git checkout release-please--branches--develop
yarn build
yarn test
```

## One-Time Setting

release-please can't open its PR unless Actions may create pull requests. In the repo's settings, go to Actions → General → Workflow permissions and tick "Allow GitHub Actions to create and approve pull requests", leaving the default permissions as read.

## Adding a Workspace

Add the new `package.json` to `extra-files` in `release-please-config.json`, at the same version as the rest. The `shared version` test in `packages/lib/__tests__/versions.test.ts` fails until you do.

## Showing the Version in an App

`apps/sketchbook/vite.config.ts` reads its `package.json` and exposes the version with `define`:

```ts
define: {
	__APP_VERSION__: JSON.stringify(pkg.version),
},
```

A future app does the same in its own `vite.config.ts` and declares the constant in a `.d.ts` file. It gets the same value, since all versions are kept equal.

## A Bad Release

Ship a fix forward as a new patch release. Don't delete published tags or Releases.
