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
const PREBASE_ONBOARDING_GUARD_FILES = [
	'src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts',
	'out/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.js',
];
const PREBASE_COPILOT_STATUS_GUARD_FILES = [
	'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts',
	'out/vs/workbench/contrib/chat/browser/chat.shared.contribution.js',
];

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
	if (relative.includes('prebaseStartupAuthContribution') && (!contents.includes('Continue with GitHub') || !contents.includes('Continue with Google') || !contents.includes('prebase-logo.png') || !contents.includes('github.svg') || !contents.includes('google.svg') || !contents.includes('monaco-workbench') || !contents.includes('backdropFilter') || !contents.includes('AUTH_OVERLAY_CLOSE_DURATION'))) {
		throw new Error(`verify:prebase-auth-ui: required themed PreBase auth surface missing from ${relative}`);
	}
}

for (const relative of PREBASE_ONBOARDING_GUARD_FILES) {
	const file = path.join(ROOT, relative);
	if (!fs.existsSync(file)) {
		throw new Error(`verify:prebase-auth-ui: missing required onboarding artifact ${relative}`);
	}
	const contents = fs.readFileSync(file, 'utf8');
	if (!/extensionId\s*===\s*['\"]prebase\.magnus['\"]/.test(contents) || !/chatExtensionId\s*===\s*['\"]prebase\.magnus['\"]/.test(contents)) {
		throw new Error(`verify:prebase-auth-ui: stable PreBase Magnus onboarding guard missing from ${relative}`);
	}
	if (/nameShort\s*===\s*['\"]PreBase['\"]/.test(contents)) {
		throw new Error(`verify:prebase-auth-ui: release-only PreBase onboarding guard found in ${relative}`);
	}
}

for (const relative of PREBASE_COPILOT_STATUS_GUARD_FILES) {
	const file = path.join(ROOT, relative);
	if (!fs.existsSync(file)) {
		throw new Error(`verify:prebase-auth-ui: missing required Copilot status artifact ${relative}`);
	}
	const contents = fs.readFileSync(file, 'utf8');
	if (!/if\s*\(isCopilotStatusBarEntryEnabled\(product\.defaultChatAgent\)\)/.test(contents)) {
		throw new Error(`verify:prebase-auth-ui: PreBase Copilot status registration guard missing from ${relative}`);
	}
}

console.log(`verify:prebase-auth-ui: PASS (${ACTIVE_AUTH_FILES.length} auth, ${PREBASE_ONBOARDING_GUARD_FILES.length} onboarding, and ${PREBASE_COPILOT_STATUS_GUARD_FILES.length} Copilot status source/output files)`);
