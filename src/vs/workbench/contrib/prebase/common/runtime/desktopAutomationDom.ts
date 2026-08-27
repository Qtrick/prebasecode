/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Injected into the owned renderer. One attempt per call; the host retries
 * with a CancellationToken so we do not sleep arbitrarily inside the page.
 */
export const DESKTOP_AUTOMATION_BOOTSTRAP = `(() => {
	if (window.__prebaseDesktopTest) {
		return true;
	}
	const MAX_NODES = 80;
	const consoleBuffer = [];
	const hook = (level) => {
		const original = console[level] ? console[level].bind(console) : undefined;
		console[level] = (...args) => {
			try {
				consoleBuffer.push({ level, text: args.map(v => {
					if (typeof v === 'string') { return v.slice(0, 300); }
					try { return JSON.stringify(v).slice(0, 300); } catch { return String(v).slice(0, 300); }
				}).join(' ').slice(0, 500), at: Date.now() });
				if (consoleBuffer.length > 50) { consoleBuffer.shift(); }
			} catch { /* ignore */ }
			if (original) { original(...args); }
		};
	};
	hook('log'); hook('warn'); hook('error');
	window.addEventListener('error', event => {
		consoleBuffer.push({ level: 'error', text: String(event.message || 'uncaught').slice(0, 500), at: Date.now() });
		if (consoleBuffer.length > 50) { consoleBuffer.shift(); }
	});

	const visible = (el) => {
		if (!el || !(el instanceof Element)) { return false; }
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) { return false; }
		if (el.getAttribute('aria-hidden') === 'true') { return false; }
		const rect = el.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const enabled = (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
	const stableRects = new WeakMap();
	const setNativeValue = (el, value) => {
		const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
			: el instanceof HTMLInputElement ? HTMLInputElement.prototype
				: undefined;
		const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
		if (!setter) { return false; }
		setter.call(el, value);
		return true;
	};
	const accessibleName = (el) => {
		const labelled = el.getAttribute('aria-labelledby');
		if (labelled) {
			return labelled.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
		}
		return (el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('title') || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.textContent || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim();
	};
	const roleOf = (el) => {
		const explicit = el.getAttribute('role');
		if (explicit) { return explicit; }
		const tag = el.tagName.toLowerCase();
		if (tag === 'button') { return 'button'; }
		if (tag === 'a') { return 'link'; }
		if (tag === 'input') {
			const type = (el.getAttribute('type') || 'text').toLowerCase();
			if (type === 'checkbox') { return 'checkbox'; }
			if (type === 'radio') { return 'radio'; }
			if (type === 'submit' || type === 'button') { return 'button'; }
			return 'textbox';
		}
		if (tag === 'textarea') { return 'textbox'; }
		if (tag === 'select') { return 'combobox'; }
		if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') { return 'heading'; }
		return tag;
	};
	const candidates = () => Array.from(document.querySelectorAll('button, a, input, textarea, select, [role], [contenteditable="true"], label'));
	const matches = (locator) => {
		const list = [];
		const eq = (actual, expected, exact) => {
			const a = (actual || '').replace(/\\s+/g, ' ').trim();
			const e = (expected || '').replace(/\\s+/g, ' ').trim();
			return exact ? a === e : a.toLowerCase().includes(e.toLowerCase());
		};
		if (locator.by === 'css') {
			try { return Array.from(document.querySelectorAll(locator.value)); } catch { return []; }
		}
		if (locator.by === 'testId') {
			return Array.from(document.querySelectorAll('[data-testid], [data-test-id]')).filter(el => el.getAttribute('data-testid') === locator.value || el.getAttribute('data-test-id') === locator.value);
		}
		if (locator.by === 'placeholder') {
			return Array.from(document.querySelectorAll('[placeholder]')).filter(el => eq(el.getAttribute('placeholder'), locator.value, locator.exact));
		}
		if (locator.by === 'label') {
			for (const label of Array.from(document.querySelectorAll('label'))) {
				if (!eq(label.textContent, locator.value, locator.exact)) { continue; }
				if (label.control) { list.push(label.control); }
				else { list.push(label); }
			}
			for (const el of candidates()) {
				if (eq(el.getAttribute('aria-label'), locator.value, locator.exact)) { list.push(el); }
			}
			return Array.from(new Set(list));
		}
		if (locator.by === 'text') {
			for (const el of candidates()) {
				if (eq(accessibleName(el), locator.value, locator.exact) || eq(el.textContent, locator.value, locator.exact)) { list.push(el); }
			}
			return list;
		}
		if (locator.by === 'role') {
			for (const el of candidates()) {
				if (roleOf(el) !== locator.role) { continue; }
				if (locator.name && !eq(accessibleName(el), locator.name, locator.exact)) { continue; }
				list.push(el);
			}
			return list;
		}
		return [];
	};
	const summarize = (el) => ({
		tag: el.tagName.toLowerCase(),
		role: roleOf(el),
		name: accessibleName(el).slice(0, 80),
		value: (el.type === 'password' ? undefined : (el.value || undefined)),
		enabled: enabled(el),
		visible: visible(el),
		checked: typeof el.checked === 'boolean' ? el.checked : undefined,
	});
	const resolve = (locator) => {
		const found = matches(locator).filter(visible);
		if (found.length === 0) {
			const hidden = matches(locator);
			return { ok: false, code: hidden.length ? 'notVisible' : 'notFound', count: hidden.length, matches: hidden.slice(0, 5).map(summarize) };
		}
		if (found.length > 1) {
			return { ok: false, code: 'ambiguous', count: found.length, matches: found.slice(0, 8).map(summarize) };
		}
		return { ok: true, count: 1, element: found[0], match: summarize(found[0]) };
	};
	const pointerActionability = (el) => {
		el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
		const rect = el.getBoundingClientRect();
		const current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		const previous = stableRects.get(el);
		stableRects.set(el, current);
		if (!previous || Math.abs(previous.x - current.x) > 0.5 || Math.abs(previous.y - current.y) > 0.5 || Math.abs(previous.width - current.width) > 0.5 || Math.abs(previous.height - current.height) > 0.5) {
			return { ok: false, code: 'notStable' };
		}
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
			return { ok: false, code: 'outsideViewport' };
		}
		const hit = document.elementFromPoint(x, y);
		if (!hit || (hit !== el && !el.contains(hit))) {
			return { ok: false, code: 'covered', blocker: hit ? summarize(hit) : undefined };
		}
		return { ok: true, point: { x, y } };
	};
	const keyboardInit = (value) => {
		const parts = String(value || '').split('+').filter(Boolean);
		const keyPart = parts.pop() || '';
		const modifiers = new Set(parts.map(part => part.toLowerCase()));
		const aliases = { Space: ' ', Esc: 'Escape', Del: 'Delete' };
		return {
			key: aliases[keyPart] || keyPart,
			ctrlKey: modifiers.has('control') || modifiers.has('ctrl'),
			metaKey: modifiers.has('meta') || modifiers.has('command'),
			altKey: modifiers.has('alt') || modifiers.has('option'),
			shiftKey: modifiers.has('shift'),
			bubbles: true,
			cancelable: true,
		};
	};
	const withEvidence = (result) => ({ ...result, console: consoleBuffer.slice(-20) });
	window.__prebaseDesktopTest = {
		run(command) {
			if (!command || typeof command !== 'object') {
				return { ok: false, code: 'badCommand' };
			}
			if (command.op === 'ready') {
				return withEvidence({ ok: true, title: document.title, url: location.href });
			}
			if (command.op === 'snapshot') {
				const interactive = candidates().filter(visible).slice(0, MAX_NODES).map(summarize);
				return {
					ok: true,
					title: document.title,
					url: location.href,
					visibleText: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 4000),
					interactive,
					console: consoleBuffer.slice(-20),
				};
			}
			if (command.op === 'console') {
				return { ok: true, console: consoleBuffer.slice(-(command.limit || 20)) };
			}
			if (command.op === 'query') {
				const resolved = resolve(command.locator);
				return withEvidence({ ...resolved, element: undefined, title: document.title, url: location.href });
			}
			if (command.op === 'hover') {
				return { ok: false, code: 'unsupported', reason: 'CSS hover requires a native pointer backend.', title: document.title, url: location.href };
			}
			const resolved = resolve(command.locator || {});
			if (!resolved.ok) {
				return withEvidence({ ...resolved, element: undefined, title: document.title, url: location.href });
			}
			const el = resolved.element;
			if ((command.op === 'click' || command.op === 'doubleClick' || command.op === 'fill' || command.op === 'type' || command.op === 'check' || command.op === 'uncheck' || command.op === 'select') && !enabled(el)) {
				return { ok: false, code: 'disabled', match: resolved.match, title: document.title, url: location.href };
			}
			if (command.op === 'click' || command.op === 'doubleClick' || command.op === 'check' || command.op === 'uncheck') {
				const actionable = pointerActionability(el);
				if (!actionable.ok) {
					return { ...actionable, match: resolved.match, title: document.title, url: location.href };
				}
			}
			if (command.op === 'click') { el.click(); }
			else if (command.op === 'doubleClick') {
				el.click();
				el.click();
				el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
			}
			else if (command.op === 'focus') { el.focus(); }
			else if (command.op === 'fill') {
				el.focus();
				if (setNativeValue(el, String(command.value ?? ''))) {
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
				} else if (el.isContentEditable) {
					el.textContent = String(command.value ?? '');
					el.dispatchEvent(new Event('input', { bubbles: true }));
				} else {
					return { ok: false, code: 'wrongControl', match: resolved.match, title: document.title, url: location.href };
				}
			}
			else if (command.op === 'type') {
				const canType = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
				if (!canType) {
					return { ok: false, code: 'wrongControl', match: resolved.match, title: document.title, url: location.href };
				}
				el.focus();
				const text = String(command.value ?? '');
				for (const character of text) {
					const keyboard = { key: character, bubbles: true, cancelable: true };
					const proceed = el.dispatchEvent(new KeyboardEvent('keydown', keyboard));
					if (proceed) {
						if (setNativeValue(el, String(el.value || '') + character)) {
							el.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
						} else if (el.isContentEditable) {
							document.execCommand('insertText', false, character);
						}
					}
					el.dispatchEvent(new KeyboardEvent('keyup', keyboard));
				}
			}
			else if (command.op === 'press') {
				el.focus();
				const keyboard = keyboardInit(command.value);
				const proceed = el.dispatchEvent(new KeyboardEvent('keydown', keyboard));
				if (proceed && (keyboard.ctrlKey || keyboard.metaKey) && keyboard.key.toLowerCase() === 'a' && typeof el.select === 'function') {
					el.select();
				}
				el.dispatchEvent(new KeyboardEvent('keyup', keyboard));
			}
			else if (command.op === 'check' || command.op === 'uncheck') {
				const want = command.op === 'check';
				if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio') || (command.op === 'uncheck' && el.type === 'radio')) {
					return { ok: false, code: 'wrongControl', match: resolved.match, title: document.title, url: location.href };
				}
				if (el.checked !== want) { el.click(); }
				if (el.checked !== want) {
					return { ok: false, code: 'wrongControl', match: resolved.match, title: document.title, url: location.href };
				}
			}
			else if (command.op === 'select') {
				if (!(el instanceof HTMLSelectElement)) {
					return { ok: false, code: 'wrongControl', match: resolved.match, title: document.title, url: location.href };
				}
				const value = String(command.value ?? '');
				const option = Array.from(el.options).find(candidate => candidate.value === value);
				if (!option) {
					return { ok: false, code: 'optionNotFound', match: resolved.match, title: document.title, url: location.href };
				}
				if (option.disabled) {
					return { ok: false, code: 'optionDisabled', match: resolved.match, title: document.title, url: location.href };
				}
				if (el.multiple) {
					for (const candidate of Array.from(el.options)) { candidate.selected = candidate === option; }
				} else {
					el.value = value;
				}
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
			}
			else if (command.op === 'read') {
				return withEvidence({ ok: true, match: summarize(el), title: document.title, url: location.href });
			}
			return { ok: true, match: summarize(el), title: document.title, url: location.href };
		}
	};
	return true;
})()`;
