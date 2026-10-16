import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'docs/**',
      'apps/web/src/vendor/**',
      '.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '**/*.mjs', 'apps/web/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/api/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='useFakeTimers'] ObjectExpression > Property[key.name='toFake'] > ArrayExpression > Literal[value='Date']",
          message:
            'Do not use vi.useFakeTimers with Date. Use the injectable clock (setTestTime/resetTestTime from lib/clock.ts) instead.',
        },
        {
          selector: "CallExpression[callee.object.name='vi'][callee.property.name='useFakeTimers']",
          message:
            'Do not use vi.useFakeTimers in API tests. Use the injectable clock (setTestTime/resetTestTime from lib/clock.ts) instead.',
        },
        {
          selector: "CallExpression[callee.object.name='vi'][callee.property.name='setSystemTime']",
          message: 'Do not use vi.setSystemTime. Use setTestTime from lib/clock.ts instead.',
        },
      ],
    },
  },
  prettier,
);
