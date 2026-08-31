/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Resolves TypeScript module imports (both .js-suffixed and extensionless) to local .ts files
 * for Node --experimental-strip-types testing.
 */
export async function resolve(specifier, context, nextResolve) {
	if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
		return nextResolve(specifier, context);
	}

	const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();

	// 1. Direct .ts match if already ends in .ts
	if (specifier.endsWith('.ts')) {
		const directTs = resolvePath(parent, specifier);
		if (existsSync(directTs)) {
			return nextResolve(pathToFileURL(directTs).href, context);
		}
	}

	// 2. .js suffix -> .ts
	if (specifier.endsWith('.js')) {
		const tsPath = resolvePath(parent, specifier.replace(/\.js$/, '.ts'));
		if (existsSync(tsPath)) {
			return nextResolve(pathToFileURL(tsPath).href, context);
		}
	}

	// 3. Extensionless -> .ts or /index.ts
	const extlessTs = resolvePath(parent, specifier + '.ts');
	if (existsSync(extlessTs)) {
		return nextResolve(pathToFileURL(extlessTs).href, context);
	}
	const indexTs = resolvePath(parent, specifier, 'index.ts');
	if (existsSync(indexTs)) {
		return nextResolve(pathToFileURL(indexTs).href, context);
	}

	return nextResolve(specifier, context);
}
