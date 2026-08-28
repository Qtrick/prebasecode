/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { executeHybridWebFetch, executeHybridWebSearch, type HybridWebContextResponse } from './hybridWebContext';
import { toMagnusWebToolPayload } from './webContextCore';
import type { MagnusSecretStorage } from './secretStorage';
import { isSecretPath, isUnderWorkspace, MagnusWorkspaceTools, resolveWorkspaceUri } from './tools';
import { WorkspaceIntelligence, type WorkspacePosition } from './workspaceIntelligence';
import { MagnusToolActivityDescriptor } from './toolActivity';
import { ProjectSafetyService } from './projectSafetyService';

function result(value: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value.slice(0, 80_000))]);
}

function commandResult(value: unknown): vscode.LanguageModelToolResult {
	return result(typeof value === 'string' ? value : JSON.stringify(value ?? { found: false }));
}

class GraphSearchTool implements vscode.LanguageModelTool<{ query: string; maximumResults?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string; maximumResults?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_graph_search', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ query: string; maximumResults?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const query = options.input.query?.trim();
		if (!query) {
			throw new Error('A graph search query is required.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.graph.searchForMagnus', query, options.input.maximumResults ?? 20));
	}
}

class GraphNodeTool implements vscode.LanguageModelTool<{ node: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ node: string }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_graph_node', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ node: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || !options.input.node?.trim()) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'A graph node id or relative path is required.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.graph.getNodeForMagnus', options.input.node.trim()));
	}
}

class GraphDependenciesTool implements vscode.LanguageModelTool<{ node: string; direction?: 'incoming' | 'outgoing' | 'both'; depth?: number; maximumNodes?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ node: string; direction?: 'incoming' | 'outgoing' | 'both'; depth?: number; maximumNodes?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_graph_dependencies', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ node: string; direction?: 'incoming' | 'outgoing' | 'both'; depth?: number; maximumNodes?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || !options.input.node?.trim()) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'A graph node id or relative path is required.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.graph.getDependenciesForMagnus', options.input.node.trim(), options.input.direction ?? 'both', options.input.depth ?? 1, options.input.maximumNodes ?? 50));
	}
}

class GraphOverviewTool implements vscode.LanguageModelTool<Record<string, never>> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_graph_overview', options.input as Record<string, unknown>);
	}
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.graph.getOverviewForMagnus'));
	}
}

class WorkspaceReadTool implements vscode.LanguageModelTool<{ path: string }> {
	private readonly workspace = new MagnusWorkspaceTools(1, false);
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_read', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const response = await this.workspace.readFile(options.input.path, token);
		if (!response.ok) {
			throw new Error(response.output);
		}
		return result(response.output);
	}
}

class WorkspaceSearchTool implements vscode.LanguageModelTool<{ query: string }> {
	private readonly workspace = new MagnusWorkspaceTools(1, false);
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_search', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ query: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const response = await this.workspace.searchWorkspace(options.input.query, token);
		if (!response.ok) {
			throw new Error(response.output);
		}
		return result(response.output);
	}
}

const workspaceIntelligence = new WorkspaceIntelligence();

class WorkspaceListFilesTool implements vscode.LanguageModelTool<{ include?: string; exclude?: string; maximumResults?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ include?: string; exclude?: string; maximumResults?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_list_files', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ include?: string; exclude?: string; maximumResults?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(await workspaceIntelligence.listFiles(options.input.include, options.input.exclude, options.input.maximumResults, token));
	}
}

class WorkspaceTextSearchTool implements vscode.LanguageModelTool<{ query: string; isRegex?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean; include?: string; exclude?: string; maximumResults?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string; isRegex?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean; include?: string; exclude?: string; maximumResults?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_text_search', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ query: string; isRegex?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean; include?: string; exclude?: string; maximumResults?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(await workspaceIntelligence.searchText(options.input, token));
	}
}

class WorkspaceReadRangeTool implements vscode.LanguageModelTool<{ path: string; startLine?: number; endLine?: number; maximumCharacters?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; startLine?: number; endLine?: number; maximumCharacters?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_read_range', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; startLine?: number; endLine?: number; maximumCharacters?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(await workspaceIntelligence.readFile(options.input.path, options.input.startLine, options.input.endLine, options.input.maximumCharacters, token));
	}
}

