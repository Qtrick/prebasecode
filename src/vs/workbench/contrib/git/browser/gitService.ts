/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IGitService, IGitExtensionDelegate, GitRef, GitRefQuery, IGitRepository, GitRepositoryState, GitDiffChange, GitCommitMetadata, GitTreeInventory, GitExactDiffResult, GitLogOptions } from '../common/gitService.js';
import { ISettableObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { structuralEquals } from '../../../../base/common/equals.js';
import { AutoOpenBarrier } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export class GitService extends Disposable implements IGitService {
	declare readonly _serviceBrand: undefined;

	private _delegate: IGitExtensionDelegate | undefined;
	private _delegateBarrier = new AutoOpenBarrier(10_000);
	private readonly _delegateListeners = this._register(new DisposableStore());
	private readonly _onDidOpenRepository = this._register(new Emitter<IGitRepository>());
	readonly onDidOpenRepository = this._onDidOpenRepository.event;
	private readonly _onDidCloseRepository = this._register(new Emitter<IGitRepository>());
	readonly onDidCloseRepository = this._onDidCloseRepository.event;

	get repositories(): Iterable<IGitRepository> {
		return this._delegate?.repositories ?? [];
	}

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}

	setDelegate(delegate: IGitExtensionDelegate): IDisposable {
		// The delegate can only be set once, since the vscode.git
		// extension can only run in one extension host process per
		// window.
		if (this._delegate) {
			this.logService.error('[GitService][setDelegate] GitExtension delegate is already set.');
			throw new BugIndicatingError('GitExtension delegate is already set.');
		}

		this._delegate = delegate;
		this._delegateListeners.add(delegate.onDidOpenRepository(repository => this._onDidOpenRepository.fire(repository)));
		this._delegateListeners.add(delegate.onDidCloseRepository(repository => this._onDidCloseRepository.fire(repository)));
		this._delegateBarrier.open();

		return toDisposable(() => {
			this._delegateListeners.clear();
			this._delegate = undefined;
		});
	}

	async openRepository(uri: URI): Promise<IGitRepository | undefined> {
		// We need to wait for the delegate to be set before we can open a repository.
		// At the moment we are waiting for 10 seconds before we automatically open the
		// barrier.
		await this._delegateBarrier.wait();

		if (!this._delegate) {
			this.logService.warn('[GitService][openRepository] GitExtension delegate is not set after 10 seconds. Cannot open repository.');
			return undefined;
		}

		return this._delegate.openRepository(uri);
	}
}

export class GitRepository extends Disposable implements IGitRepository {
	readonly rootUri: URI;

	readonly state: ISettableObservable<GitRepositoryState>;
	updateState(state: GitRepositoryState): void {
		this.state.set(state, undefined);
	}

	constructor(
		rootUri: URI,
		initialState: GitRepositoryState,
		private readonly delegate: IGitExtensionDelegate
	) {
		super();

		this.rootUri = rootUri;
		this.state = observableValueOpts({ owner: this, equalsFn: structuralEquals }, initialState);
	}

	async getRefs(query: GitRefQuery, token?: CancellationToken): Promise<GitRef[]> {
		return this.delegate.getRefs(this.rootUri, query, token);
	}

	async diffBetweenWithStats(ref1: string, ref2: string, path?: string): Promise<GitDiffChange[]> {
		return this.delegate.diffBetweenWithStats(this.rootUri, ref1, ref2, path);
	}

	async diffBetweenWithStats2(ref: string, path?: string): Promise<GitDiffChange[]> {
		return this.delegate.diffBetweenWithStats2(this.rootUri, ref, path);
	}

	async resolveCommitRef(ref: string, token?: CancellationToken): Promise<string> {
		if (this.delegate.resolveCommitRef) {
			return this.delegate.resolveCommitRef(this.rootUri, ref, token);
		}
		throw new Error('resolveCommitRef is not supported by delegate');
	}

	async getCommitDetails(ref: string, token?: CancellationToken): Promise<GitCommitMetadata> {
		if (this.delegate.getCommitDetails) {
			return this.delegate.getCommitDetails(this.rootUri, ref, token);
		}
		throw new Error('getCommitDetails is not supported by delegate');
	}

	async getCommitLog(options: GitLogOptions, token?: CancellationToken): Promise<GitCommitMetadata[]> {
		if (this.delegate.getCommitLog) {
			return this.delegate.getCommitLog(this.rootUri, options, token);
		}
		throw new Error('getCommitLog is not supported by delegate');
	}

	async listTreeEntries(ref: string, options?: { maxEntries?: number; scope?: string }, token?: CancellationToken): Promise<GitTreeInventory> {
		if (this.delegate.listTreeEntries) {
			return this.delegate.listTreeEntries(this.rootUri, ref, options, token);
		}
		throw new Error('listTreeEntries is not supported by delegate');
	}

	async readBlobContent(ref: string, path: string, maxBytes?: number, token?: CancellationToken): Promise<string> {
		if (this.delegate.readBlobContent) {
			return this.delegate.readBlobContent(this.rootUri, ref, path, maxBytes, token);
		}
		throw new Error('readBlobContent is not supported by delegate');
	}

	async diffExactTrees(refA: string, refB: string, token?: CancellationToken): Promise<GitExactDiffResult> {
		if (this.delegate.diffExactTrees) {
			return this.delegate.diffExactTrees(this.rootUri, refA, refB, token);
		}
		throw new Error('diffExactTrees is not supported by delegate');
	}

	async diffCommitToParent(commitRef: string, parentIndex?: number, token?: CancellationToken): Promise<GitExactDiffResult> {
		if (this.delegate.diffCommitToParent) {
			return this.delegate.diffCommitToParent(this.rootUri, commitRef, parentIndex, token);
		}
		throw new Error('diffCommitToParent is not supported by delegate');
	}

	async diffReviewRange(baseRef: string, headRef: string, token?: CancellationToken): Promise<GitExactDiffResult> {
		if (this.delegate.diffReviewRange) {
			return this.delegate.diffReviewRange(this.rootUri, baseRef, headRef, token);
		}
		throw new Error('diffReviewRange is not supported by delegate');
	}

	async checkIgnore(paths: string[]): Promise<string[]> {
		if (this.delegate.checkIgnore) {
			return this.delegate.checkIgnore(this.rootUri, paths);
		}
		return [];
	}
}
