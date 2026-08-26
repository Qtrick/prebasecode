/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { DESKTOP_AUTOMATION_BOOTSTRAP } from './desktopAutomationDom.js';
import { DEFAULT_DESKTOP_ACTION_TIMEOUT_MS, DEFAULT_DESKTOP_ASSERT_TIMEOUT_MS, describeLocator, type DesktopAssertCondition, type DesktopInteractAction, type DesktopLocator } from './desktopLocators.js';

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
		if (last.ok && last.code !== 'notFound' && last.code !== 'notVisible' && last.code !== 'disabled') {
			return last;
		}
		if (last.code === 'ambiguous') {
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
): Promise<DesktopDomResult> {
	return retryDesktopDomCommand(evaluate, { op: action, locator, value }, timeoutMs, token);
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
	return `Action failed for ${target}${result.code ? ` (${result.code})` : ''}.`;
}
