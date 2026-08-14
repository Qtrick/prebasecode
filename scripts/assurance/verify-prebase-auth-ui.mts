/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ACTIVE_AUTH_FILES = [
	'src/vs/workbench/contrib/prebase/browser/prebaseStartupAuthContribution.ts',
	'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts',
	'out/vs/workbench/contrib/prebase/browser/prebaseStartupAuthContribution.js',
	'out/vs/workbench/contrib/prebase/browser/prebase.contribution.js',
];
const BANNED = [/Apple/i, /GitHub Enterprise/i, /Copilot/i, /Visual Studio Code/i, /workbench\.action\.chat\.triggerSetup/, /prebase\.account\.signUp/, /password:\s*true/];

for (const relative of ACTIVE_AUTH_FILES) {
	const file = path.join(ROOT, relative);
	if (!fs.existsSync(file)) {
		throw new Error(`verify:prebase-auth-ui: missing required active artifact ${relative}`);
	}
	const contents = fs.readFileSync(file, 'utf8');
	for (const banned of BANNED) {
		if (banned.test(contents)) {
			throw new Error(`verify:prebase-auth-ui: banned public-auth surface ${banned} in ${relative}`);
		}
	}
	if (relative.includes('prebaseStartupAuthContribution') && (!contents.includes('Continue with GitHub') || !contents.includes('Continue with Google') || !contents.includes('prebase-logo.png'))) {
		throw new Error(`verify:prebase-auth-ui: required PreBase GitHub/Google/logo surface missing from ${relative}`);
	}
}

console.log(`verify:prebase-auth-ui: PASS (${ACTIVE_AUTH_FILES.length} active source/output files)`);
