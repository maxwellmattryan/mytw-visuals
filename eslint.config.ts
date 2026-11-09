import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'
import tseslint from 'typescript-eslint'

export default [
	js.configs.recommended,
	...tseslint.configs.recommended,
	prettier,
	{
		files: ['**/*.ts'],
		plugins: { prettier: prettierPlugin },
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.browser,
			},
		},
		rules: {
			'no-console': 'off',
			'prefer-const': 'warn',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/consistent-type-imports': 'error',
			'prettier/prettier': 'error',
		},
	},
	{
		files: ['**/scripts/**/*.ts', '**/vite-plugins/**/*.ts', '**/*.config.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		// The engine is UI-free and p5-free, so the editor, exporter and player can share it.
		files: ['packages/engine/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: ['p5', 'svelte', '@mytw/panel', '@lib'],
					// @lib/math is pure, so the timeline may use it.
					patterns: ['svelte/*', '@lib/*', '!@lib/math'],
				},
			],
		},
	},
	{
		// p5 is large, so it loads only for projects with sketch layers, through runtime.ts.
		files: ['packages/sketch/**/*.ts'],
		ignores: ['packages/sketch/runtime.ts', 'packages/sketch/__tests__/**'],
		rules: {
			// The typescript-eslint rule, because only it can allow `import type p5 from 'p5'`.
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'p5',
							allowTypeImports: true,
							message:
								'Load p5 through loadSketchRuntime so projects without sketch layers never fetch it.',
						},
						'svelte',
						'@mytw/panel',
					],
				},
			],
		},
	},
	{
		files: ['**/__tests__/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.jest,
				...globals.node,
			},
		},
	},
	{
		ignores: ['**/dist/', '**/node_modules/'],
	},
]
