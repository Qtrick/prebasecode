/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ScannedFile } from '../../common/types/graphTypes.js';
import type { CancellationTokenLike, IRepositoryContentSource, ScannedFileInventory } from '../../core/canonical/contentSource.js';
import { DEFAULT_IGNORE_PATTERNS } from '../../core/scanning/ignorePatterns.js';
import { isGraphRelevantFile } from '../../core/scanning/projectFiles.js';
import { basename, normalizePath } from '../../core/resolution/paths.js';
import type { IGitHistoryService } from './gitHistoryService.js';
import type { GitTreeEntry } from './gitTypes.js';

export interface GitTreeContentSourceOptions {
	readonly maxScanFiles?: number;
	readonly maxFileSizeBytes?: number;
	readonly projectName?: string;
}

export class GitTreeContentSource implements IRepositoryContentSource {
	readonly kind = 'git-tree';
	readonly identity: string;
	readonly rootPath: string;
	readonly commitSha: string;
	readonly projectName: string;
	private readonly _gitService: IGitHistoryService;
	private readonly _maxScanFiles: number;
	private readonly _maxFileSizeBytes: number;
	private _treeEntriesMap: Map<string, GitTreeEntry> | undefined;

	constructor(
		gitService: IGitHistoryService,
		rootPath: string,
		commitSha: string,
		options: GitTreeContentSourceOptions = {}
	) {
		this._gitService = gitService;
		this.rootPath = normalizePath(rootPath).replace(/\/+$/, '');
		this.commitSha = commitSha.trim();
		this.projectName = options.projectName || basename(this.rootPath) || 'workspace';
		this.identity = `git-tree:${this.rootPath}:${this.commitSha}`;
		this._maxScanFiles = options.maxScanFiles ?? 10_000;
		this._maxFileSizeBytes = options.maxFileSizeBytes ?? 500_000;
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory> {
		const treeEntries = await this._gitService.listTree(this.rootPath, this.commitSha, { maxEntries: this._maxScanFiles * 2 }, token);
		const files: ScannedFile[] = [];
		const entriesMap = new Map<string, GitTreeEntry>();
		let isTruncated = false;
		let discoveredCount = 0;

		for (const entry of treeEntries) {
			if (token?.isCancellationRequested) {
				break;
			}
			if (entry.objectType !== 'blob') {
				continue;
			}

			const relPath = normalizePath(entry.path);
			entriesMap.set(relPath, entry);

			if (this._isIgnored(relPath)) {
				continue;
			}

			if (!isGraphRelevantFile(relPath)) {
				continue;
			}

			discoveredCount++;

			if (files.length >= this._maxScanFiles) {
				isTruncated = true;
				continue;
			}

			const name = basename(relPath);
			const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
			files.push({
				absolutePath: `${this.rootPath}/${relPath}`,
				relativePath: relPath,
				extension: ext,
			});
		}

		this._treeEntriesMap = entriesMap;
		return {
			files,
			isTruncated,
			discoveredCount,
			eligibleCount: files.length,
			truncationReason: isTruncated ? `Exceeded maxScanFiles limit of ${this._maxScanFiles}` : undefined,
		};
	}

	async readFile(relativePath: string, token?: CancellationTokenLike): Promise<string | undefined> {
		const normalized = normalizePath(relativePath).replace(/^\/+/, '');
		const entry = this._treeEntriesMap?.get(normalized);
		// Pre-filter oversized blobs before fetching content
		if (entry && typeof entry.size === 'number' && entry.size > this._maxFileSizeBytes) {
			return undefined;
		}

		try {
			return await this._gitService.readFileAtRef(this.rootPath, this.commitSha, normalized, token);
		} catch {
			return undefined;
		}
	}

	async getFileSize(relativePath: string): Promise<number | undefined> {
		const normalized = normalizePath(relativePath).replace(/^\/+/, '');
		const entry = this._treeEntriesMap?.get(normalized);
		return entry?.size;
	}

	async getContentIdentity(relativePath: string): Promise<string | undefined> {
		const normalized = normalizePath(relativePath).replace(/^\/+/, '');
		const entry = this._treeEntriesMap?.get(normalized);
		return entry?.blobOid ?? entry?.objectId;
	}

	async readPackageMain(token?: CancellationTokenLike): Promise<string | null> {
		try {
			const raw = await this.readFile('package.json', token);
			if (!raw) return null;
			const pkg = JSON.parse(raw) as { main?: string; module?: string };
			return pkg.module ?? pkg.main ?? null;
		} catch {
			return null;
		}
	}

	private _isIgnored(relativePath: string): boolean {
		const clean = relativePath.replace(/^\/+/, '');
		const segments = clean.split('/');
		for (const rawPattern of DEFAULT_IGNORE_PATTERNS) {
			const pattern = rawPattern.trim();
			if (!pattern || pattern.startsWith('#')) continue;

			const exact = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/^\//, '').replace(/\/$/, '').replace(/\*\*/g, '');
			if (exact && (segments.includes(exact) || clean === exact || clean.startsWith(`${exact}/`))) {
				return true;
			}

			if (pattern.startsWith('*.') && clean.endsWith(pattern.slice(1))) {
				return true;
			}
		}
		return false;
	}
}
