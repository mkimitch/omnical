/* eslint-env node */
'use strict';
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module'
	},
	plugins: [ '@typescript-eslint' ],
	extends: [ 'eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier' ],
	rules: {
		'no-var': 'error',
		'prefer-const': 'error',
		'no-console': [ 'warn', { allow: [ 'warn', 'error' ] } ],
		'@typescript-eslint/no-unused-vars': [ 'warn', { argsIgnorePattern: '^_' } ],
		indent: [ 'error', 'tab' ],
		'no-tabs': 'off',
		quotes: [ 'error', 'single', { avoidEscape: true } ],
		'object-shorthand': [ 'error', 'always' ],
		'max-lines-per-function': [ 'warn', { max: 60, skipBlankLines: true, skipComments: true } ],
		'arrow-body-style': [ 'error', 'as-needed' ]
	}
};
