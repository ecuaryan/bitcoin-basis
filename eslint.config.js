import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-types/**', '**/coverage/**', '**/node_modules/**', '**/.wrangler/**', 'app/e2e/screenshots/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-syntax': ['error', { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Use crypto.getRandomValues.' }] },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  // The service worker runs in a worker scope, in plain JS.
  { files: ['app/public/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
);
