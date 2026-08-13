/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isSecretPath, isUnderWorkspace, resolveWorkspaceUri } from './tools';

export interface WorkspacePosition {
	line: number;
	character: number;
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
	const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.max(1, Math.min(maximum, Math.floor(candidate)));
}

function position(value: WorkspacePosition): vscode.Position {
	if (!Number.isInteger(value?.line) || !Number.isInteger(value?.character) || value.line < 0 || value.character < 0) {
		throw new Error('Position must use non-negative line and character values.');
	}
	return new vscode.Position(value.line, value.character);
}

function rangeJson(range: vscode.Range): Record<string, WorkspacePosition> {
	return {
		start: { line: range.start.line, character: range.start.character },
		end: { line: range.end.line, character: range.end.character },
	};
}

function relative(uri: vscode.Uri): string {
	return vscode.workspace.asRelativePath(uri, false);
}

function isLocationLink(location: vscode.Location | vscode.LocationLink): location is vscode.LocationLink {
	return Object.hasOwn(location, 'targetUri');
}

function isTextSearchMatch(entry: vscode.TextSearchResult): entry is vscode.TextSearchMatch {
	return Object.hasOwn(entry, 'preview');
}

function locationJson(location: vscode.Location | vscode.LocationLink): Record<string, unknown> {
	if (isLocationLink(location)) {
		return { path: relative(location.targetUri), range: rangeJson(location.targetSelectionRange ?? location.targetRange) };
	}
	return { path: relative(location.uri), range: rangeJson(location.range) };
}

function diagnosticCode(diagnostic: vscode.Diagnostic): string | number | undefined {
	return typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
}

function documentSymbolJson(symbol: vscode.DocumentSymbol, uri: vscode.Uri, output: Array<Record<string, unknown>>, maximum: number, container?: string): void {
	if (output.length >= maximum) {
		return;
	}
	output.push({ name: symbol.name, kind: vscode.SymbolKind[symbol.kind], path: relative(uri), range: rangeJson(symbol.selectionRange), container });
	for (const child of symbol.children) {
		documentSymbolJson(child, uri, output, maximum, symbol.name);
	}
}

export class WorkspaceIntelligence {
	async listFiles(include: string | undefined, exclude: string | undefined, maximumResults: number | undefined, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		const maximum = bounded(maximumResults, 100, 500);
		const files = await vscode.workspace.findFiles(include?.trim() || '**/*', exclude?.trim() || '**/{node_modules,.git}/**', maximum, token);
		return { files: files.filter(uri => isUnderWorkspace(uri) && !isSecretPath(uri)).map(relative), truncated: files.length >= maximum };
	}

