/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Ported from PreBase core for VS Code workbench.
 *--------------------------------------------------------------------------------------------*/

import type { ParseResult, ScannedFile } from './types.js'

type ImportEntry = ParseResult['imports'][number]

function stripComments(content: string): string {
	return content
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
}

export function extractImportsForFile(file: ScannedFile, content: string): ImportEntry[] {
	const ext = file.extension
	const clean = stripComments(content)

	switch (ext) {
		case '.java':
			return extractJavaImports(clean)
		case '.kt':
		case '.kts':
			return extractKotlinImports(clean)
		case '.py':
			return extractPythonImports(clean)
		case '.go':
			return extractGoImports(clean)
		case '.rs':
			return extractRustImports(clean)
		case '.cs':
			return extractCSharpImports(clean)
		case '.cpp':
		case '.cc':
		case '.cxx':
		case '.c':
		case '.h':
		case '.hpp':
			return extractCppImports(clean)
		case '.swift':
			return extractSwiftImports(clean)
		case '.php':
			return extractPhpImports(clean)
		case '.rb':
			return extractRubyImports(clean)
		case '.lua':
			return extractLuaImports(clean)
		case '.dart':
			return extractDartImports(clean)
		case '.scala':
			return extractScalaImports(clean)
		case '.vue':
		case '.svelte':
			return extractVueSvelteImports(clean)
		default:
			return extractJsLikeImports(clean)
	}
}

function extractJsLikeImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const importRe =
		/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = importRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
	while ((m = requireRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: ['require'] })
	}
	return imports
}

function extractJavaImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /import\s+(?:static\s+)?([a-zA-Z0-9_.]+)\s*;/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractKotlinImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /import\s+([a-zA-Z0-9_.*]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractPythonImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const fromRe = /from\s+(\.+[a-zA-Z0-9_.]*|[a-zA-Z0-9_.]+)\s+import/g
	const importRe = /^import\s+([a-zA-Z0-9_.]+)/gm
	let m: RegExpExecArray | null
	while ((m = fromRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	while ((m = importRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractGoImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const block = content.match(/import\s*\(([\s\S]*?)\)/)
	if (block) {
		const lineRe = /["']([^"']+)["']/g
		let m: RegExpExecArray | null
		while ((m = lineRe.exec(block[1])) !== null) {
			imports.push({ source: m[1], specifiers: [] })
		}
	}
	const singleRe = /import\s+["']([^"']+)["']/g
	let m: RegExpExecArray | null
	while ((m = singleRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractRustImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const useRe = /use\s+([a-zA-Z0-9_:{}*]+)\s*;/g
	let m: RegExpExecArray | null
	while ((m = useRe.exec(content)) !== null) {
		const src = m[1].split('::')[0]
		if (src && src !== 'self' && src !== 'super' && src !== 'crate') {
			imports.push({ source: src, specifiers: [] })
		}
	}
	const modRe = /mod\s+([a-zA-Z0-9_]+)\s*;/g
	while ((m = modRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: ['mod'] })
	}
	return imports
}

function extractCSharpImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /using\s+(?:static\s+)?([a-zA-Z0-9_.]+)\s*;/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractCppImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /#include\s+[<"]([^>"]+)[>"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractSwiftImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /import\s+([a-zA-Z0-9_.]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractPhpImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const useRe = /use\s+([a-zA-Z0-9\\]+)/g
	const requireRe = /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = useRe.exec(content)) !== null) {
		imports.push({ source: m[1].replace(/\\/g, '/'), specifiers: [] })
	}
	while ((m = requireRe.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: ['require'] })
	}
	return imports
}

function extractRubyImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /(?:require|require_relative)\s+['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractLuaImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /(?:require|import)\s*\(?\s*['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractDartImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /import\s+['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractScalaImports(content: string): ImportEntry[] {
	const imports: ImportEntry[] = []
	const re = /import\s+([a-zA-Z0-9_.]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(content)) !== null) {
		imports.push({ source: m[1], specifiers: [] })
	}
	return imports
}

function extractVueSvelteImports(content: string): ImportEntry[] {
	const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
	const script = scriptMatch?.[1] ?? content
	return extractJsLikeImports(script)
}

export function extractPackageName(file: ScannedFile, content: string): string | undefined {
	const ext = file.extension
	if (ext === '.java') {
		return content.match(/^[\s\S]*?package\s+([a-zA-Z0-9_.]+)\s*;/m)?.[1]
	}
	if (ext === '.kt' || ext === '.kts') {
		return content.match(/^[\s\S]*?package\s+([a-zA-Z0-9_.]+)/m)?.[1]
	}
	return undefined
}

export function isBabelParsableExtension(ext: string): boolean {
	return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)
}
