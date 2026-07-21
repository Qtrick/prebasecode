/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphNode } from '../../common/types/graphTypes.js';

export interface LanguageStat {
	id: string;
	name: string;
	count: number;
	percent: number;
	color: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
	typescript: '#3178c6',
	javascript: '#f1e05a',
	java: '#b07219',
	kotlin: '#a97bff',
	python: '#3572a5',
	go: '#00add8',
	rust: '#dea584',
	csharp: '#178600',
	cpp: '#f34b7d',
	c: '#555555',
	swift: '#f05138',
	php: '#4f5d95',
	ruby: '#701516',
	lua: '#000080',
	dart: '#00b4ab',
	scala: '#c22d40',
	vue: '#41b883',
	svelte: '#ff3e00',
	css: '#563d7c',
	html: '#e34c26',
	json: '#292929',
	markdown: '#083fa1',
	shell: '#89e051',
	other: '#71717a',
};

const EXT_TO_LANG: Record<string, { id: string; name: string }> = {
	ts: { id: 'typescript', name: 'TypeScript' },
	tsx: { id: 'typescript', name: 'TypeScript' },
	mts: { id: 'typescript', name: 'TypeScript' },
	cts: { id: 'typescript', name: 'TypeScript' },
	js: { id: 'javascript', name: 'JavaScript' },
	jsx: { id: 'javascript', name: 'JavaScript' },
	mjs: { id: 'javascript', name: 'JavaScript' },
	cjs: { id: 'javascript', name: 'JavaScript' },
	java: { id: 'java', name: 'Java' },
	kt: { id: 'kotlin', name: 'Kotlin' },
	kts: { id: 'kotlin', name: 'Kotlin' },
	py: { id: 'python', name: 'Python' },
	go: { id: 'go', name: 'Go' },
	rs: { id: 'rust', name: 'Rust' },
	cs: { id: 'csharp', name: 'C#' },
	cpp: { id: 'cpp', name: 'C++' },
	cc: { id: 'cpp', name: 'C++' },
	cxx: { id: 'cpp', name: 'C++' },
	h: { id: 'c', name: 'C' },
	hpp: { id: 'cpp', name: 'C++' },
	c: { id: 'c', name: 'C' },
	swift: { id: 'swift', name: 'Swift' },
	php: { id: 'php', name: 'PHP' },
	rb: { id: 'ruby', name: 'Ruby' },
	lua: { id: 'lua', name: 'Lua' },
	dart: { id: 'dart', name: 'Dart' },
	scala: { id: 'scala', name: 'Scala' },
	vue: { id: 'vue', name: 'Vue' },
	svelte: { id: 'svelte', name: 'Svelte' },
	css: { id: 'css', name: 'CSS' },
	scss: { id: 'css', name: 'CSS' },
	sass: { id: 'css', name: 'CSS' },
	less: { id: 'css', name: 'CSS' },
	html: { id: 'html', name: 'HTML' },
	htm: { id: 'html', name: 'HTML' },
	json: { id: 'json', name: 'JSON' },
	jsonc: { id: 'json', name: 'JSON' },
	md: { id: 'markdown', name: 'Markdown' },
	mdx: { id: 'markdown', name: 'Markdown' },
	sh: { id: 'shell', name: 'Shell' },
	bash: { id: 'shell', name: 'Shell' },
	zsh: { id: 'shell', name: 'Shell' },
};

function languageForPath(path: string): { id: string; name: string; color: string } {
	const base = path.split(/[/\\]/).pop() ?? path;
	const dot = base.lastIndexOf('.');
	const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
	const mapped = EXT_TO_LANG[ext];
	if (mapped) {
		return { id: mapped.id, name: mapped.name, color: LANGUAGE_COLORS[mapped.id] ?? LANGUAGE_COLORS.other };
	}
	return { id: 'other', name: 'Other', color: LANGUAGE_COLORS.other };
}

/** Aggregate language composition from snapshot file/component nodes by path extension. */
export function computeLanguageStats(nodes: readonly GraphNode[] | null | undefined): LanguageStat[] {
	if (!nodes || nodes.length === 0) {
		return [];
	}
	const counts = new Map<string, { name: string; color: string; count: number }>();

	for (const node of nodes) {
		if (!node || node.kind === 'folder') {
			continue;
		}
		if (!node.path) {
			continue;
		}
		const { id, name, color } = languageForPath(node.path);
		const existing = counts.get(id);
		if (existing) {
			existing.count += 1;
		} else {
			counts.set(id, { name, color, count: 1 });
		}
	}

	const total = [...counts.values()].reduce((sum, v) => sum + v.count, 0);
	if (total === 0) {
		return [];
	}

	return [...counts.entries()]
		.map(([id, { name, color, count }]) => ({
			id,
			name,
			count,
			percent: Math.round((count / total) * 1000) / 10,
			color,
		}))
		.sort((a, b) => b.count - a.count);
}
