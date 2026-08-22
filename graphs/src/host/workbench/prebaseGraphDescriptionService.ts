/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isEqualOrParent } from '../../../../../../base/common/resources.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../../platform/workspace/common/workspace.js';
import { IFileService, FileOperation } from '../../../../../../platform/files/common/files.js';
import { localize } from '../../../../../../nls.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

export const IPreBaseGraphDescriptionService = createDecorator<IPreBaseGraphDescriptionService>('prebaseGraphDescriptionService');

export type GraphNodeDescriptionAiStatus = 'ready' | 'pending' | 'unavailable' | 'disabled' | 'skipped';

export interface IGraphNodeDescriptionResult {
	readonly overview: string;
	readonly aiDescription?: string;
	readonly aiStatus: GraphNodeDescriptionAiStatus;
	readonly aiMessage?: string;
	readonly aiProviderId?: string;
	readonly aiModelId?: string;
	readonly cacheHit?: boolean;
}

export interface IPeekGraphNodeDescriptionResult {
	readonly cached: boolean;
	readonly description?: string;
	readonly providerId?: string;
	readonly modelId?: string;
}

export interface IPreBaseGraphDescriptionService {
	readonly _serviceBrand: undefined;
	peekCachedDescription(node: GraphNode, context?: { projectRoot?: string; contentIdentity?: string }): IPeekGraphNodeDescriptionResult;
	describeNode(node: GraphNode, token?: CancellationToken, options?: { force?: boolean; projectRoot?: string; contentIdentity?: string }): Promise<IGraphNodeDescriptionResult>;
	clearCache(): void;
}

interface CacheEntryV9 {
	readonly description: string;
	readonly sourceFingerprint: string;
	readonly nodeSemanticFingerprint?: string;
	readonly generatedAt: number;
	lastAccessed?: number;
	readonly promptVersion: number;
	readonly providerId?: string;
	readonly modelId?: string;
}

const CACHE_KEY = 'prebase.graph.descriptionCache.v9';
const PROMPT_VERSION = 9;
const MAX_CACHE_ENTRIES = 500;
const MAX_CACHE_BYTES = 512 * 1024; // 512 KB
const MAX_CONTENT = 12000;
const SENSITIVE = /(secret|token|password|credential|apiKey|privateKey|\.env|\.pem|\.key)/i;
const SENSITIVE_DIRS = /(^|\/)(\.git|\.agents|\.cursor|node_modules|out|dist|build|\.vscode|\.idea)(\/|$)/;

export function computePromptSemanticFingerprint(
	path: string,
	layer: string,
	imports: readonly string[] = [],
	sourceFingerprint: string = '0'
): string {
	const sortedImports = [...imports].sort().join(',');
	const payload = `${path}::${layer}::${sortedImports}::${sourceFingerprint}`;
	let hash = 5381;
	for (let i = 0; i < payload.length; i++) {
		hash = ((hash << 5) + hash) + payload.charCodeAt(i);
		hash |= 0;
	}
	return String(Math.abs(hash));
}

export function normalizeCompactDescription(raw: string): string {
	if (!raw) {
		return '';
	}
	let text = raw.replace(/\r?\n/g, ' ').trim();
	text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/^#+\s+/g, '');
	text = text.replace(/^(this\s+(file|module|component|class|service)\s+(is|provides|manages|handles|implements|defines|contains)\s+)/i, (_, _prefix, _type, verb) => {
		return verb.charAt(0).toUpperCase() + verb.slice(1) + ' ';
	});
	text = text.replace(/^(this\s+(file|module|component|class|service)\s+)/i, '');
	const sentenceMatch = text.match(/^(.+?[.!?])(?:\s+|$)/);
	if (sentenceMatch) {
		text = sentenceMatch[1].trim();
	}
	if (text && !/[.!?]$/.test(text)) {
		text += '.';
	}
	if (text.length > 0) {
		text = text.charAt(0).toUpperCase() + text.slice(1);
	}
	return text;
}

