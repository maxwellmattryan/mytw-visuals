import { describe, expect, it } from '@jest/globals'

import { isConventionalTitle } from '../../../scripts/check-pr-title'

describe('isConventionalTitle', () => {
	it.each([
		'feat: add version to picker',
		'fix(capture): reject empty session',
		'feat!: drop old format',
		'feat(schema)!: bump format',
		'chore(develop): release 0.2.0',
		'docs: explain releases',
		'revert: feat: add thing',
	])('accepts %j', (title) => {
		expect(isConventionalTitle(title)).toBe(true)
	})

	it.each([
		'🛠 - Convert the repo to Yarn workspaces',
		'Add a thing',
		'feat:no space',
		'feat: ',
		'FEAT: shouting',
		'feature: wrong type',
		'feat(Bad Scope): x',
		'',
	])('rejects %j', (title) => {
		expect(isConventionalTitle(title)).toBe(false)
	})
})
