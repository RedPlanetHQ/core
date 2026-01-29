import { Options, defineConfig as defineConfigTSUP } from 'tsup';

const options: Options = {
  name: 'hook-utils',
  config: 'tsconfig.json',
  entry: ['./src/cli.ts'],
  outDir: './dist',
  platform: 'node',
  format: ['esm'],
  legacyOutput: false,
  sourcemap: false,
  clean: true,
  bundle: true,
  splitting: false,
  dts: false,
  treeshake: {
    preset: 'recommended',
  },
};

export default defineConfigTSUP(options);
