/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { IMainProcessService } from '../../../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkbenchGitHistoryService } from './workbenchGitHistoryService.js';
import { TemporalGraphService, type ITemporalGraphService, type TemporalCommitIndexStatus } from '../../temporal/host/temporalGraphService.js';
import { TemporalRepositoryRegistry, type TemporalStoreFactory } from '../../temporal/ingestion/temporalRepositoryRegistry.js';
import { TEMPORAL_STORE_CHANNEL_NAME } from '../../temporal/persistence/common/temporalStoreChannel.js';
import { WorkbenchTemporalStore } from './workbenchTemporalStore.js';
import { computePureSha256 } from '../../core/canonical/pureSha256.js';
import type { CancellationTokenLike } from '../../core/canonical/contentSource.js';
import type {
	TemporalEntityLineageEvent,
	TemporalEdgeLifecycleEvent,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalHistoryPage,
	TemporalHistoryPageOptions,
	TemporalMaintenanceResult,
	TemporalQueryOptions,
	TemporalRepositoryRef,
} from '../../temporal/common/temporalTypes.js';
import type { GitHeadChangeEvent } from '../../history/git/gitHistoryService.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IPreBaseCanonicalParseService } from './workbenchCanonicalParseService.js';
import { ILifecycleService } from '../../../../../../workbench/services/lifecycle/common/lifecycle.js';

export const IPreBaseTemporalGraphService = createDecorator<IPreBaseTemporalGraphService>('prebaseTemporalGraphService');

export interface IPreBaseTemporalGraphService extends ITemporalGraphService {
	readonly _serviceBrand: undefined;
	getActiveWriteCount(): number;
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
	private readonly _temporalService: TemporalGraphService;

	constructor(
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkbenchGitHistoryService private readonly _gitHistoryService: IWorkbenchGitHistoryService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@ILogService private readonly _logService: ILogService,
		@IPreBaseCanonicalParseService parseService: IPreBaseCanonicalParseService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
	) {
		super();

		const storeFactory: TemporalStoreFactory = async (repoId: string, rootPath: string) => {
			// Temporal databases are large, repository-derived, and reconstructable.
			// Keep them in the device-local cache rather than roaming user data.
			const storageHome = this.environmentService.cacheHome;
			const dbPath = computeSafeStorePath(storageHome, repoId, rootPath);
			return new WorkbenchTemporalStore(mainProcessService.getChannel(TEMPORAL_STORE_CHANNEL_NAME), dbPath);
		};

		this._registry = new TemporalRepositoryRegistry(storeFactory, parseService);
		this._temporalService = new TemporalGraphService(this._gitHistoryService, this._registry);

		this._register(this._lifecycleService.onWillShutdown(event => {
			event.join(this._temporalService.dispose(), { id: 'WorkbenchTemporalGraphService', label: 'WorkbenchTemporalGraphService' });
		}));

		this._checkAndWireHeadObservers();
		for (const repository of this._gitHistoryService.getRepositories()) {
			void this._activateRepository(repository.rootUri.fsPath || repository.rootUri.path);
		}
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => this._checkAndWireHeadObservers()));
		this._register(this._gitHistoryService.onDidOpenRepository(repository => {
			void this._activateRepository(repository.rootUri.fsPath || repository.rootUri.path);
		}));
		this._register(this._gitHistoryService.onDidCloseRepository(repository => {
			void this._registry.closeStoreByRootPath(repository.rootUri.fsPath || repository.rootUri.path);
		}));
		if (typeof this._gitHistoryService.onDidChangeHead === 'function') {
			const sub = this._gitHistoryService.onDidChangeHead((event: GitHeadChangeEvent) => {
				void this._routeHeadChanged(event);
			});
			this._register(sub);
		}
	}

	private _checkAndWireHeadObservers(): void {
		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const rootPath = folder.uri.fsPath || folder.uri.path;
			void this._activateRepository(rootPath);
		}
	}

	private async _activateRepository(rootPath: string): Promise<void> {
		try {
			const identity = await this._gitHistoryService.getRepositoryIdentity(rootPath);
			const runtime = await this._registry.getRuntime(identity.repositoryId, identity.rootPath, this._gitHistoryService);
			await runtime.refreshRefs();
		} catch (error) {
			this._logService.error('[PreBase][Temporal] Failed to activate repository runtime', error);
		}
	}

	private async _routeHeadChanged(event: GitHeadChangeEvent): Promise<void> {
		try {
			await this._temporalService.handleRegisteredRepositoryHeadChanged(event);
		} catch (error) {
			this._logService.error(`[PreBase][Temporal] History indexing failed for repository ${computePureSha256(event.repositoryId).slice(0, 12)}`, error);
		}
	}

	getCommitIndexStatus(rootPath: string, commitSha: string, token?: CancellationTokenLike): Promise<TemporalCommitIndexStatus> {
		return this._temporalService.getCommitIndexStatus(rootPath, commitSha, token);
	}

	getRepositoryRefs(rootPath: string, token?: CancellationTokenLike): Promise<TemporalRepositoryRef[]> {
		return this._temporalService.getRepositoryRefs(rootPath, token);
	}

	getHistoryPage(rootPath: string, options?: TemporalHistoryPageOptions, token?: CancellationTokenLike): Promise<TemporalHistoryPage> {
		return this._temporalService.getHistoryPage(rootPath, options, token);
	}

	runMaintenance(rootPath: string, maxDatabaseBytes: number, token?: CancellationTokenLike): Promise<TemporalMaintenanceResult> {
		return this._temporalService.runMaintenance(rootPath, maxDatabaseBytes, token);
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

	getEntityHistoryAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntitySnapshot[]> {
		return this._temporalService.getEntityHistoryAtRef(rootPath, entityId, targetRef, token);
	}

	getEntityLineageEvents(rootPath: string, entityId: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		return this._temporalService.getEntityLineageEvents(rootPath, entityId, token);
	}

	getEntityLineageEventsAtRef(rootPath: string, entityId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEntityLineageEvent[]> {
		return this._temporalService.getEntityLineageEventsAtRef(rootPath, entityId, targetRef, token);
	}

	getEdgeHistory(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		return this._temporalService.getEdgeHistory(rootPath, edgeId, token);
	}

	getEdgeHistoryAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeSnapshot[]> {
		return this._temporalService.getEdgeHistoryAtRef(rootPath, edgeId, targetRef, token);
	}

	getEdgeLifecycleEvents(rootPath: string, edgeId: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]> {
		return this._temporalService.getEdgeLifecycleEvents(rootPath, edgeId, token);
	}

	getEdgeLifecycleEventsAtRef(rootPath: string, edgeId: string, targetRef: string, token?: CancellationTokenLike): Promise<TemporalEdgeLifecycleEvent[]> {
		return this._temporalService.getEdgeLifecycleEventsAtRef(rootPath, edgeId, targetRef, token);
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

	getActiveWriteCount(): number {
		return this._registry.countActiveWrites();
	}

	override async dispose(): Promise<void> {
		await this._temporalService.dispose();
		super.dispose();
	}
}
