/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { IGitService } from '../../../../git/common/gitService.js';
import { WorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { TemporalGraphService, type ITemporalGraphService, type TemporalIndexStatus } from '../../temporal/host/temporalGraphService.js';
import { TemporalCommitIngestionService } from '../../temporal/ingestion/temporalCommitIngestionService.js';
import { TemporalRepositoryRegistry, type TemporalStoreFactory } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type {
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalQueryOptions,
} from '../../temporal/common/temporalTypes.js';
import type { GitHeadChangeEvent } from '../../history/git/gitHistoryService.js';
import { URI } from '../../../../../../base/common/uri.js';

export const IPreBaseTemporalGraphService = createDecorator<IPreBaseTemporalGraphService>('prebaseTemporalGraphService');

export interface IPreBaseTemporalGraphService extends ITemporalGraphService {
	readonly _serviceBrand: undefined;
}

export class WorkbenchTemporalGraphService extends Disposable implements IPreBaseTemporalGraphService {
	declare readonly _serviceBrand: undefined;

	private readonly _gitHistoryService: WorkbenchGitHistoryService;
	private readonly _registry: TemporalRepositoryRegistry;
	private readonly _ingestionService: TemporalCommitIngestionService;
	private readonly _temporalService: TemporalGraphService;
	private readonly _repositoryHeadObservers = new Map<string, DisposableStore>();

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IGitService private readonly gitService: IGitService,
	) {
		super();
		this._gitHistoryService = new WorkbenchGitHistoryService(this.gitService as any);

		const storeFactory: TemporalStoreFactory = async (repoId: string) => {
			const storageHome = this.environmentService.userRoamingDataHome || this.environmentService.workspaceStorageHome;
			const dbUri = URI.joinPath(storageHome, 'prebase-temporal', `${repoId}.db`);
			const dbPath = dbUri.fsPath || dbUri.path;
			return new SqliteTemporalStore({ dbPath });
		};

		this._registry = new TemporalRepositoryRegistry(storeFactory);
		const analyzer = new IncrementalGraphAnalyzer();
		this._ingestionService = new TemporalCommitIngestionService(this._gitHistoryService, this._registry, analyzer);
		this._temporalService = new TemporalGraphService(this._gitHistoryService, this._registry, this._ingestionService);

		this._checkAndWireHeadObservers();
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this._checkAndWireHeadObservers()));
	}

	private _checkAndWireHeadObservers(): void {
		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const rootPath = folder.uri.fsPath || folder.uri.path;
			if (!this._repositoryHeadObservers.has(rootPath)) {
				const store = new DisposableStore();
				store.add(this._gitHistoryService.onDidChangeHead((event: GitHeadChangeEvent) => {
					this._temporalService.handleHeadChanged(event, rootPath).catch(() => {});
				}));
				this._repositoryHeadObservers.set(rootPath, store);
			}
		}
	}

	getCommitIndexStatus(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalIndexStatus> {
		return this._temporalService.getCommitIndexStatus(rootPath, commitSha, token);
	}

	ensureCommitIndexed(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		return this._temporalService.ensureCommitIndexed(rootPath, commitSha, token);
	}

	getGraphAtCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		return this._temporalService.getGraphAtCommit(rootPath, commitSha, token);
	}

	getEntityHistory(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		return this._temporalService.getEntityHistory(rootPath, entityId, token);
	}

	getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		return this._temporalService.getEntityLineageEvents(rootPath, entityId, token);
	}

	queryTemporalGraph(rootPath: string, options: TemporalQueryOptions, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot[]> {
		return this._temporalService.queryTemporalGraph(rootPath, options, token);
	}

	ingestCommit(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalGraphSnapshot> {
		return this._temporalService.ingestCommit(rootPath, commitSha, token);
	}

	ingestCommitRange(rootPath: string, commitShas: string[], token?: CancellationTokenLike): Promise<void> {
		return this._temporalService.ingestCommitRange(rootPath, commitShas, token);
	}

	handleHeadChanged(event: GitHeadChangeEvent, rootPath: string): Promise<void> {
		return this._temporalService.handleHeadChanged(event, rootPath);
	}

	override async dispose(): Promise<void> {
		for (const store of this._repositoryHeadObservers.values()) {
			store.dispose();
		}
		this._repositoryHeadObservers.clear();
		await this._temporalService.dispose();
		super.dispose();
	}
}
