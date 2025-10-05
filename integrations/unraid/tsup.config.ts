import { defineConfig } from 'tsup';
import { dependencies } from './package.json';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  bundle: true,
  target: 'node16',
  outDir: 'bin',
  splitting: false,
  shims: true,
  clean: true,
  name: 'unraid',
  platform: 'node',
  legacyOutput: false,
  noExternal: Object.keys(dependencies || {}),
  treeshake: {
    preset: 'recommended',
  },
});
