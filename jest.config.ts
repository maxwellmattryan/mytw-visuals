import type { Config } from 'jest'

const config: Config = {
	extensionsToTreatAsEsm: ['.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { useESM: true }],
	},
	moduleNameMapper: {
		'^@lib$': '<rootDir>/packages/lib/index.ts',
		'^@lib/(.*)$': '<rootDir>/packages/lib/$1',
	},
}

export default config
