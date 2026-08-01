/**
 * Works out which workbench colour IDs resolve to nothing under which theme
 * kinds, so `verify-surfaces.mjs` can reject PreBase UI that relies on them
 * without a fallback.
 *
 * A colour registered with a `null` default for a theme kind emits no CSS
 * custom property under that kind. A `var(--vscode-x)` with no fallback is then
 * invalid at computed-value time, which drops the declaration — or, for a
 * shorthand like `border`, resets every longhand — instead of degrading.
 *
 * Nullness is transitive: `registerColor('menu.selectionBackground',
 * listActiveSelectionBackground, …)` inherits every kind in which
 * `list.activeSelectionBackground` is null, and so does
 * `transparent(thatColour, .5)`.
 */

import fs from 'node:fs';
import path from 'node:path';

export const THEME_KINDS = ['dark', 'light', 'hcDark', 'hcLight'];

/**
 * Read the balanced argument list of a call starting at `open` (the `(`).
 *
 * @param {string} source
 * @param {number} open
 * @returns {string[]}
 */
function callArguments(source, open) {
	const args = [];
	let depth = 0;
	let start = open + 1;
	let quote = '';
	for (let i = open; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			if (char === quote && source[i - 1] !== '\\') {
				quote = '';
			}
			continue;
		}
		if (char === `'` || char === '"' || char === '`') {
			quote = char;
			continue;
		}
		if (char === '(' || char === '{' || char === '[') {
			depth++;
			continue;
		}
		if (char === ')' || char === '}' || char === ']') {
			depth--;
			if (depth === 0) {
				args.push(source.slice(start, i));
				return args;
			}
			continue;
		}
		if (char === ',' && depth === 1) {
			args.push(source.slice(start, i));
			start = i + 1;
		}
	}
	return args;
}

/**
 * Split an object literal body into its top-level `key: value` entries.
 *
 * @param {string} body
 * @returns {Map<string, string>}
 */
