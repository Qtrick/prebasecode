/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
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

const PROMPT_VERSION = 'v7';
const CACHE_KEY = 'prebase.graph.descriptionCache.v7';
const MAX_CACHE = 200;
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

	// Remove common verbose filler prefixes if present
	text = text.replace(/^(This file\s+(is responsible for|provides|implements|contains|defines|serves as)\s+)/i, (match, p1, p2) => {
		return p2.charAt(0).toUpperCase() + p2.slice(1) + ' ';
	});

	// Split into sentences
	const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
	const trimmedSentences = sentences.map(s => s.trim()).filter(Boolean);

	if (trimmedSentences.length <= 2) {
		const words = text.split(/\s+/);
		if (words.length <= 65) {
			return text;
		}
	}

	// Prefer first 2 sentences if within bounded length
	const firstTwo = trimmedSentences.slice(0, 2).join(' ');
	const firstTwoWords = firstTwo.split(/\s+/);
	if (firstTwoWords.length <= 65 && firstTwo.length > 0) {
		return firstTwo;
	}

	// If first sentence alone is sufficient
	const firstOne = trimmedSentences[0] || '';
	if (firstOne.split(/\s+/).length <= 65 && firstOne.length > 0) {
		return firstOne;
	}

	// Fallback bounding to 55 words cleanly
	const words = text.split(/\s+/).slice(0, 55);
	let result = words.join(' ');
	if (!/[.!?]$/.test(result)) {
		result += '.';
	}
	return result;
}

const SENSITIVE = /(^|\/)(\.env|\.env\..*|credentials(\.json)?|secrets?(\.json)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_rsa|id_ed25519|\.pem|\.key|\.p12|\.pfx)(\/|$)/i;
const SENSITIVE_DIRS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gcloud|secrets?)(\/|$)/i;

interface CacheEntry {
	text: string;
	at: number;
	providerId?: string;
	modelId?: string;
	cacheIdentity?: string;
}

interface DescriptionContextInfo {
	providerId?: string;
	modelId?: string;
	executionMode?: string;
	reasoningEffort?: string;
	policyVersion?: string;
	cacheIdentity?: string;
}

export interface IPreBaseGraphDescriptionService {
	readonly _serviceBrand: undefined;
	describeNode(node: GraphNode, token?: CancellationToken, options?: { force?: boolean }): Promise<IGraphNodeDescriptionResult>;
	clearCache(): void;
}

export class PreBaseGraphDescriptionService extends Disposable implements IPreBaseGraphDescriptionService {
	declare readonly _serviceBrand: undefined;

