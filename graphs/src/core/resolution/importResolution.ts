/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ParseResult } from '../../common/types/graphTypes.js'
import { basename, extname, fileStem, joinPath, normalizePath, nodeIdForPath, resolveRelative } from './paths.js'

export type PathMappings = Record<string, string[]>

export interface ImportResolutionContext {
	pathIndex: Map<string, string>
	javaFqnIndex: Map<string, string>
	simpleNameIndex: Map<string, string[]>
	goModulePath: string | null
}

const RESOLVE_EXTENSIONS = [
	'',
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.java',
	'.kt',
	'.kts',
	'.py',
	'.go',
	'.rs',
	'.cs',
	'.cpp',
	'.c',
	'.swift',
	'.php',
	'.rb',
	'.lua',
	'.dart',
	'.scala',
	'.vue',
	'.svelte'
]

function tryResolveAgainstIndex(base: string, ctx: ImportResolutionContext): string | null {
	let normalized = normalizePath(base)
	if (normalized.startsWith('./')) {
		normalized = normalized.slice(2)
	}
	if (ctx.pathIndex.has(normalized)) {
		return normalized
	}
	for (let i = 1; i < RESOLVE_EXTENSIONS.length; i++) {
		const file = normalized + RESOLVE_EXTENSIONS[i]
		if (ctx.pathIndex.has(file)) {
			return file
		}
	}
	const indexPrefix = normalized ? normalized + '/' : ''
	for (const ext of RESOLVE_EXTENSIONS) {
		const indexPath = indexPrefix + 'index' + ext
		if (ctx.pathIndex.has(indexPath)) {
			return indexPath
		}
	}
	for (const ext of RESOLVE_EXTENSIONS) {
		const initPath = indexPrefix + '__init__' + ext
		if (ctx.pathIndex.has(initPath)) {
			return initPath
		}
	}
	return null
}

