/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runInNewContext } from 'vm';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { DESKTOP_AUTOMATION_BOOTSTRAP } from '../../common/runtime/desktopAutomationDom.js';
import { assertDesktop, formatDesktopFailure, interactDesktop, retryDesktopDomCommand, type DesktopEvaluateFn } from '../../common/runtime/desktopAutomationHost.js';
import { describeLocator, locatorLooksSecret, maskFillValue, parseDesktopLocator, redactSecretText, validatePressKey } from '../../common/runtime/desktopLocators.js';
import { applyCapabilitiesTestingPermission, applyCargoTestingDependencies, applyRustTestingPlugins, applyTauriTestingTransaction, inspectTauriTestingSetup, previewTauriTestingSetup, tauriTestingCandidatePaths } from '../../common/runtime/tauriTestingSetup.js';
import { createDesktopTestRun, recordDesktopTestStep, summarizeDesktopTestRun } from '../../common/runtime/desktopTestModel.js';
import { cdpKeyParams, webDriverKeyActions, webDriverKeyValue } from '../../common/runtime/desktopNativeInput.js';
import { DesktopWebDriverClient, WEBDRIVER_DELETE_SESSION_TIMEOUT_MS, assertWebDriverSuccess, isWebDriverReadyStatus, webDriverBaseUrl, webDriverProtocolError } from '../../common/runtime/desktopWebDriver.js';
import { resolveDesktopShutdownPolicy } from '../../../../../platform/prebaseDesktop/common/processTermination.js';

function findRepoRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i++) {
		if (existsSync(join(dir, 'src/vs/workbench/contrib/prebase/common/runtime/desktopWebDriver.ts'))) {
			return dir;
		}
		dir = join(dir, '..');
	}
	throw new Error('Could not locate PreBase repository root from desktopAutomation tests.');
}

function collectTsFiles(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTsFiles(fullPath, files);
			continue;
		}
		if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			files.push(fullPath);
		}
	}
	return files;
}

suite('desktopLocators', () => {
	test('parses semantic locators and rejects deep nth-child CSS', () => {
		assert.deepStrictEqual(parseDesktopLocator({ by: 'role', role: 'button', name: 'Save' }), { by: 'role', role: 'button', name: 'Save', exact: false });
		assert.ok('error' in parseDesktopLocator({ by: 'css', value: 'div:nth-child(3) > div:nth-child(7) > span:nth-child(2) > button' }));
		assert.ok('error' in parseDesktopLocator({ by: 'css', value: `${'a,'.repeat(120)}a` }));
		assert.ok(locatorLooksSecret({ by: 'label', value: 'Password', exact: false }));
		assert.strictEqual(maskFillValue({ by: 'label', value: 'Password', exact: false }, 'hunter2'), '[redacted]');
		assert.strictEqual(describeLocator({ by: 'role', role: 'button', name: 'Sign In' }), 'role=button name=Sign In');
		assert.ok(validatePressKey('Control+Enter') === undefined);
		assert.ok(validatePressKey('LaunchNuke') !== undefined);
	});

	test('allows shallow CSS but rejects xpath and missing locator fields', () => {
		assert.deepStrictEqual(parseDesktopLocator({ by: 'css', value: 'div:nth-child(2) > button' }), { by: 'css', value: 'div:nth-child(2) > button' });
		assert.ok('error' in parseDesktopLocator({ by: 'css', value: 'xpath=//button' }));
		assert.ok('error' in parseDesktopLocator({ by: 'role' }));
		assert.ok('error' in parseDesktopLocator({ by: 'text', value: '   ' }));
		assert.deepStrictEqual(parseDesktopLocator({ by: 'testId', value: 'save-btn' }), { by: 'testId', value: 'save-btn' });
		assert.ok(validatePressKey('') !== undefined);
		assert.ok(validatePressKey('a'.repeat(41)) !== undefined);
	});

	test('redacts secrets in fill values and failure text without masking ordinary labels', () => {
		assert.strictEqual(maskFillValue({ by: 'label', value: 'Name', exact: false }, 'Ada'), 'Ada');
		assert.strictEqual(maskFillValue({ by: 'placeholder', value: 'API token', exact: false }, 'sk-live-secret'), '[redacted]');
		assert.match(redactSecretText('Authorization: Bearer abcdef\npassword=hunter2'), /authorization=\[redacted\]/i);
		assert.match(redactSecretText('token=super-secret'), /token=\[redacted\]/);
		assert.strictEqual(redactSecretText('clicked Save'), 'clicked Save');
	});
});