function hashContent(content: string): number {
	let hash = 5381;
	for (let i = 0; i < content.length; i++) {
		hash = ((hash << 5) + hash) + content.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

function inferFileDescription(node: GraphNode): string {
	const p = (node.path || node.label || node.id || '').toLowerCase();
	const base = p.split(/[/\\\\]/).pop() || p;
	const ext = base.includes('.') ? base.split('.').pop() : '';
	const layer = (node.meta && node.meta.architectureLayer) ? String(node.meta.architectureLayer) : '';
	const layerInfo = layer && layer !== 'unknown' ? ` (${layer} layer)` : '';

	if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx' || ext === 'mts' || ext === 'cts') {
		if (base.includes('.test.') || base.includes('.spec.') || base.startsWith('test')) {
			return `Test suite covering components or business logic${layerInfo}.`;
		}
		if (base.includes('types') || base.includes('interface')) {
			return `Type definitions and interface contracts${layerInfo}.`;
		}
		if (base.includes('service') || base.includes('client')) {
			return `Service client handling operations and side-effects${layerInfo}.`;
		}
		if (base.includes('controller') || base.includes('handler')) {
			return `Request/action controller dispatching user or system workflows${layerInfo}.`;
		}
		if (base.includes('component') || base.includes('view') || ext === 'tsx' || ext === 'jsx') {
			return `UI component rendering layout and interactive elements${layerInfo}.`;
		}
		return `Source code module defining application behavior${layerInfo}.`;
	}
	if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
		return `Style sheet defining visual appearance and layout themes.`;
	}
	if (ext === 'html' || ext === 'htm') {
		return `HTML markup defining document structure.`;
	}
	if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'env') {
		return `Configuration settings or structured data file.`;
	}
	if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
		return `Documentation or notes providing context and guidance.`;
	}
	if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg' || ext === 'webp' || ext === 'ico') {
		return `Static graphical asset.`;
	}
	return `Workspace asset or document${layerInfo}.`;
}

export class PreBaseGraphDescriptionService extends Disposable implements IPreBaseGraphDescriptionService {
	declare readonly _serviceBrand: undefined;

	private _active?: CancellationTokenSource;
	private readonly _inflight = new Map<string, { promise: Promise<IGraphNodeDescriptionResult>; cts: CancellationTokenSource }>();
	private readonly _dirtyFiles = new Set<string>();
	private readonly _cleanVerifiedFiles = new Set<string>();
	private readonly _fileGeneration = new Map<string, number>();
	private _cachedRecord?: Record<string, CacheEntryV9>;
	private _touchDebounceTimer?: any;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		if (this.fileService?.onDidFilesChange) {
			this._register(this.fileService.onDidFilesChange(e => {
				const list = (e as any).raw || (e as any).rawUpdated || [];
				for (const change of list) {
					const match = this._getFolderForUri((change as any).resource || change);
					if (match) {
						this._handleFileChange(match.folderUri, match.relative, false);
					}
				}
			}));
		}