export function buildImportResolutionContext(
	_projectPath: string,
	results: ParseResult[],
	goModulePath: string | null = null
): ImportResolutionContext {
	const pathIndex = new Map<string, string>()
	const javaFqnIndex = new Map<string, string>()
	const simpleNameIndex = new Map<string, string[]>()

	for (const result of results) {
		const normalized = normalizePath(result.relativePath)
		pathIndex.set(normalized, nodeIdForPath(normalized))
		const base = basename(normalized)
		if (!pathIndex.has(base)) {
			pathIndex.set(base, nodeIdForPath(normalized))
		}

		const ext = extname(normalized)
		const stem = fileStem(base)
		let existing = simpleNameIndex.get(stem)
		if (!existing) {
			simpleNameIndex.set(stem, [normalized])
		} else if (!existing.includes(normalized)) {
			existing.push(normalized)
		}

		if ((ext === '.java' || ext === '.kt' || ext === '.kts') && result.packageName) {
			javaFqnIndex.set(`${result.packageName}.${stem}`, normalized)
			const pathSuffix = `${result.packageName.replace(/\./g, '/')}/${stem}`
			javaFqnIndex.set(pathSuffix, normalized)
		}

		if (ext === '.java' || ext === '.kt' || ext === '.kts') {
			for (const prefix of ['src/main/java/', 'src/main/kotlin/', 'src/']) {
				if (!normalized.startsWith(prefix)) {
					continue
				}
				const suffix = normalized.slice(prefix.length).replace(/\.(java|kt|kts)$/, '')
				javaFqnIndex.set(suffix.replace(/\//g, '.'), normalized)
				javaFqnIndex.set(suffix, normalized)
			}
		}
	}

	return { pathIndex, javaFqnIndex, simpleNameIndex, goModulePath }
}

function tryResolveJavaImport(importSource: string, ctx: ImportResolutionContext): string | null {
	const fromIndex = ctx.javaFqnIndex.get(importSource)
	if (fromIndex) {
		return fromIndex
	}
	const pathLike = importSource.replace(/\./g, '/')
	for (const prefix of ['src/main/java', 'src/main/kotlin', 'src', 'app/src/main/java', '']) {
		const base = prefix ? joinPath(prefix, pathLike) : pathLike
		const resolved = tryResolveAgainstIndex(base, ctx)
		if (resolved) {
			return resolved
		}
	}
	return uniqueIndexedPath(ctx, importSource.split('.').pop(), (p) => /\.(java|kt|kts)$/.test(p))
}

function tryResolvePythonImport(fromFile: string, importSource: string, ctx: ImportResolutionContext): string | null {
	const modulePath = importSource.replace(/\./g, '/')
	const fromDir = fromFile.replace(/\/[^/]+$/, '')

	if (importSource.startsWith('.')) {
		const relative = importSource.replace(/^\.+/, '').replace(/\./g, '/')
		const base = relative ? resolveRelative(fromDir, relative) : fromDir
		const resolved = tryResolveAgainstIndex(base, ctx)
		if (resolved) {
			return resolved
		}
	}

	const relative = tryResolveAgainstIndex(resolveRelative(fromDir, modulePath), ctx)
	if (relative) {
		return relative
	}

	for (const root of ['', 'src', 'app']) {
		const base = root ? joinPath(root, modulePath) : modulePath
		const resolved = tryResolveAgainstIndex(base, ctx)
		if (resolved) {
			return resolved
		}
	}

	return uniqueIndexedPath(ctx, importSource.split('.').pop(), (p) => p.endsWith('.py'))
}

function tryResolveGoImport(importSource: string, ctx: ImportResolutionContext): string | null {
	let pathPart = importSource
	if (ctx.goModulePath && importSource.startsWith(ctx.goModulePath)) {
		pathPart = importSource.slice(ctx.goModulePath.length).replace(/^\//, '')
	}
	if (pathPart.startsWith('.')) {
		return null
	}
	return tryResolveAgainstIndex(pathPart, ctx)
}

function uniqueIndexedPath(
	ctx: ImportResolutionContext,
	stem: string | undefined,
	ok: (path: string) => boolean
): string | null {
	if (!stem) {
		return null
	}
	const paths = ctx.simpleNameIndex.get(stem)
	if (!paths) {
		return null
	}
	let hit: string | null = null
	for (const path of paths) {
		if (!ok(path)) {
			continue
		}
		if (hit) {
			return null
		}
		hit = path
	}
	return hit
}

function importTailStem(source: string): string {
	const base = basename(source)
	const ext = extname(base)
	if (ext && RESOLVE_EXTENSIONS.includes(ext)) {
		return fileStem(base)
	}
	const lastDot = base.lastIndexOf('.')
	return lastDot > 0 ? base.slice(lastDot + 1) : base
}

function fuzzyResolveImport(fromFile: string, importSource: string, ctx: ImportResolutionContext): string | null {
	const source = importSource.split('?')[0].trim()
	if (!source) {
		return null
	}

	if (source.startsWith('.')) {
		const fromDir = fromFile.replace(/\/[^/]+$/, '')
		const joined = resolveRelative(fromDir, source.replace(/^\.\//, ''))
		const hit = tryResolveAgainstIndex(joined, ctx)
		if (hit) {
			return hit
		}
	}

	// ponytail: O(1) stem index replaces the old O(n) pathIndex scan; still require a unique hit
	return uniqueIndexedPath(ctx, importTailStem(source), () => true)
}

export function resolveImportWithContext(
	_projectRoot: string,
	fromFile: string,
	importSource: string,
	pathMappings: PathMappings,
	ctx: ImportResolutionContext
): string | null {
	const source = importSource.split('?')[0].trim()
	if (!source) {
		return null
	}

	const ext = extname(fromFile)
	const fromDir = fromFile.replace(/\/[^/]+$/, '')

	if (source.startsWith('.')) {
		const hit = tryResolveAgainstIndex(resolveRelative(fromDir, source), ctx)
		if (hit) {
			return hit
		}
	}

	if (ext === '.java' || ext === '.kt' || ext === '.kts') {
		const java = tryResolveJavaImport(source, ctx)
		if (java) {
			return java
		}
	}

	if (ext === '.py') {
		const py = tryResolvePythonImport(fromFile, source, ctx)
		if (py) {
			return py
		}
	}

	if (ext === '.go') {
		const go = tryResolveGoImport(source, ctx)
		if (go) {
			return go
		}
	}

	if (/^[a-zA-Z_][\w.]*$/.test(source) && source.includes('.') && !source.startsWith('@')) {
		const java = tryResolveJavaImport(source, ctx)
		if (java) {
			return java
		}
	}

	for (const [pattern, targets] of Object.entries(pathMappings)) {
		if (!source.startsWith(pattern)) {
			continue
		}
		const rest = source.slice(pattern.length)
		for (const targetRoot of targets) {
			const root = normalizePath(targetRoot)
			// Prefer project-relative roots; fall back to last path segments of absolute roots.
			const relativeRoot = root.includes('/') && !root.startsWith('/') && !/^[A-Za-z]:/.test(root)
				? root
				: root.split('/').slice(-2).join('/')
			const resolved = tryResolveAgainstIndex(joinPath(relativeRoot, rest), ctx)
			if (resolved) {
				return resolved
			}
		}
	}

	if (source.includes('/')) {
		const resolved = tryResolveAgainstIndex(source.replace(/^\//, ''), ctx)
		if (resolved) {
			return resolved
		}
	}

	return fuzzyResolveImport(fromFile, source, ctx)
}
