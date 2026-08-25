import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Everything in this repo is main-process/Node code — there is no renderer to
 * lint. The game ships prebuilt and is never a lint target: `resources/` is a
 * verbatim copy of somebody else's build output.
 */
export default defineConfig([
  globalIgnores(['out', 'resources', 'release']),
  {
    files: ['**/*.{ts,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
