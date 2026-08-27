/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';

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

const VIRTUAL_KEYS: Record<string, { code: string; vk: number }> = {
	Enter: { code: 'Enter', vk: 13 },
	Tab: { code: 'Tab', vk: 9 },
	Escape: { code: 'Escape', vk: 27 },
	Backspace: { code: 'Backspace', vk: 8 },
	Delete: { code: 'Delete', vk: 46 },
	Space: { code: 'Space', vk: 32 },
	Home: { code: 'Home', vk: 36 },
	End: { code: 'End', vk: 35 },
	ArrowLeft: { code: 'ArrowLeft', vk: 37 },
	ArrowUp: { code: 'ArrowUp', vk: 38 },
	ArrowRight: { code: 'ArrowRight', vk: 39 },
	ArrowDown: { code: 'ArrowDown', vk: 40 },
	PageUp: { code: 'PageUp', vk: 33 },
	PageDown: { code: 'PageDown', vk: 34 },
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
	return (modifiers.alt ? 1 : 0) + (modifiers.ctrl ? 2 : 0) + (modifiers.meta ? 4 : 0) + (modifiers.shift ? 8 : 0);
}

export function cdpKeyParams(key: string, modifiers: DesktopKeyModifiers, type: 'keyDown' | 'keyUp' | 'char'): Record<string, unknown> {
	const named = VIRTUAL_KEYS[key === ' ' ? 'Space' : key];
	const isChar = key.length === 1;
	const text = type === 'char' && isChar ? key : (type !== 'keyUp' && (key === 'Enter' || key === 'Space') ? (key === 'Enter' ? '\r' : ' ') : '');
	return {
		type: type === 'keyDown' && !isChar ? 'rawKeyDown' : type,
		key: named ? (key === 'Space' ? ' ' : key) : key,
		code: named?.code ?? (isChar ? `Key${key.toUpperCase()}` : key),
		windowsVirtualKeyCode: named?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
		nativeVirtualKeyCode: named?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
		modifiers: cdpModifierBits(modifiers),
		text,
		unmodifiedText: text,
	};
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