class WorkspaceSymbolsTool implements vscode.LanguageModelTool<{ query?: string; path?: string; maximumResults?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ query?: string; path?: string; maximumResults?: number }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_symbols', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ query?: string; path?: string; maximumResults?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (options.input.path) {
			return commandResult(await workspaceIntelligence.documentSymbols(options.input.path, options.input.maximumResults, token));
		}
		return commandResult(await workspaceIntelligence.searchSymbols(options.input.query ?? '', options.input.maximumResults, token));
	}
}

class WorkspaceDefinitionTool implements vscode.LanguageModelTool<{ path: string; position: WorkspacePosition }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; position: WorkspacePosition }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_definition', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; position: WorkspacePosition }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(await workspaceIntelligence.getDefinitions(options.input.path, options.input.position, token));
	}
}

class WorkspaceReferencesTool implements vscode.LanguageModelTool<{ path: string; position: WorkspacePosition }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; position: WorkspacePosition }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_references', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; position: WorkspacePosition }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(await workspaceIntelligence.getReferences(options.input.path, options.input.position, token));
	}
}

class WorkspaceDiagnosticsTool implements vscode.LanguageModelTool<{ path?: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path?: string }>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_workspace_diagnostics', options.input as Record<string, unknown>);
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path?: string }>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		return commandResult(workspaceIntelligence.getDiagnostics(options.input.path));
	}
}

interface TextChange {
	start: WorkspacePosition;
	end: WorkspacePosition;
	text: string;
}

interface VersionedFileEdits {
	path: string;
	expectedVersion: number;
	edits: TextChange[];
}

function checkedWorkspaceUri(path: string): vscode.Uri {
	const uri = resolveWorkspaceUri(path);
	if (!uri || !isUnderWorkspace(uri) || isSecretPath(uri)) {
		throw new Error('The requested path is unavailable for editing.');
	}
	return uri;
}

function checkedPosition(input: WorkspacePosition): vscode.Position {
	if (!Number.isInteger(input?.line) || !Number.isInteger(input?.character) || input.line < 0 || input.character < 0) {
		throw new Error('Edit positions must be non-negative integers.');
	}
	return new vscode.Position(input.line, input.character);
}

class WorkspaceApplyEditsTool implements vscode.LanguageModelTool<{ files: VersionedFileEdits[]; label?: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ files: VersionedFileEdits[]; label?: string }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Applying edits to ${options.input.files?.length ?? 0} file(s)`, confirmationMessages: { title: 'Allow Agents to apply these workspace edits?', message: 'Agents will apply the reviewed, version-checked text edits as one workspace operation.' } };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ files: VersionedFileEdits[]; label?: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'workspaceWrite', description: 'Apply workspace edits' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'Workspace edit denied by Project Safety.');
		}
		if (!Array.isArray(options.input.files) || options.input.files.length === 0 || options.input.files.length > 50) {
			throw new Error('Provide between 1 and 50 version-checked files.');
		}
		const edit = new vscode.WorkspaceEdit();
		const changed: string[] = [];
		const checkedDocuments: Array<{ uri: vscode.Uri; document: vscode.TextDocument; expectedVersion: number }> = [];
		for (const file of options.input.files) {
			if (token.isCancellationRequested) {
				throw new Error('Cancelled');
			}
			const uri = checkedWorkspaceUri(file.path);
			const document = await vscode.workspace.openTextDocument(uri);
			if (!Number.isInteger(file.expectedVersion) || document.version !== file.expectedVersion || document.isDirty) {
				throw new Error(`Conflict in ${vscode.workspace.asRelativePath(uri)}; its version changed or it has unsaved edits.`);
			}
			if (!Array.isArray(file.edits) || file.edits.length === 0 || file.edits.length > 200) {
				throw new Error(`Invalid edit list for ${vscode.workspace.asRelativePath(uri)}.`);
			}
			checkedDocuments.push({ uri, document, expectedVersion: file.expectedVersion });
			for (const change of file.edits) {
				if (typeof change.text !== 'string' || change.text.length > 500_000) {
					throw new Error('Each edit replacement must be text no larger than 500 KB.');
				}
				edit.replace(uri, new vscode.Range(checkedPosition(change.start), checkedPosition(change.end)), change.text, { label: options.input.label ?? 'Agents workspace edit', needsConfirmation: true });
			}
			changed.push(vscode.workspace.asRelativePath(uri));
		}
		// Opening the later documents can yield to the event loop. Re-check every
		// document immediately before apply so a change made during preparation is
		// never overwritten from a stale model read.
		for (const { uri, document, expectedVersion } of checkedDocuments) {
			if (document.version !== expectedVersion || document.isDirty) {
				throw new Error(`Conflict in ${vscode.workspace.asRelativePath(uri)}; its version changed or it has unsaved edits.`);
			}
		}
		if (token.isCancellationRequested || !(await vscode.workspace.applyEdit(edit))) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'The workspace rejected the edit.');
		}
		return result(JSON.stringify({ changed }));
	}
}

class WorkspaceCreateFileTool implements vscode.LanguageModelTool<{ path: string; content: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; content: string }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Creating ${options.input.path}`, confirmationMessages: { title: 'Allow Agents to create this file?', message: `Agents will create \`${options.input.path}\` without overwriting an existing file.` } };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; content: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || typeof options.input.content !== 'string' || options.input.content.length > 1_000_000) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'Content no larger than 1 MB is required.');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'workspaceWrite', targetPath: options.input.path, description: 'Create file' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'File creation denied by Project Safety.');
		}
		const uri = checkedWorkspaceUri(options.input.path);
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(uri, { overwrite: false, ignoreIfExists: false, contents: Buffer.from(options.input.content) }, { label: 'Agents create file', needsConfirmation: true });
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error('The file already exists or could not be created.');
		}
		return result(JSON.stringify({ created: vscode.workspace.asRelativePath(uri) }));
	}
}

