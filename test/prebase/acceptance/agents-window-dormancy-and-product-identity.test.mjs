/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Test-Writer Suite: Standalone Agents Window Dormancy, Product Identity, and Quick Messaging
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

test('Product identity: Product is called "PreBase", not "PreBase Dev"', () => {
	const productJson = JSON.parse(readFileSync(join(repoRoot, 'product.json'), 'utf8'));
	assert.strictEqual(productJson.nameShort, 'PreBase', 'product.json nameShort must be PreBase');
	assert.strictEqual(productJson.nameLong, 'PreBase', 'product.json nameLong must be PreBase');

	const productTs = readFileSync(join(repoRoot, 'src/vs/platform/product/common/product.ts'), 'utf8');

	// In VSCODE_DEV environment, source launch must preserve PreBase without appending " Dev"
	assert.match(productTs, /nameShort:\s*product\.nameShort,/, 'product.ts must not append " Dev" to nameShort in dev mode');
	assert.match(productTs, /nameLong:\s*product\.nameLong,/, 'product.ts must not append " Dev" to nameLong in dev mode');
	assert.doesNotMatch(productTs, /nameShort:\s*`\${product\.nameShort} Dev`/, 'product.ts must not append Dev to nameShort');
	assert.doesNotMatch(productTs, /nameLong:\s*`\${product\.nameLong} Dev`/, 'product.ts must not append Dev to nameLong');

	// Fallback when product is empty must be "PreBase"
	assert.match(productTs, /nameShort:\s*'PreBase',/, 'Fallback nameShort must be PreBase');
	assert.match(productTs, /nameLong:\s*'PreBase',/, 'Fallback nameLong must be PreBase');
	assert.doesNotMatch(productTs, /nameShort:\s*'PreBase Dev'/, 'Fallback nameShort must not be PreBase Dev');

	// Windows startup script
	const codeBat = readFileSync(join(repoRoot, 'scripts/code.bat'), 'utf8');
	assert.match(codeBat, /title\s+PreBase\r?\n/, 'code.bat title must be PreBase, not PreBase Dev');
});

test('Agents Window Dormancy: product.json and IProductConfiguration gate is disabled by default', () => {
	const productJson = JSON.parse(readFileSync(join(repoRoot, 'product.json'), 'utf8'));
	assert.strictEqual(productJson.prebaseAgentsWindowEnabled, false, 'prebaseAgentsWindowEnabled must be false by default in product.json');

	const productBaseTs = readFileSync(join(repoRoot, 'src/vs/base/common/product.ts'), 'utf8');
	assert.match(productBaseTs, /readonly\s+prebaseAgentsWindowEnabled\?:\s*boolean;/, 'IProductConfiguration must declare prebaseAgentsWindowEnabled');
});

test('Agents Window Dormancy: Welcome page agents banner is suppressed', () => {
	const bannerTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsBanner.ts'), 'utf8');
	assert.match(bannerTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{\s*return false;\s*\}/, 'canShowAgentsBanner must return false when isAgentsWindowEnabled(product) is false');
});

