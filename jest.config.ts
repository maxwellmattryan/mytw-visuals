import type { Config } from 'jest'

const config: Config = {
	extensionsToTreatAsEsm: ['.ts'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { useESM: true }],
	},
	moduleNameMapper: {
		'^@lib$': '<rootDir>/packages/lib/index.ts',
		'^@lib/(.*)$': '<rootDir>/packages/lib/$1',
		'^@mytw/assets$': '<rootDir>/packages/assets/index.ts',
		'^@mytw/schema$': '<rootDir>/packages/schema/index.ts',
		'^@mytw/fx$': '<rootDir>/packages/fx/index.ts',
		'^@mytw/engine$': '<rootDir>/packages/engine/index.ts',
		'^@mytw/export$': '<rootDir>/packages/export/index.ts',
		'^@mytw/document$': '<rootDir>/packages/document/index.ts',
		'^@mytw/scene$': '<rootDir>/packages/scene/index.ts',
		'^@mytw/sketch$': '<rootDir>/packages/sketch/index.ts',
		'^@mytw/storage$': '<rootDir>/packages/storage/index.ts',
		'^@mytw/home$': '<rootDir>/packages/home/index.ts',
	},
}

export default config