class WorkspaceRenameFileTool implements vscode.LanguageModelTool<{ from: string; to: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ from: string; to: string }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Renaming ${options.input.from}`, confirmationMessages: { title: 'Allow Agents to rename this file?', message: `Agents will rename \`${options.input.from}\` to \`${options.input.to}\` without overwriting a destination.` } };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ from: string; to: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'fileMove', sourcePath: options.input.from, targetPath: options.input.to, description: 'Rename file' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'File rename denied by Project Safety.');
		}
		const source = checkedWorkspaceUri(options.input.from);
		const destination = checkedWorkspaceUri(options.input.to);
		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(source, destination, { overwrite: false, ignoreIfExists: false }, { label: 'Agents rename file', needsConfirmation: true });
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error('The file could not be renamed.');
		}
		return result(JSON.stringify({ from: vscode.workspace.asRelativePath(source), to: vscode.workspace.asRelativePath(destination) }));
	}
}

class WorkspaceDeleteFileTool implements vscode.LanguageModelTool<{ path: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Deleting ${options.input.path}`, confirmationMessages: { title: 'Allow Agents to delete this file?', message: `Agents will permanently delete \`${options.input.path}\`. Review this destructive change carefully.` } };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'fileDelete', targetPath: options.input.path, description: 'Delete file' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'File deletion denied by Project Safety.');
		}
		const uri = checkedWorkspaceUri(options.input.path);
		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(uri, { recursive: false, ignoreIfNotExists: false }, { label: 'Agents delete file', needsConfirmation: true });
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error('The file could not be deleted.');
		}
		return result(JSON.stringify({ deleted: vscode.workspace.asRelativePath(uri) }));
	}
}

class WorkspaceEditTool implements vscode.LanguageModelTool<{ path: string; content: string }> {
	private readonly workspace = new MagnusWorkspaceTools(1, false);
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ path: string; content: string }>): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `Updating ${options.input.path}`,
			confirmationMessages: {
				title: 'Allow Agents to edit this workspace file?',
				message: `Agents will replace the contents of \`${options.input.path}\`.`,
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ path: string; content: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'workspaceWrite', targetPath: options.input.path, description: 'Edit file' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'File edit denied by Project Safety.');
		}
		const response = await this.workspace.applyEdit(options.input.path, options.input.content, token);
		if (!response.ok) {
			throw new Error(response.output);
		}
		return result(response.output);
	}
}

class RuntimeStateTool implements vscode.LanguageModelTool<Record<string, never>> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_runtime_status', options.input as Record<string, unknown>);
	}
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.getContextForMagnus'));
	}
}

