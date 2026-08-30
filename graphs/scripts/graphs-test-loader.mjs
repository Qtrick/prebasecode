import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { existsSync, statSync } from 'node:fs';

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
		if (parent.includes('/out/vs/workbench/contrib/prebase/graphs/')) {
			if (specifier.startsWith('../../../../../../')) {
				const sub = specifier.replace(/^(\.\.\/)+/, '');
				return nextResolve(pathToFileURL(resolvePath(process.cwd(), 'out/vs', sub)).href, context);
			} else if (specifier.startsWith('../../../../../')) {
				const sub = specifier.replace(/^(\.\.\/)+/, '');
				return nextResolve(pathToFileURL(resolvePath(process.cwd(), 'out/vs/workbench', sub)).href, context);
			}
		}

		if (parent.includes('/graphs/src/')) {
			if (specifier.startsWith('../../../../../../')) {
				const sub = specifier.replace(/^(\.\.\/)+/, '');
				resolvedTarget = resolvePath(process.cwd(), 'src/vs', sub);
			} else if (specifier.startsWith('../../../../../')) {
				const sub = specifier.replace(/^(\.\.\/)+/, '');
				resolvedTarget = resolvePath(process.cwd(), 'src/vs/workbench', sub);
			} else if (parent.includes('/graphs/src/host/workbench') && specifier.startsWith('../../../')) {
				const sub = specifier.replace(/^(\.\.\/)+/, '');
				resolvedTarget = resolvePath(process.cwd(), 'src/vs/workbench/contrib/prebase', sub);
			}
		}

		// If importing from core VS Code (src/vs/), prefer compiled out/ JavaScript if present
		if (resolvedTarget.includes('/src/vs/')) {
			const outTarget = resolvedTarget.replace('/src/vs/', '/out/vs/');
			if (existsSync(outTarget)) {
				return nextResolve(pathToFileURL(outTarget).href, context);
			}
		}

		if (resolvedTarget.includes('/graphs/src/host/workbench/')) {
			const rel = resolvedTarget.slice(resolvedTarget.indexOf('/graphs/src/host/workbench/') + '/graphs/src/host/workbench/'.length);
			const tsPath = resolvePath(process.cwd(), 'graphs/src/host/workbench', rel.replace(/\.js$/, '.ts'));
			const outTarget = resolvePath(process.cwd(), 'out/vs/workbench/contrib/prebase/graphs/host/workbench', rel.replace(/\.ts$/, '.js'));
			if (existsSync(tsPath) && existsSync(outTarget)) {
				const preferTs = statSync(tsPath).mtimeMs >= statSync(outTarget).mtimeMs;
				return nextResolve(pathToFileURL(preferTs ? tsPath : outTarget).href, context);
			}
			if (existsSync(tsPath)) {
				return nextResolve(pathToFileURL(tsPath).href, context);
			}
			if (existsSync(outTarget)) {
				return nextResolve(pathToFileURL(outTarget).href, context);
			}
		}

		// For all graphs/ sources, prefer live TypeScript files on disk
		const tsPath = resolvedTarget.replace(/\.js$/, '.ts');
		if (existsSync(tsPath)) {
			return nextResolve(pathToFileURL(tsPath).href, context);
		}
	}
	return nextResolve(specifier, context);
}