suite('desktopAutomationHost', () => {
	test('retries until visible then returns', async () => {
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				calls++;
				if (calls < 3) {
					return { ok: false, code: 'notFound', count: 0 };
				}
				return { ok: true, native: 'pointer', point: { x: 10, y: 12 }, clickCount: 1, match: { name: 'Save', visible: true, enabled: true } };
			}
			return true;
		};
		const clicks: Array<[number, number, number]> = [];
		const result = await interactDesktop(evaluate, 'click', { by: 'role', role: 'button', name: 'Save' }, undefined, 1000, CancellationToken.None, {
			click: async (x, y, clickCount) => { clicks.push([x, y, clickCount]); },
			press: async () => { },
			insertText: async () => { },
		});
		assert.strictEqual(result.ok, true);
		assert.ok(calls >= 3);
		assert.deepStrictEqual(clicks, [[10, 12, 1]]);
	});

	test('press and type without a native backend fail closed instead of synthesizing Enter or Tab', async () => {
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"press"')) {
				return { ok: true, native: 'key', key: 'Enter', modifiers: { ctrl: false, meta: false, alt: false, shift: false } };
			}
			if (expression.includes('"op":"type"')) {
				return { ok: true, native: 'type', text: 'ab' };
			}
			return true;
		};
		const pressed = await interactDesktop(evaluate, 'press', { by: 'role', role: 'textbox', name: 'Name' }, 'Enter', 200);
		assert.strictEqual(pressed.ok, false);
		assert.strictEqual(pressed.code, 'nativeInputRequired');
		const typed = await interactDesktop(evaluate, 'type', { by: 'role', role: 'textbox', name: 'Name' }, 'ab', 200);
		assert.strictEqual(typed.ok, false);
		assert.strictEqual(typed.code, 'nativeInputRequired');
	});

	test('covered pointer targets never dispatch a native click', async () => {
		const clicks: Array<[number, number, number]> = [];
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				return { ok: false, code: 'covered', blocker: { tag: 'div', name: 'Overlay' } };
			}
			return true;
		};
		const result = await interactDesktop(evaluate, 'click', { by: 'role', role: 'button', name: 'Save' }, undefined, 120, CancellationToken.None, {
			click: async (x, y, clickCount) => { clicks.push([x, y, clickCount]); },
			press: async () => { },
			insertText: async () => { },
		});
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.code, 'covered');
		assert.deepStrictEqual(clicks, []);
	});

	test('check and uncheck re-resolve the locator after the native click', async () => {
		const locator = { by: 'role', role: 'checkbox', name: 'On' } as const;
		const backend = (onClick: () => void) => ({
			click: async () => { onClick(); },
			press: async () => { },
			insertText: async () => { },
		});
		const evaluateFor = (getChecked: () => boolean): DesktopEvaluateFn => async expression => {
			if (expression.includes('"op":"check"') || expression.includes('"op":"uncheck"')) {
				return { ok: true, native: 'pointer', point: { x: 8, y: 8 }, clickCount: 1, match: { checked: getChecked() } };
			}
			if (expression.includes('"op":"read"')) {
				return { ok: true, match: { checked: getChecked() } };
			}
			return true;
		};

		let checked = false;
		const failedCheck = await interactDesktop(evaluateFor(() => checked), 'check', locator, undefined, 120, CancellationToken.None, backend(() => { /* prevented */ }));
		assert.strictEqual(failedCheck.code, 'stateUnchanged');

		let reads = 0;
		const delayedCheck: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"check"')) {
				return { ok: true, native: 'pointer', point: { x: 8, y: 8 }, clickCount: 1, match: { checked: false } };
			}
			if (expression.includes('"op":"read"')) {
				reads++;
				return { ok: true, match: { checked: reads >= 2 } };
			}
			return true;
		};
		const passedCheck = await interactDesktop(delayedCheck, 'check', locator, undefined, 400, CancellationToken.None, backend(() => { }));
		assert.strictEqual(passedCheck.ok, true);
		assert.strictEqual(passedCheck.match?.checked, true);
		assert.ok(reads >= 2);

		let on = true;
		const failedUncheck = await interactDesktop(evaluateFor(() => on), 'uncheck', locator, undefined, 120, CancellationToken.None, backend(() => { /* prevented */ }));
		assert.strictEqual(failedUncheck.code, 'stateUnchanged');
		const passedUncheck = await interactDesktop(evaluateFor(() => on), 'uncheck', locator, undefined, 200, CancellationToken.None, backend(() => { on = false; }));
		assert.strictEqual(passedUncheck.ok, true);
		assert.strictEqual(passedUncheck.match?.checked, false);

		let exhaustedReads = 0;
		const exhaustedUnchanged: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"check"')) {
				return { ok: true, native: 'pointer', point: { x: 8, y: 8 }, clickCount: 1, match: { checked: false } };
			}
			if (expression.includes('"op":"read"')) {
				exhaustedReads++;
				return { ok: true, match: { checked: false } };
			}
			return true;
		};
		const exhaustedCheck = await interactDesktop(exhaustedUnchanged, 'check', locator, undefined, 0, CancellationToken.None, backend(() => { }));
		assert.strictEqual(exhaustedCheck.ok, false);
		assert.strictEqual(exhaustedCheck.code, 'stateUnchanged');
		assert.strictEqual(exhaustedReads, 1);

		let exhaustedSuccessReads = 0;
		const exhaustedButChanged: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"check"')) {
				return { ok: true, native: 'pointer', point: { x: 8, y: 8 }, clickCount: 1, match: { checked: false } };
			}
			if (expression.includes('"op":"read"')) {
				exhaustedSuccessReads++;
				return { ok: true, match: { checked: true } };
			}
			return true;
		};
		const exhaustedSuccess = await interactDesktop(exhaustedButChanged, 'check', locator, undefined, 0, CancellationToken.None, backend(() => { }));
		assert.strictEqual(exhaustedSuccess.ok, true);
		assert.strictEqual(exhaustedSuccess.match?.checked, true);
		assert.strictEqual(exhaustedSuccessReads, 1);
	});

	test('fill and type on a readonly field fail closed without retrying or typing', async () => {
		let calls = 0;
		const inserts: string[] = [];
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				calls++;
				return { ok: false, code: 'readonly', match: { name: 'Title' } };
			}
			return true;
		};
		const native = {
			click: async () => { },
			press: async () => { },
			insertText: async (text: string) => { inserts.push(text); },
		};
		const filled = await interactDesktop(evaluate, 'fill', { by: 'label', value: 'Title' }, 'Ada', 1000, CancellationToken.None, native);
		assert.strictEqual(filled.code, 'readonly');
		assert.strictEqual(calls, 1);
		const typedHost = await interactDesktop(evaluate, 'type', { by: 'label', value: 'Title' }, 'Ada', 1000, CancellationToken.None, native);
		assert.strictEqual(typedHost.code, 'readonly');
		assert.strictEqual(calls, 2);
		const typed = await retryDesktopDomCommand(evaluate, { op: 'type', locator: { by: 'label', value: 'Title' }, value: 'Ada' }, 1000);
		assert.strictEqual(typed.code, 'readonly');
		assert.strictEqual(calls, 3);
		assert.deepStrictEqual(inserts, []);
	});

	test('native Enter and Tab go to the input backend as named keys, not character text', async () => {
		const presses: Array<{ key: string; modifiers: unknown }> = [];
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"press"')) {
				const command = JSON.parse(expression.slice(expression.indexOf('(') + 1, expression.lastIndexOf(')')));
				return { ok: true, native: 'key', key: command.value, modifiers: { ctrl: false, meta: false, alt: false, shift: false } };
			}
			return true;
		};
		const enter = await interactDesktop(evaluate, 'press', { by: 'role', role: 'textbox', name: 'Name' }, 'Enter', 200, CancellationToken.None, {
			click: async () => { },
			press: async (key, modifiers) => { presses.push({ key, modifiers }); },
			insertText: async () => { },
		});
		const tab = await interactDesktop(evaluate, 'press', { by: 'role', role: 'textbox', name: 'Name' }, 'Tab', 200, CancellationToken.None, {
			click: async () => { },
			press: async (key, modifiers) => { presses.push({ key, modifiers }); },
			insertText: async () => { },
		});
		assert.strictEqual(enter.ok, true);
		assert.strictEqual(tab.ok, true);
		assert.deepStrictEqual(presses.map(item => item.key), ['Enter', 'Tab']);
		assert.strictEqual(webDriverKeyValue('Enter'), '\uE007');
		assert.strictEqual(webDriverKeyValue('Tab'), '\uE004');
		assert.notStrictEqual(webDriverKeyValue('Enter'), 'Enter');
		assert.strictEqual(cdpKeyParams('Tab', { ctrl: false, meta: false, alt: false, shift: false }, 'keyDown').text, '');
		assert.strictEqual(cdpKeyParams('Space', { ctrl: false, meta: false, alt: false, shift: false }, 'keyDown').text, ' ');
		assert.strictEqual(cdpKeyParams(' ', { ctrl: false, meta: false, alt: false, shift: false }, 'char').text, ' ');
		const actions = webDriverKeyActions('Enter', { ctrl: false, meta: false, alt: false, shift: false }) as Array<{ actions: Array<{ value?: string }> }>;
		assert.ok(actions[0]?.actions.some(step => step.value === '\uE007'));
		assert.ok(!JSON.stringify(actions).includes('"Enter"'));
		const typed = webDriverKeyActions('', { ctrl: false, meta: false, alt: false, shift: false }, 'ab') as Array<{ actions: Array<{ type?: string; value?: string }> }>;
		assert.deepStrictEqual(typed[0]?.actions.map(step => `${step.type}:${step.value}`), ['keyDown:a', 'keyUp:a', 'keyDown:b', 'keyUp:b']);
	});

	test('type deletes an existing selection before inserting native text', async () => {
		const presses: string[] = [];
		const inserts: string[] = [];
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.includes('"op":"type"')) {
				return { ok: true, native: 'type', text: 'Ada', replaceSelection: true };
			}
			return true;
		};
		const result = await interactDesktop(evaluate, 'type', { by: 'role', role: 'textbox', name: 'Name' }, 'Ada', 200, CancellationToken.None, {
			click: async () => { },
			press: async key => { presses.push(key); },
			insertText: async text => { inserts.push(text); },
		});
		assert.strictEqual(result.ok, true);
		assert.deepStrictEqual(presses, ['Backspace']);
		assert.deepStrictEqual(inserts, ['Ada']);
	});

	test('owned CDP Space dispatch in electron-main inserts a character, not only a named key', () => {
		const root = findRepoRoot();
		const main = readFileSync(join(root, 'src/vs/platform/prebaseDesktop/electron-main/prebaseDesktopMainService.ts'), 'utf8');
		const keys = readFileSync(join(root, 'src/vs/platform/prebaseDesktop/common/desktopCdpKey.ts'), 'utf8');
		assert.match(main, /desktopCdpKeyParams\(key, modifiers, 'char'\)/);
		assert.match(main, /key === 'Space' \|\| key === ' '/);
		assert.match(main, /skip char for modifier shortcuts/);
		assert.match(main, /!modifiers\.alt && !modifiers\.shift \? \['SelectAll'\]/);
		assert.match(main, /if \(electronCdp \|\| webDriver\)/);
		assert.match(main, /sanitizeOwnedDesktopChildEnv\(process\.env, env\)/);
		assert.match(main, /keep pid\/port owned until killOwnedProcess/);
		assert.match(main, /!this\._ownedPids\.has\(pid\) && !this\._ownedPortsByPid\.has\(pid\)/);
		assert.match(main, /isExited: \(\) => !this\._processGroupAlive\(pid\)/);
		assert.match(keys, /key === 'Enter' \? '\\r' : ' '/);
		assert.match(keys, /isDigit \? `Digit\$\{key\}`/);
		assert.strictEqual(cdpKeyParams('1', { ctrl: false, meta: false, alt: false, shift: false }, 'keyDown').code, 'Digit1');
		assert.match(main, /Owned text input exceeds the/);
		assert.match(main, /Owned pointer input requires finite coordinates/);
	});

	test('click without a native backend fails closed instead of synthesizing DOM click', async () => {
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				return { ok: true, native: 'pointer', point: { x: 4, y: 8 }, clickCount: 1 };
			}
			return true;
		};
		const result = await interactDesktop(evaluate, 'click', { by: 'role', role: 'button', name: 'Save' }, undefined, 200);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.code, 'nativeInputRequired');
	});

	test('retries a disabled control until it becomes actionable', async () => {
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				calls++;
				if (calls < 3) {
					return { ok: false, code: 'disabled', count: 1, match: { name: 'Save', enabled: false } };
				}
				return { ok: true, match: { name: 'Save', enabled: true } };
			}
			return true;
		};
		const result = await retryDesktopDomCommand(evaluate, { op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } }, 1000);
		assert.strictEqual(result.ok, true);
		assert.ok(calls >= 3);
	});

	test('retries transient stability, viewport, and coverage failures', async () => {
		const responses = [
			{ ok: false, code: 'notStable' },
			{ ok: false, code: 'outsideViewport' },
			{ ok: false, code: 'covered', blocker: { tag: 'div', name: 'Overlay' } },
			{ ok: true, match: { name: 'Save', enabled: true, visible: true } },
		];
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				return responses[calls++] ?? responses.at(-1);
			}
			return true;
		};

		const result = await retryDesktopDomCommand(evaluate, { op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } }, 1000);
		assert.deepStrictEqual({ result, calls }, {
			result: { ok: true, match: { name: 'Save', enabled: true, visible: true } },
			calls: 4,
		});
	});

	test('does not retry permanent wrong-control failures', async () => {
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				calls++;
				return { ok: false, code: 'wrongControl' };
			}
			return true;
		};

		const result = await retryDesktopDomCommand(evaluate, { op: 'select', locator: { by: 'role', role: 'textbox', name: 'Theme' } }, 1000);
		assert.deepStrictEqual({ code: result.code, calls }, { code: 'wrongControl', calls: 1 });
	});

	test('does not silently click the first of two Save buttons', async () => {
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				return { ok: false, code: 'ambiguous', count: 2, matches: [{ name: 'Save' }, { name: 'Save' }] };
			}
			return true;
		};
		const result = await retryDesktopDomCommand(evaluate, { op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } }, 200);
		assert.strictEqual(result.code, 'ambiguous');
		assert.strictEqual(result.count, 2);
		assert.match(formatDesktopFailure(result, { by: 'role', role: 'button', name: 'Save' }), /Ambiguous locator/);
	});

	test('assertion retries until the condition matches', async () => {
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (expression.startsWith('window.__prebaseDesktopTest.run(')) {
				calls++;
				if (calls < 3) {
					return { ok: true, match: { name: 'Loading', visible: true, enabled: true } };
				}
				return { ok: true, match: { name: 'Dashboard', visible: true, enabled: true } };
			}
			return true;
		};
		const result = await assertDesktop(evaluate, 'text', { by: 'role', role: 'heading', name: 'Dashboard' }, 'Dashboard', 1000);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.actual && typeof result.actual === 'object' ? (result.actual as { name?: string }).name : undefined, 'Dashboard');
		assert.ok(calls >= 3);
	});

	test('retries title and count assertions on distinct page commands', async () => {
		const titleEvaluate: DesktopEvaluateFn = async () => ({ ok: true, title: 'PreBase', url: 'http://localhost:1420/' });
		const title = await assertDesktop(titleEvaluate, 'title', undefined, 'PreBase', 200);
		assert.strictEqual(title.ok, true);
		assert.strictEqual(title.actual, 'PreBase');

		const countEvaluate: DesktopEvaluateFn = async expression => {
			if (String(expression).includes('"op":"query"')) {
				return { ok: true, count: 2, matches: [{ name: 'Save' }, { name: 'Save' }] };
			}
			return true;
		};
		const counted = await assertDesktop(countEvaluate, 'count', { by: 'role', role: 'button', name: 'Save' }, 2, 200);
		assert.strictEqual(counted.ok, true);
		assert.strictEqual(counted.actual, 2);
	});

	test('assertion retries until timeout then reports actual', async () => {
		const evidence = {
			ok: true,
			match: { name: 'Loading', visible: true, enabled: true },
			title: 'Loading app',
			url: 'http://127.0.0.1:1420/loading',
			console: [{ level: 'error', text: 'render failed', at: 7 }],
		};
		const evaluate: DesktopEvaluateFn = async () => evidence;
		const result = await assertDesktop(evaluate, 'text', { by: 'role', role: 'heading', name: 'Dashboard' }, 'Dashboard', 120);
		assert.strictEqual(result.ok, false);
		assert.ok(result.duration >= 120);
		assert.deepStrictEqual({
			actual: result.actual,
			title: result.result.title,
			url: result.result.url,
			console: result.result.console,
		}, {
			actual: evidence.match,
			title: evidence.title,
			url: evidence.url,
			console: evidence.console,
		});
		assert.match(formatDesktopFailure({ ok: false, code: 'notFound' }, { by: 'role', role: 'heading', name: 'Dashboard' }), /No match/);
		assert.match(formatDesktopFailure({ ok: false, code: 'notVisible' }, { by: 'text', value: 'Hidden' }), /not visible/);
		assert.match(formatDesktopFailure({ ok: false, code: 'disabled' }, { by: 'role', role: 'button', name: 'Save' }), /disabled/);
	});

	test('cancels an in-flight wait', async () => {
		const cts = new CancellationTokenSource();
		const evaluate: DesktopEvaluateFn = async () => ({ ok: false, code: 'notFound' });
		queueMicrotask(() => cts.cancel());
		await assert.rejects(() => interactDesktop(evaluate, 'click', { by: 'text', value: 'Never' }, undefined, 2000, cts.token));
		cts.dispose();
	});

	test('hidden assertion succeeds when the locator is absent', async () => {
		const evaluate: DesktopEvaluateFn = async () => ({ ok: false, code: 'notFound' });
		const result = await assertDesktop(evaluate, 'hidden', { by: 'text', value: 'Gone' }, undefined, 200);
		assert.strictEqual(result.ok, true);
	});

	test('containsText retries until the substring appears', async () => {
		let calls = 0;
		const evaluate: DesktopEvaluateFn = async expression => {
			if (String(expression).includes('run')) {
				calls++;
				return { ok: true, match: { name: calls < 3 ? 'Loading' : 'Dashboard ready' } };
			}
			return true;
		};
		const result = await assertDesktop(evaluate, 'containsText', { by: 'role', role: 'heading', name: 'Dashboard' }, 'Dashboard', 1000);
		assert.strictEqual(result.ok, true);
		assert.ok(calls >= 3);
	});
});

