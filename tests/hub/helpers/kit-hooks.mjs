/**
 * Node.js module hook: resolves SvelteKit's $lib/ alias to src/lib/ within the hub.
 * Walks up from the importing file's directory to find the hub root (package.json name=relaygent-hub).
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

function findHubRoot(fromDir) {
	let dir = fromDir;
	for (let i = 0; i < 15; i++) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
			if (pkg.name === 'relaygent-hub') return dir;
		} catch { /* keep walking */ }
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith('$lib/')) {
		const parentFile = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
		const hubRoot = findHubRoot(path.dirname(parentFile));
		if (hubRoot) {
			const resolved = path.join(hubRoot, 'src', 'lib', specifier.slice(5));
			return nextResolve(pathToFileURL(resolved).href, context);
		}
	}
	return nextResolve(specifier, context);
}
