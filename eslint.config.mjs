import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'homebridge-ui/public/', 'sample/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/quotes': ['warn', 'single'],
      '@stylistic/indent': ['warn', 2, { SwitchCase: 1 }],
      '@stylistic/semi': ['warn'],
      '@stylistic/comma-dangle': ['warn', 'always-multiline'],
      '@stylistic/brace-style': ['warn'],
      '@stylistic/max-len': ['warn', 140],
      '@stylistic/comma-spacing': ['error'],
      '@stylistic/no-multi-spaces': ['warn', { ignoreEOLComments: true }],
      '@stylistic/no-trailing-spaces': ['warn'],
      '@stylistic/lines-between-class-members': ['warn', 'always', { exceptAfterSingleLine: true }],
      '@stylistic/member-delimiter-style': ['warn'],
      'dot-notation': 'off',
      eqeqeq: 'error',
      curly: ['warn', 'all'],
      'prefer-arrow-callback': ['warn'],
      'no-console': ['warn'],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Raw LG ThinQ JSON payloads are untyped; flag new uses without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      eqeqeq: 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
