/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { ParseResult } from './types.js'
import { basename, extname, joinPath, normalizePath, nodeIdForPath, resolveRelative } from './paths.js'

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
	const normalized = normalizePath(base).replace(/^\.\//, '')
	const candidates = [
		...RESOLVE_EXTENSIONS.map((ext) => `${normalized}${ext}`),
		...RESOLVE_EXTENSIONS.map((ext) => joinPath(normalized, `index${ext}`)),
		...RESOLVE_EXTENSIONS.map((ext) => joinPath(normalized, `__init__${ext}`))
	]
	for (const candidate of candidates) {
		if (ctx.pathIndex.has(candidate)) {
			return candidate
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
		const stem = base.replace(/\.[^.]+$/, '')
		const existing = simpleNameIndex.get(stem) ?? []
		if (!existing.includes(normalized)) {
			existing.push(normalized)
			simpleNameIndex.set(stem, existing)
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
	const simple = importSource.split('.').pop()
	if (simple) {
		const paths = (ctx.simpleNameIndex.get(simple) ?? []).filter((p) => /\.(java|kt|kts)$/.test(p))
		if (paths.length === 1) {
			return paths[0]
		}
	}
	return null
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

	const simple = importSource.split('.').pop()
	if (simple) {
		const paths = (ctx.simpleNameIndex.get(simple) ?? []).filter((p) => p.endsWith('.py'))
		if (paths.length === 1) {
			return paths[0]
		}
	}
	return null
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

	const tailName = source.split(/[/\\.]/).filter(Boolean).pop() ?? source
	for (const path of ctx.pathIndex.keys()) {
		if (
			path.endsWith(`/${source}`) ||
			path.endsWith(`/${tailName}`) ||
			basename(path).replace(/\.[^.]+$/, '') === tailName
		) {
			return path
		}
	}

	const simplePaths = ctx.simpleNameIndex.get(tailName) ?? []
	if (simplePaths.length === 1) {
		return simplePaths[0]
	}
	return null
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
