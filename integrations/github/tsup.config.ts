import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'widgets',
  entry: { 'widgets/index': './src/widgets/index.ts' },
  outDir: './dist',
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  bundle: true,
  splitting: false,
  dts: false,
  tsconfig: './tsconfig.widgets.json',
  treeshake: { preset: 'recommended' },
  external: ['react', 'react/jsx-runtime', '@mariozechner/pi-tui', 'chalk', '@redplanethq/ui'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
