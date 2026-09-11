/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Test-Writer Suite: Standalone Agents Window Dormancy Adversarial & Fail-Closed Tests
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

test('Adversarial Dormancy: isAgentsWindowEnabled fail-closed under all permutations', () => {
	const script = `
import assert from 'node:assert/strict';
import { isAgentsWindowEnabled } from ${JSON.stringify(join(repoRoot, 'src/vs/base/common/agentsWindow.ts'))};

// 1. Undefined and missing configurations (MUST FAIL CLOSED)
assert.strictEqual(isAgentsWindowEnabled(undefined, undefined), false, 'undefined config and undefined env must be false');
assert.strictEqual(isAgentsWindowEnabled(undefined, {}), false, 'undefined config and empty env must be false');
assert.strictEqual(isAgentsWindowEnabled({}, undefined), false, 'empty config and undefined env must be false');
assert.strictEqual(isAgentsWindowEnabled({}, {}), false, 'empty config and empty env must be false');
assert.strictEqual(isAgentsWindowEnabled({}, {}), false, 'empty object must be false');

// 2. Explicit false configurations (MUST FAIL CLOSED)
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, {}), false, 'config false and empty env must be false');
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, undefined), false, 'config false and undefined env must be false');

// 3. Falsy/disabled environment override values (MUST FAIL CLOSED)
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: "" }), false, "empty string env must be false");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: "0" }), false, "zero env must be false");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: "false" }), false, "false env must be false");
assert.strictEqual(isAgentsWindowEnabled(undefined, { PREBASE_ENABLE_AGENTS_WINDOW: "0" }), false, "undefined config with zero env must be false");
assert.strictEqual(isAgentsWindowEnabled(undefined, { PREBASE_ENABLE_AGENTS_WINDOW: "false" }), false, "undefined config with false env must be false");

// 4. Malformed/unexpected config properties (MUST FAIL CLOSED)
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: undefined }, {}), false, "undefined property must be false");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: null }, {}), false, "null property must be false");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: "true" }, {}), false, "string true must be false");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: 1 }, {}), false, "number 1 must be false");

// 5. Explicitly enabled via product.json config (ONLY allowed when exactly boolean true)
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: true }, {}), true, "config true must be true");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: true }, undefined), true, "config true with undefined env must be true");

// 6. Explicitly enabled via internal environment variable override
assert.strictEqual(isAgentsWindowEnabled(undefined, { PREBASE_ENABLE_AGENTS_WINDOW: "1" }), true, "env 1 must override undefined config");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: "1" }), true, "env 1 must override false config");
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: "true" }), true, "env true must override false config");
`;
	const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.strictEqual(child.status, 0, child.stderr || child.stdout);
});

