import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';

export default defineConfig({
	test: {
		environment: 'node',
	},
	resolve: {
		alias: {
			'@': resolve(__dirname, 'src'),
		},
	},
});