function objectEntries(body) {
	const entries = new Map();
	let depth = 0;
	let start = 0;
	let quote = '';
	const parts = [];
	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (quote) {
			if (char === quote && body[i - 1] !== '\\') {
				quote = '';
			}
			continue;
		}
		if (char === `'` || char === '"' || char === '`') {
			quote = char;
			continue;
		}
		if (char === '(' || char === '{' || char === '[') {
			depth++;
		} else if (char === ')' || char === '}' || char === ']') {
			depth--;
		} else if (char === ',' && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	for (const part of parts) {
		const colon = part.indexOf(':');
		if (colon === -1) {
			continue;
		}
		entries.set(part.slice(0, colon).trim().replace(/^['"]|['"]$/g, ''), part.slice(colon + 1).trim());
	}
	return entries;
}

/** @param {string} dir @returns {Generator<string>} */
function* typescriptFiles(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* typescriptFiles(full);
		} else if (entry.name.endsWith('.ts')) {
			yield full;
		}
	}
}

/**
 * Scan every `registerColor` in the tree and report, for each colour ID, the
 * theme kinds under which it resolves to nothing.
 *
 * @param {string} root Absolute path to `src/vs`.
 * @returns {{ nullKinds: Map<string, string[]>, count: number }}
 */
export function collectNullDefaults(root) {
	/** @type {Map<string, string>} id → default expression */
	const defaults = new Map();
	/** @type {Map<string, string>} local const name → colour ID */
	const constToId = new Map();

	for (const file of typescriptFiles(root)) {
		const source = fs.readFileSync(file, 'utf8');
		if (!source.includes('registerColor(')) {
			continue;
		}
		for (const match of source.matchAll(/(?:const\s+(\w+)\s*=\s*)?registerColor\s*\(/g)) {
			const open = match.index + match[0].length - 1;
			const args = callArguments(source, open);
			const id = args[0]?.trim().match(/^'([^']+)'$/)?.[1];
			if (!id) {
				continue;
			}
			defaults.set(id, (args[1] ?? '').trim());
			if (match[1]) {
				constToId.set(match[1], id);
			}
		}
	}

	/** @type {Map<string, string[]>} */
	const nullKinds = new Map();
	const cache = new Map();

	/**
	 * @param {string} id
	 * @param {string} kind
	 * @param {Set<string>} seen
	 * @returns {boolean}
	 */
	function isNull(id, kind, seen) {
		const key = `${id}\u0000${kind}`;
		if (cache.has(key)) {
			return cache.get(key);
		}
		if (seen.has(key)) {
			return false; // A cycle cannot prove nullness.
		}
		seen.add(key);
		const result = expressionIsNull(defaults.get(id), kind, seen);
		cache.set(key, result);
		return result;
	}

	/**
	 * @param {string | undefined} expression
	 * @param {string} kind
	 * @param {Set<string>} seen
	 * @returns {boolean}
	 */
	function expressionIsNull(expression, kind, seen) {
		if (expression === undefined) {
			return false; // Not a colour we can resolve; assume it is defined.
		}
		const trimmed = expression.trim();
		if (trimmed === 'null' || trimmed === 'undefined') {
			return true;
		}
		if (trimmed.startsWith('{')) {
			const entry = objectEntries(trimmed.slice(1, -1)).get(kind);
			return entry === undefined ? false : expressionIsNull(entry, kind, seen);
		}
		// `transparent(x, .5)`, `darken(x, .2)`, `lighten(x, .2)` — null in, null out.
		const call = trimmed.match(/^(transparent|darken|lighten|opaque)\s*\(([\s\S]*)$/);
		if (call) {
			return expressionIsNull(callArguments(trimmed, trimmed.indexOf('('))[0], kind, seen);
		}
		const identifier = trimmed.match(/^(\w+)$/)?.[1];
		if (identifier && constToId.has(identifier)) {
			return isNull(constToId.get(identifier), kind, seen);
		}
		return false;
	}

	for (const id of defaults.keys()) {
		const kinds = THEME_KINDS.filter(kind => isNull(id, kind, new Set()));
		if (kinds.length > 0) {
			nullKinds.set(id, kinds);
		}
	}
	return { nullKinds, count: defaults.size };
}

/**
 * Find every `var(--vscode-…)` chain in `text` and report the kinds under which
 * the chain resolves to nothing.
 *
 * A chain is safe for a kind as soon as one of its tokens is defined for that
 * kind, or when it bottoms out in a literal (`transparent`, a keyword, a hex
 * value) rather than in another `var()`.
 *
 * @param {string} text
 * @param {Map<string, string[]>} nullKinds
 * @returns {{ index: number, chain: string[], unsafe: string[] }[]}
 */
export function unsafeVarChains(text, nullKinds) {
	const results = [];
	for (const match of text.matchAll(/var\(\s*--vscode-/g)) {
		const open = text.indexOf('(', match.index);
		const args = callArguments(text, open);
		const chain = [];
		let node = args;
		while (node) {
			const token = node[0]?.trim().replace(/^--vscode-/, '');
			if (token === undefined) {
				break;
			}
			chain.push(token.replace(/-/g, '.'));
			const fallback = node.slice(1).join(',').trim();
			if (!fallback.startsWith('var(')) {
				// A literal terminal (or nothing at all).
				node = undefined;
				if (fallback) {
					chain.push(`literal:${fallback}`);
				}
				break;
			}
			node = callArguments(fallback, fallback.indexOf('('));
		}
		const unsafe = THEME_KINDS.filter(kind => !chainResolves(chain, kind, nullKinds));
		if (unsafe.length > 0) {
			results.push({ index: match.index, chain, unsafe });
		}
	}
	return results;
}

/**
 * @param {string[]} chain
 * @param {string} kind
 * @param {Map<string, string[]>} nullKinds
 * @returns {boolean}
 */
function chainResolves(chain, kind, nullKinds) {
	for (const token of chain) {
		if (token.startsWith('literal:')) {
			return true;
		}
		const kinds = nullKinds.get(token);
		if (!kinds || !kinds.includes(kind)) {
			return true;
		}
	}
	return false;
}
