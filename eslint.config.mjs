import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from './prettier.config.mjs';

/** @type {import("eslint").Linter.FlatConfig[]} */ // ✅ Explicitly define type
const config = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': ts,
      prettier,
    },
    rules: {
      ...ts.configs.recommended.rules, // ✅ Ensures TypeScript rules load correctly
      'prettier/prettier': ['error', prettierConfig], // ✅ Apply Prettier formatting rules
      '@typescript-eslint/no-explicit-any': 'off', // ✅ Disable for the whole project
      '@typescript-eslint/no-unused-vars': 'off', // ✅ Disable for the whole project
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'coverage/', '**/*.min.js', '**/vendor/**'],
  },
];

export default config; // ✅ Explicitly export the properly typed config
