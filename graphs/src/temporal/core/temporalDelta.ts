/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CURRENT_DELTA_VERSION } from '../common/temporalVersioning.js';
import { computeCanonicalGraphDigest } from '../../core/canonical/canonicalGraphDigest.js';
import { TemporalError } from '../common/temporalErrors.js';
import type {
	ArchitectureGraphData,
	GraphNodeData,
	GraphEdgeData,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
	TemporalGraphSnapshot,
	TemporalStructuralDelta,
} from '../common/temporalTypes.js';

function areStringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function areNodesStructurallyEqual(a: TemporalEntitySnapshot, b: TemporalEntitySnapshot): boolean {
	if (a.path !== b.path) return false;
	if (a.blobOid !== b.blobOid || a.contentHash !== b.contentHash) return false;

	const an: GraphNodeData | undefined = a.nodeData;
	const bn: GraphNodeData | undefined = b.nodeData;
	if (!an || !bn) return an === bn;

	if (an.id !== bn.id) return false;
	if (an.kind !== bn.kind) return false;
	if (Boolean(an.isEntry) !== Boolean(bn.isEntry)) return false;
	if ((an.meta?.architectureLayer ?? null) !== (bn.meta?.architectureLayer ?? null)) return false;
	if ((an.meta?.language ?? null) !== (bn.meta?.language ?? null)) return false;

	if (!areStringArraysEqual(an.meta?.exports, bn.meta?.exports)) return false;
	if (!areStringArraysEqual(an.meta?.imports, bn.meta?.imports)) return false;

	return true;
}

function areEdgesStructurallyEqual(a: TemporalEdgeSnapshot, b: TemporalEdgeSnapshot): boolean {
	if (a.kind !== b.kind) return false;
	if (a.sourceEntityId !== b.sourceEntityId || a.targetEntityId !== b.targetEntityId) return false;

	const ae: GraphEdgeData | undefined = a.edgeData;
	const be: GraphEdgeData | undefined = b.edgeData;
	if (!ae || !be) return ae === be;

	if (ae.id !== be.id) return false;
	if (ae.source !== be.source || ae.target !== be.target) return false;
	if (ae.kind !== be.kind) return false;

	if (!areStringArraysEqual(ae.meta?.specifiers, be.meta?.specifiers)) return false;

	return true;
}

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
				if (!areNodesStructurallyEqual(parentEntity, currentEntity)) {
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
			} else if (!areEdgesStructurallyEqual(parentEdge, currentEdge)) {
				edgesModified.push(currentEdge);
			}
		}

		// Check deleted edges
		for (const [edgeId] of parentEdgeMap) {
			if (!currentSnap.edgeMap.has(edgeId)) {
				edgesDeleted.push(edgeId);
			}
		}

		const baseCommitSha = parentSnap?.commitSha ?? '';
		const targetCanonicalDigest = currentSnap.digest || currentSnap.canonicalSnapshot?.digest;
		const targetCanonicalMetadata = currentSnap.canonicalSnapshot ? {
			projectPath: currentSnap.canonicalSnapshot.projectPath,
			projectName: currentSnap.canonicalSnapshot.projectName,
			entryNodeId: currentSnap.canonicalSnapshot.entryNodeId,
			analyzedAt: currentSnap.canonicalSnapshot.analyzedAt,
			sourceIdentity: currentSnap.canonicalSnapshot.sourceIdentity,
			versions: currentSnap.canonicalSnapshot.versions,
			coverage: currentSnap.canonicalSnapshot.coverage,
			completeness: currentSnap.canonicalSnapshot.completeness,
			manifest: currentSnap.canonicalSnapshot.manifest,
		} : undefined;

		return {
			commitSha: currentSnap.commitSha,
			baseCommitSha,
			parentCommitSha: baseCommitSha,
			targetCanonicalDigest,
			targetTimestamp: currentSnap.timestamp,
			targetCanonicalMetadata,
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

		// A reconstructed target is an occurrence at the target commit even when
		// its structural content was preserved from the base state.
		for (const [entityId, entity] of newEntityMap) {
			if (entity.commitSha !== delta.commitSha) {
				newEntityMap.set(entityId, { ...entity, commitSha: delta.commitSha });
			}
		}
		for (const [edgeId, edge] of newEdgeMap) {
			if (edge.commitSha !== delta.commitSha) {
				newEdgeMap.set(edgeId, { ...edge, commitSha: delta.commitSha });
			}
		}

		// 8. Reconstruct ArchitectureGraphData with deterministic sorting
		const nodes = Array.from(newEntityMap.values()).map(e => e.nodeData);
		const edges = Array.from(newEdgeMap.values()).map(e => e.edgeData);

		const stableCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
		const sortedNodes = [...nodes].sort((a, b) => stableCompare(a.id, b.id));
		const sortedEdges = [...edges].sort((a, b) => stableCompare(a.id, b.id));

		const targetTimestamp = delta.targetTimestamp ?? delta.targetCanonicalMetadata?.analyzedAt ?? baseSnap.timestamp;
		const graphData: ArchitectureGraphData = {
			nodes: sortedNodes,
			edges: sortedEdges,
			timestamp: targetTimestamp,
		};

		const entryNodeId = delta.targetCanonicalMetadata?.entryNodeId ?? baseSnap.canonicalSnapshot?.entryNodeId ?? null;
		const derivedDigest = computeCanonicalGraphDigest({
			nodes: sortedNodes,
			edges: sortedEdges,
			entryNodeId,
		});
		if (delta.targetCanonicalDigest && derivedDigest !== delta.targetCanonicalDigest) {
			throw new TemporalError(
				'DatabaseCorrupted',
				`Reconstructed canonical content for '${delta.commitSha}' does not match its stored digest`
			);
		}

		const canonicalMetadata = delta.targetCanonicalMetadata ?? (baseSnap.canonicalSnapshot ? {
			projectPath: baseSnap.canonicalSnapshot.projectPath,
			projectName: baseSnap.canonicalSnapshot.projectName,
			entryNodeId: baseSnap.canonicalSnapshot.entryNodeId,
			analyzedAt: targetTimestamp,
			sourceIdentity: baseSnap.canonicalSnapshot.sourceIdentity,
			versions: baseSnap.canonicalSnapshot.versions,
			coverage: baseSnap.canonicalSnapshot.coverage,
			completeness: baseSnap.canonicalSnapshot.completeness,
			manifest: baseSnap.canonicalSnapshot.manifest,
		} : undefined);

		return {
			schemaVersion: baseSnap.schemaVersion,
			analyzerVersion: baseSnap.analyzerVersion,
			profileVersion: baseSnap.profileVersion,
			commitSha: delta.commitSha,
			timestamp: targetTimestamp,
			isCheckpoint,
			digest: derivedDigest,
			canonicalSnapshot: canonicalMetadata ? {
				...canonicalMetadata,
				nodes: sortedNodes,
				edges: sortedEdges,
				digest: derivedDigest,
			} : undefined,
			graphData,
			entityMap: newEntityMap,
			edgeMap: newEdgeMap,
			pathToEntityId: newPathToEntityId,
		};
	}
}
