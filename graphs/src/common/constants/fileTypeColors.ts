/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface FileTypeInfo {
	id: string;
	name: string;
	color: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
	typescript: '#3178c6',
	javascript: '#f1e05a',
	css: '#a371f7',
	scss: '#c6538c',
	html: '#e34c26',
	json: '#8b8b8b',
	markdown: '#519aba',
	image: '#c678dd',
	config: '#6b7280',
	other: '#71717a'
};

const EXT_MAP: Record<string, FileTypeInfo> = {
	ts: { id: 'typescript', name: 'TypeScript', color: LANGUAGE_COLORS.typescript },
	tsx: { id: 'typescript', name: 'TypeScript', color: LANGUAGE_COLORS.typescript },
	mts: { id: 'typescript', name: 'TypeScript', color: LANGUAGE_COLORS.typescript },
	cts: { id: 'typescript', name: 'TypeScript', color: LANGUAGE_COLORS.typescript },
	js: { id: 'javascript', name: 'JavaScript', color: LANGUAGE_COLORS.javascript },
	jsx: { id: 'javascript', name: 'JavaScript', color: LANGUAGE_COLORS.javascript },
	mjs: { id: 'javascript', name: 'JavaScript', color: LANGUAGE_COLORS.javascript },
	cjs: { id: 'javascript', name: 'JavaScript', color: LANGUAGE_COLORS.javascript },
	css: { id: 'css', name: 'CSS/SCSS', color: LANGUAGE_COLORS.css },
	scss: { id: 'css', name: 'CSS/SCSS', color: LANGUAGE_COLORS.scss },
	sass: { id: 'css', name: 'CSS/SCSS', color: LANGUAGE_COLORS.scss },
	less: { id: 'css', name: 'CSS/SCSS', color: LANGUAGE_COLORS.css },
	html: { id: 'html', name: 'HTML', color: LANGUAGE_COLORS.html },
	htm: { id: 'html', name: 'HTML', color: LANGUAGE_COLORS.html },
	md: { id: 'markdown', name: 'Markdown', color: LANGUAGE_COLORS.markdown },
	mdx: { id: 'markdown', name: 'Markdown', color: LANGUAGE_COLORS.markdown },
	png: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	jpg: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	jpeg: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	gif: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	webp: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	svg: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	ico: { id: 'image', name: 'Image', color: LANGUAGE_COLORS.image },
	json: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config },
	yaml: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config },
	yml: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config },
	toml: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config },
	ini: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config },
	env: { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config }
};

export const ENTRY_NODE_COLOR = '#e8b84a';

export function getFileTypeInfo(path: string | undefined): FileTypeInfo {
	if (!path) {
		return { id: 'other', name: 'Other', color: LANGUAGE_COLORS.other };
	}
	const base = path.split(/[/\\]/).pop() ?? path;
	const ext = base.includes('.') ? (base.split('.').pop()?.toLowerCase() ?? '') : '';
	if (EXT_MAP[ext]) {
		return EXT_MAP[ext];
	}
	if (base.startsWith('.') || /config|rc$/i.test(base)) {
		return { id: 'config', name: 'Config', color: LANGUAGE_COLORS.config };
	}
	return { id: 'other', name: ext ? ext.toUpperCase() : 'Other', color: LANGUAGE_COLORS.other };
}

export function getFileTypeColor(path: string | undefined): string {
	return getFileTypeInfo(path).color;
}

export function collectFileTypes(paths: Array<string | undefined>): FileTypeInfo[] {
	const seen = new Map<string, FileTypeInfo>();
	for (const p of paths) {
		const info = getFileTypeInfo(p);
		if (!seen.has(info.id)) {
			seen.set(info.id, info);
		}
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
