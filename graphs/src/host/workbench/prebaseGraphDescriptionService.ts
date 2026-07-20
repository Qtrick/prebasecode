/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
import { inferFileDescription } from '../../core/fileDescription.js';
import type { GraphNode } from '../../core/types.js';

export const IPreBaseGraphDescriptionService = createDecorator<IPreBaseGraphDescriptionService>('prebaseGraphDescriptionService');

export interface IGraphNodeDescriptionResult {
	overview: string;
	aiDescription?: string;
	aiStatus: 'skipped' | 'loading' | 'ready' | 'unavailable' | 'error';
	aiMessage?: string;
	cacheHit: boolean;
}

const PROMPT_VERSION = 'v2';
const CACHE_KEY = 'prebase.graph.descriptionCache.v2';
const MAX_CACHE = 200;
const MAX_CONTENT = 6000;

const SENSITIVE = /(^|\/)(\.env|\.env\..*|credentials|secrets?|id_rsa|\.pem|\.key)(\/|$)/i;

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
		if (SENSITIVE.test(relative) || /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz)$/i.test(relative)) {
			return { overview, aiStatus: 'skipped', aiMessage: localize('prebase.desc.skipped', "AI description skipped for this file type."), cacheHit: false };
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
				const file = await this.fileService.readFile(uri);
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
			'magnus-default',
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

				// Prefer Magnus extension command when present; ignore if unavailable.
				let aiDescription: string | undefined;
				try {
					const result = await this.commandService.executeCommand<string | { text?: string }>(
						'prebase.magnus.describeFile',
						{ prompt, path: relative }
					);
					aiDescription = typeof result === 'string' ? result : result?.text;
				} catch {
					aiDescription = undefined;
				}

				if (cts.token.isCancellationRequested) {
					return { overview, aiStatus: 'unavailable', aiMessage: localize('prebase.desc.cancelled', "Description request cancelled."), cacheHit: false };
				}

				if (!aiDescription?.trim()) {
					return {
						overview,
						aiStatus: 'unavailable',
						aiMessage: localize('prebase.desc.configureMagnus', "Configure Agents for an AI-generated description."),
						cacheHit: false,
					};
				}

				this._writeCache(cacheKey, aiDescription.trim());
				return { overview, aiDescription: aiDescription.trim(), aiStatus: 'ready', cacheHit: false };
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
