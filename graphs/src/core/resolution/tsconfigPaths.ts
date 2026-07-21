/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type PathMappings = Record<string, string[]>

export type TsconfigFileReader = (absolutePath: string) => string | undefined

/**
 * Load path aliases from tsconfig.json (and referenced configs).
 * Browser-safe: inject a reader instead of importing Node `fs`.
 */
export function loadTsconfigPaths(
	projectRoot: string,
	readFile: TsconfigFileReader = () => undefined
): PathMappings {
	const mappings: PathMappings = {}
	const visited = new Set<string>()

	const join = (...parts: string[]): string => {
		return parts
			.join('/')
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/')
	}

	const dirname = (p: string): string => {
		const normalized = p.replace(/\\/g, '/')
		const idx = normalized.lastIndexOf('/')
		return idx <= 0 ? (normalized.startsWith('/') ? '/' : '.') : normalized.slice(0, idx)
	}

	const resolve = (base: string, rel: string): string => {
		const stack: string[] = []
		const push = (seg: string) => {
			if (!seg || seg === '.') return
			if (seg === '..') {
				if (stack.length) stack.pop()
				return
			}
			stack.push(seg)
		}
		const seed = base.replace(/\\/g, '/')
		if (seed.startsWith('/')) stack.push('')
		for (const part of seed.split('/')) push(part)
		for (const part of rel.replace(/\\/g, '/').split('/')) push(part)
		if (stack.length === 1 && stack[0] === '') return '/'
		return stack.join('/') || '.'
	}

	function readConfig(configPath: string): void {
		const abs = resolve('.', configPath)
		if (visited.has(abs)) return
		const raw = readFile(abs)
		if (raw === undefined) return
		visited.add(abs)

		try {
			const json = JSON.parse(stripJsonComments(raw)) as {
				compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
				extends?: string
			}

			if (json.extends) {
				const parent = resolve(dirname(abs), json.extends)
				readConfig(parent.endsWith('.json') ? parent : `${parent}.json`)
			}

			const baseUrl = json.compilerOptions?.baseUrl
				? resolve(dirname(abs), json.compilerOptions.baseUrl)
				: dirname(abs)

			const paths = json.compilerOptions?.paths ?? {}
			for (const [key, targets] of Object.entries(paths)) {
				const pattern = key.replace(/\*$/, '')
				const resolvedTargets = targets.map((t) => {
					const target = t.replace(/\*$/, '')
					return resolve(baseUrl, target).replace(/\\/g, '/')
				})
				mappings[pattern] = resolvedTargets
			}
		} catch {
			// ignore malformed configs
		}
	}

	const candidates = [
		join(projectRoot, 'tsconfig.json'),
		join(projectRoot, 'tsconfig.app.json'),
		join(projectRoot, 'tsconfig.web.json')
	]

	for (const c of candidates) {
		readConfig(c)
	}

	return mappings
}

function stripJsonComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}
