import { fileURLToPath } from 'node:url'

const TITLE =
	/^(feat|fix|perf|revert|docs|style|refactor|test|build|ci|chore)(\([a-z0-9._/-]+\))?!?: \S.*$/

export function isConventionalTitle(title: string): boolean {
	return TITLE.test(title)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const title = process.env.PR_TITLE ?? ''

	if (!isConventionalTitle(title)) {
		console.error(
			`PR title ${JSON.stringify(title)} is not a Conventional Commit.\n` +
				'Expected: <type>[(scope)][!]: <description>\n' +
				'Types: feat, fix, perf, revert, docs, style, refactor, test, build, ci, chore\n' +
				'The title becomes the squash commit subject, which drives the changelog and version bump.'
		)
		process.exitCode = 1
	}
}
