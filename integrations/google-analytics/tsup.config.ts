import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'frontend',
  entry: { frontend: './src/frontend/index.ts' },
  outDir: './dist',
  format: ['esm'],
  platform: 'neutral',
  sourcemap: false,
  bundle: true,
  splitting: false,
  dts: false,
  treeshake: { preset: 'recommended' },
  external: ['react', 'react/jsx-runtime', '@redplanethq/sdk'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