test('Agents Window Dormancy: Precondition context key and commands are gated', () => {
	const constantsTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/common/constants.ts'), 'utf8');
	assert.match(constantsTs, /export\s+const\s+CONTEXT_AGENTS_WINDOW_ENABLED\s*=\s*new\s+RawContextKey<boolean>\('isAgentsWindowEnabled',\s*false\);/, 'CONTEXT_AGENTS_WINDOW_ENABLED must be defined and default to false');
	assert.match(constantsTs, /export\s+const\s+OPEN_AGENTS_WINDOW_PRECONDITION\s*=\s*ContextKeyExpr\.and\(\s*CONTEXT_AGENTS_WINDOW_ENABLED,/, 'OPEN_AGENTS_WINDOW_PRECONDITION must require CONTEXT_AGENTS_WINDOW_ENABLED');

	const actionsTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts'), 'utf8');

	// Actions must not appear in Command Palette (F1) when dormant
	assert.match(actionsTs, /f1:\s*false,/, 'OpenWorkspaceInAgentsWindowAction and OpenAgentsWindowAction must hide from F1 palette when dormant');

	// Keybinding Cmd+Shift+A must require CONTEXT_AGENTS_WINDOW_ENABLED
	assert.match(actionsTs, /when:\s*ContextKeyExpr\.and\(\s*CONTEXT_AGENTS_WINDOW_ENABLED,\s*IsSessionsWindowContext\.toNegated\(\)/, 'Cmd+Shift+A keybinding must require CONTEXT_AGENTS_WINDOW_ENABLED');

	// Title bar contribution must not register widget when dormant
	assert.match(actionsTs, /if\s*\(!enabled\)\s*\{\s*return;\s*\}/, 'OpenWorkspaceInAgentsContribution must return early when dormant');

	// Actions must fail closed in run() if dormant via isAgentsWindowEnabled
	assert.match(actionsTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{\s*return;\s*\}/, 'Action run() methods must guard against dormant execution via isAgentsWindowEnabled');
});

test('Agents Window Dormancy: Main process suppresses windowsMainService.openAgentsWindow and CLI --agents', () => {
	const windowsMainTs = readFileSync(join(repoRoot, 'src/vs/platform/windows/electron-main/windowsMainService.ts'), 'utf8');
	assert.match(windowsMainTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{[\s\S]*openAgentsWindow suppressed: Agents window is dormant/, 'openAgentsWindow must be suppressed when dormant via isAgentsWindowEnabled');

	const appTs = readFileSync(join(repoRoot, 'src/vs/code/electron-main/app.ts'), 'utf8');
	assert.match(appTs, /if\s*\(args\['agents'\]\s*&&\s*isAgentsWindowEnabled\(this\.productService\)\)/, 'CLI --agents must fail-closed via isAgentsWindowEnabled');
});

test('Quick messaging & session integrity: followUp validates session identity before dispatch', () => {
	const sessionTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts'), 'utf8');

	// Model retrieval and sessionId mismatch check must occur BEFORE followUp dispatch
	const getSessionIdx = sessionTs.indexOf('const model = deps.chatService.getSession(sessionResource);');
	const sessionCheckIdx = sessionTs.indexOf('command failed closed: session mismatch');
	const followUpIdx = sessionTs.indexOf("if (command.kind === 'followUp')");
	const sendRequestIdx = sessionTs.indexOf('deps.chatService.sendRequest(sessionResource, text');

	assert.ok(getSessionIdx > 0, 'getSession must be called');
	assert.ok(sessionCheckIdx > getSessionIdx, 'session mismatch check must occur after getSession');
	assert.ok(followUpIdx > sessionCheckIdx, 'followUp dispatch must be guarded by session mismatch check');
	assert.ok(sendRequestIdx > followUpIdx, 'sendRequest must be called within followUp dispatch');
});

test('Notch minimized/background interaction: hover and click expansion enabled regardless of backgrounded state', () => {
	const liveActivityMm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Ensure backgrounded suppression was eliminated from pointerInside, hoverTimer, and expandPeek
	assert.doesNotMatch(liveActivityMm, /if\s*\(\[self\.environmentState\s*isEqualToString:@"backgrounded"\]\s*&&\s*!self\.content\.attention\)\s*\{\s*return;\s*\}/, 'live_activity.mm must not suppress hover when backgrounded');

	// Ensure compact click triggers enterInteractiveSticky
	assert.match(liveActivityMm, /if\s*\(self\.peekOnly\s*\|\|\s*self\.controller\.attentionPeek\s*\|\|\s*!self\.expanded\)\s*\{\s*\[self\.controller\s+enterInteractiveSticky\];\s*return;\s*\}/, 'Click on compact notch must enter interactive sticky');
});

test('Agents Window Dormancy: chatAccessibilityHelp suppresses agent window actions when dormant', () => {
	const helpTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/actions/chatAccessibilityHelp.ts'), 'utf8');
	assert.match(helpTs, /isAgentsWindowEnabled\(productService\)/, 'chatAccessibilityHelp must check isAgentsWindowEnabled(productService)');
	assert.match(helpTs, /if\s*\(isAgentsWindowEnabled\)\s*\{[\s\S]*focusAgentSessionsViewer[\s\S]*openAgentsWindow[\s\S]*openAgentHostFolderPicker/, 'agent window announcements must be enclosed in isAgentsWindowEnabled check');
});

test('Agents Window Dormancy: Centralized isAgentsWindowEnabled capability behavior', () => {
	const capabilityTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/common/agentsWindowCapability.ts'), 'utf8');
	assert.match(capabilityTs, /export\s+(?:function|\{)\s*isAgentsWindowEnabled/, 'isAgentsWindowEnabled must be exported from agentsWindowCapability.ts');

	const productTs = readFileSync(join(repoRoot, 'src/vs/base/common/product.ts'), 'utf8');
	assert.match(productTs, /export\s+(?:function|\{)\s*isAgentsWindowEnabled/, 'isAgentsWindowEnabled must be exported from base/common/product.ts');

	// Run behavior test via strip-types child
	const script = `
import assert from 'node:assert/strict';
import { isAgentsWindowEnabled } from ${JSON.stringify(join(repoRoot, 'src/vs/base/common/agentsWindow.ts'))};

// Default product config (dormant)
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, {}), false, 'Default dormant config must return false');
assert.strictEqual(isAgentsWindowEnabled({}, {}), false, 'Empty config with no env must return false');
assert.strictEqual(isAgentsWindowEnabled(undefined, {}), false, 'Undefined config must return false');

// Internal override enabled
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: false }, { PREBASE_ENABLE_AGENTS_WINDOW: '1' }), true, 'Env override must enable capability');
assert.strictEqual(isAgentsWindowEnabled({ prebaseAgentsWindowEnabled: true }, {}), true, 'Product config true must enable capability');
`;
	const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.strictEqual(child.status, 0, child.stderr || child.stdout);
});

test('Agents Window Dormancy: Tips and handoff messaging completely suppressed', () => {
	const actionsTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/electron-browser/agentSessions/agentSessionsActions.ts'), 'utf8');
	assert.match(actionsTs, /AgentsHandoffInputTipContribution[\s\S]*if\s*\(!isAgentsWindowEnabled\(product\)/, 'AgentsHandoffInputTipContribution must gate on isAgentsWindowEnabled');
	assert.match(actionsTs, /this\._notificationService\.deleteNotification\(AgentsHandoffInputTipContribution\.NOTIFICATION_ID\);/, 'Dormant state must delete any lingering notification');

	const chatTipTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/chatTipService.ts'), 'utf8');
	assert.match(chatTipTs, /isAgentsWindowEnabled\(this\._productService\)/, 'ChatTipService must check isAgentsWindowEnabled');
});

test('Agents Window Dormancy: NativeHostMainService suppresses openAgentsWindow', () => {
	const nativeHostTs = readFileSync(join(repoRoot, 'src/vs/platform/native/electron-main/nativeHostMainService.ts'), 'utf8');
	assert.match(nativeHostTs, /openAgentsWindow\(windowId: number \| undefined[\s\S]*if \(!isAgentsWindowEnabled\(this\.productService\)\)\s*\{\s*this\.logService\.info\('nativeHost#openAgentsWindow suppressed: Agents window is dormant'\);/,
		'nativeHostMainService must suppress openAgentsWindow when dormant via isAgentsWindowEnabled');
});

test('Product identity: Runtime Preview terminal uses canonical PreBase Server name', () => {
	const runtimeServiceTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeService.ts'), 'utf8');
	assert.doesNotMatch(runtimeServiceTs, /"PreBase Dev Server"/, 'prebaseRuntimeService must not name terminal "PreBase Dev Server"');
	assert.match(runtimeServiceTs, /"PreBase Server"/, 'prebaseRuntimeService must name terminal "PreBase Server"');
});


