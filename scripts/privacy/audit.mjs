#!/usr/bin/env node
/**
 * Static PreBase privacy audit: product telemetry flags, forbidden endpoints,
 * secret-storage patterns, and webview CSP presence for graph/runtime editors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const warnings = [];

function fail(msg) {
	failures.push(msg);
}

function warn(msg) {
	warnings.push(msg);
}

function read(rel) {
	return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function auditProductJson() {
	const rel = 'product.json';
	const text = read(rel);
	let product;
	try {
		product = JSON.parse(text);
	} catch (e) {
		fail(`product.json: invalid JSON (${e.message})`);
		return;
	}

	if (product.enableTelemetry !== false) {
		fail(`product.json: enableTelemetry must be false (got ${JSON.stringify(product.enableTelemetry)})`);
	}

	const forbiddenKeys = [
		'telemetryEndpoint',
		'aiConfig',
		'crashReporter',
		'crashReporterId',
		'npsSurveyUrl',
		'surveyUrl',
	];
	function isActiveForbiddenValue(value) {
		if (value === undefined || value === null || value === '') {
			return false;
		}
		if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
			return false;
		}
		return true;
	}

	for (const key of forbiddenKeys) {
		if (key in product && isActiveForbiddenValue(product[key])) {
			fail(`product.json: active forbidden key "${key}"`);
		}
	}

	const forbiddenUrlPatterns = [
		/vortex\.data\.microsoft\.com/i,
		/applicationinsights/i,
		/\.aria\.microsoft\.com/i,
		/onecollector\.azure/i,
		/visualstudio\.com\/vortex/i,
		/crash\.reports/i,
		/nps\.survey/i,
	];

	const urlInventory = [];
	function walkStrings(value, jsonPath) {
		if (typeof value === 'string') {
			urlInventory.push({ jsonPath, value });
			for (const re of forbiddenUrlPatterns) {
				if (re.test(value)) {
					fail(`product.json ${jsonPath}: matches forbidden telemetry/crash pattern ${re}`);
				}
			}
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((v, i) => walkStrings(v, `${jsonPath}[${i}]`));
			return;
		}
		if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value)) {
				walkStrings(v, jsonPath ? `${jsonPath}.${k}` : k);
			}
		}
	}
	walkStrings(product, '');

	console.log(`privacy: product.json strings scanned: ${urlInventory.length}`);
	console.log('privacy: enableTelemetry=false OK');
}

function auditSecretStorage() {
	const accountPath = 'src/vs/workbench/contrib/prebase/browser/prebaseAccountService.ts';
	const account = read(accountPath);
	if (!account.includes('ISecretStorageService')) {
		fail(`${accountPath}: expected ISecretStorageService for account tokens`);
	}
	const badAccountPatterns = [
		/localStorage\.setItem\s*\([^)]*token/i,
		/globalStorage\.(set|update)[^;]*accessToken/i,
	];
	for (const re of badAccountPatterns) {
		if (re.test(account)) {
			fail(`${accountPath}: possible plaintext token storage (${re})`);
		}
	}

	const magnusPath = 'extensions/prebase-magnus/src/secretStorage.ts';
	const magnus = read(magnusPath);
	if (!magnus.includes('vscode.SecretStorage') && !magnus.includes('secrets.store')) {
		fail(`${magnusPath}: expected VS Code SecretStorage API`);
	}
	if (/localStorage|writeFileSync|settings\.json.*apiKey/i.test(magnus)) {
		fail(`${magnusPath}: possible plaintext credential persistence`);
	}
	console.log('privacy: account + Magnus secret storage patterns OK');
}

function auditWebviewCsp() {
	const checks = [
		{
			file: 'graphs/src/host/workbench/graphEditor.ts',
			required: /Content-Security-Policy.*default-src 'none'/,
		},
		{
			file: 'src/vs/workbench/contrib/prebase/browser/runtimeEditor.ts',
			required: /Content-Security-Policy.*default-src 'none'/,
		},
	];
	for (const { file, required } of checks) {
		const text = read(file);
		if (!required.test(text)) {
			fail(`${file}: missing strict webview CSP meta (default-src 'none')`);
		}
	}
	const onboarding = 'src/vs/workbench/contrib/prebase/browser/prebaseOnboardingEditor.ts';
	if (read(onboarding).includes('Content-Security-Policy')) {
		warn(`${onboarding}: onboarding uses workbench DOM; CSP meta not required`);
	}
	console.log('privacy: graph + runtime webview CSP static checks OK');
}

function auditRuntimeNetworkObservation() {
	warn(
		'Runtime network observation (no unexpected telemetry uploads) requires GUI launch — see docs/ASSURANCE.md#runtime-network-observation (Needs Verification).'
	);
}

console.log('privacy: static audit starting…');
auditProductJson();
auditSecretStorage();
auditWebviewCsp();
auditRuntimeNetworkObservation();

for (const w of warnings) {
	console.warn(`privacy: WARNING ${w}`);
}

if (failures.length > 0) {
	console.error('privacy: FAIL');
	for (const f of failures) {
		console.error(`  - ${f}`);
	}
	process.exit(1);
}

console.log(`privacy: PASS (${warnings.length} warning(s))`);
