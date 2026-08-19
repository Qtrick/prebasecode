/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
import type {
	GraphNodeData,
	TemporalEntityLineageEvent,
	TemporalEntitySnapshot,
	TemporalLineageCase,
} from '../common/temporalTypes.js';

export interface FileToResolve {
	readonly path: string;
	readonly blobOid?: string;
	readonly contentHash?: string;
	readonly nodeData: GraphNodeData;
}

export interface LineageResolutionInput {
	readonly commitSha: string;
	readonly parentCommitSha?: string;
	readonly parentEntityMap: ReadonlyMap<string, TemporalEntitySnapshot>;
	readonly parentPathToEntityId: ReadonlyMap<string, string>;
	readonly currentFiles: readonly FileToResolve[];
	readonly diffChanges: readonly GitExactDiffChange[];
	readonly deletedEntityIdsInHistory?: ReadonlySet<string>;
}

export interface LineageResolutionResult {
	readonly entitySnapshots: Map<string, TemporalEntitySnapshot>;
	readonly pathToEntityId: Map<string, string>;
	readonly lineageEvents: TemporalEntityLineageEvent[];
	readonly terminatedEntityIds: string[];
}

function generateEntityId(path: string, commitSha: string, disambiguator?: string): string {
	const cleanPath = path.replace(/\\/g, '/');
	const suffix = disambiguator ? `_${disambiguator}` : '';
	return `ent_${cleanPath.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${commitSha.slice(0, 8)}${suffix}`;
}