class RuntimeNavigateTool implements vscode.LanguageModelTool<{ url: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ url: string }>): vscode.PreparedToolInvocation {
		const local = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(options.input.url) || options.input.url.startsWith('/');
		return {
			invocationMessage: `Navigating Runtime Preview to ${options.input.url}`,
			confirmationMessages: local ? undefined : { title: 'Allow Runtime Preview to open an external origin?', message: `Agents will navigate Runtime Preview to \`${options.input.url}\`. External origins can expose project activity to that site.` },
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ url: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || typeof options.input.url !== 'string' || options.input.url.length > 4096) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'A valid preview URL or relative path is required.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.navigateForMagnus', options.input.url));
	}
}

class RuntimeInspectPageTool implements vscode.LanguageModelTool<Record<string, never>> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_runtime_preview_diagnose', options.input as Record<string, unknown>);
	}
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.inspectForMagnus', token));
	}
}

class RuntimeEvidenceTool implements vscode.LanguageModelTool<{ kind: 'console' | 'network'; maximumEntries?: number }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ kind: 'console' | 'network'; maximumEntries?: number }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `Collecting ${options.input.kind} evidence from Runtime Preview` };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ kind: 'console' | 'network'; maximumEntries?: number }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || (options.input.kind !== 'console' && options.input.kind !== 'network')) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'Specify console or network evidence.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.getEvidenceForMagnus', options.input.kind, options.input.maximumEntries ?? 50));
	}
}

class RuntimeTestTool implements vscode.LanguageModelTool<{ action: 'begin' | 'finalize' | 'replay' }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ action: 'begin' | 'finalize' | 'replay' }>): vscode.PreparedToolInvocation {
		return { invocationMessage: `${options.input.action} Runtime Preview test session` };
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ action: 'begin' | 'finalize' | 'replay' }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested || !['begin', 'finalize', 'replay'].includes(options.input.action)) {
			throw new Error(token.isCancellationRequested ? 'Cancelled' : 'Unsupported Runtime Preview test action.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.controlTestForMagnus', options.input.action));
	}
}

class RuntimeServerTool implements vscode.LanguageModelTool<{ action: 'start' | 'stop' | 'restart' }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ action: 'start' | 'stop' | 'restart' }>): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `${options.input.action} Runtime Preview server`,
			confirmationMessages: {
				title: `${options.input.action[0].toUpperCase()}${options.input.action.slice(1)} Runtime Preview server?`,
				message: 'Agents will use the selected project Runtime Preview configuration. Only a PreBase-owned server can be stopped.',
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ action: 'start' | 'stop' | 'restart' }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'runtime', description: 'Control Runtime Preview server' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'Runtime Preview server control denied by Project Safety.');
		}
		const action = options.input.action;
		if (action !== 'start' && action !== 'stop' && action !== 'restart') {
			throw new Error('Unsupported runtime action.');
		}
		return commandResult(await vscode.commands.executeCommand('prebase.runtime.controlForMagnus', action));
	}
}