class MiniElement {
	attrs: Record<string, string> = {};
	children: MiniElement[] = [];
	text = '';
	nativeValue = '';
	selectionStart = 0;
	selectionEnd = 0;
	disabled = false;
	checked = false;
	isContentEditable = false;
	clicked = 0;
	selected = 0;
	scrolled = 0;
	events: Array<Record<string, unknown>> = [];
	control?: MiniElement;
	labels: MiniElement[] = [];
	hidden = false;
	rect = { x: 0, y: 0, left: 0, top: 0, width: 16, height: 16 };
	rects?: Array<typeof this.rect>;
	constructor(readonly tagName: string) { }
	get textContent(): string { return this.text || this.children.map(child => child.textContent).join(''); }
	set textContent(value: string) { this.text = value; }
	get type(): string { return (this.attrs.type || (this.tagName === 'INPUT' ? 'text' : '')).toLowerCase(); }
	get value(): string { return this.tagName === 'OPTION' ? (this.attrs.value ?? this.text) : this.nativeValue; }
	set value(value: string) { this.nativeValue = value; }
	get readOnly(): boolean { return this.getAttribute('readonly') !== null || this.getAttribute('readOnly') !== null; }
	get options(): MiniElement[] { return this.tagName === 'SELECT' ? this.children : []; }
	get multiple(): boolean { return this.getAttribute('multiple') !== null; }
	getAttribute(name: string): string | null { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
	click(): void { this.clicked++; if (this.type === 'checkbox' || this.type === 'radio') { this.checked = !this.checked; } }
	focus(): void { /* renderer focus is not required for these assertions */ }
	select(): void { this.selected++; }
	scrollIntoView(): void { this.scrolled++; }
	contains(candidate: MiniElement): boolean { return candidate === this || this.children.some(child => child.contains(candidate)); }
	dispatchEvent(event: Record<string, unknown>): boolean {
		this.events.push({
			type: event.type,
			key: event.key,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			detail: event.detail,
			data: event.data,
			inputType: event.inputType,
		});
		return event.defaultPrevented !== true;
	}
	getBoundingClientRect(): typeof this.rect {
		if (this.hidden) {
			return { x: this.rect.x, y: this.rect.y, left: this.rect.left, top: this.rect.top, width: 0, height: 0 };
		}
		return this.rects?.shift() ?? this.rect;
	}
}

function collect(node: MiniElement): MiniElement[] {
	return [node, ...node.children.flatMap(collect)];
}

function el(tag: string, attrs: Record<string, string> = {}, text = '', children: MiniElement[] = []): MiniElement {
	const node = new MiniElement(tag.toUpperCase());
	node.attrs = { ...attrs };
	node.text = text;
	if (attrs.disabled !== undefined) { node.disabled = true; }
	if (attrs.hidden !== undefined) { node.hidden = true; }
	if (attrs.type === 'password' || attrs.type === 'text') { node.value = ''; }
	for (const child of children) {
		node.children.push(child);
	}
	return node;
}

function selectorMatches(node: MiniElement, selector: string): boolean {
	const attrEq = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
	if (attrEq) {
		return node.getAttribute(attrEq[1]) === attrEq[2];
	}
	const attr = selector.match(/^\[([^=\]]+)\]$/);
	if (attr) {
		return node.getAttribute(attr[1]) !== null;
	}
	return node.tagName.toLowerCase() === selector.toLowerCase();
}

function installDomTest(nodes: MiniElement[]): {
	run: (command: unknown) => Record<string, unknown>;
	rendererConsole: { log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
} {
	class Element { }
	Object.setPrototypeOf(MiniElement.prototype, Element.prototype);
	class HTMLInputElement extends MiniElement {
		override get value(): string { return this.nativeValue; }
		override set value(value: string) { this.nativeValue = value; }
	}
	class HTMLTextAreaElement extends MiniElement {
		override get value(): string { return this.nativeValue; }
		override set value(value: string) { this.nativeValue = value; }
	}
	class HTMLSelectElement extends MiniElement { }
	const body = el('body', {}, '', nodes);
	const all = () => collect(body).slice(1);
	all().forEach((node, index) => {
		node.rect = { x: index * 24, y: 0, left: index * 24, top: 0, width: 16, height: 16 };
		if (node.tagName === 'INPUT') {
			Object.setPrototypeOf(node, HTMLInputElement.prototype);
		} else if (node.tagName === 'TEXTAREA') {
			Object.setPrototypeOf(node, HTMLTextAreaElement.prototype);
		} else if (node.tagName === 'SELECT') {
			Object.setPrototypeOf(node, HTMLSelectElement.prototype);
		}
	});
	const document = {
		title: 'Fixture',
		body: { innerText: all().map(node => node.textContent).join(' ') },
		querySelectorAll(selector: string) {
			const parts = selector.split(',').map(part => part.trim());
			return all().filter(node => parts.some(part => selectorMatches(node, part)));
		},
		getElementById(id: string) {
			return all().find(node => node.getAttribute('id') === id) ?? null;
		},
		elementFromPoint(x: number, y: number) {
			return [...all()].reverse().find(node => {
				if (node.hidden) {
					return false;
				}
				const rect = node.rect;
				return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
			}) ?? null;
		},
		execCommand: () => true,
	};
	function EventCtor(this: Record<string, unknown>, type: string, init: Record<string, unknown> = {}) {
		Object.assign(this, init, { type });
	}
	const rendererConsole = { log(..._args: unknown[]) { }, warn(..._args: unknown[]) { }, error(..._args: unknown[]) { } };
	const sandbox: Record<string, unknown> = {
		window: {
			innerWidth: 1024,
			innerHeight: 768,
			getComputedStyle: (node: MiniElement) => ({
				display: node.hidden ? 'none' : 'block',
				visibility: 'visible',
				opacity: '1',
			}),
			addEventListener: () => { /* console hook only */ },
		},
		document,
		location: { href: 'http://127.0.0.1:1420/' },
		console: rendererConsole,
		Element,
		HTMLInputElement,
		HTMLTextAreaElement,
		HTMLSelectElement,
		Event: EventCtor,
		InputEvent: EventCtor,
		MouseEvent: EventCtor,
		KeyboardEvent: EventCtor,
		Array,
		Set,
		JSON,
		Date,
		String,
		Number,
		Boolean,
		Error,
		Math,
	};
	(sandbox.window as { document: unknown }).document = document;
	runInNewContext(DESKTOP_AUTOMATION_BOOTSTRAP, sandbox);
	const api = (sandbox.window as { __prebaseDesktopTest: { run: (command: unknown) => Record<string, unknown> } }).__prebaseDesktopTest;
	assert.ok(api, 'bootstrap must install window.__prebaseDesktopTest');
	return { run: command => api.run(command), rendererConsole };
}

function runStablePointerAction(api: { run: (command: unknown) => Record<string, unknown> }, command: unknown): Record<string, unknown> {
	const first = api.run(command);
	assert.strictEqual(first.code, 'notStable');
	return api.run(command);
}

suite('desktopAutomationDom', () => {
	test('clicks a unique role, testId, and labelled control', () => {
		const save = el('button', {}, 'Save');
		const named = el('button', { 'data-testid': 'ok' }, 'OK');
		const field = el('input', { type: 'text' });
		const label = el('label', {}, 'Name');
		label.control = field;
		const api = installDomTest([save, named, label, field]);
		assert.strictEqual(runStablePointerAction(api, { op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } }).native, 'pointer');
		assert.strictEqual(save.clicked, 0);
		assert.strictEqual(runStablePointerAction(api, { op: 'click', locator: { by: 'testId', value: 'ok' } }).native, 'pointer');
		assert.strictEqual(named.clicked, 0);
		const filled = api.run({ op: 'fill', locator: { by: 'label', value: 'Name' }, value: 'Ada' });
		assert.strictEqual(filled.ok, true);
		assert.strictEqual(field.value, 'Ada');
	});

	test('refuses to click the first of two visible Save buttons', () => {
		const api = installDomTest([el('button', {}, 'Save'), el('button', {}, 'Save')]);
		const result = api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } });
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.code, 'ambiguous');
		assert.strictEqual(result.count, 2);
	});

	test('distinguishes hidden, disabled, and exact name mismatch', () => {
		const hidden = el('button', { hidden: '' }, 'Save');
		const disabled = el('button', { disabled: '' }, 'Submit');
		const close = el('button', {}, 'Close window');
		const api = installDomTest([hidden, disabled, close]);
		assert.strictEqual(api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Save' } }).code, 'notVisible');
		assert.strictEqual(api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Submit' } }).code, 'disabled');
		assert.strictEqual(api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Close', exact: true } }).code, 'notFound');
		assert.strictEqual(runStablePointerAction(api, { op: 'click', locator: { by: 'role', role: 'button', name: 'Close' } }).ok, true);
	});

	test('reports covered, offscreen, and unstable pointer targets without clicking', () => {
		const covered = el('button', {}, 'Covered');
		const blocker = el('div', { role: 'dialog', 'aria-label': 'Modal blocker' });
		const api = installDomTest([covered, blocker]);
		blocker.rect = { ...covered.rect };

		const firstCovered = api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Covered' } });
		assert.strictEqual(firstCovered.code, 'notStable');
		const coveredResult = api.run({ op: 'click', locator: { by: 'role', role: 'button', name: 'Covered' } });
		assert.strictEqual(coveredResult.code, 'covered');
		assert.deepStrictEqual(JSON.parse(JSON.stringify(coveredResult.blocker)), {
			tag: 'div',
			role: 'dialog',
			name: 'Modal blocker',
			enabled: true,
			visible: true,
			checked: false,
		});
		assert.strictEqual(covered.clicked, 0);
		assert.strictEqual(covered.scrolled, 2);

		const offscreen = el('button', {}, 'Offscreen');
		const offscreenApi = installDomTest([offscreen]);
		offscreen.rect = { x: 1200, y: 0, left: 1200, top: 0, width: 16, height: 16 };
		assert.strictEqual(offscreenApi.run({ op: 'click', locator: { by: 'text', value: 'Offscreen' } }).code, 'notStable');
		assert.strictEqual(offscreenApi.run({ op: 'click', locator: { by: 'text', value: 'Offscreen' } }).code, 'outsideViewport');
		assert.strictEqual(offscreen.clicked, 0);

		const moving = el('button', {}, 'Moving');
		const movingApi = installDomTest([moving]);
		moving.rects = [
			{ x: 0, y: 0, left: 0, top: 0, width: 16, height: 16 },
			{ x: 0, y: 0, left: 0, top: 0, width: 16, height: 16 },
			{ x: 0, y: 0, left: 0, top: 0, width: 16, height: 16 },
			{ x: 3, y: 0, left: 3, top: 0, width: 16, height: 16 },
			{ x: 3, y: 0, left: 3, top: 0, width: 16, height: 16 },
			{ x: 3, y: 0, left: 3, top: 0, width: 16, height: 16 },
		];
		assert.strictEqual(movingApi.run({ op: 'click', locator: { by: 'text', value: 'Moving' } }).code, 'notStable');
		assert.strictEqual(movingApi.run({ op: 'click', locator: { by: 'text', value: 'Moving' } }).code, 'notStable');
		assert.strictEqual(moving.clicked, 0);
	});

	test('fills through the native setter and emits controlled-input events', () => {
		const field = el('input', { type: 'text', 'aria-label': 'Name' });
		const api = installDomTest([field]);
		let patchedSetterCalls = 0;
		Object.defineProperty(field, 'value', {
			configurable: true,
			get: () => field.nativeValue,
			set: () => { patchedSetterCalls++; },
		});

		const result = api.run({ op: 'fill', locator: { by: 'label', value: 'Name' }, value: 'Ada' });
		assert.deepStrictEqual({
			ok: result.ok,
			value: field.value,
			patchedSetterCalls,
			events: field.events.map(event => event.type),
		}, {
			ok: true,
			value: 'Ada',
			patchedSetterCalls: 0,
			events: ['input', 'change'],
		});
	});

	test('prepares sequential type for the native input backend without synthesizing key events', () => {
		const field = el('input', { type: 'text', 'aria-label': 'Message' });
		field.value = '>';
		const api = installDomTest([field]);

		const result = api.run({ op: 'type', locator: { by: 'label', value: 'Message' }, value: 'ab' });
		assert.deepStrictEqual({
			ok: result.ok,
			native: result.native,
			text: result.text,
			value: field.value,
			events: field.events,
		}, {
			ok: true,
			native: 'type',
			text: 'ab',
			value: '>',
			events: [],
		});
	});

	test('typing into a selected field leaves the existing selection for the native backend', () => {
		const field = el('input', { type: 'text', 'aria-label': 'Name' });
		field.value = 'Ada Lovelace';
		field.selectionStart = 0;
		field.selectionEnd = field.value.length;
		const api = installDomTest([field]);

		const result = api.run({ op: 'type', locator: { by: 'label', value: 'Name' }, value: 'Grace' });
		assert.deepStrictEqual({
			ok: result.ok,
			native: result.native,
			text: result.text,
			replaceSelection: result.replaceSelection,
			value: field.value,
			selectionStart: field.selectionStart,
			selectionEnd: field.selectionEnd,
			selected: field.selected,
			events: field.events,
		}, {
			ok: true,
			native: 'type',
			text: 'Grace',
			replaceSelection: true,
			value: 'Ada Lovelace',
			selectionStart: 0,
			selectionEnd: 'Ada Lovelace'.length,
			selected: 0,
			events: [],
		});
	});

	test('prepares modifier chords for the native key backend', () => {
		const field = el('input', { type: 'text', 'aria-label': 'Name' });
		const api = installDomTest([field]);

		const result = api.run({ op: 'press', locator: { by: 'label', value: 'Name' }, value: 'Control+Shift+A' }) as { ok: boolean; native?: string; key?: string; modifiers?: { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean } };
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.native, 'key');
		assert.strictEqual(result.key, 'A');
		assert.strictEqual(result.modifiers?.ctrl, true);
		assert.strictEqual(result.modifiers?.meta, false);
		assert.strictEqual(result.modifiers?.alt, false);
		assert.strictEqual(result.modifiers?.shift, true);
		assert.strictEqual(field.selected, 0);
	});

	test('double click prepares a two-count native pointer action', () => {
		const button = el('button', {}, 'Open');
		const api = installDomTest([button]);
		const result = runStablePointerAction(api, { op: 'doubleClick', locator: { by: 'role', role: 'button', name: 'Open' } });

		assert.deepStrictEqual({
			ok: result.ok,
			native: result.native,
			clickCount: result.clickCount,
			clicks: button.clicked,
		}, {
			ok: true,
			native: 'pointer',
			clickCount: 2,
			clicks: 0,
		});
	});

	test('select validates control type, option existence, and disabled options before changing value', () => {
		const wrong = el('input', { type: 'text', 'aria-label': 'Theme' });
		const light = el('option', { value: 'light' }, 'Light');
		const disabled = el('option', { value: 'disabled', disabled: '' }, 'Disabled');
		const select = el('select', { 'aria-label': 'Theme' }, '', [light, disabled]);
		const api = installDomTest([wrong, select]);

		assert.strictEqual(api.run({ op: 'select', locator: { by: 'label', value: 'Theme', exact: true }, value: 'light' }).code, 'ambiguous');
		assert.strictEqual(api.run({ op: 'select', locator: { by: 'css', value: 'input' }, value: 'light' }).code, 'wrongControl');
		assert.strictEqual(api.run({ op: 'select', locator: { by: 'css', value: 'select' }, value: 'missing' }).code, 'optionNotFound');
		assert.strictEqual(api.run({ op: 'select', locator: { by: 'css', value: 'select' }, value: 'disabled' }).code, 'optionDisabled');
		const selected = api.run({ op: 'select', locator: { by: 'css', value: 'select' }, value: 'light' });
		assert.deepStrictEqual({
			ok: selected.ok,
			native: selected.native,
			value: select.value,
			events: select.events.map(event => event.type),
		}, {
			ok: true,
			native: undefined,
			value: 'light',
			events: ['input', 'change'],
		});
		const focused = api.run({ op: 'focus', locator: { by: 'css', value: 'input' } });
		assert.strictEqual(focused.ok, true);
		assert.strictEqual(focused.native, undefined);
	});

	test('refuses radio uncheck and fill/type on non-editable controls', () => {
		const radio = el('input', { type: 'radio', 'aria-label': 'Choice' });
		radio.checked = true;
		const button = el('button', {}, 'Save');
		const box = el('input', { type: 'checkbox', 'aria-label': 'On' });
		box.checked = true;
		const api = installDomTest([radio, button, box]);

		assert.strictEqual(runStablePointerAction(api, { op: 'uncheck', locator: { by: 'label', value: 'Choice' } }).code, 'wrongControl');
		assert.strictEqual(radio.checked, true);
		assert.strictEqual(radio.clicked, 0);
		assert.strictEqual(api.run({ op: 'fill', locator: { by: 'role', role: 'button', name: 'Save' }, value: 'Ada' }).code, 'wrongControl');
		assert.strictEqual(api.run({ op: 'type', locator: { by: 'role', role: 'button', name: 'Save' }, value: 'ab' }).code, 'wrongControl');
		const alreadyChecked = runStablePointerAction(api, { op: 'check', locator: { by: 'label', value: 'On' } });
		assert.strictEqual(alreadyChecked.ok, true);
		assert.strictEqual(alreadyChecked.native, undefined);
		assert.strictEqual(box.clicked, 0);
		assert.strictEqual(api.run({ op: 'uncheck', locator: { by: 'label', value: 'On' } }).native, 'pointer');
		assert.strictEqual(box.clicked, 0);
	});

	test('refuses fill and type on readonly fields', () => {
		const field = el('input', { type: 'text', readonly: '', 'aria-label': 'Title' });
		const api = installDomTest([field]);
		assert.strictEqual(api.run({ op: 'fill', locator: { by: 'label', value: 'Title' }, value: 'Ada' }).code, 'readonly');
		assert.strictEqual(api.run({ op: 'type', locator: { by: 'label', value: 'Title' }, value: 'Ada' }).code, 'readonly');
		assert.strictEqual(field.value, '');
		assert.strictEqual(runStablePointerAction(api, { op: 'click', locator: { by: 'label', value: 'Title' } }).native, 'pointer');
		assert.strictEqual(field.clicked, 0);
	});

	test('omits password values from match summaries', () => {
		const secret = el('input', { type: 'password', 'aria-label': 'Password' });
		secret.value = 'hunter2';
		const api = installDomTest([secret]);
		const result = api.run({ op: 'read', locator: { by: 'label', value: 'Password' } });
		assert.strictEqual(result.ok, true);
		assert.strictEqual((result.match as { value?: string } | undefined)?.value, undefined);
	});

	test('failed renderer queries carry only the latest bounded console evidence', () => {
		const api = installDomTest([]);
		for (let index = 0; index < 25; index++) {
			api.rendererConsole.error(`token=secret-${index}`, 'x'.repeat(600));
		}

		const result = api.run({ op: 'read', locator: { by: 'text', value: 'Missing' } });
		const evidence = Array.from(result.console as Array<{ level: string; text: string; at: number }>);
		assert.strictEqual(result.code, 'notFound');
		assert.strictEqual(evidence.length, 20);
		assert.match(evidence[0].text, /token=secret-5/);
		assert.match(evidence.at(-1)!.text, /token=secret-24/);
		assert.ok(evidence.every(entry => entry.level === 'error' && entry.text.length <= 500 && Number.isFinite(entry.at)));
	});
});

