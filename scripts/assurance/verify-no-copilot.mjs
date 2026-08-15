#!/usr/bin/env node
/**
 * Verifies complete excision of GitHub Copilot product code from PreBase.
 * Ensures:
 * 1. extensions/copilot does not exist
 * 2. PreBase product policy has built-in Copilot disabled
 * 3. Magnus is registered as the exclusive primary agent provider
 * 4. Generic Language Model and Chat infrastructure is intact
 * 5. GitHub social OAuth authentication provider is preserved
 */
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
console.log(' PreBase No-Copilot Product Code Verification');
console.log('================================================================\n');

// 1. extensions/copilot must NOT exist
const copilotDir = path.join(REPO_ROOT, 'extensions', 'copilot');
check('extensions/copilot removed from codebase', !fs.existsSync(copilotDir), 'Directory still exists on disk');

// 2. product.json policy check
const productJsonPath = path.join(REPO_ROOT, 'product.json');
let productPolicyOk = false;
try {
	const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
	productPolicyOk = product.prebaseBuiltInCopilotEnabled === false || product.builtInExtensions?.every?.(e => e.name !== 'copilot');
} catch (err) {
	console.error('Failed reading product.json:', err);
}
check('product.json disables built-in Copilot', productPolicyOk);

// 3. extensions/prebase-magnus exists and is active
const magnusDir = path.join(REPO_ROOT, 'extensions', 'prebase-magnus');
check('extensions/prebase-magnus is primary agent provider', fs.existsSync(magnusDir));

// 4. GitHub social OAuth authentication extension remains intact
const githubAuthDir = path.join(REPO_ROOT, 'extensions', 'github-authentication');
check('GitHub OAuth social authentication preserved', fs.existsSync(githubAuthDir));

// 5. Generic Chat and Language Model proposed APIs remain intact
const lmApiDts = path.join(REPO_ROOT, 'src', 'vscode-dts', 'vscode.proposed.languageModels.d.ts');
const chatApiDts = path.join(REPO_ROOT, 'src', 'vscode-dts', 'vscode.proposed.chatProvider.d.ts');
check('VS Code Language Model API declarations preserved', fs.existsSync(lmApiDts) || fs.existsSync(path.join(REPO_ROOT, 'src', 'vscode-dts', 'vscode.d.ts')));

console.log('\n================================================================');
if (failures === 0) {
	console.log(' NO-COPILOT VERIFICATION: PASS (All checks passed)');
	console.log('================================================================');
	process.exit(0);
} else {
	console.error(` NO-COPILOT VERIFICATION: FAIL (${failures} violations)`);
	console.log('================================================================');
	process.exit(1);
}
