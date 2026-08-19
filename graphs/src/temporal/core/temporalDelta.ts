/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CURRENT_DELTA_VERSION } from '../common/temporalVersioning.js';
import type {
	ArchitectureGraphData,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../common/temporalTypes.js';

export class TemporalDeltaEngine {
	/**
	 * Computes the forward structural delta from a parent snapshot to a current snapshot.
	 */
	computeDelta(
		currentSnap: TemporalGraphSnapshot,
		parentSnap?: TemporalGraphSnapshot
	): TemporalStructuralDelta {
		const parentEntityMap = parentSnap?.entityMap ?? new Map<string, TemporalEntitySnapshot>();
		const parentEdgeMap = parentSnap?.edgeMap ?? new Map<string, TemporalEdgeSnapshot>();

		const entitiesAdded: TemporalEntitySnapshot[] = [];
		const entitiesModified: TemporalEntitySnapshot[] = [];
		const entitiesDeleted: string[] = [];
		const entitiesRenamed: Array<{ entityId: string; oldPath: string; newPath: string }> = [];

		const edgesAdded: TemporalEdgeSnapshot[] = [];
		const edgesModified: TemporalEdgeSnapshot[] = [];
		const edgesDeleted: string[] = [];

		// Check current entities against parent
		for (const [entityId, currentEntity] of currentSnap.entityMap) {
			const parentEntity = parentEntityMap.get(entityId);
			if (!parentEntity) {
				entitiesAdded.push(currentEntity);
			} else {
				if (parentEntity.path !== currentEntity.path) {
					entitiesRenamed.push({
						entityId,
						oldPath: parentEntity.path,
						newPath: currentEntity.path,
					});
				}
				const isContentChanged = currentEntity.blobOid !== parentEntity.blobOid ||
					currentEntity.contentHash !== parentEntity.contentHash;
				if (isContentChanged || parentEntity.path !== currentEntity.path) {
					entitiesModified.push(currentEntity);
				}
			}
		}

		// Check deleted entities
		for (const [entityId] of parentEntityMap) {
			if (!currentSnap.entityMap.has(entityId)) {
				entitiesDeleted.push(entityId);
			}
		}

		// Check current edges against parent
		for (const [edgeId, currentEdge] of currentSnap.edgeMap) {
			const parentEdge = parentEdgeMap.get(edgeId);
			if (!parentEdge) {
				edgesAdded.push(currentEdge);
			} else if (
				parentEdge.kind !== currentEdge.kind ||
				parentEdge.edgeData.source !== currentEdge.edgeData.source ||
				parentEdge.edgeData.target !== currentEdge.edgeData.target
			) {
				edgesModified.push(currentEdge);
			}
		}

		// Check deleted edges
		for (const [edgeId] of parentEdgeMap) {
			if (!currentSnap.edgeMap.has(edgeId)) {
				edgesDeleted.push(edgeId);
			}
		}

		return {
			commitSha: currentSnap.commitSha,
			parentCommitSha: parentSnap?.commitSha ?? '',
			deltaVersion: CURRENT_DELTA_VERSION,
			entitiesAdded,
			entitiesModified,
			entitiesDeleted,
			entitiesRenamed,
			edgesAdded,
			edgesModified,
			edgesDeleted,
		};
	}

	/**
	 * Applies a forward structural delta onto a base snapshot to produce a new snapshot.
	 */
	applyDelta(
		baseSnap: TemporalGraphSnapshot,
		delta: TemporalStructuralDelta,
		isCheckpoint: boolean = false
	): TemporalGraphSnapshot {
		const newEntityMap = new Map<string, TemporalEntitySnapshot>(baseSnap.entityMap);
		const newEdgeMap = new Map<string, TemporalEdgeSnapshot>(baseSnap.edgeMap);
		const newPathToEntityId = new Map<string, string>(baseSnap.pathToEntityId);

		// 1. Remove deleted entities
		for (const entityId of delta.entitiesDeleted) {
			const existing = newEntityMap.get(entityId);
			if (existing) {
				newPathToEntityId.delete(existing.path);
				newEntityMap.delete(entityId);
			}
		}

		// 2. Remove deleted edges
		for (const edgeId of delta.edgesDeleted) {
			newEdgeMap.delete(edgeId);
		}

		// 3. Process renamed entities
		for (const rename of delta.entitiesRenamed) {
			newPathToEntityId.delete(rename.oldPath);
			newPathToEntityId.set(rename.newPath, rename.entityId);
		}

		// 4. Upsert modified entities
		for (const mod of delta.entitiesModified) {
			newEntityMap.set(mod.entityId, mod);
			newPathToEntityId.set(mod.path, mod.entityId);
		}

		// 5. Insert added entities
		for (const added of delta.entitiesAdded) {
			newEntityMap.set(added.entityId, added);
			newPathToEntityId.set(added.path, added.entityId);
		}

		// 6. Upsert modified edges
		for (const mod of delta.edgesModified) {
			newEdgeMap.set(mod.edgeId, mod);
		}

		// 7. Insert added edges
		for (const added of delta.edgesAdded) {
			newEdgeMap.set(added.edgeId, added);
		}

		// 8. Reconstruct ArchitectureGraphData with deterministic sorting
		const nodes = Array.from(newEntityMap.values()).map(e => e.nodeData);
		const edges = Array.from(newEdgeMap.values()).map(e => e.edgeData);

		const stableCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
		const sortedNodes = [...nodes].sort((a, b) => stableCompare(a.id, b.id));
		const sortedEdges = [...edges].sort((a, b) => stableCompare(a.id, b.id));

		const graphData: ArchitectureGraphData = {
			nodes: sortedNodes,
			edges: sortedEdges,
			timestamp: baseSnap.timestamp,
		};

		return {
			schemaVersion: baseSnap.schemaVersion,
			analyzerVersion: baseSnap.analyzerVersion,
			profileVersion: baseSnap.profileVersion,
			commitSha: delta.commitSha,
			timestamp: baseSnap.timestamp,
			isCheckpoint,
			graphData,
			entityMap: newEntityMap,
			edgeMap: newEdgeMap,
			pathToEntityId: newPathToEntityId,
		};
	}
}