suite('tauriTestingSetup', () => {
	const cargo = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n';
	const rust = 'fn main() {\n    tauri::Builder::default().run(tauri::generate_context!()).unwrap();\n}\n';

	test('previews debug-only plugin changes and stays idempotent', () => {
		const preview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: cargo,
			rustEntry: rust,
			capabilitiesJson: JSON.stringify({ identifier: 'default', permissions: ['core:default'] }),
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.ok(!('error' in preview));
		if ('error' in preview) {
			return;
		}
		assert.deepStrictEqual(preview.changes.map(change => ({
			path: change.path,
			kind: change.kind,
		})), [
			{ path: 'src-tauri/Cargo.toml', kind: 'update' },
			{ path: 'src-tauri/src/lib.rs', kind: 'update' },
			{ path: 'src-tauri/capabilities/default.json', kind: 'update' },
		]);
		assert.ok(preview.removeInstructions.includes('prebase-testing'));
		const cargoOnce = applyCargoTestingDependencies(cargo);
		assert.strictEqual(applyCargoTestingDependencies(cargoOnce), cargoOnce);
		const rustOnce = applyRustTestingPlugins(rust);
		assert.ok(typeof rustOnce === 'string');
		assert.strictEqual(applyRustTestingPlugins(rustOnce as string), rustOnce);
		const caps = applyCapabilitiesTestingPermission(JSON.stringify({ permissions: ['core:default'] }));
		assert.ok(typeof caps === 'string');
		assert.deepStrictEqual(JSON.parse(caps as string), {
			permissions: ['core:default', 'wdio-webdriver:default'],
		});
		const rustLet = applyRustTestingPlugins('fn run() {\n    let builder = tauri::Builder::default();\n    builder.run(tauri::generate_context!()).unwrap();\n}\n');
		assert.ok(typeof rustLet === 'string' && rustLet.includes('let mut builder') && rustLet.includes('tauri_plugin_wdio_webdriver'));
	});

	test('preview does not mutate sources and uses optional prebase-testing instead of cfg(debug_assertions) dependencies', () => {
		const originalCargo = cargo;
		const originalRust = rust;
		const preview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: cargo,
			rustEntry: rust,
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.strictEqual(cargo, originalCargo);
		assert.strictEqual(rust, originalRust);
		assert.ok(!('error' in preview));
		if ('error' in preview) {
			return;
		}
		assert.ok(preview.productionSafe);
		const capabilityChange = preview.changes.find(change => change.path === 'src-tauri/capabilities/default.json');
		assert.strictEqual(capabilityChange?.kind, 'create');
		assert.deepStrictEqual(JSON.parse(capabilityChange?.preview ?? ''), {
			identifier: 'prebase-testing',
			description: 'Debug-only embedded WebDriver access for PreBase desktop testing.',
			windows: ['main'],
			permissions: ['wdio-webdriver:default'],
		});
		assert.ok(preview.changes.every(change => change.preview.includes('prebase-testing') || change.preview.includes('wdio-webdriver:default') || change.preview.includes('debug_assertions')));
		const appliedCargo = applyCargoTestingDependencies(cargo);
		assert.match(appliedCargo, /prebase-testing/);
		assert.match(appliedCargo, /optional = true/);
		assert.ok(!appliedCargo.includes("[target.'cfg(debug_assertions)'.dependencies]"));
		assert.deepStrictEqual(
			Array.from(appliedCargo.matchAll(/^\s*(tauri-plugin-[\w-]+)\s*=/gm), match => match[1]),
			['tauri-plugin-wdio-webdriver'],
		);
		assert.deepStrictEqual(
			appliedCargo.match(/^prebase-testing\s*=\s*\[(.*)\]$/m)?.[1].match(/"([^"]+)"/g),
			['"dep:tauri-plugin-wdio-webdriver"'],
		);
		const depsIdx = appliedCargo.indexOf('[dependencies]');
		const featuresIdx = appliedCargo.indexOf('[features]');
		const pluginIdx = appliedCargo.indexOf('tauri-plugin-wdio-webdriver');
		assert.ok(depsIdx >= 0 && featuresIdx > depsIdx && pluginIdx > depsIdx && pluginIdx < featuresIdx);
		const withFeatures = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n\n[features]\ndefault = []\n';
		const appliedWithFeatures = applyCargoTestingDependencies(withFeatures);
		assert.ok(appliedWithFeatures.indexOf('tauri-plugin-wdio-webdriver') > appliedWithFeatures.indexOf('[dependencies]'));
		assert.ok(appliedWithFeatures.indexOf('tauri-plugin-wdio-webdriver') < appliedWithFeatures.indexOf('[features]'));
		assert.match(appliedWithFeatures, /\[features\]\nprebase-testing/);
		const appliedRust = applyRustTestingPlugins(rust);
		assert.ok(typeof appliedRust === 'string' && appliedRust.includes('feature = "prebase-testing"'));
		assert.ok(typeof appliedRust === 'string' && !appliedRust.includes('tauri_plugin_wdio::'));
		const createdCapabilities = applyCapabilitiesTestingPermission();
		assert.ok(typeof createdCapabilities === 'string');
		assert.deepStrictEqual(JSON.parse(createdCapabilities as string), {
			identifier: 'prebase-testing',
			description: 'Debug-only embedded WebDriver access for PreBase desktop testing.',
			windows: ['main'],
			permissions: ['wdio-webdriver:default'],
		});
	});

	test('preserves an existing capability while adding only the embedded WebDriver ACL', () => {
		const existing = {
			identifier: 'desktop',
			description: 'Existing application capability',
			windows: ['main', 'settings'],
			permissions: ['core:default', 'allow-greet'],
		};
		const applied = applyCapabilitiesTestingPermission(JSON.stringify(existing));
		assert.ok(typeof applied === 'string');
		assert.deepStrictEqual(JSON.parse(applied as string), {
			...existing,
			permissions: ['core:default', 'allow-greet', 'wdio-webdriver:default'],
		});
	});

	test('refuses to edit a non-Tauri Cargo.toml', () => {
		const preview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: '[package]\nname="cli"\n[dependencies]\nserde="1"\n',
			rustEntry: rust,
			rustEntryPath: 'src/main.rs',
			cargoPath: 'Cargo.toml',
			capabilitiesPath: 'capabilities/default.json',
		});
		assert.deepStrictEqual(preview, { error: 'Cargo.toml has no tauri crate; refusing to add testing plugins.' });
	});

	test('refuses unsafe manifests and reports already-enabled projects as a no-op', () => {
		assert.deepStrictEqual(previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: '[dependencies]\ntauri = "2"\n',
			rustEntry: rust,
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		}), { error: 'Cargo.toml does not look like a Tauri package manifest.' });
		assert.deepStrictEqual(previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: cargo,
			rustEntry: 'fn main() {}',
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		}), { error: 'Rust entry does not contain a Tauri Builder; refusing unsafe source edits.' });
		assert.deepStrictEqual(applyRustTestingPlugins('fn main() {}'), { error: 'Could not find a safe Tauri Builder insertion point.' });
		assert.deepStrictEqual(applyCapabilitiesTestingPermission('{'), { error: 'capabilities JSON is not valid.' });

		const enabled = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: `${cargo}tauri-plugin-wdio-webdriver = { version = "1", optional = true }\n\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n`,
			rustEntry: 'fn main() {\n    let mut builder = tauri::Builder::default();\n    #[cfg(all(debug_assertions, feature = "prebase-testing"))]\n    {\n        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());\n    }\n    builder.run(tauri::generate_context!()).unwrap();\n}\n',
			capabilitiesJson: JSON.stringify({ permissions: ['core:default', 'wdio-webdriver:default'] }),
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.ok(!('error' in enabled));
		if ('error' in enabled) {
			return;
		}
		assert.deepStrictEqual(enabled.changes, []);
	});

	test('inspects partial versus complete Tauri testing setup without overclaiming ready', () => {
		assert.deepStrictEqual(inspectTauriTestingSetup({}), {
			dependencyPresent: false,
			featurePresent: false,
			featureIncludesDriver: false,
			pluginPresent: false,
			pluginGuarded: false,
			pluginRegistered: false,
			permissionPresent: false,
			ready: false,
		});
		assert.deepStrictEqual(inspectTauriTestingSetup({
			cargoToml: '[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
		}), {
			dependencyPresent: false,
			featurePresent: true,
			featureIncludesDriver: true,
			pluginPresent: false,
			pluginGuarded: false,
			pluginRegistered: false,
			permissionPresent: false,
			ready: false,
		});
		assert.deepStrictEqual(inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = []\n',
		}), {
			dependencyPresent: true,
			featurePresent: true,
			featureIncludesDriver: false,
			pluginPresent: false,
			pluginGuarded: false,
			pluginRegistered: false,
			permissionPresent: false,
			ready: false,
		});
		assert.deepStrictEqual(inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n',
		}), {
			dependencyPresent: true,
			featurePresent: false,
			featureIncludesDriver: false,
			pluginPresent: false,
			pluginGuarded: false,
			pluginRegistered: false,
			permissionPresent: false,
			ready: false,
		});
		assert.deepStrictEqual(inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
			rustEntry: 'builder.plugin(tauri_plugin_wdio_webdriver::init());',
		}), {
			dependencyPresent: true,
			featurePresent: true,
			featureIncludesDriver: true,
			pluginPresent: true,
			pluginGuarded: false,
			pluginRegistered: true,
			permissionPresent: false,
			ready: false,
		});
		const guarded = inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
			rustEntry: '#[cfg(all(debug_assertions, feature = "prebase-testing"))] { builder = builder.plugin(tauri_plugin_wdio_webdriver::init()); }',
			capabilitiesJson: '{"permissions":["wdio-webdriver:default"]}',
		});
		assert.deepStrictEqual({
			pluginPresent: guarded.pluginPresent,
			pluginGuarded: guarded.pluginGuarded,
			pluginRegistered: guarded.pluginRegistered,
			ready: guarded.ready,
		}, {
			pluginPresent: true,
			pluginGuarded: true,
			pluginRegistered: true,
			ready: true,
		});
		const unguardedInit = inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
			rustEntry: 'tauri_plugin_wdio_webdriver::init()',
			capabilitiesJson: '{"permissions":["wdio-webdriver:default"]}',
		});
		assert.deepStrictEqual({
			pluginPresent: unguardedInit.pluginPresent,
			pluginGuarded: unguardedInit.pluginGuarded,
			ready: unguardedInit.ready,
		}, {
			pluginPresent: true,
			pluginGuarded: false,
			ready: false,
		});
		const unguardedBuilder = inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
			rustEntry: 'let mut builder = tauri::Builder::default();\nbuilder.plugin(tauri_plugin_wdio_webdriver::init());\n',
			capabilitiesJson: '{"permissions":["wdio-webdriver:default"]}',
		});
		assert.deepStrictEqual({
			pluginPresent: unguardedBuilder.pluginPresent,
			pluginRegistered: unguardedBuilder.pluginRegistered,
			pluginGuarded: unguardedBuilder.pluginGuarded,
			ready: unguardedBuilder.ready,
		}, {
			pluginPresent: true,
			pluginRegistered: true,
			pluginGuarded: false,
			ready: false,
		});
		const stringOnly = inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
			rustEntry: 'fn main() { let _ = "tauri_plugin_wdio_webdriver"; }',
			capabilitiesJson: '{"permissions":["wdio-webdriver:default"]}',
		});
		assert.deepStrictEqual({
			pluginPresent: stringOnly.pluginPresent,
			pluginRegistered: stringOnly.pluginRegistered,
			pluginGuarded: stringOnly.pluginGuarded,
			permissionPresent: stringOnly.permissionPresent,
			ready: stringOnly.ready,
		}, {
			pluginPresent: true,
			pluginRegistered: true,
			pluginGuarded: false,
			permissionPresent: true,
			ready: false,
		});
		const cargoComplete = inspectTauriTestingSetup({
			cargoToml: '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n',
		});
		assert.deepStrictEqual({
			dependencyPresent: cargoComplete.dependencyPresent,
			featurePresent: cargoComplete.featurePresent,
			featureIncludesDriver: cargoComplete.featureIncludesDriver,
			pluginGuarded: cargoComplete.pluginGuarded,
			ready: cargoComplete.ready,
		}, {
			dependencyPresent: true,
			featurePresent: true,
			featureIncludesDriver: true,
			pluginGuarded: false,
			ready: false,
		});
	});

	test('repairs every partial Cargo permutation without duplicating entries', () => {
		const nothing = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n';
		const depOnly = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n';
		const featureOnly = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\n\n[features]\nprebase-testing = []\n';
		const featureMissingDriver = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n\n[features]\nprebase-testing = []\n';
		const complete = '[package]\nname="demo"\n[dependencies]\ntauri = "2"\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n';

		const cases = [
			{ cargo: nothing, before: { dependencyPresent: false, featurePresent: false, featureIncludesDriver: false } },
			{ cargo: depOnly, before: { dependencyPresent: true, featurePresent: false, featureIncludesDriver: false } },
			{ cargo: featureOnly, before: { dependencyPresent: false, featurePresent: true, featureIncludesDriver: false } },
			{ cargo: featureMissingDriver, before: { dependencyPresent: true, featurePresent: true, featureIncludesDriver: false } },
			{ cargo: complete, before: { dependencyPresent: true, featurePresent: true, featureIncludesDriver: true } },
		];
		for (const item of cases) {
			const before = inspectTauriTestingSetup({ cargoToml: item.cargo });
			assert.deepStrictEqual({
				dependencyPresent: before.dependencyPresent,
				featurePresent: before.featurePresent,
				featureIncludesDriver: before.featureIncludesDriver,
				ready: before.ready,
			}, { ...item.before, ready: false });
			const once = applyCargoTestingDependencies(item.cargo);
			if (item.cargo === complete) {
				assert.strictEqual(once, item.cargo);
			}
			assert.match(once, /tauri-plugin-wdio-webdriver\s*=/);
			assert.match(once, /prebase-testing\s*=\s*\[[^\]]*tauri-plugin-wdio-webdriver/);
			assert.strictEqual(applyCargoTestingDependencies(once), once);
			assert.strictEqual((once.match(/tauri-plugin-wdio-webdriver\s*=/g) ?? []).length, 1);
			assert.strictEqual((once.match(/^\s*prebase-testing\s*=/gm) ?? []).length, 1);
			const repaired = inspectTauriTestingSetup({ cargoToml: once });
			assert.deepStrictEqual({
				dependencyPresent: repaired.dependencyPresent,
				featurePresent: repaired.featurePresent,
				featureIncludesDriver: repaired.featureIncludesDriver,
				pluginGuarded: repaired.pluginGuarded,
				ready: repaired.ready,
			}, {
				dependencyPresent: true,
				featurePresent: true,
				featureIncludesDriver: true,
				pluginGuarded: false,
				ready: false,
			});
		}

		const depOnlyPreview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: depOnly,
			rustEntry: rust,
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.ok(!('error' in depOnlyPreview));
		if ('error' in depOnlyPreview) {
			return;
		}
		const cargoChange = depOnlyPreview.changes.find(change => change.path === 'src-tauri/Cargo.toml');
		assert.ok(cargoChange?.preview.includes('prebase-testing'));
		assert.ok(!cargoChange?.preview.includes('tauri-plugin-wdio-webdriver ='));

		const featureOnlyPreview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: featureOnly,
			rustEntry: rust,
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.ok(!('error' in featureOnlyPreview));
		if ('error' in featureOnlyPreview) {
			return;
		}
		const featureOnlyCargo = featureOnlyPreview.changes.find(change => change.path === 'src-tauri/Cargo.toml');
		assert.ok(featureOnlyCargo?.preview.includes('tauri-plugin-wdio-webdriver ='));
		assert.ok(featureOnlyCargo?.preview.includes('prebase-testing'));

		const featureMissingPreview = previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: featureMissingDriver,
			rustEntry: rust,
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		});
		assert.ok(!('error' in featureMissingPreview));
		if ('error' in featureMissingPreview) {
			return;
		}
		const featureMissingCargo = featureMissingPreview.changes.find(change => change.path === 'src-tauri/Cargo.toml');
		assert.ok(featureMissingCargo?.preview.includes('prebase-testing'));
		assert.ok(!featureMissingCargo?.preview.includes('tauri-plugin-wdio-webdriver ='));

		assert.deepStrictEqual(previewTauriTestingSetup({
			appRoot: '/app',
			cargoToml: complete,
			rustEntry: 'fn main() {\n    tauri::Builder::default().plugin(tauri_plugin_wdio_webdriver::init());\n}\n',
			rustEntryPath: 'src-tauri/src/lib.rs',
			cargoPath: 'src-tauri/Cargo.toml',
			capabilitiesPath: 'src-tauri/capabilities/default.json',
		}), { error: 'WebDriver plugin is registered without debug_assertions and feature prebase-testing. Manual review required; PreBase will not rewrite this Rust source.' });
		assert.deepStrictEqual(applyRustTestingPlugins('fn main() { builder.plugin(tauri_plugin_wdio_webdriver::init()); }\n'), {
			error: 'WebDriver plugin is registered without debug_assertions and feature prebase-testing. Manual review required; PreBase will not rewrite this Rust source.',
		});
	});
});

