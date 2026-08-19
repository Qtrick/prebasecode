/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { IWorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { TemporalGraphService, type ITemporalGraphService, type TemporalIndexStatus } from '../../temporal/host/temporalGraphService.js';
import { TemporalCommitIngestionService } from '../../temporal/ingestion/temporalCommitIngestionService.js';
import { TemporalRepositoryRegistry, type TemporalStoreFactory } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { IncrementalGraphAnalyzer } from '../../temporal/analysis/incrementalGraphAnalyzer.js';
import { SqliteTemporalStore } from '../../temporal/persistence/node/sqliteTemporalStore.js';
import { computePureSha256 } from '../../core/canonical/pureSha256.js';
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

export function computeSafeStorePath(storageHome: URI, repoId: string, rootPath: string): string {
	const hash = computePureSha256(repoId || rootPath).slice(0, 16);
	const base = (rootPath ? rootPath.split(/[/\\]/).filter(Boolean).pop() : 'repo') || 'repo';
	const safeName = base.replace(/[^a-zA-Z0-9_-]/g, '_');
	const filename = `${safeName}_${hash}.db`;
	const dbUri = URI.joinPath(storageHome, 'prebase-temporal', filename);
	return dbUri.fsPath || dbUri.path;
}

export class WorkbenchTemporalGraphService extends Disposable implements IPreBaseTemporalGraphService {
	declare readonly _serviceBrand: undefined;

	private readonly _registry: TemporalRepositoryRegistry;
	private readonly _ingestionService: TemporalCommitIngestionService;
	private readonly _temporalService: TemporalGraphService;
	private readonly _repositoryHeadObservers = new Map<string, DisposableStore>();

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkbenchGitHistoryService private readonly _gitHistoryService: IWorkbenchGitHistoryService,
	) {
		super();

		const storeFactory: TemporalStoreFactory = async (repoId: string, rootPath: string) => {
			const storageHome = this.environmentService.userRoamingDataHome || this.environmentService.workspaceStorageHome;
			const dbPath = computeSafeStorePath(storageHome, repoId, rootPath);
			return new SqliteTemporalStore({ dbPath });
		};

		this._registry = new TemporalRepositoryRegistry(storeFactory);
		const analyzer = new IncrementalGraphAnalyzer();
		this._ingestionService = new TemporalCommitIngestionService(this._gitHistoryService, this._registry, analyzer);
		this._temporalService = new TemporalGraphService(this._gitHistoryService, this._registry, this._ingestionService);

		this._checkAndWireHeadObservers();
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this._checkAndWireHeadObservers()));
		if (typeof this._gitHistoryService.onDidChangeHead === 'function') {
			const sub = this._gitHistoryService.onDidChangeHead((event: GitHeadChangeEvent) => {
				this._routeHeadChanged(event);
			});
			this._register(sub);
		}
	}

	private _checkAndWireHeadObservers(): void {
		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const rootPath = folder.uri.fsPath || folder.uri.path;
			// Ensure store is initialized for open workspace folders
			this._gitHistoryService.getRepositoryIdentity(rootPath).then(identity => {
				this._registry.getStore(identity.repositoryId, rootPath).catch(() => {});
			}).catch(() => {});
		}
	}

	private _routeHeadChanged(event: GitHeadChangeEvent): void {
		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const rootPath = folder.uri.fsPath || folder.uri.path;
			this._temporalService.handleHeadChanged(event, rootPath).catch(() => {});
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