const SAFE_SCRIPT_NAME = /^(?:test|lint|typecheck|check|build|compile|validate|verify)(?::[A-Za-z0-9_-]+)*$/;
const DISALLOWED_SCRIPT_CONTENT = /(?:\bsudo\b|\bsu\b|\brm\b|\bcurl\b|\bwget\b|\bssh\b|\b(?:sh|bash|zsh|fish|cmd|powershell|pwsh|node|deno|python(?:\d+(?:\.\d+)*)?|ruby|perl|php|make|just|docker|git|npx|tsx|ts-node)\b|\bnpm\s+(?:install|exec)\b|\bpnpm\s+(?:add|install|exec|dlx)\b|\byarn\s+(?:add|install|dlx)\b|\bbun\s+(?:add|install|x)\b|[;&|`]|\$\(|\$\{|\n)/i;

async function packageManagerFor(folder: vscode.WorkspaceFolder): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
	const packageUri = vscode.Uri.joinPath(folder.uri, 'package.json');
	const raw = Buffer.from(await vscode.workspace.fs.readFile(packageUri)).toString('utf8');
	const parsed = JSON.parse(raw) as { packageManager?: string };
	if (parsed.packageManager?.startsWith('pnpm@')) {return 'pnpm';}
	if (parsed.packageManager?.startsWith('yarn@')) {return 'yarn';}
	if (parsed.packageManager?.startsWith('bun@')) {return 'bun';}
	for (const [name, manager] of [['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']] as const) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, name));
			return manager;
		} catch {
			// Try the next package-manager lockfile.
		}
	}
	return 'npm';
}

async function textFile(folder: vscode.WorkspaceFolder, name: string): Promise<string | undefined> {
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, name))).toString('utf8').trim();
	} catch {
		return undefined;
	}
}

async function workspaceFolderForTerminal(): Promise<vscode.WorkspaceFolder> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || folder.uri.scheme !== 'file') {
		throw new Error('A local workspace folder is required to run project tasks.');
	}
	return folder;
}

async function runVisibleTask(task: vscode.Task, token: vscode.CancellationToken): Promise<{ cancelled: boolean; exitCode: number | undefined }> {
	const execution = await vscode.tasks.executeTask(task);
	return new Promise(resolve => {
		let settled = false;
		const disposables: vscode.Disposable[] = [];
		const addDisposable = <T extends vscode.Disposable>(disposable: T): T => {
			if (settled) {
				disposable.dispose();
			} else {
				disposables.push(disposable);
			}
			return disposable;
		};
		const finish = (cancelled: boolean, exitCode: number | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			while (disposables.length) {
				disposables.pop()?.dispose();
			}
			resolve({ cancelled, exitCode });
		};
		addDisposable(vscode.tasks.onDidEndTaskProcess(event => {
			if (event.execution === execution) {
				finish(false, event.exitCode);
			}
		}));
		addDisposable(token.onCancellationRequested(() => {
			execution.terminate();
			finish(true, undefined);
		}));
		if (settled) {
			return;
		}
		// Cancellation may arrive between executeTask and registration of the
		// listener; terminate this exact execution rather than leaving it running.
		if (token.isCancellationRequested) {
			execution.terminate();
			finish(true, undefined);
		}
	});
}

class ProjectEnvironmentTool implements vscode.LanguageModelTool<Record<string, never>> {
	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>): vscode.PreparedToolInvocation {
		return { invocationMessage: 'Inspecting project environment' };
	}
	async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const folder = await workspaceFolderForTerminal();
		const raw = await textFile(folder, 'package.json');
		const packageJson = raw ? JSON.parse(raw) as { engines?: { node?: string }; packageManager?: string; scripts?: Record<string, string>; volta?: { node?: string } } : undefined;
		const manager = await packageManagerFor(folder);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		return result(JSON.stringify({
			workspace: folder.uri.fsPath,
			packageManager: manager,
			declaredPackageManager: packageJson?.packageManager,
			scripts: Object.keys(packageJson?.scripts ?? {}).sort(),
			extensionHostNode: process.version,
			requiredNode: (await textFile(folder, '.nvmrc')) ?? (await textFile(folder, '.node-version')) ?? packageJson?.volta?.node ?? packageJson?.engines?.node,
		}));
	}
}

class InstallDependenciesTool implements vscode.LanguageModelTool<{ operation: 'install' | 'update' }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ operation: 'install' | 'update' }>): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `${options.input.operation} project dependencies`,
			confirmationMessages: {
				title: `Allow Agents to ${options.input.operation} dependencies?`,
				message: `Agents will run the detected package manager's ${options.input.operation} command in this workspace. This can access the network, execute package lifecycle scripts, and change the lockfile or dependencies.`,
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ operation: 'install' | 'update' }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'terminal', command: `${options.input.operation} dependencies`, description: 'Modify dependencies' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'Dependency modification denied by Project Safety.');
		}
		if (options.input.operation !== 'install' && options.input.operation !== 'update') {
			throw new Error('Unsupported dependency operation.');
		}
		const folder = await workspaceFolderForTerminal();
		const manager = await packageManagerFor(folder);
		const packageJson = await textFile(folder, 'package.json');
		const declaredManager = packageJson ? (JSON.parse(packageJson) as { packageManager?: string }).packageManager : undefined;
		// Yarn Berry uses `up`; Yarn Classic uses `upgrade`. The other supported
		// package managers consistently use `update` for this explicit operation.
		const yarnMajor = declaredManager?.match(/^yarn@(\d+)/)?.[1];
		const command = options.input.operation === 'install'
			? 'install'
			: manager === 'yarn' && yarnMajor !== undefined && Number(yarnMajor) >= 2
				? 'up'
				: manager === 'yarn'
					? 'upgrade'
					: 'update';
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const task = new vscode.Task({ type: 'prebase-agent-dependencies', manager, command }, folder, `Agents: ${manager} ${command}`, 'PreBase Agents', new vscode.ShellExecution(manager, [command], { cwd: folder.uri.fsPath }));
		const outcome = await runVisibleTask(task, token);
		return result(JSON.stringify({ command: `${manager} ${command}`, cwd: folder.uri.fsPath, networkRequired: true, lifecycleScriptsMayRun: true, status: outcome.cancelled ? 'cancelled' : outcome.exitCode === 0 ? 'passed' : outcome.exitCode === undefined ? 'unknown' : 'failed', exitCode: outcome.exitCode }));
	}
}

