/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Filenames that should appear in the graph as project metadata nodes. */
const METADATA_FILENAMES = new Set([
	'package.json',
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'composer.lock',
	'gemfile',
	'gemfile.lock',
	'go.mod',
	'go.sum',
	'cargo.toml',
	'cargo.lock',
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
	'settings.gradle',
	'settings.gradle.kts',
	'pyproject.toml',
	'requirements.txt',
	'pipfile',
	'pipfile.lock',
	'tsconfig.json',
	'jsconfig.json',
	'eslint.config.js',
	'eslint.config.mjs',
	'eslint.config.cjs',
	'.eslintrc',
	'.eslintrc.json',
	'.eslintrc.js',
	'.eslintrc.cjs',
	'.prettierrc',
	'.prettierrc.json',
	'prettier.config.js',
	'prettier.config.mjs',
	'prettier.config.cjs',
	'babel.config.js',
	'babel.config.json',
	'jest.config.js',
	'jest.config.ts',
	'vitest.config.ts',
	'vitest.config.js',
	'rollup.config.js',
	'webpack.config.js',
	'tailwind.config.js',
	'tailwind.config.ts',
	'postcss.config.js',
	'dockerfile',
	'docker-compose.yml',
	'docker-compose.yaml',
	'makefile',
	'readme.md',
	'license',
	'license.md',
	'changelog.md',
	'.gitignore',
	'.gitattributes',
	'.npmrc',
	'.nvmrc',
	'.editorconfig',
	'.env',
	'.env.example',
	'.env.local',
	'.env.development',
	'.env.production'
])

const CODE_EXTENSIONS = new Set([
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
	'.cc',
	'.cxx',
	'.c',
	'.h',
	'.hpp',
	'.swift',
	'.php',
	'.rb',
	'.lua',
	'.dart',
	'.scala',
	'.vue',
	'.svelte'
])

const METADATA_NAME_PATTERNS = [
	/^vite\.config\.(ts|js|mts|mjs|cjs)$/i,
	/^next\.config\.(ts|js|mts|mjs|cjs)$/i,
	/^nuxt\.config\.(ts|js)$/i,
	/^astro\.config\.(ts|js|mts|mjs|cjs)$/i,
	/^svelte\.config\.(ts|js)$/i,
	/^electron\.vite\.config\.(ts|js)$/i,
	/^tsconfig\.[\w.-]+\.json$/i,
	/^\.env\..+$/i
]

function basename(relativePath: string): string {
	const parts = relativePath.replace(/\\/g, '/').split('/')
	return parts[parts.length - 1] ?? relativePath
}

function extname(relativePath: string): string {
	const name = basename(relativePath)
	const i = name.lastIndexOf('.')
	return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function isCodeFile(relativePath: string): boolean {
	return CODE_EXTENSIONS.has(extname(relativePath))
}

export function isMetadataFile(relativePath: string): boolean {
	const name = basename(relativePath).toLowerCase()
	if (METADATA_FILENAMES.has(name)) return true
	return METADATA_NAME_PATTERNS.some((re) => re.test(basename(relativePath)))
}

/** Whether a path should be scanned and represented as a graph node. */
export function isGraphRelevantFile(relativePath: string): boolean {
	if (isCodeFile(relativePath)) return true
	return isMetadataFile(relativePath)
}

export function metadataKind(relativePath: string): 'config' | 'lock' | 'env' | 'docs' | 'build' {
	const name = basename(relativePath).toLowerCase()
	if (/\.lock$|^go\.sum$|^cargo\.lock$/.test(name)) return 'lock'
	if (/^\.env/.test(name)) return 'env'
	if (/readme|license|changelog|contributing/.test(name)) return 'docs'
	if (/dockerfile|docker-compose|makefile|gradle|pom\.xml|cargo\.toml|go\.mod/.test(name)) {
		return 'build'
	}
	return 'config'
}

export function inferLanguageFromPath(relativePath: string): string | undefined {
	const ext = extname(relativePath)
	if (ext) return ext.slice(1)
	const name = basename(relativePath).toLowerCase()
	if (name === 'dockerfile') return 'dockerfile'
	if (name === 'makefile') return 'makefile'
	return undefined
}
