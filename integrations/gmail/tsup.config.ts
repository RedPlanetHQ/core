import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  outDir: 'bin',
  external: ['react', 'react-dom'],
  banner: {
    js: '#!/usr/bin/env node'
  }
}); 