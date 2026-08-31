#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

let failures = 0;

function check(desc, pass, details) {
	if (pass) {
		console.log(`  ✓ ${desc}`);
	} else {
		console.error(`  ✕ ${desc}${details ? `: ${details}` : ''}`);
		failures++;
	}
}

console.log('================================================================');
console.log(' PreBase File-Dialog Routing & Default Invariants Verification');
console.log('================================================================\n');

// 1. files.contribution.ts default must be false
const filesContribPath = path.join(REPO_ROOT, 'src/vs/workbench/contrib/files/browser/files.contribution.ts');
let filesContribOk = false;
try {
	const content = fs.readFileSync(filesContribPath, 'utf8');
	const match = /'files\.simpleDialog\.enable':\s*\{[\s\S]*?'default':\s*(false|true)/.exec(content);
	filesContribOk = match !== null && match[1] === 'false';
} catch (err) {
	console.error('Failed reading files.contribution.ts:', err);
}
check('files.simpleDialog.enable default is false in files.contribution.ts', filesContribOk);

// 2. product.json must not force simpleDialog
const productJsonPath = path.join(REPO_ROOT, 'product.json');
let productOk = true;
try {
	const content = fs.readFileSync(productJsonPath, 'utf8');
	if (content.includes('simpleDialog')) {
		const parsed = JSON.parse(content);
		productOk = parsed['files.simpleDialog.enable'] !== true;
	}
} catch (err) {
	console.error('Failed reading product.json:', err);
	productOk = false;
}
check('product.json does not force simpleDialog', productOk);

// 3. scripts/code.sh must not force simpleDialog
const codeShPath = path.join(REPO_ROOT, 'scripts/code.sh');
let codeShOk = false;
try {
	const content = fs.readFileSync(codeShPath, 'utf8');
	codeShOk = !content.includes('simpleDialog') && !content.includes('enableSmokeTestDriver');
} catch (err) {
	console.error('Failed reading scripts/code.sh:', err);
}
check('scripts/code.sh does not force simpleDialog or smoke test mode', codeShOk);

// 4. launch.sh must support --native-dialogs and isolate simpleDialog to automation
const launchShPath = path.join(REPO_ROOT, '.agents/skills/launch/scripts/launch.sh');
let launchShOk = false;
try {
	const content = fs.readFileSync(launchShPath, 'utf8');
	launchShOk = content.includes('--native-dialogs') && content.includes('files.simpleDialog.enable');
} catch (err) {
	console.error('Failed reading launch.sh:', err);
}
check('launch.sh isolates simpleDialog to automation and supports --native-dialogs', launchShOk);

console.log('\n================================================================');
if (failures === 0) {
	console.log(' PREBASE FILE-DIALOG ROUTING VERIFICATION: PASS (All checks passed)');
	console.log('================================================================');
	process.exit(0);
} else {
	console.error(` PREBASE FILE-DIALOG ROUTING VERIFICATION: FAIL (${failures} check(s) failed)`);
	console.log('================================================================');
	process.exit(1);
}
