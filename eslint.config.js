import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

const shared = 'src/shared runs unchanged on client and server and must stay deterministic.';

export default ts.config(
  {
    ignores: [
      'dist/**',
      'dist-server/**',
      'node_modules/**',
      'coverage/**',
      '.artifacts/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Architectural boundary: shared game logic is renderer-free, platform-free and deterministic.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^three(/|$)', message: `${shared} Keep Three.js in src/client.` },
            {
              regex: '(^|/)(client|server)(/|$)',
              message: `${shared} It cannot import client or server code.`,
            },
            {
              regex: '^(node:|ws$|fs$|path$|crypto$|http$|os$|sqlite$)',
              message: `${shared} Node built-ins are unavailable in the browser.`,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'performance',
          'requestAnimationFrame',
          'setTimeout',
          'setInterval',
          'fetch',
          'WebSocket',
          'process',
        ].map((name) => ({
          name,
          message: `${shared} ${name} is platform-bound or non-deterministic.`,
        })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: `${shared} Use the seeded random() in shared/math.`,
        },
        { object: 'Date', property: 'now', message: `${shared} Time comes from state.time.` },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: `${shared} Time comes from state.time.`,
        },
      ],
    },
  },
  {
    // Browser contexts come from tests/e2e/fixtures.ts, which monitors errors and refuses
    // pointer lock on Windows (Chromium's ClipCursor would trap the real mouse).
    files: ['tests/e2e/**/*.ts'],
    ignores: ['tests/e2e/fixtures.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['newContext', 'newPage'].map((property) => ({
          object: 'browser',
          property,
          message: 'Use the context/page or newContext fixtures from tests/e2e/fixtures.ts.',
        })),
      ],
    },
  },
  {
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^three(/|$)|(^|/)client(/|$)',
              message: 'The world server must not depend on the client or Three.js.',
            },
          ],
        },
      ],
    },
  },
);