	private _active: CancellationTokenSource | undefined;
	private _inflight = new Map<string, Promise<IGraphNodeDescriptionResult>>();

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
	}

	override dispose(): void {
		this._active?.cancel();
		this._active?.dispose();
		this._active = undefined;
		super.dispose();
	}

	clearCache(): void {
		this.storageService.remove(CACHE_KEY, StorageScope.APPLICATION);
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

		let content = '';
		let contentHash = '0';
		try {
			const uri = this._resolveWorkspaceUri(folder.uri, relative);
			if (uri) {
				const file = await this.fileService.readFile(uri, { limits: { size: MAX_CONTENT } });
				content = file.value.toString().slice(0, MAX_CONTENT);
				contentHash = String(file.etag || hashContent(content));
			}
		} catch {
			content = '';
		}

		// Retrieve active AI description context to validate cache identity
		let activeContext: DescriptionContextInfo | undefined;
		try {
			activeContext = await this.commandService.executeCommand<DescriptionContextInfo>(
				'prebase.magnus.getDescriptionContext',
				relative
			);
		} catch {
			activeContext = undefined;
		}

		const cacheKey = [
			folder.uri.toString(),
			'file',
			relative,
			contentHash,
			PROMPT_VERSION,
		].join('::');

		const cached = options?.force ? undefined : this._readCache()[cacheKey];
		if (cached?.text) {
			const matchesIdentity = !cached.cacheIdentity || !activeContext?.cacheIdentity || cached.cacheIdentity === activeContext.cacheIdentity;
			if (matchesIdentity) {
				return {
					overview,
					aiDescription: cached.text,
					aiStatus: 'ready',
					aiProviderId: cached.providerId ?? activeContext?.providerId ?? 'gemini',
					aiModelId: cached.modelId ?? activeContext?.modelId,
					cacheHit: true,
				};
			}
		}

		const existing = this._inflight.get(cacheKey);
		if (existing) {
			return existing;
		}

		this._active?.cancel();
		this._active?.dispose();
		const cts = new CancellationTokenSource(token);
		this._active = cts;

		const work = (async (): Promise<IGraphNodeDescriptionResult> => {
			try {
				const prompt = [
					'Write an ultra-concise 1–2 sentence description (~30–55 words) of this source file.',
					'Sentence 1: State its concrete responsibility in the codebase.',
					'Sentence 2: State its most important mechanism, dependency, or architectural relationship (for test files, state what behavior or regression is validated).',
					'Rules: Do NOT list exhaustive export identifiers or repeat generic category overviews. Use only evidence in the supplied path, layer, imports, and content. Output plain text only without markdown formatting.',
					`Path: ${relative}`,
					`Layer: ${node.meta?.architectureLayer ?? 'unknown'}`,
					`Imports: ${(node.meta?.imports || []).slice(0, 16).join(', ') || 'none'}`,
					'Content:',
					content || '(unavailable)',
				].join('\n');

				// Invoke Magnus describeFile command
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
							aiStatus: 'error',
							aiMessage: raw.safeMessage || localize('prebase.desc.authError', "The AI provider rejected the configured credential. Update your key in Agents Settings."),
							cacheHit: false,
						};
					}
					if (raw.status === 'rateLimited') {
						return {
							overview,
							aiStatus: 'error',
							aiMessage: raw.safeMessage || localize('prebase.desc.rateLimited', "The AI provider is temporarily rate limited. Please retry in a moment."),
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
				const cacheIdentity = (typeof raw === 'object' && raw.cacheIdentity) ? raw.cacheIdentity : (activeContext?.cacheIdentity ?? `${providerId}:${modelId || 'auto'}:${PROMPT_VERSION}`);

				this._writeCache(cacheKey, {
					text: aiText,
					at: Date.now(),
					providerId,
					modelId,
					cacheIdentity,
				});

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
				this._inflight.delete(cacheKey);
				if (this._active === cts) {
					this._active = undefined;
				}
				cts.dispose();
			}
		})();

		this._inflight.set(cacheKey, work);
		return work;
	}

	private _safeRelativePath(raw: string): string | undefined {
		const relative = raw.replace(/^file:/, '').replace(/\\/g, '/');
		if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) {
			return undefined;
		}
		const parts = relative.split('/');
		if (parts.some(p => !p || p === '.' || p === '..')) {
			return undefined;
		}
		return parts.join('/');
	}

	private _resolveWorkspaceUri(folder: URI, relative: string): URI | undefined {
		const uri = URI.joinPath(folder, relative);
		// Require a path separator after the folder prefix — string startsWith alone allows /workspace-evil escapes.
		if (!isEqualOrParent(uri, folder)) {
			return undefined;
		}
		return uri;
	}

	private _readCache(): Record<string, CacheEntry> {
		try {
			return JSON.parse(this.storageService.get(CACHE_KEY, StorageScope.APPLICATION, '{}') || '{}') as Record<string, CacheEntry>;
		} catch {
			return {};
		}
	}

	private _writeCache(key: string, entry: CacheEntry): void {
		const cache = this._readCache();
		cache[key] = entry;
		const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CACHE);
		const next: Record<string, CacheEntry> = {};
		for (const [k, v] of entries) {
			next[k] = v;
		}
		this.storageService.store(CACHE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
