import { describe, expect, it } from '@jest/globals'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

type PackageJson = { version: string; workspaces: string[] }
type ExtraFile = { type: string; path: string; jsonpath: string }
type ReleaseConfig = { packages: Record<string, { 'extra-files': ExtraFile[] }> }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T
}

const rootPackage = readJson<PackageJson>('package.json')
const manifest = readJson<Record<string, string>>('.release-please-manifest.json')
const config = readJson<ReleaseConfig>('release-please-config.json')

// Workspaces are all `<dir>/*` globs, and a directory without a package.json isn't a workspace.
const workspacePackages = rootPackage.workspaces.flatMap((glob) => {
	const dir = glob.replace(/\/\*$/, '')
	return readdirSync(join(ROOT, dir))
		.map((name) => `${dir}/${name}/package.json`)
		.filter((path) => existsSync(join(ROOT, path)))
})

describe('shared version', () => {
	it('finds the workspace packages', () => {
		expect(workspacePackages.length).toBeGreaterThan(0)
	})

	it('keeps the root package at the manifest version', () => {
		expect(rootPackage.version).toBe(manifest['.'])
	})

	it.each(workspacePackages)('keeps %s at the manifest version', (path) => {
		expect(readJson<PackageJson>(path).version).toBe(manifest['.'])
	})

	it.each(workspacePackages)('lists %s in extra-files', (path) => {
		expect(config.packages['.']['extra-files']).toContainEqual({
			type: 'json',
			path,
			jsonpath: '$.version',
		})
	})
})
