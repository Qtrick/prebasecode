/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PermissionCheckResult, RuntimeActionRisk } from './types.js';

const DESTRUCTIVE_PATTERNS = [
	/\brm\s+-rf\b/i,
	/\brmdir\b/i,
	/\bdel\s+\/s\b/i,
	/\bformat\b/i,
	/\bdrop\s+database\b/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+clean\s+-fd\b/i
];

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Wildcard bind addresses. Dev servers print these to say "listening on every
 * interface", but they are not routable destinations: Chromium refuses `[::]`
 * and Windows cannot connect to `0.0.0.0`. Rewrite them to the loopback address
 * the server is necessarily also listening on.
 */
const WILDCARD_HOST_TO_LOOPBACK = new Map([
	['0.0.0.0', '127.0.0.1'],
	['[::]', '[::1]']
]);

/**
 * Validate that a URL uses http/https only and is parseable.
 *
 * `url` is the canonical form to navigate to: trailing slash removed and any
 * wildcard bind host rewritten to loopback. `isLocal` decides whether the
 * external-navigation confirmation is skipped, so it must only ever be true for
 * a host that is genuinely loopback after that rewrite.
 */
export function validatePreviewUrl(raw: string): { ok: true; url: string; isLocal: boolean } | { ok: false; reason: string } {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { ok: false, reason: 'URL is empty.' };
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { ok: false, reason: 'URL is not valid.' };
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return { ok: false, reason: 'Only http and https URLs are allowed.' };
	}
	const loopback = WILDCARD_HOST_TO_LOOPBACK.get(parsed.hostname.toLowerCase());
	if (loopback) {
		parsed.hostname = loopback;
	}
	const isLocal = LOCAL_HOST_RE.test(parsed.hostname);
	const normalized = (loopback ? parsed.toString() : trimmed).replace(/\/$/, '');
	return { ok: true, url: normalized || parsed.origin, isLocal };
}

export function isLocalhostUrl(url: string): boolean {
	const result = validatePreviewUrl(url);
	return result.ok && result.isLocal;
}

export function classifyTerminalCommand(command: string): {
	risk: RuntimeActionRisk;
	blocked: boolean;
	reason: string;
} {
	const cmd = command.trim();
	for (const re of DESTRUCTIVE_PATTERNS) {
		if (re.test(cmd)) {
			return {
				risk: 'blocked',
				blocked: true,
				reason: 'Destructive terminal command blocked.'
			};
		}
	}
	if (/npm\s+install|pnpm\s+add|yarn\s+add|bun\s+add/i.test(cmd)) {
		return { risk: 'high', blocked: false, reason: 'Installing packages modifies the project.' };
	}
	return { risk: 'medium', blocked: false, reason: 'Terminal command may modify project state.' };
}

export function classifyNavigateUrl(url: string, allowExternal: boolean): PermissionCheckResult {
	const validated = validatePreviewUrl(url);
	if (!validated.ok) {
		return {
			allowed: false,
			risk: 'blocked',
			requiresApproval: false,
			blocked: true,
			reason: validated.reason,
			actionLabel: 'Navigate preview'
		};
	}
	if (validated.isLocal || allowExternal) {
		return {
			allowed: true,
			risk: 'low',
			requiresApproval: false,
			blocked: false,
			reason: validated.isLocal ? 'Localhost preview URLs are allowed by default.' : 'External URLs allowed by setting.',
			actionLabel: 'Navigate preview'
		};
	}
	return {
		allowed: false,
		risk: 'medium',
		requiresApproval: true,
		blocked: false,
		reason: 'External URLs require explicit user approval.',
		actionLabel: 'Navigate preview'
	};
}