suite('tauriTestingTransaction', () => {
	const writes = [
		{ resource: 'Cargo.toml', before: 'cargo-old', after: 'cargo-new' },
		{ resource: 'lib.rs', before: 'rust-old', after: 'rust-new' },
		{ resource: 'capabilities.json', before: undefined, after: 'capabilities-new' },
	] as const;

	function transactionIo(failAt: number) {
		const files = new Map<string, string>([
			['Cargo.toml', 'cargo-old'],
			['lib.rs', 'rust-old'],
		]);
		const operations: string[] = [];
		let forwardWrites = 0;
		return {
			files,
			operations,
			io: {
				async write(resource: string, value: string): Promise<void> {
					operations.push(`write ${resource} ${value}`);
					if (value.endsWith('-new') && ++forwardWrites === failAt) {
						throw new Error(`write ${failAt} failed`);
					}
					files.set(resource, value);
				},
				async remove(resource: string): Promise<void> {
					operations.push(`remove ${resource}`);
					files.delete(resource);
				},
			},
		};
	}

	test('first write failure leaves every original file untouched', async () => {
		const state = transactionIo(1);
		const result = await applyTauriTestingTransaction(writes, state.io);
		assert.deepStrictEqual(result, { ok: false, reason: 'write 1 failed', rollbackErrors: [] });
		assert.deepStrictEqual(Object.fromEntries(state.files), {
			'Cargo.toml': 'cargo-old',
			'lib.rs': 'rust-old',
		});
		assert.deepStrictEqual(state.operations, ['write Cargo.toml cargo-new']);
	});

	test('second write failure restores the first updated file', async () => {
		const state = transactionIo(2);
		const result = await applyTauriTestingTransaction(writes, state.io);
		assert.deepStrictEqual(result, { ok: false, reason: 'write 2 failed', rollbackErrors: [] });
		assert.deepStrictEqual(Object.fromEntries(state.files), {
			'Cargo.toml': 'cargo-old',
			'lib.rs': 'rust-old',
		});
		assert.deepStrictEqual(state.operations, [
			'write Cargo.toml cargo-new',
			'write lib.rs rust-new',
			'write Cargo.toml cargo-old',
		]);
	});

	test('third write failure restores both earlier updates in reverse order', async () => {
		const state = transactionIo(3);
		const result = await applyTauriTestingTransaction(writes, state.io);
		assert.deepStrictEqual(result, { ok: false, reason: 'write 3 failed', rollbackErrors: [] });
		assert.deepStrictEqual(Object.fromEntries(state.files), {
			'Cargo.toml': 'cargo-old',
			'lib.rs': 'rust-old',
		});
		assert.deepStrictEqual(state.operations, [
			'write Cargo.toml cargo-new',
			'write lib.rs rust-new',
			'write capabilities.json capabilities-new',
			'write lib.rs rust-old',
			'write Cargo.toml cargo-old',
		]);
	});

	test('rollback failures include the resource name', async () => {
		const files = new Map<string, string>([
			['src-tauri/Cargo.toml', 'cargo-old'],
			['src-tauri/src/lib.rs', 'rust-old'],
		]);
		const pathWrites = [
			{ resource: 'src-tauri/Cargo.toml', before: 'cargo-old', after: 'cargo-new' },
			{ resource: 'src-tauri/src/lib.rs', before: 'rust-old', after: 'rust-new' },
		];
		const result = await applyTauriTestingTransaction(pathWrites, {
			async write(resource: string, value: string): Promise<void> {
				if (value === 'rust-new') {
					throw new Error('write rust failed');
				}
				if (value === 'cargo-old') {
					throw new Error('disk full');
				}
				files.set(resource, value);
			},
			async remove(): Promise<void> { /* unused */ },
		});
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.strictEqual(result.reason, 'write rust failed');
			assert.deepStrictEqual(result.rollbackErrors, ['src-tauri/Cargo.toml: disk full']);
		}
		assert.strictEqual(files.get('src-tauri/Cargo.toml'), 'cargo-new');
		assert.strictEqual(files.get('src-tauri/src/lib.rs'), 'rust-old');
	});

	test('rollback deletes a newly created capability before restoring older files', async () => {
		const state = transactionIo(3);
		const writesWithCompletedCreation = [writes[0], writes[2], writes[1]];
		const result = await applyTauriTestingTransaction(writesWithCompletedCreation, state.io);
		assert.deepStrictEqual(result, { ok: false, reason: 'write 3 failed', rollbackErrors: [] });
		assert.deepStrictEqual(Object.fromEntries(state.files), {
			'Cargo.toml': 'cargo-old',
			'lib.rs': 'rust-old',
		});
		assert.deepStrictEqual(state.operations, [
			'write Cargo.toml cargo-new',
			'write capabilities.json capabilities-new',
			'write lib.rs rust-new',
			'remove capabilities.json',
			'write Cargo.toml cargo-old',
		]);
	});

	test('live fixture copy repairs a complete missing setup and rolls back partial writes', async () => {
		const source = join(findRepoRoot(), 'test/prebase/fixtures/desktop-tauri-plain');
		assert.ok(existsSync(join(source, 'src-tauri/Cargo.toml')));

		const copyOnce = () => {
			const dir = mkdtempSync(join(tmpdir(), 'pb-tauri-setup-'));
			cpSync(source, dir, { recursive: true });
			return {
				dir,
				cargoPath: join(dir, 'src-tauri/Cargo.toml'),
				rustPath: join(dir, 'src-tauri/src/lib.rs'),
				capsPath: join(dir, 'src-tauri/capabilities/default.json'),
			};
		};
		const read = (copy: { cargoPath: string; rustPath: string; capsPath: string }) => ({
			cargoToml: readFileSync(copy.cargoPath, 'utf8'),
			rustEntry: readFileSync(copy.rustPath, 'utf8'),
			capabilitiesJson: readFileSync(copy.capsPath, 'utf8'),
		});
		const previewOf = (copy: ReturnType<typeof copyOnce>) => {
			const files = read(copy);
			return previewTauriTestingSetup({
				appRoot: copy.dir,
				...files,
				rustEntryPath: 'src-tauri/src/lib.rs',
				cargoPath: 'src-tauri/Cargo.toml',
				capabilitiesPath: 'src-tauri/capabilities/default.json',
			});
		};
		const applyCopy = async (copy: ReturnType<typeof copyOnce>, failAt?: number) => {
			const files = read(copy);
			const cargoNext = applyCargoTestingDependencies(files.cargoToml);
			const rustNext = applyRustTestingPlugins(files.rustEntry);
			assert.strictEqual(typeof rustNext, 'string');
			const capsNext = applyCapabilitiesTestingPermission(files.capabilitiesJson);
			assert.strictEqual(typeof capsNext, 'string');
			const writes = [
				{ resource: copy.cargoPath, before: files.cargoToml, after: cargoNext },
				{ resource: copy.rustPath, before: files.rustEntry, after: rustNext as string },
				{ resource: copy.capsPath, before: files.capabilitiesJson, after: capsNext as string },
			].filter(write => write.after !== write.before);
			let forward = 0;
			return applyTauriTestingTransaction(writes, {
				async write(resource: string, value: string): Promise<void> {
					if (failAt !== undefined && ++forward === failAt) {
						throw new Error(`injected failure at write ${failAt}`);
					}
					writeFileSync(resource, value);
				},
				async remove(resource: string): Promise<void> {
					rmSync(resource, { force: true });
				},
			});
		};

		const cancelled = copyOnce();
		try {
			const before = read(cancelled);
			const preview = previewOf(cancelled);
			assert.ok(!('error' in preview));
			assert.ok(preview.changes.some(change => change.path.includes('Cargo.toml')));
			assert.ok(preview.changes.some(change => change.path.includes('lib.rs')));
			assert.deepStrictEqual(read(cancelled), before);
			assert.strictEqual(inspectTauriTestingSetup(before).ready, false);
		} finally {
			rmSync(cancelled.dir, { recursive: true, force: true });
		}

		const approved = copyOnce();
		try {
			const result = await applyCopy(approved);
			assert.deepStrictEqual(result, { ok: true });
			assert.strictEqual(inspectTauriTestingSetup(read(approved)).ready, true);
			const completePreview = previewOf(approved);
			assert.ok(!('error' in completePreview));
			assert.strictEqual(completePreview.changes.length, 0);
			const again = await applyCopy(approved);
			assert.deepStrictEqual(again, { ok: true });
			assert.strictEqual(inspectTauriTestingSetup(read(approved)).ready, true);
		} finally {
			rmSync(approved.dir, { recursive: true, force: true });
		}

		const afterCargo = copyOnce();
		try {
			const original = read(afterCargo);
			const result = await applyCopy(afterCargo, 2);
			assert.strictEqual(result.ok, false);
			if (!result.ok) {
				assert.ok(result.reason.includes('injected failure at write 2'));
				assert.deepStrictEqual(result.rollbackErrors, []);
			}
			assert.deepStrictEqual(read(afterCargo), original);
		} finally {
			rmSync(afterCargo.dir, { recursive: true, force: true });
		}

		const afterRust = copyOnce();
		try {
			const original = read(afterRust);
			const result = await applyCopy(afterRust, 3);
			assert.strictEqual(result.ok, false);
			if (!result.ok) {
				assert.ok(result.reason.includes('injected failure at write 3'));
				assert.deepStrictEqual(result.rollbackErrors, []);
			}
			assert.deepStrictEqual(read(afterRust), original);
		} finally {
			rmSync(afterRust.dir, { recursive: true, force: true });
		}
	});

	test('live fixture copy reconciles each Cargo permutation and does not rewrite unguarded Rust', async () => {
		const source = join(findRepoRoot(), 'test/prebase/fixtures/desktop-tauri-plain');
		const copyOnce = () => {
			const dir = mkdtempSync(join(tmpdir(), 'pb-tauri-perm-'));
			cpSync(source, dir, { recursive: true });
			return {
				dir,
				cargoPath: join(dir, 'src-tauri/Cargo.toml'),
				rustPath: join(dir, 'src-tauri/src/lib.rs'),
			};
		};
		const patchCargo = (cargoPath: string, kind: 'nothing' | 'depOnly' | 'featureOnly' | 'featureMissingDriver' | 'complete') => {
			let cargo = readFileSync(cargoPath, 'utf8');
			if (kind === 'depOnly' || kind === 'featureMissingDriver' || kind === 'complete') {
				cargo = cargo.replace('[dependencies]\n', '[dependencies]\ntauri-plugin-wdio-webdriver = { version = "1", optional = true }\n');
			}
			if (kind === 'featureOnly' || kind === 'featureMissingDriver') {
				cargo += '\n[features]\nprebase-testing = []\n';
			}
			if (kind === 'complete') {
				cargo += '\n[features]\nprebase-testing = ["dep:tauri-plugin-wdio-webdriver"]\n';
			}
			writeFileSync(cargoPath, cargo);
		};

		for (const kind of ['nothing', 'depOnly', 'featureOnly', 'featureMissingDriver', 'complete'] as const) {
			const copy = copyOnce();
			try {
				patchCargo(copy.cargoPath, kind);
				const before = readFileSync(copy.cargoPath, 'utf8');
				const once = applyCargoTestingDependencies(before);
				assert.match(once, /tauri-plugin-wdio-webdriver\s*=/);
				assert.match(once, /prebase-testing\s*=\s*\[[^\]]*tauri-plugin-wdio-webdriver/);
				assert.strictEqual((once.match(/tauri-plugin-wdio-webdriver\s*=/g) ?? []).length, 1);
				assert.strictEqual((once.match(/^\s*prebase-testing\s*=/gm) ?? []).length, 1);
				assert.strictEqual(applyCargoTestingDependencies(once), once);
				writeFileSync(copy.cargoPath, once);
				const state = inspectTauriTestingSetup({ cargoToml: readFileSync(copy.cargoPath, 'utf8') });
				assert.deepStrictEqual({
					dependencyPresent: state.dependencyPresent,
					featurePresent: state.featurePresent,
					featureIncludesDriver: state.featureIncludesDriver,
				}, { dependencyPresent: true, featurePresent: true, featureIncludesDriver: true });
				if (kind === 'complete') {
					assert.strictEqual(once, before);
				}
			} finally {
				rmSync(copy.dir, { recursive: true, force: true });
			}
		}

		const unguarded = copyOnce();
		try {
			const originalRust = readFileSync(unguarded.rustPath, 'utf8');
			const originalCargo = readFileSync(unguarded.cargoPath, 'utf8');
			writeFileSync(unguarded.rustPath, originalRust.replace(
				'tauri::Builder::default()',
				'tauri::Builder::default().plugin(tauri_plugin_wdio_webdriver::init())',
			));
			const rustBefore = readFileSync(unguarded.rustPath, 'utf8');
			const preview = previewTauriTestingSetup({
				appRoot: unguarded.dir,
				cargoToml: originalCargo,
				rustEntry: rustBefore,
				capabilitiesJson: readFileSync(join(unguarded.dir, 'src-tauri/capabilities/default.json'), 'utf8'),
				rustEntryPath: 'src-tauri/src/lib.rs',
				cargoPath: 'src-tauri/Cargo.toml',
				capabilitiesPath: 'src-tauri/capabilities/default.json',
			});
			assert.deepStrictEqual(preview, {
				error: 'WebDriver plugin is registered without debug_assertions and feature prebase-testing. Manual review required; PreBase will not rewrite this Rust source.',
			});
			assert.deepStrictEqual(applyRustTestingPlugins(rustBefore), {
				error: 'WebDriver plugin is registered without debug_assertions and feature prebase-testing. Manual review required; PreBase will not rewrite this Rust source.',
			});
			assert.strictEqual(readFileSync(unguarded.rustPath, 'utf8'), rustBefore);
			assert.strictEqual(readFileSync(unguarded.cargoPath, 'utf8'), originalCargo);
		} finally {
			rmSync(unguarded.dir, { recursive: true, force: true });
		}
	});
});

