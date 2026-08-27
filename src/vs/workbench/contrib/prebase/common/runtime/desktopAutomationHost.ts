/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { DESKTOP_AUTOMATION_BOOTSTRAP } from './desktopAutomationDom.js';
import { DEFAULT_DESKTOP_ACTION_TIMEOUT_MS, DEFAULT_DESKTOP_ASSERT_TIMEOUT_MS, describeLocator, type DesktopAssertCondition, type DesktopInteractAction, type DesktopLocator } from './desktopLocators.js';
import { parseDesktopKeyChord, type DesktopNativeInputBackend } from './desktopNativeInput.js';

export type DesktopEvaluateFn = (expression: string, token?: CancellationToken) => Promise<unknown>;

export interface DesktopAutomationCommand {
	op: string;
	locator?: DesktopLocator;
	value?: string;
	limit?: number;
}

export interface DesktopDomResult {
	ok: boolean;
	code?: string;
	count?: number;
	match?: Record<string, unknown>;
	matches?: Array<Record<string, unknown>>;
	title?: string;
	url?: string;
	visibleText?: string;
	interactive?: Array<Record<string, unknown>>;
	console?: Array<{ level: string; text: string; at: number }>;
	blocker?: Record<string, unknown>;
	reason?: string;
	native?: 'pointer' | 'key' | 'type';
	point?: { x: number; y: number };
	clickCount?: number;
	key?: string;
	modifiers?: { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
	text?: string;
	replaceSelection?: boolean;
}

async function delay(ms: number, token: CancellationToken): Promise<void> {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			dispose.dispose();
			resolve();
		}, ms);
		const dispose = token.onCancellationRequested(() => {
			clearTimeout(timer);
			reject(new CancellationError());
		});
	});
}

function serializeCommand(command: DesktopAutomationCommand): string {
	return JSON.stringify(command);
}

export async function ensureDesktopAutomation(evaluate: DesktopEvaluateFn, token: CancellationToken = CancellationToken.None): Promise<void> {
	await evaluate(DESKTOP_AUTOMATION_BOOTSTRAP, token);
}

export async function runDesktopDomCommand(evaluate: DesktopEvaluateFn, command: DesktopAutomationCommand, token: CancellationToken = CancellationToken.None): Promise<DesktopDomResult> {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
	await ensureDesktopAutomation(evaluate, token);
	const expression = `window.__prebaseDesktopTest.run(${serializeCommand(command)})`;
	const raw = await evaluate(expression, token);
	if (!raw || typeof raw !== 'object') {
		return { ok: false, code: 'invalidResult' };
	}
	return raw as DesktopDomResult;
}

export async function retryDesktopDomCommand(
	evaluate: DesktopEvaluateFn,
	command: DesktopAutomationCommand,
	timeoutMs: number,
	token: CancellationToken = CancellationToken.None,
): Promise<DesktopDomResult> {
	const started = Date.now();
	let last: DesktopDomResult = { ok: false, code: 'notFound' };
	while (Date.now() - started <= timeoutMs) {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		last = await runDesktopDomCommand(evaluate, command, token);
		if (last.ok && last.code !== 'notFound' && last.code !== 'notVisible' && last.code !== 'disabled' && last.code !== 'readonly' && last.code !== 'stateUnchanged') {
			return last;
		}
		if (last.code === 'ambiguous' || last.code === 'unsupported' || last.code === 'wrongControl' || last.code === 'readonly') {
			return last;
		}
		await delay(50, token);
	}
	return last;
}

export async function interactDesktop(
	evaluate: DesktopEvaluateFn,
	action: DesktopInteractAction,
	locator: DesktopLocator,
	value: string | undefined,
	timeoutMs = DEFAULT_DESKTOP_ACTION_TIMEOUT_MS,
	token: CancellationToken = CancellationToken.None,
	native?: DesktopNativeInputBackend,
): Promise<DesktopDomResult> {
	const deadline = Date.now() + timeoutMs;
	const prepared = await retryDesktopDomCommand(evaluate, { op: action, locator, value }, timeoutMs, token);
	if (!prepared.ok) {
		return prepared;
	}
	if (prepared.native === 'pointer') {
		if (!native || prepared.point === undefined) {
			return { ...prepared, ok: false, code: 'nativeInputRequired', reason: 'Pointer actions require the CDP or WebDriver input backend.' };
		}
		await native.click(prepared.point.x, prepared.point.y, prepared.clickCount ?? 1, token);
		if (action === 'check' || action === 'uncheck') {
			const want = action === 'check';
			let last: DesktopDomResult = prepared;
			do {
				if (token.isCancellationRequested) {
					throw new CancellationError();
				}
				last = await runDesktopDomCommand(evaluate, { op: 'read', locator }, token);
				if (last.ok && last.match?.checked === want) {
					return { ...prepared, match: last.match };
				}
				if (Date.now() > deadline) {
					break;
				}
				await delay(50, token);
			} while (Date.now() <= deadline);
			return { ...prepared, ok: false, code: 'stateUnchanged', match: last.match, reason: `Control did not become ${want ? 'checked' : 'unchecked'} after the native click.` };
		}
		return prepared;
	}
	if (prepared.native === 'key') {
		if (!native || !prepared.key) {
			return { ...prepared, ok: false, code: 'nativeInputRequired', reason: 'Key press requires the CDP or WebDriver input backend.' };
		}
		await native.press(prepared.key, prepared.modifiers ?? parseDesktopKeyChord(prepared.key).modifiers, token);
		return prepared;
	}
	if (prepared.native === 'type') {
		if (!native) {
			return { ...prepared, ok: false, code: 'nativeInputRequired', reason: 'Typing requires the CDP or WebDriver input backend.' };
		}
		if (prepared.replaceSelection) {
			await native.press('Backspace', { ctrl: false, meta: false, alt: false, shift: false }, token);
		}
		await native.insertText(prepared.text ?? String(value ?? ''), token);
		return prepared;
	}
	return prepared;
}

