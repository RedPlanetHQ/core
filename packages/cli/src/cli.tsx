#!/usr/bin/env node
import Pastel from 'pastel';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

// Get version from packages/cli/package.json, not workspace root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(join(__dirname, '..', 'package.json'));

const app = new Pastel({
	importMeta: import.meta,
	version: pkg.version,
	name: 'corebrain',
});

await app.run();
