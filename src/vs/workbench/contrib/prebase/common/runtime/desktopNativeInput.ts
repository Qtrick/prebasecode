/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { desktopCdpKeyParams, desktopCdpModifierBits } from '../../../../../platform/prebaseDesktop/common/desktopCdpKey.js';

export interface DesktopKeyModifiers {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
}

export interface DesktopNativeInputBackend {
	click(x: number, y: number, clickCount: number, token: CancellationToken): Promise<void>;
	press(key: string, modifiers: DesktopKeyModifiers, token: CancellationToken): Promise<void>;
	insertText(text: string, token: CancellationToken): Promise<void>;
}

const WEBDRIVER_KEYS: Record<string, string> = {
	Enter: '\uE007',
	Tab: '\uE004',
	Escape: '\uE00C',
	Backspace: '\uE003',
	Delete: '\uE017',
	Space: '\uE00D',
	Home: '\uE011',
	End: '\uE010',
	ArrowLeft: '\uE012',
	ArrowUp: '\uE013',
	ArrowRight: '\uE014',
	ArrowDown: '\uE015',
	PageUp: '\uE00E',
	PageDown: '\uE00F',
};

export function parseDesktopKeyChord(value: string): { key: string; modifiers: DesktopKeyModifiers } {
	const parts = String(value || '').split('+').filter(Boolean);
	const keyPart = parts.pop() || '';
	const aliases: Record<string, string> = { Space: 'Space', Esc: 'Escape', Del: 'Delete' };
	const modifiers = new Set(parts.map(part => part.toLowerCase()));
	return {
		key: aliases[keyPart] || keyPart,
		modifiers: {
			ctrl: modifiers.has('control') || modifiers.has('ctrl'),
			meta: modifiers.has('meta') || modifiers.has('command'),
			alt: modifiers.has('alt') || modifiers.has('option'),
			shift: modifiers.has('shift'),
		},
	};
}

export function cdpModifierBits(modifiers: DesktopKeyModifiers): number {
	return desktopCdpModifierBits(modifiers);
}

export function cdpKeyParams(key: string, modifiers: DesktopKeyModifiers, type: 'keyDown' | 'keyUp' | 'char'): Record<string, unknown> {
	return desktopCdpKeyParams(key, modifiers, type);
}

export function webDriverKeyValue(key: string): string {
	if (WEBDRIVER_KEYS[key]) {
		return WEBDRIVER_KEYS[key];
	}
	if (key === ' ') {
		return WEBDRIVER_KEYS.Space;
	}
	return key;
}

export function webDriverPointerClickActions(x: number, y: number, clickCount: number): unknown[] {
	const pointer: Array<Record<string, unknown>> = [
		{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' },
	];
	const count = clickCount <= 1 ? 1 : 2;
	for (let i = 0; i < count; i++) {
		pointer.push({ type: 'pointerDown', button: 0 });
		pointer.push({ type: 'pointerUp', button: 0 });
	}
	return [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: pointer }];
}

export function webDriverKeyActions(key: string, modifiers: DesktopKeyModifiers, text?: string): unknown[] {
	const downs: Array<Record<string, unknown>> = [];
	const ups: Array<Record<string, unknown>> = [];
	if (modifiers.ctrl) { downs.push({ type: 'keyDown', value: '\uE009' }); ups.unshift({ type: 'keyUp', value: '\uE009' }); }
	if (modifiers.meta) { downs.push({ type: 'keyDown', value: '\uE03D' }); ups.unshift({ type: 'keyUp', value: '\uE03D' }); }
	if (modifiers.alt) { downs.push({ type: 'keyDown', value: '\uE00A' }); ups.unshift({ type: 'keyUp', value: '\uE00A' }); }
	if (modifiers.shift) { downs.push({ type: 'keyDown', value: '\uE008' }); ups.unshift({ type: 'keyUp', value: '\uE008' }); }
	if (text) {
		const typed: Array<Record<string, unknown>> = [];
		for (const character of text) {
			typed.push({ type: 'keyDown', value: character });
			typed.push({ type: 'keyUp', value: character });
		}
		return [{ type: 'key', id: 'keyboard', actions: [...downs, ...typed, ...ups] }];
	}
	const value = webDriverKeyValue(key);
	downs.push({ type: 'keyDown', value });
	ups.unshift({ type: 'keyUp', value });
	return [{ type: 'key', id: 'keyboard', actions: [...downs, ...ups] }];
}