export async function assertDesktop(
	evaluate: DesktopEvaluateFn,
	condition: DesktopAssertCondition,
	locator: DesktopLocator | undefined,
	expected: string | number | undefined,
	timeoutMs = DEFAULT_DESKTOP_ASSERT_TIMEOUT_MS,
	token: CancellationToken = CancellationToken.None,
): Promise<{ ok: boolean; actual?: unknown; expected?: unknown; result: DesktopDomResult; duration: number }> {
	const started = Date.now();
	let last: DesktopDomResult = { ok: false };
	while (Date.now() - started <= timeoutMs) {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		if (condition === 'title' || condition === 'url') {
			last = await runDesktopDomCommand(evaluate, { op: 'ready' }, token);
			const actual = condition === 'title' ? last.title : last.url;
			const matched = typeof expected === 'string' && typeof actual === 'string'
				? (condition === 'url' ? actual.includes(expected) || actual === expected : actual === expected)
				: false;
			if (matched) {
				return { ok: true, actual, expected, result: last, duration: Date.now() - started };
			}
		} else if (condition === 'count') {
			last = await runDesktopDomCommand(evaluate, { op: 'query', locator }, token);
			const actual = last.count ?? last.matches?.length ?? 0;
			if (actual === expected) {
				return { ok: true, actual, expected, result: last, duration: Date.now() - started };
			}
		} else {
			last = await runDesktopDomCommand(evaluate, { op: locator ? 'read' : 'ready', locator }, token);
			const match = last.match ?? {};
			let matched = false;
			if (condition === 'visible') { matched = last.ok && match.visible === true; }
			else if (condition === 'hidden') { matched = last.code === 'notFound' || last.code === 'notVisible' || match.visible === false; }
			else if (condition === 'enabled') { matched = last.ok && match.enabled === true; }
			else if (condition === 'disabled') { matched = last.ok && match.enabled === false; }
			else if (condition === 'checked') { matched = last.ok && match.checked === true; }
			else if (condition === 'unchecked') { matched = last.ok && match.checked === false; }
			else if (condition === 'text') { matched = last.ok && String(match.name ?? '') === String(expected ?? ''); }
			else if (condition === 'containsText') { matched = last.ok && String(match.name ?? '').includes(String(expected ?? '')); }
			else if (condition === 'value') { matched = last.ok && String(match.value ?? '') === String(expected ?? ''); }
			if (matched) {
				return { ok: true, actual: match, expected, result: last, duration: Date.now() - started };
			}
		}
		await delay(50, token);
	}
	return { ok: false, actual: last.match ?? last, expected, result: last, duration: Date.now() - started };
}

export function formatDesktopFailure(result: DesktopDomResult, locator?: DesktopLocator): string {
	const target = locator ? describeLocator(locator) : 'page';
	if (result.code === 'ambiguous') {
		return `Ambiguous locator ${target}: ${result.count ?? result.matches?.length ?? 0} matches. Narrow by role name, exact text, or testId.`;
	}
	if (result.code === 'notFound') {
		return `No match for ${target}.`;
	}
	if (result.code === 'notVisible') {
		return `${target} was found but is not visible.`;
	}
	if (result.code === 'disabled') {
		return `${target} is disabled.`;
	}
	if (result.code === 'notStable') {
		return `${target} did not become stable before the action timeout.`;
	}
	if (result.code === 'outsideViewport') {
		return `${target} remained outside the reachable viewport after scrolling.`;
	}
	if (result.code === 'covered') {
		const blocker = result.blocker;
		const description = blocker
			? `<${String(blocker.tag ?? 'element')}>${blocker.name ? ` "${String(blocker.name)}"` : ''}`
			: 'another element';
		return `${target} is covered by ${description}.`;
	}
	if (result.code === 'readonly') {
		return `${target} is read-only.`;
	}
	if (result.code === 'stateUnchanged') {
		return result.reason ?? `${target} did not change to the expected state.`;
	}
	if (result.code === 'wrongControl') {
		return `${target} does not support this control action.`;
	}
	if (result.code === 'optionNotFound') {
		return `${target} has no option matching the requested value.`;
	}
	if (result.code === 'optionDisabled') {
		return `${target} matched a disabled option.`;
	}
	if (result.code === 'nativeInputRequired') {
		return result.reason ?? 'Native pointer or keyboard backend is required for this action.';
	}
	if (result.code === 'unsupported' && result.reason) {
		return `${target}: ${result.reason}`;
	}
	return `Action failed for ${target}${result.code ? ` (${result.code})` : ''}.`;
}
