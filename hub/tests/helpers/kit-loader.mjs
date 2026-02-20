/**
 * Register a Node.js module hook that resolves SvelteKit's $lib/ alias.
 * Usage: node --import=./tests/helpers/kit-loader.mjs --test tests/*.test.js
 */
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
register('./kit-hooks.mjs', pathToFileURL(__dirname + '/'));
