// The projects the editor can open until #21 adds storage. Each fixture's JSON is its own chunk,
// and its image assets are fingerprinted and emitted by Vite (no copy of the PNG in this app).
import understoryBaseUrl from '../../sketchbook/assets/images/mytw-002_base.png?url'

export type FixtureId = 'understory' | 'minimal'

export interface Fixture {
	readonly id: FixtureId
	readonly name: string
	/** The project document, before `parseProject`. */
	readonly load: () => Promise<unknown>
	/** Where each asset hash's bytes are served. */
	readonly assets: Readonly<Record<string, string>>
}

export const FIXTURES: readonly Fixture[] = [
	{
		id: 'understory',
		name: 'Understory',
		load: async () =>
			(await import('../../../packages/schema/fixtures/v1/understory.json')).default,
		assets: {
			'sha256:740b8530c50ed203aa2ecb3ef2ecd24e100b1fef711424f2c8033bb6b724384b': understoryBaseUrl,
		},
	},
	{
		id: 'minimal',
		name: 'Minimal',
		load: async () => (await import('../../../packages/schema/fixtures/v1/minimal.json')).default,
		assets: {},
	},
]

export function findFixture(id: string): Fixture | undefined {
	return FIXTURES.find((fixture) => fixture.id === id)
}
