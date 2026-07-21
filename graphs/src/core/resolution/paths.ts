/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Normalize separators to forward slashes. */
export function normalizePath(p: string): string {
	return p.replace(/\\/g, '/')
}

export function basename(filePath: string): string {
	const normalized = normalizePath(filePath)
	const parts = normalized.split('/')
	return parts[parts.length - 1] ?? filePath
}

export function extname(filePath: string): string {
	const name = basename(filePath)
	const i = name.lastIndexOf('.')
	return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function nodeIdForPath(relativePath: string): string {
	return `file:${normalizePath(relativePath)}`
}

export function folderIdForPath(relativePath: string): string {
	return `folder:${normalizePath(relativePath) || '.'}`
}

export function getParentFolderPath(relativePath: string): string | null {
	const parts = normalizePath(relativePath).split('/').filter(Boolean)
	if (parts.length <= 1) {
		return null
	}
	parts.pop()
	return parts.join('/')
}

/** Join path segments with `/`, collapsing duplicates. */
export function joinPath(...parts: string[]): string {
	return parts
		.map((p) => normalizePath(p).replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/')
}

/** Resolve a relative import against a directory (no filesystem). */
export function resolveRelative(fromDir: string, importSource: string): string {
	const baseParts = normalizePath(fromDir).split('/').filter(Boolean)
	const sourceParts = normalizePath(importSource).split('/')
	for (const part of sourceParts) {
		if (part === '.' || part === '') {
			continue
		}
		if (part === '..') {
			baseParts.pop()
			continue
		}
		baseParts.push(part)
	}
	return baseParts.join('/')
}
