/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Neutral CDP key/code/VK mapping owned by the platform desktop layer so
 * Electron main and workbench callers cannot drift.
 */
export interface DesktopCdpKeyModifiers {
	ctrl?: boolean;
	meta?: boolean;
	alt?: boolean;
	shift?: boolean;
}

export const DESKTOP_CDP_NAMED_KEYS: Record<string, { code: string; vk: number }> = {
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

export function desktopCdpModifierBits(modifiers: DesktopCdpKeyModifiers = {}): number {
	return (modifiers.alt ? 1 : 0) + (modifiers.ctrl ? 2 : 0) + (modifiers.meta ? 4 : 0) + (modifiers.shift ? 8 : 0);
}

export function desktopCdpKeyParams(key: string, modifiers: DesktopCdpKeyModifiers = {}, type: 'keyDown' | 'keyUp' | 'char'): Record<string, unknown> {
	const named = DESKTOP_CDP_NAMED_KEYS[key === ' ' ? 'Space' : key];
	const isChar = key.length === 1;
	const isDigit = isChar && key >= '0' && key <= '9';
	const isLetter = isChar && /[a-zA-Z]/.test(key);
	const text = type === 'char' && isChar ? key : (type !== 'keyUp' && (key === 'Enter' || key === 'Space' || key === ' ') ? (key === 'Enter' ? '\r' : ' ') : '');
	return {
		type: type === 'keyDown' && !isChar ? 'rawKeyDown' : type,
		key: named ? (key === 'Space' || key === ' ' ? ' ' : key) : key,
		code: named?.code ?? (isDigit ? `Digit${key}` : isLetter ? `Key${key.toUpperCase()}` : key),
		windowsVirtualKeyCode: named?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
		nativeVirtualKeyCode: named?.vk ?? (isChar ? key.toUpperCase().charCodeAt(0) : 0),
		modifiers: desktopCdpModifierBits(modifiers),
		text,
		unmodifiedText: text,
	};
}
