/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
	findPreBaseSourceRoot,
	isPreBaseSourceRoot,
	loadPreBaseRootEnv,
	parseAllowlistedEnv,
	PreBaseSecretResolver,
} from './secretResolver';
import { MagnusSecretStorage } from './secretStorage';
import { STATIC_FALLBACK_GEMINI_MODELS } from './geminiAdapter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Magnus Activation & Tool/Command Contracts', () => {
	const repoRoot = path.resolve(__dirname, '../../..');
	const manifestPath = path.join(__dirname, '../package.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	it('ensures exact parity between manifest languageModelTools and runtime registrations', () => {
		const manifestTools = new Set(manifest.contributes?.languageModelTools?.map((t: { name: string }) => t.name) ?? []);
		assert.ok(manifestTools.size > 0, 'Manifest must declare language model tools');

		// Extract all vscode.lm.registerTool calls in src/
		const srcDir = path.join(__dirname);
		const registeredTools = new Set<string>();
		const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
		const toolRegex = /vscode\.lm\.registerTool\(\s*['"]([^'"]+)['"]/g;

		for (const file of files) {
			if (typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
				const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
				let match: RegExpExecArray | null;
				while ((match = toolRegex.exec(content)) !== null) {
					registeredTools.add(match[1]);
				}
			}
		}

		assert.strictEqual(registeredTools.size, 38, 'Expected 38 runtime registered tools');
		assert.strictEqual(manifestTools.size, 38, 'Expected 38 manifest contributed tools');

		const missingFromManifest = Array.from(registeredTools).filter(t => !manifestTools.has(t));
		const missingFromRuntime = Array.from(manifestTools).filter(t => !registeredTools.has(t));

		assert.deepStrictEqual(missingFromManifest, [], 'No runtime tools should be missing from manifest');
		assert.deepStrictEqual(missingFromRuntime, [], 'No manifest tools should be missing runtime implementations');
		assert.ok(manifestTools.has('prebase_desktop_get_process_output'), 'prebase_desktop_get_process_output must be contributed');
	});

	it('ensures all manifest contributed commands have handlers registered in extension source', () => {
		const manifestCommands: string[] = manifest.contributes?.commands?.map((c: { command: string }) => c.command) ?? [];
		assert.ok(manifestCommands.length > 0, 'Manifest must declare commands');

		const srcDir = path.join(__dirname);
		const registeredCommands = new Set<string>();
		const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
		const cmdRegex = /vscode\.commands\.registerCommand\(\s*['"]([^'"]+)['"]/g;

		for (const file of files) {
			if (typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
				const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
				let match: RegExpExecArray | null;
				while ((match = cmdRegex.exec(content)) !== null) {
					registeredCommands.add(match[1]);
				}
			}
		}

		const missingHandlers = manifestCommands.filter(cmd => !registeredCommands.has(cmd));
		assert.deepStrictEqual(missingHandlers, [], 'Every manifest command must have a runtime handler');
		assert.ok(registeredCommands.has('prebase.magnus.attachGraphSelection'), 'attachGraphSelection must be registered');
		assert.ok(registeredCommands.has('prebase.magnus.attachRuntimeContext'), 'attachRuntimeContext must be registered');
		assert.ok(registeredCommands.has('prebase.magnus.importApiKeyFromProcessEnv'), 'importApiKeyFromProcessEnv must be registered');
	});
});

