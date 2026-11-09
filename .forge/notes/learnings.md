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