export class TemporalLineageResolver {
	/**
	 * Resolves entity identities and lineage transitions across a commit boundary.
	 */
	resolveLineage(input: LineageResolutionInput): LineageResolutionResult {
		const {
			commitSha,
			parentCommitSha = '',
			parentEntityMap,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
			deletedEntityIdsInHistory = new Set<string>(),
		} = input;

		const entitySnapshots = new Map<string, TemporalEntitySnapshot>();
		const pathToEntityId = new Map<string, string>();
		const lineageEvents: TemporalEntityLineageEvent[] = [];
		const claimedParentEntityIds = new Set<string>();

		// 1. Index git diff changes by new path and old path
		const diffByNewPath = new Map<string, GitExactDiffChange>();
		const diffByOldPath = new Map<string, GitExactDiffChange>();
		for (const diff of diffChanges) {
			if (diff.path) {
				diffByNewPath.set(diff.path, diff);
			}
			if (diff.oldPath) {
				diffByOldPath.set(diff.oldPath, diff);
			}
		}

		// Check for swapped paths (Case 11)
		const swappedPathPairs: Array<{ pathA: string; pathB: string }> = [];
		for (const [newPath, diff] of diffByNewPath) {
			if (diff.oldPath && diff.oldPath !== newPath) {
				const counterpart = diffByNewPath.get(diff.oldPath);
				if (counterpart && counterpart.oldPath === newPath) {
					swappedPathPairs.push({ pathA: diff.oldPath, pathB: newPath });
				}
			}
		}

		// 2. Process each current file
		for (const file of currentFiles) {
			const currentPath = file.path;
			const parentEntityIdForSamePath = parentPathToEntityId.get(currentPath);
			const parentSnapshotForSamePath = parentEntityIdForSamePath ? parentEntityMap.get(parentEntityIdForSamePath) : undefined;
			const diff = diffByNewPath.get(currentPath);

			// Check for root commit (no parent)
			if (!parentCommitSha || parentEntityMap.size === 0) {
				const entityId = generateEntityId(currentPath, commitSha);
				const snapshot: TemporalEntitySnapshot = {
					entityId,
					commitSha,
					path: currentPath,
					blobOid: file.blobOid,
					contentHash: file.contentHash,
					nodeData: file.nodeData,
				};
				entitySnapshots.set(entityId, snapshot);
				pathToEntityId.set(currentPath, entityId);
				continue;
			}

			// CASE 11: Swapped paths
			const isSwapped = swappedPathPairs.some(p => p.pathA === currentPath || p.pathB === currentPath);
			if (isSwapped && diff && diff.oldPath) {
				const sourceEntityId = parentPathToEntityId.get(diff.oldPath);
				if (sourceEntityId && !claimedParentEntityIds.has(sourceEntityId)) {
					claimedParentEntityIds.add(sourceEntityId);
					const snapshot: TemporalEntitySnapshot = {
						entityId: sourceEntityId,
						commitSha,
						path: currentPath,
						blobOid: file.blobOid,
						contentHash: file.contentHash,
						nodeData: file.nodeData,
					};
					entitySnapshots.set(sourceEntityId, snapshot);
					pathToEntityId.set(currentPath, sourceEntityId);
					lineageEvents.push({
						entityId: sourceEntityId,
						commitSha,
						parentCommitSha,
						lineageCase: 'swapped-paths',
						evidence: {
							sourceEntityId,
							oldPath: diff.oldPath,
							newPath: currentPath,
							oldBlobOid: diff.oldBlobOid,
							newBlobOid: diff.newBlobOid,
							confidence: 0.95,
							details: `Swapped paths with ${diff.oldPath}`,
						},
					});
					continue;
				}
			}

			// CASE 3 & 4: Git Rename (R100 or R<100)
			if (diff && diff.kind === 'renamed' && diff.oldPath) {
				const sourceEntityId = parentPathToEntityId.get(diff.oldPath);
				if (sourceEntityId && !claimedParentEntityIds.has(sourceEntityId)) {
					claimedParentEntityIds.add(sourceEntityId);
					const isExact = (diff.similarity ?? 100) >= 100 && diff.oldBlobOid === diff.newBlobOid;
					const lineageCase: TemporalLineageCase = isExact ? 'git-rename' : 'git-rename-edit';

					const snapshot: TemporalEntitySnapshot = {
						entityId: sourceEntityId,
						commitSha,
						path: currentPath,
						blobOid: file.blobOid,
						contentHash: file.contentHash,
						nodeData: file.nodeData,
					};
					entitySnapshots.set(sourceEntityId, snapshot);
					pathToEntityId.set(currentPath, sourceEntityId);
					lineageEvents.push({
						entityId: sourceEntityId,
						commitSha,
						parentCommitSha,
						lineageCase,
						evidence: {
							sourceEntityId,
							oldPath: diff.oldPath,
							newPath: currentPath,
							oldBlobOid: diff.oldBlobOid,
							newBlobOid: diff.newBlobOid,
							similarity: diff.similarity,
							confidence: (diff.similarity ?? 100) / 100,
							details: `Git rename from ${diff.oldPath} (similarity ${diff.similarity ?? 100}%)`,
						},
					});
					continue;
				}
			}

			// CASE 6: Forked Copy
			if (diff && diff.kind === 'copied' && diff.oldPath) {
				const sourceEntityId = parentPathToEntityId.get(diff.oldPath);
				const newEntityId = generateEntityId(currentPath, commitSha, 'copy');
				const snapshot: TemporalEntitySnapshot = {
					entityId: newEntityId,
					commitSha,
					path: currentPath,
					blobOid: file.blobOid,
					contentHash: file.contentHash,
					nodeData: file.nodeData,
				};
				entitySnapshots.set(newEntityId, snapshot);
				pathToEntityId.set(currentPath, newEntityId);
				lineageEvents.push({
					entityId: newEntityId,
					commitSha,
					parentCommitSha,
					lineageCase: 'forked-copy',
					evidence: {
						sourceEntityId,
						oldPath: diff.oldPath,
						newPath: currentPath,
						oldBlobOid: diff.oldBlobOid,
						newBlobOid: diff.newBlobOid,
						similarity: diff.similarity,
						confidence: 0.9,
						details: `Forked copy from ${diff.oldPath}`,
					},
				});
				continue;
			}

			// CASE 1 & 2: Same path in parent
			if (parentEntityIdForSamePath && parentSnapshotForSamePath && !claimedParentEntityIds.has(parentEntityIdForSamePath)) {
				claimedParentEntityIds.add(parentEntityIdForSamePath);
				const isContentSame = file.blobOid && parentSnapshotForSamePath.blobOid
					? file.blobOid === parentSnapshotForSamePath.blobOid
					: file.contentHash === parentSnapshotForSamePath.contentHash;

				const lineageCase: TemporalLineageCase = isContentSame ? 'same-canonical-id' : 'modified-in-place';
				const snapshot: TemporalEntitySnapshot = {
					entityId: parentEntityIdForSamePath,
					commitSha,
					path: currentPath,
					blobOid: file.blobOid,
					contentHash: file.contentHash,
					nodeData: file.nodeData,
				};
				entitySnapshots.set(parentEntityIdForSamePath, snapshot);
				pathToEntityId.set(currentPath, parentEntityIdForSamePath);
				lineageEvents.push({
					entityId: parentEntityIdForSamePath,
					commitSha,
					parentCommitSha,
					lineageCase,
					evidence: {
						sourceEntityId: parentEntityIdForSamePath,
						oldPath: currentPath,
						newPath: currentPath,
						oldBlobOid: parentSnapshotForSamePath.blobOid,
						newBlobOid: file.blobOid,
						confidence: 1.0,
						details: isContentSame ? 'Unchanged entity' : 'Modified in place',
					},
				});
				continue;
			}

			// CASE 8: Recreated fresh after prior delete
			const priorDeletedEntityId = Array.from(deletedEntityIdsInHistory).find(id => {
				const snap = parentEntityMap.get(id);
				return snap && snap.path === currentPath;
			});

			if (priorDeletedEntityId) {
				const freshEntityId = generateEntityId(currentPath, commitSha, 'recreated');
				const snapshot: TemporalEntitySnapshot = {
					entityId: freshEntityId,
					commitSha,
					path: currentPath,
					blobOid: file.blobOid,
					contentHash: file.contentHash,
					nodeData: file.nodeData,
				};
				entitySnapshots.set(freshEntityId, snapshot);
				pathToEntityId.set(currentPath, freshEntityId);
				lineageEvents.push({
					entityId: freshEntityId,
					commitSha,
					parentCommitSha,
					lineageCase: 'recreated-fresh',
					evidence: {
						sourceEntityId: priorDeletedEntityId,
						oldPath: currentPath,
						newPath: currentPath,
						newBlobOid: file.blobOid,
						confidence: 0.95,
						details: `Recreated path ${currentPath} after prior deletion of entity ${priorDeletedEntityId}`,
					},
				});
				continue;
			}

			// CASE 5: Directory Move fallback heuristic
			let directoryMoveFound = false;
			for (const [parentPath, parentId] of parentPathToEntityId) {
				if (claimedParentEntityIds.has(parentId)) continue;
				const parentSlashIndex = parentPath.lastIndexOf('/');
				const currentSlashIndex = currentPath.lastIndexOf('/');
				if (parentSlashIndex > 0 && currentSlashIndex > 0) {
					const parentBase = parentPath.slice(parentSlashIndex + 1);
					const currentBase = currentPath.slice(currentSlashIndex + 1);
					if (parentBase === currentBase) {
						const parentSnap = parentEntityMap.get(parentId);
						if (parentSnap && (parentSnap.blobOid === file.blobOid || (file.blobOid && parentSnap.blobOid))) {
							claimedParentEntityIds.add(parentId);
							const snapshot: TemporalEntitySnapshot = {
								entityId: parentId,
								commitSha,
								path: currentPath,
								blobOid: file.blobOid,
								contentHash: file.contentHash,
								nodeData: file.nodeData,
							};
							entitySnapshots.set(parentId, snapshot);
							pathToEntityId.set(currentPath, parentId);
							lineageEvents.push({
								entityId: parentId,
								commitSha,
								parentCommitSha,
								lineageCase: 'directory-move',
								evidence: {
									sourceEntityId: parentId,
									oldPath: parentPath,
									newPath: currentPath,
									oldBlobOid: parentSnap.blobOid,
									newBlobOid: file.blobOid,
									confidence: 0.85,
									details: `Directory move heuristic from ${parentPath}`,
								},
							});
							directoryMoveFound = true;
							break;
						}
					}
				}
			}
			if (directoryMoveFound) {
				continue;
			}

			// Default: Fresh entity for added file (or distinct-basename Case 9 / ambiguous fail closed Case 10)
			const freshEntityId = generateEntityId(currentPath, commitSha);
			const snapshot: TemporalEntitySnapshot = {
				entityId: freshEntityId,
				commitSha,
				path: currentPath,
				blobOid: file.blobOid,
				contentHash: file.contentHash,
				nodeData: file.nodeData,
			};
			entitySnapshots.set(freshEntityId, snapshot);
			pathToEntityId.set(currentPath, freshEntityId);
		}

		// 3. Find terminated entities (Case 7: Delete)
		const terminatedEntityIds: string[] = [];
		for (const [parentId, parentSnap] of parentEntityMap) {
			if (!claimedParentEntityIds.has(parentId)) {
				terminatedEntityIds.push(parentId);
				lineageEvents.push({
					entityId: parentId,
					commitSha,
					parentCommitSha,
					lineageCase: 'terminated',
					evidence: {
						sourceEntityId: parentId,
						oldPath: parentSnap.path,
						oldBlobOid: parentSnap.blobOid,
						confidence: 1.0,
						details: `Entity terminated (deleted at ${parentSnap.path})`,
					},
				});
			}
		}

		return {
			entitySnapshots,
			pathToEntityId,
			lineageEvents,
			terminatedEntityIds,
		};
	}
}
