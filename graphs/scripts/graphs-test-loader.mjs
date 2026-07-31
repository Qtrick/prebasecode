import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Resolve graph unit-test imports that use .js suffix to on-disk .ts sources.
 */
export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith('.js') && !specifier.includes('node_modules')) {
		const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
		const tsPath = resolvePath(parent, specifier.replace(/\.js$/, '.ts'));
		if (existsSync(tsPath)) {
			return nextResolve(pathToFileURL(tsPath).href, context);
		}
	}
	return nextResolve(specifier, context);
}
