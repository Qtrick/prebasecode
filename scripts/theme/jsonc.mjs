#!/usr/bin/env node
import fs from 'node:fs';

/**
 * Minimal JSON-with-comments reader for the bundled colour themes, which use
 * line/block comments and trailing commas. Strings are preserved verbatim.
 *
 * @param {string} file
 * @returns {any}
 */
export function readJsonc(file) {
	const text = fs.readFileSync(file, 'utf8');
	let out = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '"') {
			const start = i++;
			while (i < text.length) {
				if (text[i] === '\\') { i += 2; continue; }
				if (text[i] === '"') { i++; break; }
				i++;
			}
			out += text.slice(start, i);
			continue;
		}
		if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') { i++; }
			continue;
		}
		if (ch === '/' && text[i + 1] === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { i++; }
			i += 2;
			continue;
		}
		out += ch;
		i++;
	}
	// Drop trailing commas before a closing brace/bracket.
	out = out.replace(/,(\s*[}\]])/g, '$1');
	return JSON.parse(out);
}