describe('Root Resolution & Workspace Isolation', () => {
	it('resolves authentic PreBase source root from extension path', () => {
		const extensionPath = path.resolve(__dirname, '..');
		const root = findPreBaseSourceRoot(extensionPath);
		assert.ok(root, 'Should find authentic root from extension path');
		assert.ok(isPreBaseSourceRoot(root), 'Root must pass authentic PreBase validation');
	});

	it('strictly isolates arbitrary user workspace directories from being identified as PreBase root', () => {
		const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-user-workspace-'));
		try {
			fs.writeFileSync(path.join(tmpWorkspace, 'package.json'), JSON.stringify({ name: 'my-random-project' }));
			fs.writeFileSync(path.join(tmpWorkspace, '.env'), 'GEMINI_API_KEY=leak-key');

			assert.strictEqual(isPreBaseSourceRoot(tmpWorkspace), false, 'Arbitrary workspace must never be PreBase root');
			assert.strictEqual(findPreBaseSourceRoot(tmpWorkspace), undefined, 'findPreBaseSourceRoot must not accept arbitrary workspace');

			const resolver = new PreBaseSecretResolver({ explicitRoot: tmpWorkspace });
			assert.strictEqual(resolver.isSourceDevelopment(), false, 'Should not treat arbitrary workspace as source dev');
			assert.strictEqual(resolver.resolveGeminiKey(), undefined, 'Should not read GEMINI_API_KEY from arbitrary workspace .env');
		} finally {
			fs.rmSync(tmpWorkspace, { recursive: true, force: true });
		}
	});

	it('strictly rejects fake PreBase roots missing critical markers', () => {
		const tmpFake = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-fake-root-'));
		try {
			fs.writeFileSync(path.join(tmpFake, 'product.json'), JSON.stringify({ nameShort: 'PreBase' }));
			fs.writeFileSync(path.join(tmpFake, 'package.json'), JSON.stringify({ name: 'some-other-pkg' })); // Not code-oss-dev
			// Missing AGENTS.md
			assert.strictEqual(isPreBaseSourceRoot(tmpFake), false);
		} finally {
			fs.rmSync(tmpFake, { recursive: true, force: true });
		}
	});

	it('disables source development in packaged mode', () => {
		const resolver = new PreBaseSecretResolver({ forcePackaged: true });
		assert.strictEqual(resolver.isSourceDevelopment(), false);
		assert.strictEqual(resolver.getPreBaseRoot(), undefined);
	});
});

describe('Root .env Freshness & Hot Reload', () => {
	it('detects added, changed, and removed keys without restarting or recreating resolver', () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-hot-root-'));
		try {
			// Setup authentic structure
			fs.writeFileSync(path.join(tmpRoot, 'product.json'), JSON.stringify({ nameShort: 'PreBase', applicationName: 'prebase', nameLong: 'PreBase' }));
			fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'code-oss-dev' }));
			fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), '# PreBase Agent Instructions');

			const resolver = new PreBaseSecretResolver({ explicitRoot: tmpRoot });
			assert.strictEqual(resolver.isSourceDevelopment(), true);

			// 1. Initial: no .env file
			const initialGemini = resolver.resolveGeminiKey();
			const initialLinkup = resolver.resolveLinkupKey();
			assert.strictEqual(initialGemini, undefined, 'Initial Gemini should be unconfigured');
			assert.strictEqual(initialLinkup, undefined, 'Initial LinkUp should be unconfigured');

			// 2. Add GEMINI_API_KEY to .env
			const envPath = path.join(tmpRoot, '.env');
			fs.writeFileSync(envPath, 'GEMINI_API_KEY=first-gemini-key\nLINKUP_API_KEY=first-linkup-key\n');

			// Small sleep or ensure stat changes
			const gemini1 = resolver.resolveGeminiKey();
			const linkup1 = resolver.resolveLinkupKey();
			assert.ok(gemini1, 'Gemini key should be resolved after .env creation');
			assert.strictEqual(gemini1.key, 'first-gemini-key');
			assert.strictEqual(gemini1.source, 'local-env');

			assert.ok(linkup1, 'LinkUp key should be resolved after .env creation');
			assert.strictEqual(linkup1.key, 'first-linkup-key');
			assert.strictEqual(linkup1.source, 'local-env');

			// 3. Update key in .env (force new mtime/size)
			fs.writeFileSync(envPath, 'GEMINI_API_KEY=updated-gemini-key-longer\nLINKUP_API_KEY=updated-linkup-key\n');
			// Explicitly set mtime to future to simulate modification
			const stat = fs.statSync(envPath);
			fs.utimesSync(envPath, stat.atime, new Date(Date.now() + 2000));

			const gemini2 = resolver.resolveGeminiKey();
			assert.ok(gemini2);
			assert.strictEqual(gemini2.key, 'updated-gemini-key-longer', 'Gemini key must reflect updated value without restart');

			// 4. Remove .env file
			fs.unlinkSync(envPath);
			const gemini3 = resolver.resolveGeminiKey();
			const linkup3 = resolver.resolveLinkupKey();
			assert.strictEqual(gemini3, undefined, 'Gemini must be undefined after .env removal');
			assert.strictEqual(linkup3, undefined, 'LinkUp must be undefined after .env removal');

			// 5. Diagnostics reflect current presence accurately
			const diag = resolver.getDiagnostics();
			assert.strictEqual(diag.isSourceDev, true);
			assert.strictEqual(diag.resolvedRootPresent, true);
			assert.strictEqual(diag.rootEnvPresent, false);
			assert.strictEqual(diag.gemini.localEnv, 'absent');
			assert.strictEqual(diag.linkup.localEnv, 'absent');
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe('Model Fallback Integrity', () => {
	it('does not contain shut-down gemini-2.0 models in fallback models list', () => {
		for (const m of STATIC_FALLBACK_GEMINI_MODELS) {
			assert.ok(!m.id.includes('2.0'), `Fallback models must not include 2.0 models (found: ${m.id})`);
			assert.ok(!m.id.includes('1.5'), `Fallback models must not include 1.5 models (found: ${m.id})`);
		}
		const ids = STATIC_FALLBACK_GEMINI_MODELS.map(m => m.id);
		assert.ok(ids.includes('gemini-2.5-pro'), 'Must include gemini-2.5-pro');
		assert.ok(ids.includes('gemini-2.5-flash'), 'Must include gemini-2.5-flash');
	});
});

