/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService, FileOperation } from '../../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { inferFileDescription } from '../../core/analysis/fileDescription.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

export const IPreBaseGraphDescriptionService = createDecorator<IPreBaseGraphDescriptionService>('prebaseGraphDescriptionService');

export interface IGraphNodeDescriptionResult {
	overview: string;
	aiDescription?: string;
	aiStatus: 'skipped' | 'loading' | 'ready' | 'unavailable' | 'error';
	aiMessage?: string;
	aiProviderId?: string;
	aiModelId?: string;
	cacheHit: boolean;
}

export interface IPeekGraphNodeDescriptionResult {
	cached: boolean;
	description?: string;
	providerId?: string;
	modelId?: string;
}

const PROMPT_VERSION = 'v9';
const CACHE_KEY = 'prebase.graph.descriptionCache.v9';
const MAX_CACHE_ENTRIES = 2000;
const MAX_CACHE_BYTES = 1024 * 1024; // 1 MB byte budget
const MAX_CONTENT = 12000;

function hashContent(str: string): string {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

export function normalizeCompactDescription(rawText: string): string {
	let text = rawText
		.replace(/\*\*(.*?)\*\*/g, '$1')
		.replace(/`(.*?)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();

	// Remove common verbose filler prefixes
	text = text.replace(/^(This file\s+(is responsible for|provides|implements|contains|defines|serves as)\s+)/i, (match, p1, p2) => {
		return p2.charAt(0).toUpperCase() + p2.slice(1) + ' ';
	});
	text = text.replace(/^(Defines TypeScript type definitions representing added|Defines TypeScript contracts for|Provides helper utilities for)\s+/i, 'Defines ');

	// Split into sentences
	const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
	const trimmedSentences = sentences.map(s => s.trim()).filter(Boolean);

	// Prefer first sentence
	let first = trimmedSentences[0] || text;
	const words = first.split(/\s+/);
	if (words.length > 38) {
		first = words.slice(0, 38).join(' ');
		if (!/[.!?]$/.test(first)) {
			first += '.';
		}
	}
	return first;
}

const SENSITIVE = /(^|\/)(\.env|\.env\..*|credentials(\.json)?|secrets?(\.json)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_rsa|id_ed25519|\.pem|\.key|\.p12|\.pfx)(\/|$)/i;
const SENSITIVE_DIRS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gcloud|secrets?)(\/|$)/i;

interface CacheEntryV9 {
	description: string;
	sourceFingerprint: string;
	generatedAt: number;
	promptVersion: string;
	providerId?: string;
	modelId?: string;
}

interface DescriptionContextInfo {
	providerId?: string;
	modelId?: string;
	executionMode?: string;
	reasoningEffort?: string;
	policyVersion?: string;
	cacheIdentity?: string;
	disabled?: boolean;
}

export interface IPreBaseGraphDescriptionService {
	readonly _serviceBrand: undefined;
	describeNode(node: GraphNode, token?: CancellationToken, options?: { force?: boolean }): Promise<IGraphNodeDescriptionResult>;
	peekCachedDescription(node: GraphNode): IPeekGraphNodeDescriptionResult;
	clearCache(): void;
}

export class PreBaseGraphDescriptionService extends Disposable implements IPreBaseGraphDescriptionService {
	declare readonly _serviceBrand: undefined;

	private _active: CancellationTokenSource | undefined;
	private _inflight = new Map<string, { promise: Promise<IGraphNodeDescriptionResult>; cts: CancellationTokenSource }>();

	private readonly _dirtyFiles = new Set<string>();
	private readonly _cleanVerifiedFiles = new Set<string>();
	private readonly _fileGeneration = new Map<string, number>();

	private readonly workspaceContextService: IWorkspaceContextService;
	private readonly fileService: IFileService;
	private readonly storageService: IStorageService;
	private readonly commandService: ICommandService;

	constructor(
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@ICommandService commandService: ICommandService,
	) {
		super();
		this.workspaceContextService = workspaceContextService;
		this.fileService = fileService;
		this.storageService = storageService;
		this.commandService = commandService;

		// Track file modifications lazily in-memory. Zero network/AI calls on file events.
		if (this.fileService.onDidFilesChange) {
			this._register(this.fileService.onDidFilesChange(e => {
				const folder = this.workspaceContextService.getWorkspace().folders[0];
				if (!folder) {
					return;
				}
				for (const uri of e.rawAdded) {
					this._handleFileChange(folder.uri, uri, false);
				}
				for (const uri of e.rawUpdated) {
					this._handleFileChange(folder.uri, uri, false);
				}
				for (const uri of e.rawDeleted) {
					this._handleFileChange(folder.uri, uri, true);
				}
			}));
		}

		if (this.fileService.onDidRunOperation) {
			this._register(this.fileService.onDidRunOperation(e => {
				const folder = this.workspaceContextService.getWorkspace().folders[0];
				if (!folder) {
					return;
				}
				this._handleFileChange(folder.uri, e.resource, e.operation === FileOperation.DELETE);
			}));
		}
	}

	private _handleFileChange(folderUri: URI, uri: URI, isDelete: boolean): void {
		if (isEqualOrParent(uri, folderUri)) {
			const rel = this._safeRelativePath(uri.path.replace(folderUri.path, '').replace(/^\//, ''));
			if (rel) {
				const cacheKey = this._makeLogicalKey(folderUri, rel);
				this._fileGeneration.set(cacheKey, (this._fileGeneration.get(cacheKey) || 0) + 1);
				this._dirtyFiles.add(cacheKey);
				this._cleanVerifiedFiles.delete(cacheKey);
				if (isDelete) {
					this._deleteCacheKey(cacheKey);
				}
			}
		}
	}

	override dispose(): void {
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
		super.dispose();
	}

	clearCache(): void {
		this.storageService.remove(CACHE_KEY, StorageScope.APPLICATION);
		this._dirtyFiles.clear();
		this._cleanVerifiedFiles.clear();
	}

	peekCachedDescription(node: GraphNode): IPeekGraphNodeDescriptionResult {
		const relative = this._safeRelativePath(node.path || node.label);
		if (!relative || SENSITIVE.test(relative) || SENSITIVE_DIRS.test(relative)) {
			return { cached: false };
		}
		const folder = this.workspaceContextService.getWorkspace().folders[0];
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
			return {
				cached: true,
				description: entry.description,
				providerId: entry.providerId,
				modelId: entry.modelId,
			};
		}
		return { cached: false };
	}

	async describeNode(node: GraphNode, token?: CancellationToken, options?: { force?: boolean }): Promise<IGraphNodeDescriptionResult> {
		const overview = inferFileDescription(node);
		const relative = this._safeRelativePath(node.path || node.label);
		if (!relative) {
			return { overview, aiStatus: 'skipped', aiMessage: localize('prebase.desc.badPath', "AI description skipped for an unsafe path."), cacheHit: false };
		}
		if (SENSITIVE.test(relative) || SENSITIVE_DIRS.test(relative) || /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|tar|tgz)$/i.test(relative)) {
			return { overview, aiStatus: 'skipped', aiMessage: localize('prebase.desc.skipped', "AI description skipped for this sensitive or binary file."), cacheHit: false };
		}

		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.noWorkspace', "Open a project to generate AI descriptions."), cacheHit: false };
		}

		const cacheKey = this._makeLogicalKey(folder.uri, relative);

		// Fast clean-path cache hit: if verified clean and not forced, return cached description without reading file or calling AI
		if (!options?.force && this._cleanVerifiedFiles.has(cacheKey)) {
			const cached = this._readCache()[cacheKey];
			if (cached?.description && cached.promptVersion === PROMPT_VERSION) {
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
				let contentHash = '0';
				const uri = this._resolveWorkspaceUri(folder.uri, relative);
				if (uri) {
					try {
						const file = await this.fileService.readFile(uri, { position: 0, length: MAX_CONTENT });
						content = file.value.toString().slice(0, MAX_CONTENT);
						contentHash = String(hashContent(content));
					} catch {
						content = '';
					}
				}

				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}

				// Check fingerprint match if not forced
				if (!options?.force) {
					const cached = this._readCache()[cacheKey];
					if (cached?.description && cached.promptVersion === PROMPT_VERSION && cached.sourceFingerprint === contentHash) {
						this._cleanVerifiedFiles.add(cacheKey);
						this._dirtyFiles.delete(cacheKey);
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

				// Retrieve active AI description context
				let activeContext: DescriptionContextInfo | undefined;
				try {
					activeContext = await this.commandService.executeCommand<DescriptionContextInfo>(
						'prebase.magnus.getDescriptionContext',
						relative
					);
				} catch {
					activeContext = undefined;
				}

				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}

				if (activeContext?.disabled) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.disabled', "AI description is disabled in settings."), cacheHit: false };
				}

				const prompt = [
					'Write an ultra-concise 1-sentence description (~18–32 words, max 38 words) of this source file.',
					'State its concrete responsibility and key architectural mechanism in one clear, informative sentence with no filler.',
					'Rules: Do NOT list exhaustive export identifiers or repeat generic category overviews. Use only evidence in the supplied path, layer, imports, and content. Output plain text only without markdown formatting.',
					`Path: ${relative}`,
					`Layer: ${node.meta?.architectureLayer ?? 'unknown'}`,
					`Imports: ${(node.meta?.imports || []).slice(0, 16).join(', ') || 'none'}`,
					'Content:',
					content || '(unavailable)',
				].join('\n');

				type RawResult = string | {
					text?: string;
					status?: 'ready' | 'notConfigured' | 'authError' | 'rateLimited' | 'networkError' | 'modelUnavailable' | 'cancelled' | 'disabled' | 'error' | 'skipped';
					safeMessage?: string;
					providerId?: string;
					modelId?: string;
					cacheIdentity?: string;
				};

				let raw: RawResult | undefined;
				let execError: unknown = undefined;
				try {
					raw = await this.commandService.executeCommand<RawResult>(
						'prebase.magnus.describeFile',
						{ prompt, path: relative }
					);
				} catch (err) {
					raw = undefined;
					execError = err;
				}

				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}

				if (!raw) {
					const errMsg = execError instanceof Error ? execError.message : String(execError || '');
					let aiMessage = localize('prebase.desc.configureMagnus', "Agents extension is not available.");
					if (errMsg.includes('activation') || errMsg.includes('Activating extension')) {
						aiMessage = localize('prebase.desc.activationFailed', "Agents runtime failed to activate.");
					} else if (errMsg && !errMsg.includes('not found') && !errMsg.includes('command \'prebase.magnus.describeFile\'')) {
						aiMessage = errMsg;
					}
					return {
						overview,
						aiStatus: 'unavailable',
						aiMessage,
						cacheHit: false,
					};
				}

				if (typeof raw === 'object' && raw.status && raw.status !== 'ready') {
					if (raw.status === 'notConfigured') {
						return {
							overview,
							aiStatus: 'unavailable',
							aiMessage: raw.safeMessage || localize('prebase.desc.notConfigured', "AI description unavailable — no AI provider credential configured. Configure a key in Agents Settings (or provide GEMINI_API_KEY in PreBase root .env)."),
							cacheHit: false,
						};
					}
					if (raw.status === 'authError') {
						return {
							overview,
							aiStatus: 'unavailable',
							aiMessage: raw.safeMessage || localize('prebase.desc.authError', "AI description authentication failed. Check your API key in Agents Settings."),
							cacheHit: false,
						};
					}
					if (raw.status === 'rateLimited') {
						return {
							overview,
							aiStatus: 'error',
							aiMessage: raw.safeMessage || localize('prebase.desc.rateLimited', "AI description rate limit reached. Please wait a moment before requesting another description."),
							cacheHit: false,
						};
					}
					if (raw.status === 'cancelled') {
						return {
							overview,
							aiStatus: 'unavailable',
							aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."),
							cacheHit: false,
						};
					}
					if (raw.status === 'disabled') {
						return {
							overview,
							aiStatus: 'unavailable',
							aiMessage: localize('prebase.desc.disabled', "AI description is disabled in settings."),
							cacheHit: false,
						};
					}
					if (raw.status === 'skipped') {
						return {
							overview,
							aiStatus: 'skipped',
							aiMessage: raw.safeMessage || localize('prebase.desc.skipped', "AI description skipped for this file."),
							cacheHit: false,
						};
					}
					if (raw.status === 'modelUnavailable') {
						return {
							overview,
							aiStatus: 'error',
							aiMessage: raw.safeMessage || localize('prebase.desc.modelUnavailable', "The selected AI model is unavailable."),
							cacheHit: false,
						};
					}
					return {
						overview,
						aiStatus: 'error',
						aiMessage: raw.safeMessage || localize('prebase.desc.failed', "AI description generation failed."),
						cacheHit: false,
					};
				}

				const rawAiText = typeof raw === 'string' ? raw.trim() : raw.text?.trim();

				if (!rawAiText) {
					return {
						overview,
						aiStatus: 'unavailable',
						aiMessage: localize('prebase.desc.emptyResult', "AI model returned an empty description."),
						cacheHit: false,
					};
				}

				const aiText = normalizeCompactDescription(rawAiText);
				const providerId = (typeof raw === 'object' && raw.providerId) ? raw.providerId : (activeContext?.providerId ?? 'gemini');
				const modelId = (typeof raw === 'object' && raw.modelId) ? raw.modelId : activeContext?.modelId;

				// Stale in-flight race protection: discard result if file was modified again during AI request
				const currentFileGen = this._fileGeneration.get(cacheKey) || 0;
				if (fileGenAtStart === currentFileGen) {
					this._writeCache(cacheKey, {
						description: aiText,
						sourceFingerprint: contentHash,
						generatedAt: Date.now(),
						promptVersion: PROMPT_VERSION,
						providerId,
						modelId,
					});
					this._cleanVerifiedFiles.add(cacheKey);
					this._dirtyFiles.delete(cacheKey);
				}

				return {
					overview,
					aiDescription: aiText,
					aiStatus: 'ready',
					aiProviderId: providerId,
					aiModelId: modelId,
					cacheHit: false,
				};
			} catch (err) {
				return {
					overview,
					aiStatus: 'error',
					aiMessage: err instanceof Error ? err.message : String(err),
					cacheHit: false,
				};
			} finally {
				if (this._inflight.get(cacheKey)?.cts === cts) {
					this._inflight.delete(cacheKey);
				}
				if (this._active === cts) {
					this._active = undefined;
				}
				cts.dispose();
			}
		})();

		this._inflight.set(cacheKey, { promise: work, cts });
		return work;
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
		try {
			return JSON.parse(this.storageService.get(CACHE_KEY, StorageScope.APPLICATION, '{}') || '{}') as Record<string, CacheEntryV9>;
		} catch {
			return {};
		}
	}

	private _deleteCacheKey(key: string): void {
		const cache = this._readCache();
		if (cache[key]) {
			delete cache[key];
			this.storageService.store(CACHE_KEY, JSON.stringify(cache), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
	}

	private _writeCache(key: string, entry: CacheEntryV9): void {
		const cache = this._readCache();
		cache[key] = entry;
		const entries = Object.entries(cache).sort((a, b) => b[1].generatedAt - a[1].generatedAt).slice(0, MAX_CACHE_ENTRIES);
		const next: Record<string, CacheEntryV9> = {};
		let totalBytes = 0;
		for (const [k, v] of entries) {
			const entryBytes = k.length + (v.description?.length ?? 0) + 128;
			if (totalBytes + entryBytes > MAX_CACHE_BYTES) {
				break;
			}
			next[k] = v;
			totalBytes += entryBytes;
		}
		this.storageService.store(CACHE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
