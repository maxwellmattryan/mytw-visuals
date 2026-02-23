import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'

export default [
	js.configs.recommended,
	prettier,
	{
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
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'prettier/prettier': 'error',
		},
	},
	{
		files: ['scripts/**/*.js'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		ignores: ['dist/', 'node_modules/'],
	},
]
