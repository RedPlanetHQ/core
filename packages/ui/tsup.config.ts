import { defineConfig } from 'tsup';

export default defineConfig([
  {
    name: 'tui',
    entry: { 'tui/index': './src/tui/index.ts' },
    outDir: './dist',
    platform: 'node',
    format: ['esm'],
    legacyOutput: false,
    sourcemap: true,
    clean: false,
    bundle: true,
    splitting: false,
    dts: true,
    treeshake: { preset: 'recommended' },
    external: ['@mariozechner/pi-tui', 'chalk'],
  },
  {
    name: 'web',
    entry: { 'web/index': './src/web/index.ts' },
    outDir: './dist',
    platform: 'browser',
    format: ['cjs', 'esm'],
    legacyOutput: false,
    sourcemap: true,
    clean: false,
    bundle: true,
    splitting: false,
    dts: true,
    treeshake: { preset: 'recommended' },
    external: ['react', 'react/jsx-runtime'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
]);
