import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'frontend',
  entry: { frontend: './src/frontend/index.ts' },
  outDir: './dist',
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  bundle: true,
  splitting: false,
  dts: false,
  tsconfig: './tsconfig.widgets.json',
  treeshake: { preset: 'recommended' },
  external: ['react', 'react/jsx-runtime', '@redplanethq/ui/web'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