class DeclaredNodeVersionTool implements vscode.LanguageModelTool<{ action: 'use' | 'install'; version: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ action: 'use' | 'install'; version: string }>): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `Run nvm ${options.input.action} ${options.input.version}`,
			confirmationMessages: {
				title: options.input.action === 'install' ? 'Allow Agents to install the declared Node version?' : 'Allow Agents to use the declared Node version?',
				message: `Agents will run \`nvm ${options.input.action} ${options.input.version}\` in a visible project task. It will not change shell startup files; install may download Node.`,
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ action: 'use' | 'install'; version: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'terminal', command: `nvm ${options.input.action} ${options.input.version}`, description: 'Manage Node version' });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'Node version management denied by Project Safety.');
		}
		if ((options.input.action !== 'use' && options.input.action !== 'install') || typeof options.input.version !== 'string' || options.input.version.length > 40 || !/^(?:v?\d+(?:\.\d+){0,2}|lts\/[A-Za-z0-9*_-]+)$/.test(options.input.version)) {
			throw new Error('Use a declared numeric or lts Node version only.');
		}
		const folder = await workspaceFolderForTerminal();
		const packageJson = await textFile(folder, 'package.json');
		const parsed = packageJson ? JSON.parse(packageJson) as { volta?: { node?: string } } : undefined;
		const declared = (await textFile(folder, '.nvmrc')) ?? (await textFile(folder, '.node-version')) ?? parsed?.volta?.node;
		if (!declared || declared.replace(/^v/, '') !== options.input.version.replace(/^v/, '')) {
			throw new Error('The requested Node version does not exactly match this project’s declared .nvmrc, .node-version, or Volta version.');
		}
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		// nvm is normally a shell function, not an executable. The version is
		// strictly validated above and quoted to prevent `lts/*` glob expansion.
		const command = `nvm ${options.input.action} '${options.input.version}'`;
		const task = new vscode.Task({ type: 'prebase-agent-node', action: options.input.action, version: options.input.version }, folder, `Agents: ${command}`, 'PreBase Agents', new vscode.ShellExecution(command, { cwd: folder.uri.fsPath }));
		const outcome = await runVisibleTask(task, token);
		return result(JSON.stringify({ command: `nvm ${options.input.action} ${options.input.version}`, cwd: folder.uri.fsPath, nodeVersionScope: options.input.action === 'use' ? 'task-only; this does not persist to future VS Code tasks' : 'installed by nvm if successful', networkRequired: options.input.action === 'install', status: outcome.cancelled ? 'cancelled' : outcome.exitCode === 0 ? 'passed' : outcome.exitCode === undefined ? 'unknown' : 'failed', exitCode: outcome.exitCode }));
	}
}