suite('desktopTestModel', () => {
	test('records steps and redacts secret fill values', () => {
		const run = createDesktopTestRun({ id: 't1', framework: 'electron', mode: 'renderer', backend: 'cdp', workspaceRoot: '/app' });
		recordDesktopTestStep(run, {
			kind: 'interact',
			action: 'fill',
			locator: { by: 'label', value: 'API token', exact: false },
			resolvedTarget: 'sk-secret-value',
			startedAt: Date.now(),
			durationMs: 12,
			ok: true,
		});
		assert.strictEqual(run.steps[0].resolvedTarget, '[redacted]');
		const summary = summarizeDesktopTestRun(run);
		assert.strictEqual(summary.passedSteps, 1);
		assert.strictEqual(summary.failedSteps, 0);
	});

	test('redacts secrets in failure text and keeps ordinary fill values', () => {
		const run = createDesktopTestRun({ id: 't2', framework: 'tauri', mode: 'fullApp', backend: 'webdriver', workspaceRoot: '/app' });
		recordDesktopTestStep(run, {
			kind: 'interact',
			action: 'fill',
			locator: { by: 'label', value: 'Name', exact: false },
			resolvedTarget: 'Ada',
			startedAt: Date.now(),
			durationMs: 4,
			ok: true,
		});
		recordDesktopTestStep(run, {
			kind: 'assert',
			action: 'text',
			startedAt: Date.now(),
			durationMs: 8,
			ok: false,
			failure: 'password=hunter2 while waiting for Ready',
		});
		assert.strictEqual(run.steps[0].resolvedTarget, 'Ada');
		assert.match(String(run.steps[1].failure), /password=\[redacted\]/);
		assert.strictEqual(summarizeDesktopTestRun(run).failedSteps, 1);
	});
});

