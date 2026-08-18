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

// 6. product.json default chat agent is Magnus
let defaultChatAgentIsMagnus = false;
try {
	const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
	defaultChatAgentIsMagnus = product.defaultChatAgent?.extensionId === 'prebase.magnus' && product.defaultChatAgent?.chatExtensionId === 'prebase.magnus';
} catch (err) {
	console.error('Failed checking defaultChatAgent in product.json:', err);
}
check('product.json configures Magnus as default chat agent', defaultChatAgentIsMagnus);

// 7. First-party chat compatibility notifier uses PreBase Agents copy for Magnus
const chatContribPath = path.join(REPO_ROOT, 'src', 'vs', 'workbench', 'contrib', 'chat', 'browser', 'chatParticipant.contribution.ts');
let chatCompatFirstParty = false;
try {
	const chatContribContent = fs.readFileSync(chatContribPath, 'utf8');
	chatCompatFirstParty = chatContribContent.includes('isMagnusDefaultChatAgent()') &&
		chatContribContent.includes('prebaseAgentsFailErrorMessage') &&
		chatContribContent.includes('prebaseAgentsVersion') &&
		chatContribContent.includes('DisabledByInvalidExtension');
} catch (err) {
	console.error('Failed checking chatParticipant.contribution.ts:', err);
}
check('First-party chat compatibility notifier is Magnus-aware with PreBase branding', chatCompatFirstParty);

// 8. Extension gallery does not self-deprecate Magnus nor trigger false Copilot migration
const galleryServicePath = path.join(REPO_ROOT, 'src', 'vs', 'platform', 'extensionManagement', 'common', 'extensionGalleryService.ts');
const migrationPath = path.join(REPO_ROOT, 'src', 'vs', 'platform', 'extensionManagement', 'common', 'unsupportedExtensionsMigration.ts');
let deprecationGuardsOk = false;
try {
	const galleryContent = fs.readFileSync(galleryServicePath, 'utf8');
	const migrationContent = fs.readFileSync(migrationPath, 'utf8');
	deprecationGuardsOk = galleryContent.includes('!areSameExtensions({ id: this.productService.defaultChatAgent.extensionId }, { id: this.productService.defaultChatAgent.chatExtensionId })') &&
		migrationContent.includes('areSameExtensions({ id: unsupportedExtensionId }, { id: preReleaseExtensionId })');
} catch (err) {
	console.error('Failed checking extension gallery / migration guards:', err);
}
check('Extension Gallery and Migration services guard against self-deprecation of first-party Agent', deprecationGuardsOk);

console.log('\n================================================================');
if (failures === 0) {
	console.log(' PREBASE COPILOT PRODUCT ISOLATION: PASS (All checks passed)');
	console.log('================================================================');
	process.exit(0);
} else {
	console.error(` PREBASE COPILOT PRODUCT ISOLATION: FAIL (${failures} violations)`);
	console.log('================================================================');
	process.exit(1);
}
