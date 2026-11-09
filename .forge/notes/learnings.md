# Forge learnings

<!--
Lessons every Forge agent reads before starting. Written by the retro agent (via a reviewed
PR) and by humans. Keep each entry short, actionable and backed by evidence (job ids). Prune
entries that stop paying for themselves; this file is read on every agent run, so its length
costs tokens on every job.

Format:
- **<rule>** — why, evidence: <job ids>. (added YYYY-MM-DD · experiment: <id> · review-by: YYYY-MM-DD)
`experiment:` names an entry in experiments.md; `review-by:` is when the retro checks that its metric moved.
-->

- **`CLAUDE.md` is not tracked in this repo, so never plan or make edits to it.** The maintainer's global gitignore excludes it, so a builder's edit never reaches the PR, and it's an escalate-protected path anyway. Put contributor and architecture docs in `README.md` or `CONTRIBUTING.md`. Note any suggested `CLAUDE.md` wording in `build.md` for a person to add by hand. Evidence: jobs 7, 8 and 10. (added 2026-11-08 · experiment: notes-claude-md-untracked · review-by: 2026-12-06)
- **Register a new workspace under `packages/` or `apps/` when you scaffold it, not after verify fails.** Set its `package.json` `version` to the `"."` value in `.release-please-manifest.json`. Add `{ "type": "json", "path": "<dir>/package.json", "jsonpath": "$.version" }` to `extra-files` in `release-please-config.json`. Add its `@mytw/<name>` alias to `paths` in `tsconfig.json` and to `moduleNameMapper` in `jest.config.ts`, and add the package to the Project Structure tree in `README.md`. Then run `yarn test --testPathPattern=versions`, which checks the first two. Jobs 14, 16, 17, 18 and 19 failed their first verify on `versions.test.ts`. Jobs 12, 13 and 15 found the gap mid-build, and job 19's docs review flagged the missing tree entry. (added 2026-11-09 · experiment: notes-new-package-checklist · review-by: 2026-12-07)
- **An async test waits on an explicit signal, never on a timer tick.** When a test must act partway through an operation (release an asset mid-load, cancel an export), have the fake expose a promise that resolves when the step under test starts, and `await` that promise. Don't `await` one `setTimeout(0)` tick, which is enough locally but too little on a slow CI runner. `image-assets.test.ts` hung in CI for exactly this reason, cost job 16 a human rework, and timed out once in job 15's integration. (added 2026-11-09 · experiment: notes-async-test-signal · review-by: 2026-12-07)