suite('desktopWebDriver', () => {
	test('only treats HTTP success plus ready true as WebDriver ready', () => {
		assert.strictEqual(isWebDriverReadyStatus(200, { value: { ready: true, message: 'ok' } }), true);
		assert.strictEqual(isWebDriverReadyStatus(200, { ready: true }), true);
		assert.strictEqual(isWebDriverReadyStatus(200, { value: { ready: false } }), false);
		assert.strictEqual(isWebDriverReadyStatus(404, { value: { ready: true } }), false);
		assert.strictEqual(isWebDriverReadyStatus(500, { value: { ready: true } }), false);
		assert.strictEqual(isWebDriverReadyStatus(200, undefined), false);
		assert.strictEqual(isWebDriverReadyStatus(200, { value: { error: 'unknown command' } }), false);
		assert.strictEqual(isWebDriverReadyStatus(200, { value: { ready: true, error: null } }), true);
		assert.strictEqual(isWebDriverReadyStatus(200, { value: { ready: true, error: 'crash' } }), false);
		assert.strictEqual(isWebDriverReadyStatus(200, { ready: 'true' }), false);
		assert.strictEqual(isWebDriverReadyStatus(401, '<html>nope</html>'), false);
		assert.deepStrictEqual(webDriverProtocolError({ value: { error: 'stale element reference', message: 'element is not attached' } }), {
			error: 'stale element reference',
			message: 'element is not attached',
		});
		const giant = 'x'.repeat(5_000);
		assert.throws(() => assertWebDriverSuccess('execute', {
			status: 200,
			json: true,
			body: { value: { error: 'javascript error', message: giant } },
		}), (error: Error) => {
			assert.match(error.message, /^execute failed \(HTTP 200, javascript error: /);
			assert.ok(error.message.length < 400);
			assert.ok(!error.message.includes(giant));
			return true;
		});
		assert.throws(() => assertWebDriverSuccess('screenshot', {
			status: 500,
			json: false,
			body: giant,
		}), /^Error: screenshot failed \(HTTP 500, non-JSON\)\.$/);
		assert.throws(() => assertWebDriverSuccess('execute', {
			status: 200,
			json: true,
			body: { value: { error: 'javascript error', message: 'boom' } },
		}), /execute failed \(HTTP 200, javascript error: boom\)/);
	});

	test('waitUntilReady accepts a W3C ready envelope and rejects 404, 500, and ready false', async () => {
		const original = globalThis.fetch;
		const statuses = [
			{ status: 404, body: 'not found' },
			{ status: 200, body: '{not json' },
			{ status: 200, body: JSON.stringify({ value: { ready: false } }) },
			{ status: 500, body: JSON.stringify({ value: { ready: true } }) },
			{ status: 200, body: JSON.stringify({ value: { ready: true, error: 'crash' } }) },
			{ status: 200, body: JSON.stringify({ value: { ready: true, message: 'ready' } }) },
		];
		globalThis.fetch = (async () => {
			const next = statuses.shift();
			assert.ok(next, 'waitUntilReady must not treat earlier HTTP or protocol-error envelopes as ready');
			return { status: next.status, text: async () => next.body } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			await client.waitUntilReady(5_000);
			assert.strictEqual(statuses.length, 0);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('waitUntilReady does not treat HTTP 404 with a ready JSON body as ready', async () => {
		const original = globalThis.fetch;
		let polls = 0;
		globalThis.fetch = (async () => {
			polls++;
			return { status: 404, text: async () => JSON.stringify({ value: { ready: true, message: 'ok' } }) } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			await assert.rejects(() => client.waitUntilReady(80), /did not become ready/);
			assert.ok(polls >= 1);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('waitUntilReady times out on a hung status request', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			await new Promise<void>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
			});
			return { status: 200, text: async () => JSON.stringify({ value: { ready: true } }) } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			await assert.rejects(() => client.waitUntilReady(80), /did not become ready/);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('deleteSession is bound to 2s and swallows shutdown failures', async () => {
		assert.strictEqual(WEBDRIVER_DELETE_SESSION_TIMEOUT_MS, 2_000);
		const original = globalThis.fetch;
		const urls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			urls.push(`${init?.method ?? 'GET'} ${String(input)}`);
			await new Promise<void>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
			});
			return { status: 200, text: async () => '{}' } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			const started = Date.now();
			await client.deleteSession({ sessionId: 's-1', baseUrl: 'http://127.0.0.1:4444' });
			const elapsed = Date.now() - started;
			assert.deepStrictEqual(urls, ['DELETE http://127.0.0.1:4444/session/s-1']);
			assert.ok(elapsed >= 1_500 && elapsed < 4_000, `deleteSession elapsed ${elapsed}ms`);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('only allows loopback URLs', () => {
		assert.strictEqual(webDriverBaseUrl(4445), 'http://127.0.0.1:4445');
		assert.throws(() => webDriverBaseUrl(0));
		assert.throws(() => webDriverBaseUrl(65536));
		new DesktopWebDriverClient('http://127.0.0.1:4444');
		new DesktopWebDriverClient('http://localhost:4444');
		new DesktopWebDriverClient('http://[::1]:4444');
		assert.throws(() => new DesktopWebDriverClient('http://example.com:4444'));
		assert.throws(() => new DesktopWebDriverClient('http://192.168.1.9:4444'));
		assert.throws(() => new DesktopWebDriverClient('http://0.0.0.0:4444'));
		assert.throws(() => new DesktopWebDriverClient('ws://127.0.0.1:4444'));
	});

	test('cancels an in-flight WebDriver ready wait without leaving the loop running', async () => {
		const client = new DesktopWebDriverClient('http://127.0.0.1:1');
		const cts = new CancellationTokenSource();
		cts.cancel();
		await assert.rejects(() => client.waitUntilReady(2_000, cts.token));
		cts.dispose();
	});

	test('newSession, execute, screenshot, and performActions fail closed on HTTP 200 protocol errors', async () => {
		const original = globalThis.fetch;
		const envelope = JSON.stringify({
			value: { sessionId: 's-fake', error: 'unknown error', message: 'driver crashed' },
		});
		const urls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			urls.push(`${init?.method ?? 'GET'} ${String(input)}`);
			return { status: 200, text: async () => envelope } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			await assert.rejects(() => client.newSession(), /newSession failed \(HTTP 200, unknown error: driver crashed\)/);
			const session = { sessionId: 's-1', baseUrl: 'http://127.0.0.1:4444' };
			await assert.rejects(() => client.execute(session, 'return 1'), /execute failed \(HTTP 200, unknown error: driver crashed\)/);
			await assert.rejects(() => client.screenshot(session), /screenshot failed \(HTTP 200, unknown error: driver crashed\)/);
			await assert.rejects(() => client.performActions(session, []), /actions failed \(HTTP 200, unknown error: driver crashed\)/);
			await client.deleteSession(session);
			assert.ok(urls.some(url => url.startsWith('DELETE ')));
		} finally {
			globalThis.fetch = original;
		}
	});

	test('parses a session id and rejects a non-PNG screenshot without calling a remote host', async () => {
		const original = globalThis.fetch;
		const urls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			urls.push(`${init?.method ?? 'GET'} ${url}`);
			if (url.endsWith('/session') && init?.method === 'POST') {
				return { status: 200, text: async () => JSON.stringify({ value: { sessionId: 's-1' } }) } as Response;
			}
			if (url.endsWith('/screenshot')) {
				return { status: 200, text: async () => JSON.stringify({ value: 'short' }) } as Response;
			}
			if (url.includes('/execute/sync')) {
				return { status: 400, text: async () => JSON.stringify({ value: { error: 'stale' } }) } as Response;
			}
			return { status: 404, text: async () => '' } as Response;
		}) as typeof fetch;
		try {
			const client = new DesktopWebDriverClient('http://127.0.0.1:4444');
			const session = await client.newSession();
			assert.strictEqual(session.sessionId, 's-1');
			await assert.rejects(() => client.screenshot(session), /PNG/);
			await assert.rejects(() => client.execute(session, 'return 1'), /execute failed/);
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				urls.push(`${init?.method ?? 'GET'} ${url}`);
				return { status: 200, text: async () => 'not-json' } as Response;
			}) as typeof fetch;
			await assert.rejects(() => client.performActions(session, []), /actions failed/);
			assert.ok(urls.every(url => url.includes('127.0.0.1') || url.includes('localhost')));
		} finally {
			globalThis.fetch = original;
		}
	});
});

suite('desktopShutdownPolicy', () => {
	test('test-owned processes terminate even when preview externals are detached', () => {
		assert.deepStrictEqual(resolveDesktopShutdownPolicy(true, false), {
			closeManagedWindows: true,
			terminateOwnedChildren: false,
		});
		const root = findRepoRoot();
		const main = readFileSync(join(root, 'src/vs/platform/prebaseDesktop/electron-main/prebaseDesktopMainService.ts'), 'utf8');
		const runtime = readFileSync(join(root, 'src/vs/workbench/contrib/prebase/browser/prebaseDesktopRuntimeService.ts'), 'utf8');
		assert.match(main, /const killPids = new Set\(testPids\)/);
		assert.match(main, /policy\.closeManagedWindows \|\| session\.purpose === 'test'/);
		assert.match(runtime, /stopExternal \|\| testOwned/);
		assert.match(runtime, /stopManaged \|\| testOwned/);
	});
});

suite('desktopAutomationLazyLoad', () => {
	test('production desktop runtime does not import Playwright or WebdriverIO', () => {
		const root = findRepoRoot();
		const files = [
			...collectTsFiles(join(root, 'src/vs/workbench/contrib/prebase/common/runtime')),
			...collectTsFiles(join(root, 'src/vs/platform/prebaseDesktop')),
			join(root, 'src/vs/workbench/contrib/prebase/browser/prebaseDesktopRuntimeService.ts'),
			join(root, 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeService.ts'),
			join(root, 'src/vs/workbench/contrib/prebase/browser/prebaseRuntimeView.ts'),
			join(root, 'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts'),
			join(root, 'extensions/prebase-magnus/src/desktopTools.ts'),
		];
		const driverImport = /(?:from|import\(|require\()\s*['"](?:playwright(?:-core)?|playwright\/[^'"]+|webdriverio|@wdio\/[^'"]+)['"]/;
		assert.ok(files.length > 8);
		for (const file of files) {
			assert.ok(existsSync(file), `missing production file ${file}`);
			const text = readFileSync(file, 'utf8');
			assert.ok(!driverImport.test(text), `${file} must not import playwright or webdriverio`);
		}
	});
});

suite('tauriTestingCandidatePaths', () => {
	test('resolves lib.rs and capabilities next to src-tauri Cargo.toml', () => {
		assert.deepStrictEqual(tauriTestingCandidatePaths('src-tauri/Cargo.toml'), {
			rustEntries: ['src-tauri/src/lib.rs', 'src-tauri/src/main.rs'],
			capabilities: ['src-tauri/capabilities/default.json', 'src-tauri/capabilities/desktop.json'],
		});
	});

	test('applies debug-only plugins to the plain fixture without touching the already-enabled fixture', () => {
		const root = findRepoRoot();
		const plainRoot = join(root, 'test/prebase/fixtures/desktop-tauri-plain/src-tauri');
		const enabledRoot = join(root, 'test/prebase/fixtures/desktop-tauri/src-tauri');
		const plainCargo = readFileSync(join(plainRoot, 'Cargo.toml'), 'utf8');
		const plainRust = readFileSync(join(plainRoot, 'src/lib.rs'), 'utf8');
		const plainCaps = readFileSync(join(plainRoot, 'capabilities/default.json'), 'utf8');
		const enabledCargo = readFileSync(join(enabledRoot, 'Cargo.toml'), 'utf8');
		const enabledRust = readFileSync(join(enabledRoot, 'src/lib.rs'), 'utf8');
		const enabledCaps = readFileSync(join(enabledRoot, 'capabilities/default.json'), 'utf8');

		const plainPreview = previewTauriTestingSetup({
			appRoot: plainRoot,
			cargoToml: plainCargo,
			rustEntry: plainRust,
			capabilitiesJson: plainCaps,
			rustEntryPath: 'src/lib.rs',
			cargoPath: 'Cargo.toml',
			capabilitiesPath: 'capabilities/default.json',
		});
		assert.ok(!('error' in plainPreview));
		if ('error' in plainPreview) {
			return;
		}
		assert.ok(plainPreview.changes.length >= 2);
		assert.strictEqual(plainCargo.includes('tauri-plugin-wdio-webdriver'), false);
		const appliedCargo = applyCargoTestingDependencies(plainCargo);
		const appliedRust = applyRustTestingPlugins(plainRust);
		assert.ok(typeof appliedRust === 'string');
		assert.match(appliedCargo, /prebase-testing/);
		assert.ok((appliedRust as string).includes('feature = "prebase-testing"'));
		assert.strictEqual(plainCargo.includes('tauri-plugin-wdio-webdriver'), false, 'preview/apply must not mutate the original fixture string');

		const enabledPreview = previewTauriTestingSetup({
			appRoot: enabledRoot,
			cargoToml: enabledCargo,
			rustEntry: enabledRust,
			capabilitiesJson: enabledCaps,
			rustEntryPath: 'src/lib.rs',
			cargoPath: 'Cargo.toml',
			capabilitiesPath: 'capabilities/default.json',
		});
		assert.ok(!('error' in enabledPreview));
		if ('error' in enabledPreview) {
			return;
		}
		assert.deepStrictEqual(enabledPreview.changes, []);
		assert.strictEqual(applyCargoTestingDependencies(enabledCargo), enabledCargo);
		assert.strictEqual(applyRustTestingPlugins(enabledRust), enabledRust);
	});

	test('keeps fixture frontend payloads bounded and enables only the embedded WebDriver plugin', () => {
		const root = findRepoRoot();
		for (const fixtureName of ['desktop-tauri', 'desktop-tauri-plain']) {
			const fixtureRoot = join(root, 'test/prebase/fixtures', fixtureName);
			const configPath = join(fixtureRoot, 'src-tauri/tauri.conf.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8')) as { build?: { frontendDist?: string } };
			const frontendDist = config.build?.frontendDist;
			assert.strictEqual(frontendDist, '../web');
			assert.strictEqual(resolve(dirname(configPath), frontendDist), join(fixtureRoot, 'web'));
		}

		const enabledRoot = join(root, 'test/prebase/fixtures/desktop-tauri/src-tauri');
		const cargoToml = readFileSync(join(enabledRoot, 'Cargo.toml'), 'utf8');
		const capability = JSON.parse(readFileSync(join(enabledRoot, 'capabilities/default.json'), 'utf8')) as { permissions?: string[] };
		assert.deepStrictEqual(
			Array.from(cargoToml.matchAll(/^\s*(tauri-plugin-[\w-]+)\s*=/gm), match => match[1]),
			['tauri-plugin-wdio-webdriver'],
		);
		assert.deepStrictEqual(
			cargoToml.match(/^prebase-testing\s*=\s*\[(.*)\]$/m)?.[1].match(/"([^"]+)"/g),
			['"dep:tauri-plugin-wdio-webdriver"'],
		);
		assert.deepStrictEqual(capability.permissions?.filter(permission => permission.startsWith('wdio')), ['wdio-webdriver:default']);
	});
});

suite('desktopProductPathAcceptance', () => {
	function evaluate(evidence: Record<string, unknown>) {
		const runner = join(findRepoRoot(), 'test/prebase/acceptance/prebase-desktop-product-path.mjs');
		const result = spawnSync(process.execPath, [runner, '--evaluate'], {
			input: JSON.stringify(evidence),
			encoding: 'utf8',
		});
		return { status: result.status, stderr: result.stderr, output: JSON.parse(result.stdout || '{}') };
	}

	function completeEvidence(overrides: Record<string, unknown> = {}) {
		return {
			framework: 'electron',
			bypassedPreBase: false,
			detected: true,
			started: true,
			state: 'testing',
			backend: 'cdp',
			inspected: true,
			filled: true,
			clicked: true,
			asserted: true,
			screenshotOk: true,
			outputOk: true,
			restarted: true,
			assertedAfterRestart: true,
			stopped: true,
			childAfterStop: 'gone',
			portAfterStop: [],
			quit: { remaining: 'gone' },
			...overrides,
		};
	}

	test('fails when Playwright connected directly to the fixture', () => {
		const result = evaluate(completeEvidence({ bypassedPreBase: true }));
		assert.strictEqual(result.status, 1, result.stderr);
		assert.deepStrictEqual(result.output.failures, ['Acceptance connected Playwright directly to the fixture']);
	});

	test('fails when the automation backend is not the PreBase product path', () => {
		const electron = evaluate(completeEvidence({ backend: 'webdriver' }));
		assert.strictEqual(electron.status, 1, electron.stderr);
		assert.deepStrictEqual(electron.output.failures, ['Unexpected automation backend: webdriver']);
		const tauri = evaluate(completeEvidence({ framework: 'tauri', backend: 'cdp' }));
		assert.strictEqual(tauri.status, 1, tauri.stderr);
		assert.deepStrictEqual(tauri.output.failures, ['Unexpected automation backend: cdp']);
	});

	test('fails when the session never reaches Testing', () => {
		const result = evaluate(completeEvidence({ state: 'running' }));
		assert.strictEqual(result.status, 1, result.stderr);
		assert.deepStrictEqual(result.output.failures, ['Session state is running, expected testing']);
	});

	test('passes a complete product-path evidence record', () => {
		for (const evidence of [
			completeEvidence(),
			completeEvidence({ framework: 'tauri', backend: 'webdriver' }),
		]) {
			const result = evaluate(evidence);
			assert.strictEqual(result.status, 0, result.stderr);
			assert.deepStrictEqual(result.output, { ok: true, failures: [] });
		}
	});
});
