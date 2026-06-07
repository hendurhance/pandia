import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
	{
		ignores: [
			'dist/',
			'build/',
			'.svelte-kit/',
			'src-tauri/',
			'node_modules/',
			'playwright-report/',
			'website/',
		],
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte'],
				svelteConfig,
			},
		},
	},
	{
		rules: {
			// Unused imports/vars are an error so the build bundler's noise
			// (false-positive SSR warnings) can't hide a real one. Prefix with
			// `_` to keep an intentional unused binding.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					args: 'after-used',
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'no-unused-private-class-members': 'error',
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/no-navigation-without-resolve': 'warn',
			'svelte/no-unused-svelte-ignore': 'error',
			'svelte/no-useless-mustaches': 'warn',
			'svelte/require-each-key': 'warn',
			'svelte/no-at-html-tags': 'warn',
		},
	},
);
