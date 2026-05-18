import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Use React 17+ automatic JSX runtime for test transforms. tsconfig.json
  // ships `"jsx": "preserve"` for Next.js (which uses `react-jsx` automatic
  // in its own pipeline), but esbuild's default for "preserve" emits the
  // classic `React.createElement(...)` runtime — which requires React in
  // scope at runtime. The biome `noUnusedImports` rule (error) strips
  // `import * as React from 'react'` when it sees only JSX usage, breaking
  // every component test with `ReferenceError: React is not defined`.
  // Configuring esbuild to use `automatic` matches Next.js's own runtime
  // (no React import needed; JSX emits `_jsx(...)` calls referencing
  // `react/jsx-runtime`) so biome's import-cleanup is correctly unblocked.
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    // Next 16 ships `next/server` as a CommonJS file (`next/server.js`) but
    // does NOT declare a `package.json#exports` entry for the bare specifier —
    // Next's build pipeline rewrites the import internally. Auth.js v5's
    // `next-auth/lib/env.js` imports `next/server` (no extension) and vitest's
    // strict ESM resolver rejects it. The alias steers the bare import to the
    // physical file so any Auth.js test (G_B-1 anti-enum, G_B-2 panel routes,
    // and every subsequent panel-route test) loads cleanly.
    alias: [{ find: /^next\/server$/, replacement: 'next/server.js' }],
  },
  test: {
    include: [
      'tests/**/*.spec.ts',
      'tests/**/*.spec.tsx',
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
    ],
    exclude: ['tests/e2e/**', 'node_modules', '.next'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    testTimeout: 10_000,
    server: {
      // Force next-auth + @auth/* + the libsql/drizzle pair through vite's
      // transform pipeline so the alias above intercepts their transitive
      // `next/server` import. Without this vitest externalises the deps via
      // Node's native ESM resolver, which rejects bare `next/server` (Next 16
      // ships no exports entry for it). Inlining keeps vite in the loop.
      deps: {
        inline: [
          'next-auth',
          '@auth/core',
          '@auth/drizzle-adapter',
          'drizzle-orm',
          '@libsql/client',
        ],
      },
    },
  },
});