		if (this.fileService?.onDidRunOperation) {
			this._register(this.fileService.onDidRunOperation(e => {
				if (e.operation === FileOperation.DELETE) {
					const match = this._getFolderForUri(e.resource);
					if (match) {
						this._handleFileChange(match.folderUri, match.relative, true);
					}
				} else if (e.operation === FileOperation.MOVE) {
					const srcMatch = this._getFolderForUri(e.resource);
					if (srcMatch) {
						this._handleFileChange(srcMatch.folderUri, srcMatch.relative, true);
					}
					const targetRes = e.target?.resource || e.target;
					if (targetRes) {
						const targetMatch = this._getFolderForUri(targetRes);
						if (targetMatch) {
							this._handleFileChange(targetMatch.folderUri, targetMatch.relative, false);
						}
					}
				} else if (e.operation === FileOperation.COPY) {
					const targetRes = e.target?.resource || e.target;
					if (targetRes) {
						const targetMatch = this._getFolderForUri(targetRes);
						if (targetMatch) {
							this._handleFileChange(targetMatch.folderUri, targetMatch.relative, false);
						}
					}
				} else if (e.operation === FileOperation.CREATE || e.operation === FileOperation.WRITE) {
					const res = e.target?.resource || e.target || e.resource;
					if (res) {
						const match = this._getFolderForUri(res);
						if (match) {
							this._handleFileChange(match.folderUri, match.relative, false);
						}
					}
				}
			}));
		}
	}

	private _getFolderForUri(candidate: URI | { resource: URI } | undefined): { folderUri: URI; relative: string } | undefined {
		try {
			if (!candidate) {
				return undefined;
			}
			const uri = (candidate as any).resource || candidate;
			if (!uri || !uri.path) {
				return undefined;
			}
			if (typeof this.workspaceContextService?.getWorkspaceFolder === 'function') {
				const folder = this.workspaceContextService.getWorkspaceFolder(uri);
				if (folder && isEqualOrParent(uri, folder.uri)) {
					const rel = this._safeRelativePath(uri.path.replace(folder.uri.path, '').replace(/^\//, ''));
					if (rel) {
						return { folderUri: folder.uri, relative: rel };
					}
				}
			}
			const workspace = this.workspaceContextService?.getWorkspace?.();
			const folders = workspace?.folders || [];
			for (const f of folders) {
				if (isEqualOrParent(uri, f.uri)) {
					const rel = this._safeRelativePath(uri.path.replace(f.uri.path, '').replace(/^\//, ''));
					if (rel) {
						return { folderUri: f.uri, relative: rel };
					}
				}
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	private _getFolderForNode(node: GraphNode, projectRoot?: string): IWorkspaceFolder | undefined {
		const workspace = this.workspaceContextService?.getWorkspace?.();
		const folders = workspace?.folders || [];
		if (!folders.length) {
			return undefined;
		}
		if (projectRoot) {
			const normalizedProjectRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
			const rootMatch = folders.find(f => {
				const fPath = (f.uri.fsPath || f.uri.path).replace(/\\/g, '/').replace(/\/$/, '');
				return fPath === normalizedProjectRoot;
			});
			if (rootMatch) {
				return rootMatch;
			}
		}
		if (folders.length === 1 || !node.path) {
			return folders[0];
		}
		const nodePath = (node.path || '').replace(/\\/g, '/');
		const match = folders.find(f => {
			const fPath = f.uri.fsPath.replace(/\\/g, '/') || f.uri.path;
			return nodePath.startsWith(fPath);
		});
		return match || folders[0];
	}

	private _handleFileChange(folderUri: URI, relative: string, isDelete: boolean): void {
		const cacheKey = this._makeLogicalKey(folderUri, relative);
		this._fileGeneration.set(cacheKey, (this._fileGeneration.get(cacheKey) || 0) + 1);
		this._dirtyFiles.add(cacheKey);
		this._cleanVerifiedFiles.delete(cacheKey);
		if (isDelete) {
			this._deleteCacheKey(cacheKey);
			const inflight = this._inflight.get(cacheKey);
			if (inflight) {
				inflight.cts.cancel();
				this._inflight.delete(cacheKey);
			}
		}
	}

	override dispose(): void {
		if (this._touchDebounceTimer) {
			clearTimeout(this._touchDebounceTimer);
			this._touchDebounceTimer = undefined;
		}
		this._flushCache();
		this._active?.cancel();
		this._active?.dispose();
		this._active = undefined;
		for (const item of this._inflight.values()) {
			item.cts.cancel();
			item.cts.dispose();
		}
		this._inflight.clear();
		this._dirtyFiles.clear();
		this._cleanVerifiedFiles.clear();
		this._fileGeneration.clear();
		super.dispose();
	}

	clearCache(): void {
		this.storageService.remove(CACHE_KEY, StorageScope.APPLICATION);
		this._cachedRecord = {};
		this._dirtyFiles.clear();
		this._cleanVerifiedFiles.clear();
		this._fileGeneration.clear();
		this._active?.cancel();
		this._active?.dispose();
		this._active = undefined;
		for (const item of this._inflight.values()) {
			item.cts.cancel();
			item.cts.dispose();
		}
		this._inflight.clear();
	}

	peekCachedDescription(node: GraphNode, context?: { projectRoot?: string; contentIdentity?: string }): IPeekGraphNodeDescriptionResult {
		const relative = this._safeRelativePath(node.path || node.label);
		if (!relative || SENSITIVE.test(relative) || SENSITIVE_DIRS.test(relative)) {
			return { cached: false };
		}
		const folder = this._getFolderForNode(node, context?.projectRoot);
		if (!folder) {
			return { cached: false };
		}
		const cacheKey = this._makeLogicalKey(folder.uri, relative);
		if (this._dirtyFiles.has(cacheKey)) {
			return { cached: false };
		}
		const cache = this._readCache();
		const entry = cache[cacheKey];
		if (entry?.description && entry.promptVersion === PROMPT_VERSION) {
			const nodeLayer = node.meta?.architectureLayer ?? 'unknown';
			const nodeImports = node.meta?.imports || [];
			if (this._cleanVerifiedFiles.has(cacheKey)) {
				const expectedFingerprint = computePromptSemanticFingerprint(relative, nodeLayer, nodeImports, entry.sourceFingerprint);
				if (!entry.nodeSemanticFingerprint || entry.nodeSemanticFingerprint === expectedFingerprint) {
					this._touchCacheEntry(cacheKey);
					return {
						cached: true,
						description: entry.description,
						providerId: entry.providerId,
						modelId: entry.modelId,
					};
				}
			}
			const nodeContentHash = context?.contentIdentity
				|| (node.meta as { contentHash?: string; contentIdentity?: string } | undefined)?.contentIdentity
				|| (node.meta as { contentHash?: string; contentIdentity?: string } | undefined)?.contentHash
				|| (node as any).contentHash;
			if (nodeContentHash && entry.sourceFingerprint === String(nodeContentHash)) {
				const expectedFingerprint = computePromptSemanticFingerprint(relative, nodeLayer, nodeImports, String(nodeContentHash));
				if (!entry.nodeSemanticFingerprint || entry.nodeSemanticFingerprint === expectedFingerprint) {
					this._cleanVerifiedFiles.add(cacheKey);
					this._touchCacheEntry(cacheKey);
					return {
						cached: true,
						description: entry.description,
						providerId: entry.providerId,
						modelId: entry.modelId,
					};
				}
			}
		}
		return { cached: false };
	}

	async describeNode(
		node: GraphNode,
		tokenOrOptions?: CancellationToken | { force?: boolean; projectRoot?: string; contentIdentity?: string },
		maybeOptions?: { force?: boolean; projectRoot?: string; contentIdentity?: string }
	): Promise<IGraphNodeDescriptionResult> {
		let token: CancellationToken | undefined;
		let options: { force?: boolean; projectRoot?: string; contentIdentity?: string } | undefined;
		if (tokenOrOptions && typeof (tokenOrOptions as any).onCancellationRequested === 'function') {
			token = tokenOrOptions as CancellationToken;
			options = maybeOptions;
		} else {
			options = (tokenOrOptions as { force?: boolean; projectRoot?: string; contentIdentity?: string }) || maybeOptions;
		}
		const overview = inferFileDescription(node);
		const relative = this._safeRelativePath(node.path || node.label);
		if (!relative) {
			return { overview, aiStatus: 'skipped', aiMessage: localize('prebase.desc.badPath', "AI description skipped for an unsafe path."), cacheHit: false };
		}
		if (SENSITIVE.test(relative) || SENSITIVE_DIRS.test(relative) || /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|tgz)$/i.test(relative)) {
			return { overview, aiStatus: 'skipped', aiMessage: localize('prebase.desc.skipped', "AI description skipped for this sensitive or binary file."), cacheHit: false };
		}

		const folder = this._getFolderForNode(node, options?.projectRoot);
		if (!folder) {
			return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.noWorkspace', "Open a project to generate AI descriptions."), cacheHit: false };
		}

		const cacheKey = this._makeLogicalKey(folder.uri, relative);
		const nodeLayer = node.meta?.architectureLayer ?? 'unknown';
		const nodeImports = node.meta?.imports || [];

		// Fast clean-path cache hit: if verified clean and not forced, return cached description without reading file or calling AI
		if (!options?.force && this._cleanVerifiedFiles.has(cacheKey)) {
			const cached = this._readCache()[cacheKey];
			if (cached?.description && cached.promptVersion === PROMPT_VERSION) {
				const expectedFingerprint = computePromptSemanticFingerprint(relative, nodeLayer, nodeImports, cached.sourceFingerprint);
				if (!cached.nodeSemanticFingerprint || cached.nodeSemanticFingerprint === expectedFingerprint) {
					this._touchCacheEntry(cacheKey);
					return {
						overview,
						aiDescription: cached.description,
						aiStatus: 'ready',
						aiProviderId: cached.providerId ?? 'gemini',
						aiModelId: cached.modelId,
						cacheHit: true,
					};
				}
			}
		}

		// Deduplicate simultaneous requests for same node
		const existing = this._inflight.get(cacheKey);
		if (existing && !existing.cts.token.isCancellationRequested && (!token || !token.isCancellationRequested)) {
			return existing.promise;
		}
		if (existing) {
			this._inflight.delete(cacheKey);
		}

		this._active?.cancel();
		this._active?.dispose();
		const cts = new CancellationTokenSource(token);
		this._active = cts;

		const work = (async (): Promise<IGraphNodeDescriptionResult> => {
			const fileGenAtStart = this._fileGeneration.get(cacheKey) || 0;
			try {
				let content = '';
				const nodeContentHash = options?.contentIdentity
					|| (node.meta as { contentHash?: string; contentIdentity?: string } | undefined)?.contentIdentity
					|| (node.meta as { contentHash?: string; contentIdentity?: string } | undefined)?.contentHash
					|| (node as any).contentHash;

				let contentHash = nodeContentHash ? String(nodeContentHash) : '0';
				const uri = this._resolveWorkspaceUri(folder.uri, relative);
				if (uri) {
					try {
						const file = await this.fileService.readFile(uri, { position: 0, length: MAX_CONTENT });
						content = file.value.toString().slice(0, MAX_CONTENT);
						if (!nodeContentHash) {
							contentHash = String(hashContent(content));
						}
					} catch {
						content = '';
					}
				}

				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}

				const semanticFingerprint = computePromptSemanticFingerprint(relative, nodeLayer, nodeImports, contentHash);

				// Check fingerprint match if not forced
				if (!options?.force) {
					const cached = this._readCache()[cacheKey];
					if (cached?.description && cached.promptVersion === PROMPT_VERSION && cached.sourceFingerprint === contentHash) {
						if (!cached.nodeSemanticFingerprint || cached.nodeSemanticFingerprint === semanticFingerprint) {
							this._cleanVerifiedFiles.add(cacheKey);
							this._dirtyFiles.delete(cacheKey);
							this._touchCacheEntry(cacheKey);
							return {
								overview,
								aiDescription: cached.description,
								aiStatus: 'ready',
								aiProviderId: cached.providerId ?? 'gemini',
								aiModelId: cached.modelId,
								cacheHit: true,
							};
						}
					}
				}

				let context: any;
				try {
					context = await this.commandService?.executeCommand?.('prebase.magnus.getDescriptionContext');
				} catch {
					context = undefined;
				}

				let rawDescription = '';
				let aiProviderId = context?.providerId || 'gemini';
				let aiModelId = context?.modelId;

				const prompt = this._buildPrompt(relative, content, nodeLayer, nodeImports);
				let aiResult: any;
				try {
					aiResult = await this.commandService?.executeCommand?.('prebase.magnus.describeFile', {
						path: relative,
						content,
						layer: nodeLayer,
						imports: nodeImports,
						prompt,
					});
				} catch {
					aiResult = undefined;
				}

				if (aiResult && aiResult.text) {
					rawDescription = aiResult.text;
					if (aiResult.providerId) { aiProviderId = aiResult.providerId; }
					if (aiResult.modelId) { aiModelId = aiResult.modelId; }
				}

				const description = normalizeCompactDescription(rawDescription);
				if (!description) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.empty', "Empty response from language model."), cacheHit: false };
				}

				// If file was mutated during generation, do not cache stale result
				const currentFileGen = this._fileGeneration.get(cacheKey) || 0;
				if (currentFileGen === fileGenAtStart) {
					this._writeCache(cacheKey, {
						description,
						sourceFingerprint: contentHash,
						nodeSemanticFingerprint: semanticFingerprint,
						generatedAt: Date.now(),
						lastAccessed: Date.now(),
						promptVersion: PROMPT_VERSION,
						providerId: aiProviderId,
						modelId: aiModelId
					});
					this._cleanVerifiedFiles.add(cacheKey);
					this._dirtyFiles.delete(cacheKey);
				}

				return {
					overview,
					aiDescription: description,
					aiStatus: 'ready',
					aiProviderId,
					aiModelId,
					cacheHit: false
				};
			} catch (err: any) {
				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}
				return { overview, aiStatus: 'unavailable', aiMessage: err?.message || String(err), cacheHit: false };
			} finally {
				this._inflight.delete(cacheKey);
			}
		})();

		this._inflight.set(cacheKey, { promise: work, cts });
		return work;
	}

	private _buildPrompt(path: string, content: string, layer: string, imports: readonly string[]): string {
		const importList = imports.length ? imports.slice(0, 15).join(', ') : 'None';
		return `You are analyzing a codebase file for an architectural code graph.
Provide a concise, highly accurate description of the file's primary responsibility in 2-3 sentences.
Focus on its role, exported capabilities, and how other parts of the system interact with it.

File path: ${path}
Architectural layer: ${layer}
Direct imports/dependencies: ${importList}

File content excerpt:
\`\`\`
${content}
\`\`\`
`;
	}

	private _safeRelativePath(candidate: string | undefined): string | undefined {
		if (!candidate) {
			return undefined;
		}
		const relative = candidate.replace(/\\/g, '/').replace(/^\.\//, '').trim();
		if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) {
			return undefined;
		}
		const parts = relative.split('/');
		if (parts.some(p => !p || p === '.' || p === '..')) {
			return undefined;
		}
		return parts.join('/');
	}

	private _makeLogicalKey(folderUri: URI, relative: string): string {
		const folderStr = URI.isUri(folderUri) ? folderUri.toString() : String(folderUri);
		return `${folderStr}::${relative}`;
	}

	private _resolveWorkspaceUri(folder: URI, relative: string): URI | undefined {
		try {
			const folderUri = URI.isUri(folder) ? folder : URI.parse(String(folder));
			const uri = URI.joinPath(folderUri, relative);
			if (!isEqualOrParent(uri, folderUri)) {
				return undefined;
			}
			return uri;
		} catch {
			return undefined;
		}
	}

	private _readCache(): Record<string, CacheEntryV9> {
		if (this._cachedRecord) {
			return this._cachedRecord;
		}
		try {
			this._cachedRecord = JSON.parse(this.storageService.get(CACHE_KEY, StorageScope.APPLICATION, '{}') || '{}') as Record<string, CacheEntryV9>;
			return this._cachedRecord;
		} catch {
			this._cachedRecord = {};
			return this._cachedRecord;
		}
	}

	private _deleteCacheKey(key: string): void {
		const cache = this._readCache();
		if (cache[key]) {
			delete cache[key];
			this._flushCache();
		}
	}

	private _touchCacheEntry(key: string): void {
		const cache = this._readCache();
		if (cache[key]) {
			cache[key].lastAccessed = Date.now();
			// Debounce storage writes for hover touches
			if (this._touchDebounceTimer) {
				clearTimeout(this._touchDebounceTimer);
			}
			this._touchDebounceTimer = setTimeout(() => {
				this._touchDebounceTimer = undefined;
				this._flushCache();
			}, 2000);
		}
	}

	private _flushCache(): void {
		if (!this._cachedRecord) {
			return;
		}
		const entries = Object.entries(this._cachedRecord).sort((a, b) => (b[1].lastAccessed ?? b[1].generatedAt) - (a[1].lastAccessed ?? a[1].generatedAt)).slice(0, MAX_CACHE_ENTRIES);
		const next: Record<string, CacheEntryV9> = {};
		let totalBytes = 0;
		for (const [k, v] of entries) {
			const entryBytes = k.length + (v.description?.length ?? 0) + 160;
			if (totalBytes + entryBytes > MAX_CACHE_BYTES) {
				break;
			}
			next[k] = v;
			totalBytes += entryBytes;
		}
		this._cachedRecord = next;
		this.storageService.store(CACHE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _writeCache(key: string, entry: CacheEntryV9): void {
		const cache = this._readCache();
		entry.lastAccessed = entry.lastAccessed ?? Date.now();
		cache[key] = entry;
		this._flushCache();
	}
}
