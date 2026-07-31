/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { parse, type ParserOptions } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { ParseResult, ScannedFile } from '../../common/types/graphTypes.js';
import { runNativeParseBatch } from './parseHooks.js';
import { isMetadataFile } from '../scanning/projectFiles.js';
import {
	extractImportsForFile,
	extractPackageName,
	isBabelParsableExtension
} from './importExtractors.js';

export type ParserFileReader = (absolutePath: string) => Promise<string | undefined>;

type TraverseFn = (ast: t.Node, visitors: object) => void;
const traverse: TraverseFn = ((babelTraverse as unknown as { default?: TraverseFn }).default ?? babelTraverse) as TraverseFn;

const PARSER_PLUGINS: ParserOptions['plugins'] = [
	'typescript',
	'jsx',
	'decorators-legacy',
	'classProperties',
	'dynamicImport',
	'importMeta',
	'topLevelAwait'
];

export class ParserEngine {
	constructor(private readonly readFile: ParserFileReader = async () => undefined) { }

	async parseFile(file: ScannedFile, contentOverride?: string): Promise<ParseResult | null> {
		let content: string;
		if (typeof contentOverride === 'string') {
			content = contentOverride;
		} else {
			const loaded = await this.readFile(file.absolutePath);
			if (loaded === undefined) {
				return null;
			}
			content = loaded;
		}

		if (content.length > 500_000) {return null;}

		if (isMetadataFile(file.relativePath)) {
			return this.parseMetadataFile(file);
		}

		if (!isBabelParsableExtension(file.extension)) {
			return this.parseWithImportExtractor(file, content);
		}

		let ast: t.File;
		try {
			ast = parse(content, {
				sourceType: 'module',
				plugins: PARSER_PLUGINS,
				errorRecovery: true
			});
		} catch {
			return this.fallbackRegexParse(file, content);
		}

		const imports: ParseResult['imports'] = [];
		const exports: ParseResult['exports'] = [];
		const functions: string[] = [];
		const components: string[] = [];
		const symbolLines: Record<string, number> = {};
		let isComponentFile = file.extension === '.tsx' || file.extension === '.jsx';

		const noteLine = (name: string, line?: number | null) => {
			if (name && typeof line === 'number' && symbolLines[name] == null) {
				symbolLines[name] = line;
			}
		};
		const extractDecl = (decl: t.Declaration) =>
			this.extractDeclarationNames(decl, exports, functions, components, symbolLines);
		const isComponentName = (name: string) => this.looksLikeComponent(name, file.extension);

		traverse(ast, {
			ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
				const source = path.node.source.value;
				const specifiers = path.node.specifiers.map((s) => {
					if (t.isImportDefaultSpecifier(s)) {return 'default';}
					if (t.isImportNamespaceSpecifier(s)) {return '*';}
					return s.local.name;
				});
				imports.push({
					source,
					specifiers,
					isDefault: path.node.specifiers.some((s) => t.isImportDefaultSpecifier(s)),
					line: path.node.loc?.start.line
				});
			},
			ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
				if (path.node.declaration) {extractDecl(path.node.declaration);}
				path.node.specifiers.forEach((s) => {
					if (t.isExportSpecifier(s) && t.isIdentifier(s.exported)) {
						const line = path.node.loc?.start.line;
						exports.push({ name: s.exported.name, line });
						noteLine(s.exported.name, line);
					}
				});
			},
			ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
				const line = path.node.loc?.start.line;
				const name =
					t.isIdentifier(path.node.declaration)
						? path.node.declaration.name
						: t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id
							? path.node.declaration.id.name
							: 'default';
				exports.push({ name, isDefault: true, line });
				noteLine(name, line);
				if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
					if (isComponentName(path.node.declaration.id.name)) {
						components.push(path.node.declaration.id.name);
						noteLine(path.node.declaration.id.name, path.node.declaration.loc?.start.line ?? line);
					}
				}
			},
			ExportAllDeclaration(path: NodePath<t.ExportAllDeclaration>) {
				exports.push({ name: `* from ${path.node.source?.value ?? ''}`, line: path.node.loc?.start.line });
			},
			FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
				if (path.node.id?.name) {
					const line = path.node.loc?.start.line;
					functions.push(path.node.id.name);
					noteLine(path.node.id.name, line);
					if (isComponentName(path.node.id.name)) {
						components.push(path.node.id.name);
						noteLine(path.node.id.name, line);
					}
				}
			},
			VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
				if (t.isIdentifier(path.node.id) && path.node.init) {
					const name = path.node.id.name;
					const line = path.node.loc?.start.line;
					if (
						t.isArrowFunctionExpression(path.node.init) ||
						t.isFunctionExpression(path.node.init)
					) {
						functions.push(name);
						noteLine(name, line);
						if (isComponentName(name)) {
							components.push(name);
							noteLine(name, line);
							isComponentFile = true;
						}
					}
				}
			},
			CallExpression(path: NodePath<t.CallExpression>) {
				if (
					t.isIdentifier(path.node.callee, { name: 'require' }) &&
					path.node.arguments[0] &&
					t.isStringLiteral(path.node.arguments[0])
				) {
					imports.push({
						source: path.node.arguments[0].value,
						specifiers: ['require'],
						line: path.node.loc?.start.line
					});
					return;
				}
				// Older babel: import('x') as CallExpression(callee=Import).
				if (
					t.isImport(path.node.callee) &&
					path.node.arguments[0] &&
					t.isStringLiteral(path.node.arguments[0])
				) {
					imports.push({
						source: path.node.arguments[0].value,
						specifiers: [],
						isDynamic: true,
						line: path.node.loc?.start.line
					});
				}
			},
			ImportExpression(path: NodePath<t.ImportExpression>) {
				const src = path.node.source;
				if (t.isStringLiteral(src)) {
					imports.push({
						source: src.value,
						specifiers: [],
						isDynamic: true,
						line: path.node.loc?.start.line
					});
				}
			}
		});

		return {
			filePath: file.absolutePath,
			relativePath: file.relativePath,
			imports,
			exports,
			functions,
			components,
			isComponentFile: isComponentFile || components.length > 0,
			symbolLines: Object.keys(symbolLines).length ? symbolLines : undefined
		};
	}

	async parseFiles(files: ScannedFile[], projectPath?: string): Promise<ParseResult[]> {
		let nativeResults: ParseResult[] = [];
		if (projectPath) {
			const native = await runNativeParseBatch(projectPath, files);
			if (native) {nativeResults = native;}
		}

		const covered = new Set(nativeResults.map((r) => r.relativePath));
		const missing = files.filter((f) => !covered.has(f.relativePath));
		const fallbackResults = await this.parseFilesWithTypeScript(missing);

		return [...nativeResults, ...fallbackResults];
	}

	private async parseFilesWithTypeScript(files: ScannedFile[]): Promise<ParseResult[]> {
		const results: ParseResult[] = [];
		const batchSize = 20;

		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			const parsed = await Promise.all(batch.map((f) => this.parseFile(f)));
			for (const p of parsed) {
				if (p) {results.push(p);}
			}
		}

		return results;
	}

	private extractDeclarationNames(
		decl: t.Declaration,
		exports: ParseResult['exports'],
		functions: string[],
		components: string[],
		symbolLines?: Record<string, number>
	): void {
		void components;
		const note = (name: string, line?: number | null) => {
			if (symbolLines && name && typeof line === 'number' && symbolLines[name] == null) {
				symbolLines[name] = line;
			}
		};
		if (t.isFunctionDeclaration(decl) && decl.id) {
			const line = decl.loc?.start.line;
			exports.push({ name: decl.id.name, line });
			functions.push(decl.id.name);
			note(decl.id.name, line);
		} else if (t.isVariableDeclaration(decl)) {
			decl.declarations.forEach((d) => {
				if (t.isIdentifier(d.id)) {
					const line = d.loc?.start.line ?? decl.loc?.start.line;
					exports.push({ name: d.id.name, line });
					note(d.id.name, line);
				}
			});
		} else if (t.isClassDeclaration(decl) && decl.id) {
			const line = decl.loc?.start.line;
			exports.push({ name: decl.id.name, line });
			note(decl.id.name, line);
		} else if (t.isTSInterfaceDeclaration(decl)) {
			const line = decl.loc?.start.line;
			exports.push({ name: decl.id.name, isType: true, line });
			note(decl.id.name, line);
		} else if (t.isTSTypeAliasDeclaration(decl)) {
			const line = decl.loc?.start.line;
			exports.push({ name: decl.id.name, isType: true, line });
			note(decl.id.name, line);
		}
	}

	private looksLikeComponent(name: string, ext: string): boolean {
		if (ext === '.tsx' || ext === '.jsx') {return /^[A-Z]/.test(name);}
		return false;
	}

	private parseMetadataFile(file: ScannedFile): ParseResult {
		return {
			filePath: file.absolutePath,
			relativePath: file.relativePath,
			imports: [],
			exports: [],
			functions: [],
			components: [],
			isComponentFile: false
		};
	}

	private parseWithImportExtractor(file: ScannedFile, content: string): ParseResult {
		const imports = extractImportsForFile(file, content);
		const packageName = extractPackageName(file, content);
		const isComponent =
			file.extension === '.tsx' ||
			file.extension === '.jsx' ||
			file.extension === '.vue' ||
			file.extension === '.svelte';

		return {
			filePath: file.absolutePath,
			relativePath: file.relativePath,
			imports,
			exports: [],
			functions: [],
			components: [],
			isComponentFile: isComponent,
			packageName
		};
	}

	private fallbackRegexParse(file: ScannedFile, content: string): ParseResult {
		return this.parseWithImportExtractor(file, content);
	}
}
