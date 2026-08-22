/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../common/temporalTypes.js';
import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalStructuralDiffSummary,
	TemporalNodeChangeKind,
	TemporalEdgeChangeKind,
} from './temporalViewTypes.js';

export function computeTemporalStructuralDiff(
	targetCommitSha: string,
	targetEntities: readonly TemporalEntitySnapshot[],
	targetEdges: readonly TemporalEdgeSnapshot[],
	baseCommitSha?: string,
	baseEntities?: readonly TemporalEntitySnapshot[],
	baseEdges?: readonly TemporalEdgeSnapshot[],
	lineageOptions?: { isPartialLineage?: boolean; partialLineageReason?: string },
): TemporalStructuralDiff {
	const nodes: TemporalRenderNode[] = [];
	const edges: TemporalRenderEdge[] = [];

	let addedCount = 0;
	let removedCount = 0;
	let modifiedCount = 0;
	let renamedCount = 0;
	let unchangedCount = 0;
	let edgeAddedCount = 0;
	let edgeRemovedCount = 0;

	if (!baseCommitSha || !baseEntities) {
		// Root commit or no base: all nodes and edges are added
		for (const e of targetEntities) {
			const label = getLabelFromPath(e.path);
			const canonicalId = (e as any).canonicalNodeId || e.nodeData?.id || e.path;
			nodes.push({
				entityId: e.entityId,
				canonicalNodeId: canonicalId,
				path: e.path,
				label,
				kind: 'file',
				x: 0,
				y: 0,
				changeKind: 'added',
				meta: e.nodeData as any,
			});
			addedCount++;
		}

		for (const edge of targetEdges) {
			const srcPath = (edge as any).sourcePath || targetEntities.find(n => n.entityId === edge.sourceEntityId)?.path || '';
			const tgtPath = (edge as any).targetPath || targetEntities.find(n => n.entityId === edge.targetEntityId)?.path || '';
			edges.push({
				edgeId: edge.edgeId,
				sourceEntityId: edge.sourceEntityId,
				targetEntityId: edge.targetEntityId,
				sourcePath: srcPath,
				targetPath: tgtPath,
				kind: edge.kind,
				changeKind: 'added',
				edgeData: edge.edgeData as any,
			});
			edgeAddedCount++;
		}
	} else {
		const baseEntityMap = new Map<string, TemporalEntitySnapshot>();
		for (const be of baseEntities) {
			baseEntityMap.set(be.entityId, be);
		}

		const targetEntityMap = new Map<string, TemporalEntitySnapshot>();
		for (const te of targetEntities) {
			targetEntityMap.set(te.entityId, te);
			const be = baseEntityMap.get(te.entityId);
			let changeKind: TemporalNodeChangeKind;
			let oldPath: string | undefined;

			const teCanonicalId = (te as any).canonicalNodeId || te.nodeData?.id || te.path;
			const beCanonicalId = be ? ((be as any).canonicalNodeId || be.nodeData?.id || be.path) : undefined;

			if (!be) {
				changeKind = 'added';
				addedCount++;
			} else if (te.path !== be.path) {
				changeKind = 'renamed';
				oldPath = be.path;
				renamedCount++;
			} else if (
				(te.blobOid && be.blobOid && te.blobOid !== be.blobOid)
				|| (te.contentHash && be.contentHash && te.contentHash !== be.contentHash)
				|| (teCanonicalId !== beCanonicalId)
			) {
				changeKind = 'modified';
				modifiedCount++;
			} else {
				changeKind = 'unchanged';
				unchangedCount++;
			}

			nodes.push({
				entityId: te.entityId,
				canonicalNodeId: teCanonicalId,
				path: te.path,
				label: getLabelFromPath(te.path),
				kind: 'file',
				x: 0,
				y: 0,
				changeKind,
				oldPath,
				meta: te.nodeData as any,
			});
		}

		// Check for removed entities present in base but absent in target
		for (const be of baseEntities) {
			if (!targetEntityMap.has(be.entityId)) {
				const beCanonicalId = (be as any).canonicalNodeId || be.nodeData?.id || be.path;
				nodes.push({
					entityId: be.entityId,
					canonicalNodeId: beCanonicalId,
					path: be.path,
					label: getLabelFromPath(be.path),
					kind: 'file',
					x: 0,
					y: 0,
					changeKind: 'removed',
					meta: be.nodeData as any,
				});
				removedCount++;
			}
		}

		// Edge diffing
		const baseEdgeMap = new Map<string, TemporalEdgeSnapshot>();
		if (baseEdges) {
			for (const bEdge of baseEdges) {
				const key = makeEdgeKey(bEdge.sourceEntityId, bEdge.targetEntityId, bEdge.kind);
				baseEdgeMap.set(key, bEdge);
			}
		}

		const targetEdgeMap = new Map<string, TemporalEdgeSnapshot>();
		for (const tEdge of targetEdges) {
			const key = makeEdgeKey(tEdge.sourceEntityId, tEdge.targetEntityId, tEdge.kind);
			targetEdgeMap.set(key, tEdge);
			const inBase = baseEdgeMap.has(key);
			const changeKind: TemporalEdgeChangeKind = inBase ? 'unchanged' : 'added';
			if (!inBase) {
				edgeAddedCount++;
			}
			const srcPath = (tEdge as any).sourcePath || targetEntityMap.get(tEdge.sourceEntityId)?.path || '';
			const tgtPath = (tEdge as any).targetPath || targetEntityMap.get(tEdge.targetEntityId)?.path || '';
			edges.push({
				edgeId: tEdge.edgeId,
				sourceEntityId: tEdge.sourceEntityId,
				targetEntityId: tEdge.targetEntityId,
				sourcePath: srcPath,
				targetPath: tgtPath,
				kind: tEdge.kind,
				changeKind,
				edgeData: tEdge.edgeData as any,
			});
		}

		if (baseEdges) {
			for (const bEdge of baseEdges) {
				const key = makeEdgeKey(bEdge.sourceEntityId, bEdge.targetEntityId, bEdge.kind);
				if (!targetEdgeMap.has(key)) {
					const srcPath = (bEdge as any).sourcePath || baseEntityMap.get(bEdge.sourceEntityId)?.path || '';
					const tgtPath = (bEdge as any).targetPath || baseEntityMap.get(bEdge.targetEntityId)?.path || '';
					edges.push({
						edgeId: bEdge.edgeId,
						sourceEntityId: bEdge.sourceEntityId,
						targetEntityId: bEdge.targetEntityId,
						sourcePath: srcPath,
						targetPath: tgtPath,
						kind: bEdge.kind,
						changeKind: 'removed',
						edgeData: bEdge.edgeData as any,
					});
					edgeRemovedCount++;
				}
			}
		}
	}

	const summary: TemporalStructuralDiffSummary = {
		addedCount,
		removedCount,
		modifiedCount,
		renamedCount,
		unchangedCount,
		edgeAddedCount,
		edgeRemovedCount,
	};

	return {
		targetCommitSha,
		baseCommitSha,
		nodes,
		edges,
		summary,
		isPartialLineage: Boolean(lineageOptions?.isPartialLineage),
		partialLineageReason: lineageOptions?.partialLineageReason,
	};
}

function getLabelFromPath(p: string): string {
	const lastSlash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
	return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}

function makeEdgeKey(sourceEntityId: string, targetEntityId: string, kind: string): string {
	return `${sourceEntityId}-->${targetEntityId}::${kind}`;
}
