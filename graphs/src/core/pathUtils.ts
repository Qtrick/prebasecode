/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browser-safe path containment helpers (no Node `fs` / `path` imports).
 */

function normalizeSlashes(p: string): string {
	return p.replace(/\\/g, '/')
}

function isAbsolutePath(filePath: string): boolean {
	return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

function resolvePath(base: string, ...parts: string[]): string {
	const stack: string[] = []
	const push = (segment: string) => {
		if (!segment || segment === '.') {
			return
		}
		if (segment === '..') {
			if (stack.length) {
				stack.pop()
			}
			return
		}
		stack.push(segment)
	}

	const seed = normalizeSlashes(base)
	if (seed.startsWith('/')) {
		stack.push('')
	}
	for (const part of seed.split('/')) {
		push(part)
	}
	for (const part of parts) {
		for (const segment of normalizeSlashes(part).split('/')) {
			push(segment)
		}
	}
	if (stack.length === 1 && stack[0] === '') {
		return '/'
	}
	const joined = stack.join('/')
	if (/^[A-Za-z]:$/.test(joined)) {
		return joined + '/'
	}
	return joined || '.'
}

function relativePath(from: string, to: string): string {
	const fromParts = resolvePath(from).split('/').filter((p, i) => p.length > 0 || i === 0)
	const toParts = resolvePath(to).split('/').filter((p, i) => p.length > 0 || i === 0)
	let i = 0
	while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
		i++
	}
	const ups = fromParts.length - i
	const downs = toParts.slice(i)
	return [...Array(ups).fill('..'), ...downs].join('/') || '.'
}

/** True when `targetPath` resolves inside `rootPath` (no traversal escape). */
export function isPathContainedInRoot(rootPath: string, targetPath: string): boolean {
	const root = normalizeSlashes(resolvePath(rootPath)).replace(/\/$/, '')
	const target = normalizeSlashes(resolvePath(targetPath)).replace(/\/$/, '')
	if (target === root) {
		return true
	}
	return target.startsWith(root + '/')
}

function hasParentTraversalSegments(relative: string): boolean {
	return relative.split(/[/\\]/).some((segment) => segment === '..')
}

/** Normalize a graph node path to a project-relative path for filesystem reads. */
export function toProjectRelativePath(projectPath: string, filePath: string): string | null {
	if (!filePath) {
		return null
	}

	const normalizedFile = normalizeSlashes(filePath)

	if (isAbsolutePath(filePath) || /^[A-Za-z]:\//.test(normalizedFile)) {
		const rel = relativePath(projectPath, filePath)
		if (rel.startsWith('..') || rel === '' || hasParentTraversalSegments(rel)) {
			return null
		}
		return normalizeSlashes(rel)
	}

	const rel = normalizedFile.replace(/^\//, '')
	if (!rel || hasParentTraversalSegments(rel)) {
		return null
	}
	return rel
}

export function resolveProjectFilePath(projectPath: string, filePath: string): string | null {
	const rel = toProjectRelativePath(projectPath, filePath)
	if (!rel) {
		return null
	}
	const resolved = resolvePath(projectPath, rel)
	if (!isPathContainedInRoot(projectPath, resolved)) {
		return null
	}
	return resolved
}

/**
 * Browser-safe variant — without realpath/symlink checks (those require Node fs).
 * Callers that need symlink escape protection should use a node-side wrapper.
 */
export async function resolveProjectFilePathSafe(
	projectPath: string,
	filePath: string,
	options: { mustExist?: boolean } = {}
): Promise<string | null> {
	const resolved = resolveProjectFilePath(projectPath, filePath)
	if (!resolved) {
		return null
	}
	if (options.mustExist) {
		// Existence checks require a file service; without one, treat as unresolved.
		return null
	}
	return resolved
}
