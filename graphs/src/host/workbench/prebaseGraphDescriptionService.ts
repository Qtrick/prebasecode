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
	cacheHit: boolean;
}

const PROMPT_VERSION = 'v3';
const CACHE_KEY = 'prebase.graph.descriptionCache.v3';
const MAX_CACHE = 200;
const MAX_CONTENT = 6000;

const SENSITIVE = /(^|\/)(\.env|\.env\..*|credentials(\.json)?|secrets?(\.json)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_rsa|id_ed25519|\.pem|\.key|\.p12|\.pfx)(\/|$)/i;
const SENSITIVE_DIRS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gcloud|secrets?)(\/|$)/i;

interface CacheEntry {
	text: string;
	at: number;
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

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
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
				contentHash = String(file.etag || content.length);
			}
		} catch {
			content = '';
		}

		const cacheKey = [
			folder.uri.toString(),
			'file',
			relative,
			contentHash,
			PROMPT_VERSION,
			'gemini',
		].join('::');

		const cached = options?.force ? undefined : this._readCache()[cacheKey];
		if (cached?.text) {
			return { overview, aiDescription: cached.text, aiStatus: 'ready', cacheHit: true };
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
					'Write a concise 1–3 sentence description of this source file’s likely role.',
					'Be specific. Do not invent APIs. Plain text only.',
					`Path: ${relative}`,
					`Layer: ${node.meta?.architectureLayer ?? 'unknown'}`,
					`Imports: ${(node.meta?.imports || []).slice(0, 12).join(', ') || 'none'}`,
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

				const aiText = typeof raw === 'string' ? raw.trim() : raw.text?.trim();

				if (!aiText) {
					return {
						overview,
						aiStatus: 'unavailable',
						aiMessage: localize('prebase.desc.emptyResult', "AI model returned an empty description."),
						cacheHit: false,
					};
				}

				const cacheIdentity = (typeof raw === 'object' && raw.cacheIdentity) ? raw.cacheIdentity : 'gemini';
				const effectiveCacheKey = [
					folder.uri.toString(),
					'file',
					relative,
					contentHash,
					PROMPT_VERSION,
					cacheIdentity,
				].join('::');

				this._writeCache(effectiveCacheKey, aiText);
				return { overview, aiDescription: aiText, aiStatus: 'ready', cacheHit: false };
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

	private _writeCache(key: string, text: string): void {
		const cache = this._readCache();
		cache[key] = { text, at: Date.now() };
		const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_CACHE);
		const next: Record<string, CacheEntry> = {};
		for (const [k, v] of entries) {
			next[k] = v;
		}
		this.storageService.store(CACHE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