test('Adversarial Dormancy: All 11 entry points strictly guarded by centralized helper', () => {
	// 1. Electron Main App CLI startup (--agents)
	const appTs = readFileSync(join(repoRoot, 'src/vs/code/electron-main/app.ts'), 'utf8');
	assert.match(appTs, /if\s*\(args\['agents'\]\s*&&\s*isAgentsWindowEnabled\(this\.productService\)\)/,
		'app.ts CLI --agents must require isAgentsWindowEnabled');
	assert.doesNotMatch(appTs, /this\.productService\.prebaseAgentsWindowEnabled\s*!==\s*false/,
		'app.ts must NOT use fail-open !== false check');

	// 2. WindowsMainService openAgentsWindow
	const windowsMainTs = readFileSync(join(repoRoot, 'src/vs/platform/windows/electron-main/windowsMainService.ts'), 'utf8');
	assert.match(windowsMainTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{[\s\S]*this\.logService\.info\('windowsManager#openAgentsWindow suppressed: Agents window is dormant'\);[\s\S]*return \[\];\s*\}/,
		'windowsMainService.openAgentsWindow must fail-closed via isAgentsWindowEnabled');
	assert.doesNotMatch(windowsMainTs, /product\.prebaseAgentsWindowEnabled\s*===?\s*false/,
		'windowsMainService must NOT use ad-hoc === false check');

	// 3. NativeHostMainService openAgentsWindow IPC
	const nativeHostTs = readFileSync(join(repoRoot, 'src/vs/platform/native/electron-main/nativeHostMainService.ts'), 'utf8');
	assert.match(nativeHostTs, /if\s*\(!isAgentsWindowEnabled\(this\.productService\)\)\s*\{[\s\S]*this\.logService\.info\('nativeHost#openAgentsWindow suppressed: Agents window is dormant'\);[\s\S]*return;\s*\}/,
		'nativeHostMainService.openAgentsWindow must fail-closed via isAgentsWindowEnabled');
	assert.doesNotMatch(nativeHostTs, /this\.productService\.prebaseAgentsWindowEnabled\s*===?\s*false/,
		'nativeHostMainService must NOT use ad-hoc === false check');

	// 4. LaunchMainService openAgentsWindow
	const launchTs = readFileSync(join(repoRoot, 'src/vs/platform/launch/electron-main/launchMainService.ts'), 'utf8');
	assert.match(launchTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{[\s\S]*this\.logService\.info\('launchMainService#start suppressed: Agents window is dormant'\);\s*\}\s*else\s*\{/,
		'launchMainService.openAgentsWindow must fail-closed via isAgentsWindowEnabled');
	assert.doesNotMatch(launchTs, /product\.prebaseAgentsWindowEnabled\s*===?\s*false/,
		'launchMainService must NOT use ad-hoc === false check');

	// 5. Welcome Banner
	const bannerTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsBanner.ts'), 'utf8');
	assert.match(bannerTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{\s*return false;\s*\}/,
		'canShowAgentsBanner must fail-closed via isAgentsWindowEnabled');
	assert.doesNotMatch(bannerTs, /product\.prebaseAgentsWindowEnabled\s*===?\s*false/,
		'agentSessionsBanner must NOT use ad-hoc === false check');

	// 6. Accessibility Help
	const helpTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/actions/chatAccessibilityHelp.ts'), 'utf8');
	assert.match(helpTs, /isAgentsWindowEnabled\(productService\)/,
		'chatAccessibilityHelp must check isAgentsWindowEnabled');

	// 7. Titlebar Action Contribution
	const actionsTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts'), 'utf8');
	assert.match(actionsTs, /const enabled = isAgentsWindowEnabled\(productService\);[\s\S]*if \(!enabled\) \{\s*return;\s*\}/,
		'OpenWorkspaceInAgentsContribution must evaluate isAgentsWindowEnabled');

	// 8. Renderer Action Execution (OpenWorkspaceInAgentsWindowAction)
	assert.match(actionsTs, /if \(!isAgentsWindowEnabled\(product\)\) \{\s*return;\s*\}/,
		'OpenWorkspaceInAgentsWindowAction.run must guard execution via isAgentsWindowEnabled');

	// 9. Renderer Action Execution (OpenAgentsWindowAction)
	assert.match(actionsTs, /class OpenAgentsWindowAction[\s\S]*if \(!isAgentsWindowEnabled\(product\)\) \{\s*return;\s*\}/,
		'OpenAgentsWindowAction.run must guard execution via isAgentsWindowEnabled');

	// 10. Handoff Tips Notification
	assert.match(actionsTs, /AgentsHandoffInputTipContribution[\s\S]*if \(!isAgentsWindowEnabled\(product\)\) \{[\s\S]*this\._notificationService\.deleteNotification/,
		'AgentsHandoffInputTipContribution must fail-closed via isAgentsWindowEnabled');

	// 11. ChatTipService
	const chatTipTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/chatTipService.ts'), 'utf8');
	assert.match(chatTipTs, /isAgentsWindowEnabled\(this\._productService\)/,
		'ChatTipService must check isAgentsWindowEnabled');
});
