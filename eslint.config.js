/**
 * Flat ESLint config — TypeScript renderer/preload/main sources only.
 * The vanilla-JS `electron/` shell is deliberately excluded (see
 * IMPROVEMENT_PLAN.md Phase 1 anti-pattern guards: no churn there yet).
 *
 * Recommended (non-type-checked) rules to keep `npm run lint` fast.
 */

const js = require('@eslint/js')
const tseslint = require('typescript-eslint')
const reactHooks = require('eslint-plugin-react-hooks')
const prettier = require('eslint-config-prettier')

module.exports = tseslint.config(
  {
    ignores: [
      'electron/**',
      'out/**',
      'dist/**',
      'node_modules/**',
      'scripts/**',
      'build/**',
      'resources/**',
      'output/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      prettier,
    ],
    rules: {
      // The codebase intentionally uses `_`-prefixed placeholders.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // React Compiler-era rules flag long-standing patterns in this codebase
      // (sync setState in effects, ref writes during render). Keep them
      // visible as warnings; fixing them is a refactor, not a lint chore.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  }
)