class ProjectScriptTool implements vscode.LanguageModelTool<{ script: string }> {
	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<{ script: string }>): vscode.PreparedToolInvocation {
		return {
			invocationMessage: `Run project script ${options.input.script}`,
			confirmationMessages: {
				title: 'Run project validation script?',
				message: `Agents will run the declared project script \`${options.input.script}\` in the selected workspace folder. It cannot run arbitrary shell input.`,
			},
		};
	}
	async invoke(options: vscode.LanguageModelToolInvocationOptions<{ script: string }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const script = typeof options.input.script === 'string' ? options.input.script.trim() : undefined;
		if (!script || !SAFE_SCRIPT_NAME.test(script)) {
			throw new Error('Only declared validation, test, build, or check scripts are allowed.');
		}
		const perm = await ProjectSafetyService.instance.checkPermission({ category: 'terminal', command: `npm run ${script}`, description: `Run script ${script}` });
		if (!perm.allowed) {
			throw new Error(perm.reason || 'Project script execution denied by Project Safety.');
		}
		const folder = await workspaceFolderForTerminal();
		const raw = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, 'package.json'))).toString('utf8');
		const packageJson = JSON.parse(raw) as { scripts?: Record<string, string> };
		const scripts = packageJson.scripts ?? {};
		const body = scripts[script];
		if (!body) {
			throw new Error(`Package script '${script}' is not declared by this project.`);
		}
		const lifecycleScripts = [script, `pre${script}`, `post${script}`]
			.map(name => ({ name, body: scripts[name] }))
			.filter((entry): entry is { name: string; body: string } => typeof entry.body === 'string');
		if (lifecycleScripts.some(entry => DISALLOWED_SCRIPT_CONTENT.test(entry.body))) {
			throw new Error(`Package script '${script}' requires manual review because its resolved command is not safe for autonomous execution.`);
		}
		const manager = await packageManagerFor(folder);
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const task = new vscode.Task(
			{ type: 'prebase-agent-script', script },
			folder,
			`Agents: ${manager} run ${script}`,
			'PreBase Agents',
			new vscode.ShellExecution(manager, ['run', script], { cwd: folder.uri.fsPath }),
		);
		const outcome = await runVisibleTask(task, token);
		if (outcome.cancelled) {
			return result(JSON.stringify({ command: `${manager} run ${script}`, cwd: folder.uri.fsPath, status: 'cancelled' }));
		}
		return result(JSON.stringify({ command: `${manager} run ${script}`, cwd: folder.uri.fsPath, exitCode: outcome.exitCode, status: outcome.exitCode === 0 ? 'passed' : outcome.exitCode === undefined ? 'unknown' : 'failed' }));
	}
}

const localWebContextCache = new Map<string, HybridWebContextResponse>();

interface WebSearchInput {
	query: string;
	depth?: 'fast' | 'standard' | 'deep';
	maxResults?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	fromDate?: string;
	toDate?: string;
	freshness?: 'normal' | 'fresh';
}

interface WebFetchInput {
	url: string;
	freshness?: 'normal' | 'fresh';
}

class WebSearchTool implements vscode.LanguageModelTool<WebSearchInput> {
	constructor(private readonly secrets?: MagnusSecretStorage) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<WebSearchInput>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_web_search', options.input as unknown as Record<string, unknown>);
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<WebSearchInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const input = options.input;
		if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 1_000) {
			throw new Error('Web search requires a query of 1 to 1,000 characters.');
		}
		if (input.depth && !['fast', 'standard', 'deep'].includes(input.depth)) {
			throw new Error('Web search depth must be fast, standard, or deep.');
		}
		if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 6)) {
			throw new Error('Web search maximum results must be an integer from 1 to 6.');
		}
		if (input.freshness && input.freshness !== 'normal' && input.freshness !== 'fresh') {
			throw new Error('Web search freshness must be normal or fresh.');
		}
		for (const domains of [input.includeDomains, input.excludeDomains]) {
			if (domains && (!Array.isArray(domains) || domains.length > 20 || domains.some(domain => typeof domain !== 'string' || domain.length > 253))) {
				throw new Error('Web search domain filters must contain at most 20 host names.');
			}
		}

		if (this.secrets) {
			const linkupKey = await this.secrets.getProviderApiKey('linkup');
			const firecrawlKey = await this.secrets.getProviderApiKey('firecrawl');
			if (linkupKey && firecrawlKey) {
				return commandResult(toMagnusWebToolPayload(await executeHybridWebSearch(input, {
					linkupKey,
					firecrawlKey,
					token,
					cache: localWebContextCache,
				})));
			}
		}

		return commandResult(toMagnusWebToolPayload(await vscode.commands.executeCommand('prebase.webSearch.searchForMagnus', input, token)));
	}
}

