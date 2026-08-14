/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ESLint } from 'eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Privileged code paths require a clean lint result; no debt baseline is accepted. */
const TARGETS = [
	'scripts/assurance/**/*.{ts,tsx,mts,cts}',
	'src/vs/platform/prebaseDesktop/**/*.{ts,tsx,mts,cts}',
	'extensions/prebase-magnus/src/**/*.{ts,tsx,mts,cts}',
	// Workbench adapters that authorize/forward Agent desktop and preview operations.
	'src/vs/workbench/contrib/prebase/common/runtime/desktopStopForMagnus.ts',
	'src/vs/workbench/contrib/prebase/common/runtime/evidenceBuffer.ts',
	'src/vs/workbench/contrib/prebase/common/runtime/permissionClassifier.ts',
	'src/vs/workbench/contrib/prebase/common/runtime/runtimeResponseReader.ts',
	'src/vs/workbench/contrib/prebase/common/runtime/runtimeWebviewProtocol.ts',
	'src/vs/workbench/contrib/prebase/browser/prebaseDesktopRuntimeService.ts',
	'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeService.ts',
	'src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts',
	'src/vs/workbench/contrib/prebase/browser/prebaseAccountService.ts',
	'src/vs/workbench/contrib/prebase/browser/prebaseStartupAuthContribution.ts',
	'src/vs/workbench/contrib/prebase/browser/cloud/prebaseSupabaseAuthClient.ts',
	'src/vs/workbench/contrib/prebase/common/auth/prebaseOAuth.ts',
	'src/vs/workbench/contrib/prebase/common/auth/prebaseStartupAuth.ts',
];

async function main(): Promise<void> {
	console.log('verify:eslint-prebase-security: strict lint for privileged PreBase code; no baseline is used.');
	console.log(`  targets (${TARGETS.length}):`);
	for (const target of TARGETS) {
		console.log(`    - ${target}`);
	}

	const linter = new ESLint({
		cwd: REPO_ROOT,
		cache: true,
		cacheLocation: path.join(REPO_ROOT, '.eslintcache-prebase-security'),
		cacheStrategy: 'content',
		errorOnUnmatchedPattern: false,
	});
	const results = await linter.lintFiles(TARGETS);
	if (results.length === 0) {
		throw new Error('verify:eslint-prebase-security: linted 0 files — refusing a silent pass.');
	}

	const errorCount = results.reduce((count, result) => count + result.errorCount, 0);
	const warningCount = results.reduce((count, result) => count + result.warningCount, 0);
	if (errorCount > 0 || warningCount > 0) {
		const formatter = await linter.loadFormatter('stylish');
		console.error(formatter.format(results));
		throw new Error(`verify:eslint-prebase-security: strict lint failed (files=${results.length} errors=${errorCount} warnings=${warningCount}).`);
	}

	console.log(`verify:eslint-prebase-security: PASS (files=${results.length}, errors=0, warnings=0).`);
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
