import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-syntax': ['error', { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Use crypto.getRandomValues.' }] },
  },
);