class WebFetchTool implements vscode.LanguageModelTool<WebFetchInput> {
	constructor(private readonly secrets?: MagnusSecretStorage) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<WebFetchInput>): vscode.PreparedToolInvocation {
		return MagnusToolActivityDescriptor.describeInvocation('prebase_web_fetch', options.input as unknown as Record<string, unknown>);
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<WebFetchInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const url = options.input.url?.trim();
		if (!url) {
			throw new Error('Web fetch requires a public http(s) URL.');
		}
		if (this.secrets) {
			const firecrawlKey = await this.secrets.getProviderApiKey('firecrawl');
			if (firecrawlKey) {
				return commandResult(toMagnusWebToolPayload(await executeHybridWebFetch({ url, freshness: options.input.freshness }, {
					linkupKey: '',
					firecrawlKey,
					token,
					cache: localWebContextCache,
				})));
			}
		}
		return commandResult(toMagnusWebToolPayload(await vscode.commands.executeCommand('prebase.webSearch.fetchForMagnus', { url, freshness: options.input.freshness }, token)));
	}
}

/** Registers structured native tools; no model output is interpreted as shell or edit directives. */
export function registerMagnusLanguageModelTools(context: vscode.ExtensionContext, secrets?: MagnusSecretStorage): void {
	context.subscriptions.push(
		vscode.lm.registerTool('prebase_web_search', new WebSearchTool(secrets)),
		vscode.lm.registerTool('prebase_web_fetch', new WebFetchTool(secrets)),
		vscode.lm.registerTool('prebase_graph_search_nodes', new GraphSearchTool()),
		vscode.lm.registerTool('prebase_graph_get_node', new GraphNodeTool()),
		vscode.lm.registerTool('prebase_graph_get_dependencies', new GraphDependenciesTool()),
		vscode.lm.registerTool('prebase_graph_get_overview', new GraphOverviewTool()),
		vscode.lm.registerTool('prebase_workspace_read_file', new WorkspaceReadTool()),
		vscode.lm.registerTool('prebase_workspace_search_text', new WorkspaceSearchTool()),
		vscode.lm.registerTool('prebase_workspace_list_files', new WorkspaceListFilesTool()),
		vscode.lm.registerTool('prebase_workspace_search_text_rich', new WorkspaceTextSearchTool()),
		vscode.lm.registerTool('prebase_workspace_read_file_range', new WorkspaceReadRangeTool()),
		vscode.lm.registerTool('prebase_workspace_search_symbols', new WorkspaceSymbolsTool()),
		vscode.lm.registerTool('prebase_workspace_get_definition', new WorkspaceDefinitionTool()),
		vscode.lm.registerTool('prebase_workspace_get_references', new WorkspaceReferencesTool()),
		vscode.lm.registerTool('prebase_workspace_get_diagnostics', new WorkspaceDiagnosticsTool()),
		vscode.lm.registerTool('prebase_edit_apply_file', new WorkspaceEditTool()),
		vscode.lm.registerTool('prebase_edit_apply', new WorkspaceApplyEditsTool()),
		vscode.lm.registerTool('prebase_edit_create_file', new WorkspaceCreateFileTool()),
		vscode.lm.registerTool('prebase_edit_rename_file', new WorkspaceRenameFileTool()),
		vscode.lm.registerTool('prebase_edit_delete_file', new WorkspaceDeleteFileTool()),
		vscode.lm.registerTool('prebase_runtime_get_state', new RuntimeStateTool()),
		vscode.lm.registerTool('prebase_runtime_navigate', new RuntimeNavigateTool()),
		vscode.lm.registerTool('prebase_runtime_inspect_page', new RuntimeInspectPageTool()),
		vscode.lm.registerTool('prebase_runtime_get_evidence', new RuntimeEvidenceTool()),
		vscode.lm.registerTool('prebase_runtime_control_test', new RuntimeTestTool()),
		vscode.lm.registerTool('prebase_runtime_server', new RuntimeServerTool()),
		vscode.lm.registerTool('prebase_terminal_get_project_environment', new ProjectEnvironmentTool()),
		vscode.lm.registerTool('prebase_terminal_install_dependencies', new InstallDependenciesTool()),
		vscode.lm.registerTool('prebase_terminal_run_declared_node_version', new DeclaredNodeVersionTool()),
		vscode.lm.registerTool('prebase_terminal_run_project_script', new ProjectScriptTool()),
	);
}
