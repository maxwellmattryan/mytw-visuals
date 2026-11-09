import { describe, expect, it } from '@jest/globals'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import { parseProject } from '@mytw/schema'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')

// Every `fixtures/v<n>/*.json`, so fixtures added with a new version are covered automatically.
const fixtureFiles = readdirSync(FIXTURES)
	.filter((dir) => /^v\d+$/.test(dir))
	.flatMap((dir) =>
		readdirSync(join(FIXTURES, dir))
			.filter((file) => file.endsWith('.json'))
			.map((file) => `${dir}/${file}`)
	)

describe('project fixtures', () => {
	it('include the v1, v2 and v3 fixtures', () => {
		expect(fixtureFiles).toEqual(
			expect.arrayContaining([
				'v1/understory.json',
				'v1/minimal.json',
				'v2/sketch-layer.json',
				'v3/custom-effect.json',
			])
		)
	})

	it('every fixture parses through the full pipeline', () => {
		const issuesByFile = Object.fromEntries(
			fixtureFiles.map((file) => {
				const result = parseProject(readFileSync(join(FIXTURES, file), 'utf8'))
				return [file, result.ok ? [] : result.issues]
			})
		)
		expect(issuesByFile).toEqual(Object.fromEntries(fixtureFiles.map((file) => [file, []])))
	})
})
