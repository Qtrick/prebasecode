/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ScannedFile } from '../../common/types/graphTypes.js';
import { DEFAULT_IGNORE_PATTERNS } from '../scanning/ignorePatterns.js';
import { isGraphRelevantFile } from '../scanning/projectFiles.js';
import { basename, normalizePath } from '../resolution/paths.js';

export interface CancellationTokenLike {
	readonly isCancellationRequested: boolean;
}

export interface ScannedFileInventory {
	readonly files: readonly ScannedFile[];
	readonly isTruncated: boolean;
	readonly discoveredCount: number;
	readonly eligibleCount: number;
	readonly truncationReason?: string;
}

export interface IRepositoryContentSource {
	readonly kind: 'working-tree' | 'git-tree';
	readonly identity: string;
	readonly rootPath: string;
	readonly projectName?: string;
	listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory>;
	readFile(relativePath: string, token?: CancellationTokenLike): Promise<string | undefined>;
	getFileSize?(relativePath: string): Promise<number | undefined>;
	getContentIdentity?(relativePath: string): Promise<string | undefined>;
	readPackageMain?(token?: CancellationTokenLike): Promise<string | null>;
}

export interface WorkingTreeFileOps {
	readFile(filePath: string): Promise<string>;
	readDirectory?(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
	getFileSize?(filePath: string): Promise<number | undefined>;
}

export interface WorkingTreeContentSourceOptions {
	readonly maxScanFiles?: number;
	readonly respectGitIgnore?: boolean;
	readonly customIgnorePatterns?: readonly string[];
	readonly checkIgnore?: (paths: string[]) => Promise<Set<string>>;
	readonly fileOps: WorkingTreeFileOps;
	readonly projectName?: string;
}

export class WorkingTreeContentSource implements IRepositoryContentSource {
	readonly kind = 'working-tree';
	readonly identity: string;
	readonly rootPath: string;
	readonly projectName: string;
	private readonly _maxScanFiles: number;
	private readonly _respectGitIgnore: boolean;
	private readonly _customIgnorePatterns: readonly string[];
	private readonly _checkIgnore?: (paths: string[]) => Promise<Set<string>>;
	private readonly _fileOps: WorkingTreeFileOps;

	constructor(rootPath: string, options: WorkingTreeContentSourceOptions) {
		this.rootPath = normalizePath(rootPath).replace(/\/+$/, '');
		this.projectName = options.projectName || basename(this.rootPath) || 'workspace';
		this.identity = `working-tree:${this.rootPath}`;
		this._maxScanFiles = options.maxScanFiles ?? 10_000;
		this._respectGitIgnore = options.respectGitIgnore !== false;
		this._customIgnorePatterns = options.customIgnorePatterns ?? [];
		this._checkIgnore = options.checkIgnore;
		this._fileOps = options.fileOps;
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory> {
		if (!this._fileOps.readDirectory) {
			return { files: [], isTruncated: false, discoveredCount: 0, eligibleCount: 0 };
		}

		const files: ScannedFile[] = [];
		let ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...this._customIgnorePatterns];

		if (this._respectGitIgnore && !this._checkIgnore) {
			try {
				const gitignorePath = `${this.rootPath}/.gitignore`;
				const content = await this._fileOps.readFile(gitignorePath);
				const extra = content
					.split('\n')
					.map(l => l.trim())
					.filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
				ignorePatterns = [...ignorePatterns, ...extra];
			} catch {
				// No root .gitignore file
			}
		}

		const queue: string[] = [this.rootPath];
		let isTruncated = false;
		let discoveredCount = 0;

		for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
			if (token?.isCancellationRequested) {
				break;
			}
			const currentDir = queue[queueIndex];
			let entries: Array<{ name: string; isDirectory: boolean }>;
			try {
				entries = await this._fileOps.readDirectory(currentDir);
			} catch {
				continue;
			}

			const candidatePaths: Array<{ fullPath: string; relPath: string; name: string; ext: string }> = [];

			for (const entry of entries) {
				if (token?.isCancellationRequested) {
					break;
				}
				const fullPath = `${currentDir}/${entry.name}`;
				const relPath = normalizePath(fullPath.slice(this.rootPath.length + 1));

				if (this._isPatternIgnored(relPath, entry.isDirectory, ignorePatterns)) {
					continue;
				}

				if (entry.isDirectory) {
					queue.push(fullPath);
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
				candidatePaths.push({ fullPath, relPath, name, ext });
			}

			if (this._checkIgnore && candidatePaths.length > 0) {
				let ignoredSet: Set<string>;
				try {
					ignoredSet = await this._checkIgnore(candidatePaths.map(c => c.relPath));
				} catch {
					ignoredSet = new Set();
				}
				for (const cand of candidatePaths) {
					if (ignoredSet.has(cand.relPath)) {
						continue;
					}
					if (files.length < this._maxScanFiles) {
						files.push({
							absolutePath: cand.fullPath,
							relativePath: cand.relPath,
							extension: cand.ext,
						});
					} else {
						isTruncated = true;
					}
				}
			} else {
				for (const cand of candidatePaths) {
					if (files.length < this._maxScanFiles) {
						files.push({
							absolutePath: cand.fullPath,
							relativePath: cand.relPath,
							extension: cand.ext,
						});
					} else {
						isTruncated = true;
					}
				}
			}
		}

		return {
			files,
			isTruncated,
			discoveredCount,
			eligibleCount: files.length,
			truncationReason: isTruncated ? `Exceeded maxScanFiles limit of ${this._maxScanFiles}` : undefined,
		};
	}

	async readFile(relativePath: string, _token?: CancellationTokenLike): Promise<string | undefined> {
		try {
			const fullPath = relativePath.startsWith('/')
				? relativePath
				: `${this.rootPath}/${relativePath}`;
			return await this._fileOps.readFile(fullPath);
		} catch {
			return undefined;
		}
	}

	async getFileSize(relativePath: string): Promise<number | undefined> {
		if (!this._fileOps.getFileSize) {
			return undefined;
		}
		try {
			const fullPath = relativePath.startsWith('/')
				? relativePath
				: `${this.rootPath}/${relativePath}`;
			return await this._fileOps.getFileSize(fullPath);
		} catch {
			return undefined;
		}
	}

	async readPackageMain(_token?: CancellationTokenLike): Promise<string | null> {
		try {
			const raw = await this.readFile('package.json');
			if (!raw) return null;
			const pkg = JSON.parse(raw) as { main?: string; module?: string };
			return pkg.module ?? pkg.main ?? null;
		} catch {
			return null;
		}
	}

	private _isPatternIgnored(relativePath: string, isDirectory: boolean, patterns: string[]): boolean {
		const clean = relativePath.replace(/^\/+/, '');
		const segments = clean.split('/');
		for (const rawPattern of patterns) {
			const pattern = rawPattern.trim();
			if (!pattern || pattern.startsWith('#')) continue;

			// Direct segment match (e.g. "node_modules", ".git", "dist")
			const exact = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/^\//, '').replace(/\/$/, '').replace(/\*\*/g, '');
			if (exact && (segments.includes(exact) || clean === exact || clean.startsWith(`${exact}/`))) {
				return true;
			}

			// Extension match (e.g. "*.min.js")
			if (pattern.startsWith('*.') && !isDirectory) {
				const ext = pattern.slice(1);
				if (clean.endsWith(ext)) {
					return true;
				}
			}
		}
		return false;
	}
}