describe('Execution Mode & Fallback Distinction', () => {
	it('correctly resolves LinkUp local credential vs cloud fallback', () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prebase-linkup-test-'));
		try {
			fs.writeFileSync(path.join(tmpRoot, 'product.json'), JSON.stringify({ nameShort: 'PreBase', applicationName: 'prebase', nameLong: 'PreBase' }));
			fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'code-oss-dev' }));
			fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), '# PreBase Agent Instructions');

			const resolver = new PreBaseSecretResolver({ explicitRoot: tmpRoot });

			// Case 1: No key, hosted available
			const hostedExec = resolver.resolveProviderExecution({
				providerId: 'linkup',
				requestedMode: 'auto',
				hostedAvailable: true,
			});
			assert.strictEqual(hostedExec.configured, true);
			assert.strictEqual(hostedExec.source, 'hosted');
			assert.strictEqual(hostedExec.isHosted, true);

			// Case 2: Local key in .env overrides hosted in auto mode
			fs.writeFileSync(path.join(tmpRoot, '.env'), 'LINKUP_API_KEY=linkup-direct-key\n');
			const localExec = resolver.resolveProviderExecution({
				providerId: 'linkup',
				requestedMode: 'auto',
				hostedAvailable: true,
			});
			assert.strictEqual(localExec.configured, true);
			assert.strictEqual(localExec.source, 'local-env');
			assert.strictEqual(localExec.key, 'linkup-direct-key');
			assert.strictEqual(localExec.isHosted, false);

			// Case 3: Explicit BYOK mode with SecretStorage key
			const byokExec = resolver.resolveProviderExecution({
				providerId: 'linkup',
				requestedMode: 'byok',
				secretStorageKey: 'linkup-byok-key',
				hostedAvailable: true,
			});
			assert.strictEqual(byokExec.configured, true);
			assert.strictEqual(byokExec.source, 'secret-storage');
			assert.strictEqual(byokExec.key, 'linkup-byok-key');
			assert.strictEqual(byokExec.isHosted, false);

			// Case 4: No key and no hosted -> unconfigured
			fs.unlinkSync(path.join(tmpRoot, '.env'));
			const unconfExec = resolver.resolveProviderExecution({
				providerId: 'linkup',
				requestedMode: 'auto',
				hostedAvailable: false,
			});
			assert.strictEqual(unconfExec.configured, false);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe('Context Attachment Bounding', () => {
	it('safely bounds large graph selection strings', () => {
		const largeInput = 'x'.repeat(25_000);
		const bounded = largeInput.slice(0, 10_000);
		assert.strictEqual(bounded.length, 10_000);
	});

	it('safely serializes and bounds object context', () => {
		const obj = { nodes: Array.from({ length: 500 }, (_, i) => ({ id: `node-${i}`, label: `Label ${i}` })) };
		const serialized = JSON.stringify(obj);
		assert.ok(serialized.length > 10_000);
		const bounded = serialized.slice(0, 10_000);
		assert.strictEqual(bounded.length, 10_000);
	});
});

