/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DesktopLocator =
	| { by: 'role'; role: string; name?: string; exact?: boolean }
	| { by: 'label'; value: string; exact?: boolean }
	| { by: 'placeholder'; value: string; exact?: boolean }
	| { by: 'text'; value: string; exact?: boolean }
	| { by: 'testId'; value: string }
	| { by: 'css'; value: string };

export type DesktopInteractAction =
	| 'click'
	| 'doubleClick'
	| 'fill'
	| 'type'
	| 'press'
	| 'check'
	| 'uncheck'
	| 'select' // ponytail: DOM semantic action for V1; not native OS select
	| 'focus'; // ponytail: DOM semantic action for V1; not native OS focus

export type DesktopAssertCondition =
	| 'visible'
	| 'hidden'
	| 'enabled'
	| 'disabled'
	| 'checked'
	| 'unchecked'
	| 'text'
	| 'containsText'
	| 'value'
	| 'count'
	| 'title'
	| 'url';

export const DEFAULT_DESKTOP_ACTION_TIMEOUT_MS = 8_000;
export const DEFAULT_DESKTOP_ASSERT_TIMEOUT_MS = 8_000;
export const DEFAULT_ELECTRON_STARTUP_TIMEOUT_MS = 45_000;
export const DEFAULT_TAURI_STARTUP_TIMEOUT_MS = 180_000;

const SECRET_LOCATOR_RE = /password|passwd|secret|token|api[_-]?key|authorization/i;
const ALLOWED_KEYS = new Set([
	'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Space', 'Home', 'End',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'PageUp', 'PageDown', 'Meta', 'Control', 'Alt', 'Shift',
]);

export function locatorLooksSecret(locator: DesktopLocator, extra?: string): boolean {
	const blob = `${locator.by} ${'name' in locator ? locator.name ?? '' : ''} ${'value' in locator ? locator.value ?? '' : ''} ${extra ?? ''}`;
	return SECRET_LOCATOR_RE.test(blob);
}

export function describeLocator(locator: DesktopLocator): string {
	switch (locator.by) {
		case 'role':
			return locator.name ? `role=${locator.role} name=${locator.name}` : `role=${locator.role}`;
		case 'label':
			return `label=${locator.value}`;
		case 'placeholder':
			return `placeholder=${locator.value}`;
		case 'text':
			return `text=${locator.value}`;
		case 'testId':
			return `testId=${locator.value}`;
		case 'css':
			return `css=${locator.value}`;
	}
}

export function parseDesktopLocator(raw: unknown): DesktopLocator | { error: string } {
	if (!raw || typeof raw !== 'object') {
		return { error: 'Locator is required.' };
	}
	const value = raw as Record<string, unknown>;
	const by = value.by;
	if (by === 'role' && typeof value.role === 'string' && value.role.trim()) {
		return {
			by: 'role',
			role: value.role.trim(),
			name: typeof value.name === 'string' ? value.name : undefined,
			exact: value.exact === true,
		};
	}
	if ((by === 'label' || by === 'placeholder' || by === 'text') && typeof value.value === 'string' && value.value.trim()) {
		return { by, value: value.value, exact: value.exact === true };
	}
	if (by === 'testId' && typeof value.value === 'string' && value.value.trim()) {
		return { by: 'testId', value: value.value };
	}
	if (by === 'css' && typeof value.value === 'string' && value.value.trim() && !value.value.includes('xpath')) {
		const css = value.value.trim();
		if (css.length > 200 || /expression\s*\(|javascript:/i.test(css)) {
			return { error: 'Unsupported locator. Use role, label, text, or testId, or a short css selector.' };
		}
		if ((css.match(/nth-child\s*\(/g) ?? []).length >= 3) {
			return { error: 'Deep nth-child CSS locators are rejected. Prefer role, label, text, or testId.' };
		}
		return { by: 'css', value: css };
	}
	return { error: 'Unsupported locator. Use role, label, placeholder, text, testId, or a simple css selector.' };
}

export function validatePressKey(key: string): string | undefined {
	const trimmed = key.trim();
	if (!trimmed || trimmed.length > 40) {
		return 'Key is empty or too long.';
	}
	const parts = trimmed.split('+');
	for (const part of parts) {
		if (part.length === 1 && /^[A-Za-z0-9]$/.test(part)) {
			continue;
		}
		if (!ALLOWED_KEYS.has(part)) {
			return `Unsupported key "${part}". Use Enter, Escape, Tab, arrows, or a single character, optionally with Control/Alt/Shift/Meta.`;
		}
	}
	return undefined;
}

export function redactSecretText(value: string): string {
	return value
		.replace(/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\r\n]*/gi, '$1=[redacted]')
		.replace(/\b(token|access[_-]?token|api[_-]?key|client[_-]?secret|secret|password)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1=[redacted]');
}

export function maskFillValue(locator: DesktopLocator, value: string): string {
	return locatorLooksSecret(locator, value) ? '[redacted]' : redactSecretText(value).slice(0, 80);
}