	async searchText(input: { query: string; isRegex?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean; include?: string; exclude?: string; maximumResults?: number }, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 512) {
			throw new Error('Search query must contain 1 to 512 characters.');
		}
		const maximum = bounded(input.maximumResults, 50, 200);
		const matches: Array<Record<string, unknown>> = [];
		const complete = await vscode.workspace.findTextInFiles(
			{ pattern: input.query, isRegExp: input.isRegex === true, isCaseSensitive: input.isCaseSensitive === true, isWordMatch: input.isWordMatch === true },
			{ include: input.include?.trim() || undefined, exclude: input.exclude?.trim() || undefined, maxResults: maximum, useDefaultExcludes: true, useIgnoreFiles: true },
			entry => {
				if (token.isCancellationRequested || !isTextSearchMatch(entry) || !isUnderWorkspace(entry.uri) || isSecretPath(entry.uri) || matches.length >= maximum) {
					return;
				}
				matches.push({ path: relative(entry.uri), preview: entry.preview.text.slice(0, 500), ranges: entry.ranges instanceof vscode.Range ? [rangeJson(entry.ranges)] : entry.ranges.map(rangeJson) });
			},
			token,
		);
		return { matches, limitHit: complete.limitHit === true, resultCount: matches.length };
	}

	async readFile(path: string, startLine: number | undefined, endLine: number | undefined, maximumCharacters: number | undefined, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const uri = resolveWorkspaceUri(path);
		if (!uri || !isUnderWorkspace(uri) || isSecretPath(uri)) {
			throw new Error('The requested path is unavailable.');
		}
		const document = await vscode.workspace.openTextDocument(uri);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const requestedStart = typeof startLine === 'number' && Number.isFinite(startLine) ? startLine : 0;
		const requestedEnd = typeof endLine === 'number' && Number.isFinite(endLine) ? endLine : document.lineCount;
		const first = Math.max(0, Math.min(document.lineCount, Math.floor(requestedStart)));
		const last = Math.min(document.lineCount, Math.max(first, Math.floor(requestedEnd)));
		const text = document.getText(new vscode.Range(first, 0, last, 0));
		const maximum = bounded(maximumCharacters, 80_000, 120_000);
		return { path: relative(uri), version: document.version, lineStart: first, lineEnd: last, text: text.slice(0, maximum), truncated: text.length > maximum };
	}

	async searchSymbols(query: string, maximumResults: number | undefined, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		if (!query?.trim()) {
			throw new Error('A symbol query is required.');
		}
		const maximum = bounded(maximumResults, 50, 200);
		const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query.trim());
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return {
			symbols: (symbols ?? []).filter(symbol => isUnderWorkspace(symbol.location.uri) && !isSecretPath(symbol.location.uri)).slice(0, maximum).map(symbol => ({ name: symbol.name, kind: vscode.SymbolKind[symbol.kind], path: relative(symbol.location.uri), range: rangeJson(symbol.location.range), container: symbol.containerName })),
		};
	}

	async getDefinitions(path: string, at: WorkspacePosition, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		const uri = this._safeUri(path);
		const locations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', uri, position(at));
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return { definitions: (locations ?? []).filter(location => {
			const uri = isLocationLink(location) ? location.targetUri : location.uri;
			return isUnderWorkspace(uri) && !isSecretPath(uri);
		}).slice(0, 100).map(locationJson) };
	}

	async getReferences(path: string, at: WorkspacePosition, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		const uri = this._safeUri(path);
		const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position(at));
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return { references: (locations ?? []).filter(location => isUnderWorkspace(location.uri) && !isSecretPath(location.uri)).slice(0, 200).map(locationJson) };
	}

	getDiagnostics(path: string | undefined): Record<string, unknown> {
		const entries = path ? [this._safeUri(path)] : vscode.languages.getDiagnostics().map(([uri]) => uri).filter(uri => isUnderWorkspace(uri));
		return {
			diagnostics: entries.filter(uri => !isSecretPath(uri)).flatMap(uri => vscode.languages.getDiagnostics(uri).slice(0, 100).map(diagnostic => ({ path: relative(uri), severity: vscode.DiagnosticSeverity[diagnostic.severity], message: diagnostic.message.slice(0, 1000), source: diagnostic.source, code: diagnosticCode(diagnostic), range: rangeJson(diagnostic.range) }))),
		};
	}

	async documentSymbols(path: string, maximumResults: number | undefined, token: vscode.CancellationToken): Promise<Record<string, unknown>> {
		const uri = this._safeUri(path);
		const symbols = await vscode.commands.executeCommand<Array<vscode.SymbolInformation | vscode.DocumentSymbol>>('vscode.executeDocumentSymbolProvider', uri);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const output: Array<Record<string, unknown>> = [];
		const maximum = bounded(maximumResults, 100, 300);
		for (const symbol of symbols ?? []) {
			if (symbol instanceof vscode.DocumentSymbol) {
				documentSymbolJson(symbol, uri, output, maximum);
			} else if (output.length < maximum && isUnderWorkspace(symbol.location.uri) && !isSecretPath(symbol.location.uri)) {
				output.push({ name: symbol.name, kind: vscode.SymbolKind[symbol.kind], path: relative(symbol.location.uri), range: rangeJson(symbol.location.range), container: symbol.containerName });
			}
		}
		return { symbols: output, truncated: output.length >= maximum };
	}

	private _safeUri(path: string): vscode.Uri {
		const uri = resolveWorkspaceUri(path);
		if (!uri || !isUnderWorkspace(uri) || isSecretPath(uri)) {
			throw new Error('The requested path is unavailable.');
		}
		return uri;
	}
}
