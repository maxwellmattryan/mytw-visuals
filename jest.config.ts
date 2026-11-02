import type { Config } from 'jest'

const config: Config = {
	extensionsToTreatAsEsm: ['.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { useESM: true }],
	},
	moduleNameMapper: {
		'^@lib$': '<rootDir>/lib/index.ts',
		'^@lib/(.*)$': '<rootDir>/lib/$1',
	},
}

export default config
