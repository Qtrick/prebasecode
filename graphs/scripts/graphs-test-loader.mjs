import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

/**
 * Resolve graph unit-test imports that use .js suffix to on-disk .ts sources,
 * while mapping core VS Code imports (src/vs/) to compiled out/vs/ JavaScript.
 */
export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith('.js') && !specifier.includes('node_modules')) {
		const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
		let resolvedTarget = resolvePath(parent, specifier);

		// When files under graphs/ reference VS Code core using the symlink depth (../../../../../../),
		// map them directly to src/vs/
		if (specifier.startsWith('../../../../../../')) {
			const sub = specifier.replace(/^(\.\.\/)+/, '');
			resolvedTarget = resolvePath(process.cwd(), 'src/vs', sub);
		}

		// If importing from core VS Code (src/vs/) or host/workbench/, prefer compiled out/ JavaScript if present
		if (resolvedTarget.includes('/src/vs/')) {
			const outTarget = resolvedTarget.replace('/src/vs/', '/out/vs/');
			if (existsSync(outTarget)) {
				return nextResolve(pathToFileURL(outTarget).href, context);
			}
		}

		if (resolvedTarget.includes('/graphs/src/host/workbench/')) {
			const rel = resolvedTarget.slice(resolvedTarget.indexOf('/graphs/src/host/workbench/') + '/graphs/src/host/workbench/'.length);
			const outTarget = resolvePath(process.cwd(), 'out/vs/workbench/contrib/prebase/graphs/host/workbench', rel.replace(/\.ts$/, '.js'));
			if (existsSync(outTarget)) {
				return nextResolve(pathToFileURL(outTarget).href, context);
			}
		}

		const tsPath = resolvedTarget.replace(/\.js$/, '.ts');
		if (existsSync(tsPath)) {
			return nextResolve(pathToFileURL(tsPath).href, context);
		}
	}
	return nextResolve(specifier, context);
}
