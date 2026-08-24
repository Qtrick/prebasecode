/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../common/temporalTypes.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
import type {
	TemporalStructuralDiff,
	TemporalRenderNode,
	TemporalRenderEdge,
	TemporalStructuralDiffSummary,
	TemporalNodeChangeKind,
	TemporalEdgeChangeKind,
} from './temporalViewTypes.js';

export interface TemporalStructuralDiffOptions {
	readonly isPartialLineage?: boolean;
	readonly partialLineageReason?: string;
	readonly gitDiffChanges?: readonly GitExactDiffChange[];
}

export interface ComparisonMatchEvidence {
	readonly matchKind: 'persisted-lineage' | 'git-rename' | 'same-path' | 'exact-content' | 'unmatched';
	readonly oldPath?: string;
	readonly similarity?: number;
}

const EMPTY_BLOB_HASHES = new Set([
	'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', // SHA-1 empty blob
	'4b825dc642cb6eb9a060e54bf8d69288fbee4904', // SHA-1 empty tree
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // SHA-256 empty blob
]);

function normalizePath(p: string | undefined): string {
	if (!p) return '';
	return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

export function computeTemporalStructuralDiff(
	targetCommitSha: string,
	targetEntities: readonly TemporalEntitySnapshot[],
	targetEdges: readonly TemporalEdgeSnapshot[],
	baseCommitSha?: string,
	baseEntities?: readonly TemporalEntitySnapshot[],
	baseEdges?: readonly TemporalEdgeSnapshot[],
	lineageOptions?: TemporalStructuralDiffOptions,
): TemporalStructuralDiff {
	const nodes: TemporalRenderNode[] = [];
	const edges: TemporalRenderEdge[] = [];

	let addedCount = 0;
	let removedCount = 0;
	let modifiedCount = 0;
	let renamedCount = 0;
	let renamedModifiedCount = 0;
	let unchangedCount = 0;
	let edgeAddedCount = 0;
	let edgeRemovedCount = 0;
	let edgeModifiedCount = 0;

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
		const baseBlobCounts = new Map<string, number>();
		for (const be of baseEntities) {
			baseEntityMap.set(be.entityId, be);
			const blob = be.blobOid || (be as any).contentIdentity || be.contentHash;
			if (blob) {
				baseBlobCounts.set(blob, (baseBlobCounts.get(blob) ?? 0) + 1);
			}
		}

		const targetEntityMap = new Map<string, TemporalEntitySnapshot>();
		const targetBlobCounts = new Map<string, number>();
		for (const te of targetEntities) {
			targetEntityMap.set(te.entityId, te);
			const blob = te.blobOid || (te as any).contentIdentity || te.contentHash;
			if (blob) {
				targetBlobCounts.set(blob, (targetBlobCounts.get(blob) ?? 0) + 1);
			}
		}

		// Cross-Commit Comparison Identity Resolution
		const matchedTargetEntityToBase = new Map<string, TemporalEntitySnapshot>();
		const matchedBaseEntityIds = new Set<string>();
		const targetMatchEvidence = new Map<string, ComparisonMatchEvidence>();

		// STEP 1 — SAME PERSISTED ENTITY ID (Highest-confidence persisted lineage)
		for (const te of targetEntities) {
			const be = baseEntityMap.get(te.entityId);
			if (be && !matchedBaseEntityIds.has(be.entityId)) {
				matchedTargetEntityToBase.set(te.entityId, be);
				matchedBaseEntityIds.add(be.entityId);
				targetMatchEvidence.set(te.entityId, { matchKind: 'persisted-lineage', oldPath: be.path });
			}
		}

		// STEP 2 — EXPLICIT GIT RENAME EVIDENCE (diff-tree -M rename detection)
		const gitDiffs = lineageOptions?.gitDiffChanges;
		if (gitDiffs && gitDiffs.length > 0) {
			for (const diff of gitDiffs) {
				if (diff.kind === 'renamed' && diff.oldPath && diff.path) {
					const normNew = normalizePath(diff.path);
					const normOld = normalizePath(diff.oldPath);

					const te = targetEntities.find(n => !matchedTargetEntityToBase.has(n.entityId) && normalizePath(n.path) === normNew);
					const be = baseEntities.find(n => !matchedBaseEntityIds.has(n.entityId) && normalizePath(n.path) === normOld);

					if (te && be) {
						matchedTargetEntityToBase.set(te.entityId, be);
						matchedBaseEntityIds.add(be.entityId);
						targetMatchEvidence.set(te.entityId, {
							matchKind: 'git-rename',
							oldPath: be.path,
							similarity: diff.similarity,
						});
					}
				}
			}
		}

		// STEP 3 — SAME NORMALIZED PATH (Same logical file across independently indexed cold anchors)
		for (const te of targetEntities) {
			if (matchedTargetEntityToBase.has(te.entityId)) {
				continue;
			}
			const normPath = normalizePath(te.path);
			const be = baseEntities.find(n => !matchedBaseEntityIds.has(n.entityId) && normalizePath(n.path) === normPath);
			if (be) {
				matchedTargetEntityToBase.set(te.entityId, be);
				matchedBaseEntityIds.add(be.entityId);
				targetMatchEvidence.set(te.entityId, { matchKind: 'same-path', oldPath: be.path });
			}
		}

		// STEP 4 — UNIQUE FULL BLOB / CONTENT IDENTITY MATCH (Unambiguous 1-to-1 exact moves/renames)
		const unmatchedBaseByBlob = new Map<string, TemporalEntitySnapshot[]>();
		for (const be of baseEntities) {
			if (matchedBaseEntityIds.has(be.entityId)) continue;
			const blob = be.blobOid || (be as any).contentIdentity || be.contentHash;
			if (blob && blob.length >= 7) {
				const list = unmatchedBaseByBlob.get(blob) ?? [];
				list.push(be);
				unmatchedBaseByBlob.set(blob, list);
			}
		}

		const unmatchedTargetByBlob = new Map<string, TemporalEntitySnapshot[]>();
		for (const te of targetEntities) {
			if (matchedTargetEntityToBase.has(te.entityId)) continue;
			const blob = te.blobOid || (te as any).contentIdentity || te.contentHash;
			if (blob && blob.length >= 7) {
				const list = unmatchedTargetByBlob.get(blob) ?? [];
				list.push(te);
				unmatchedTargetByBlob.set(blob, list);
			}
		}

		for (const [blob, targetList] of unmatchedTargetByBlob) {
			// Never pair empty files across different paths without explicit Git rename
			if (EMPTY_BLOB_HASHES.has(blob.toLowerCase())) {
				continue;
			}
			const baseList = unmatchedBaseByBlob.get(blob);
			const totalInBase = baseBlobCounts.get(blob) ?? 0;
			const totalInTarget = targetBlobCounts.get(blob) ?? 0;

			// Only pair if the blob is strictly unique (frequency == 1) in BOTH entire trees
			if (totalInBase === 1 && totalInTarget === 1 && targetList.length === 1 && baseList && baseList.length === 1) {
				const te = targetList[0];
				const be = baseList[0];
				if (!matchedTargetEntityToBase.has(te.entityId) && !matchedBaseEntityIds.has(be.entityId)) {
					matchedTargetEntityToBase.set(te.entityId, be);
					matchedBaseEntityIds.add(be.entityId);
					targetMatchEvidence.set(te.entityId, { matchKind: 'exact-content', oldPath: be.path });
				}
			}
		}

		// STEP 5 — CLASSIFY TARGET NODES (Matched vs Added)
		for (const te of targetEntities) {
			const be = matchedTargetEntityToBase.get(te.entityId);
			let changeKind: TemporalNodeChangeKind;
			let oldPath: string | undefined;
			let isModified = false;

			const teCanonicalId = (te as any).canonicalNodeId || te.nodeData?.id || te.path;
			const contentChanged = hasNodeContentChanged(te, be);

			if (!be) {
				changeKind = 'added';
				addedCount++;
			} else if (normalizePath(te.path) !== normalizePath(be.path)) {
				changeKind = 'renamed';
				oldPath = be.path;
				renamedCount++;
				isModified = contentChanged;
				if (isModified) {
					renamedModifiedCount++;
				}
			} else if (contentChanged) {
				changeKind = 'modified';
				modifiedCount++;
				isModified = true;
			} else {
				changeKind = 'unchanged';
				unchangedCount++;
			}

			const evidence = targetMatchEvidence.get(te.entityId);
			const metaObj = {
				...(te.nodeData as any),
				isRenamedAndModified: changeKind === 'renamed' && isModified,
				comparisonMatchKind: evidence?.matchKind || (changeKind === 'added' ? 'unmatched' : undefined),
			};

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
				isModified,
				meta: metaObj,
			});
		}

		// Check for removed entities present in base but absent in target
		for (const be of baseEntities) {
			if (!matchedBaseEntityIds.has(be.entityId)) {
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

		// Edge diffing with comparison identity mapping
		const targetEntityIdToBaseId = new Map<string, string>();
		for (const [tId, be] of matchedTargetEntityToBase) {
			targetEntityIdToBaseId.set(tId, be.entityId);
		}

		const baseEdgeById = new Map<string, TemporalEdgeSnapshot>();
		const baseEdgeByEndpoints = new Map<string, TemporalEdgeSnapshot>();
		const baseEdgeByPaths = new Map<string, TemporalEdgeSnapshot>();

		if (baseEdges) {
			for (const be of baseEdges) {
				baseEdgeById.set(be.edgeId, be);
				const bSrcPath = (be as any).sourcePath || baseEntityMap.get(be.sourceEntityId)?.path || '';
				const bTgtPath = (be as any).targetPath || baseEntityMap.get(be.targetEntityId)?.path || '';
				baseEdgeByEndpoints.set(`${be.sourceEntityId}:::${be.targetEntityId}:::${be.kind}`, be);
				if (bSrcPath && bTgtPath) {
					baseEdgeByPaths.set(`${normalizePath(bSrcPath)}:::${normalizePath(bTgtPath)}:::${be.kind}`, be);
				}
			}
		}

		const matchedBaseEdgeIds = new Set<string>();

		for (const tEdge of targetEdges) {
			const srcPath = (tEdge as any).sourcePath || targetEntityMap.get(tEdge.sourceEntityId)?.path || '';
			const tgtPath = (tEdge as any).targetPath || targetEntityMap.get(tEdge.targetEntityId)?.path || '';

			let bEdge = baseEdgeById.get(tEdge.edgeId);
			if (!bEdge) {
				const mappedSrcBaseId = targetEntityIdToBaseId.get(tEdge.sourceEntityId);
				const mappedTgtBaseId = targetEntityIdToBaseId.get(tEdge.targetEntityId);
				if (mappedSrcBaseId && mappedTgtBaseId) {
					bEdge = baseEdgeByEndpoints.get(`${mappedSrcBaseId}:::${mappedTgtBaseId}:::${tEdge.kind}`);
				}
			}
			if (!bEdge && srcPath && tgtPath) {
				bEdge = baseEdgeByPaths.get(`${normalizePath(srcPath)}:::${normalizePath(tgtPath)}:::${tEdge.kind}`);
			}

			if (bEdge) {
				matchedBaseEdgeIds.add(bEdge.edgeId);
			}

			let edgeChangeKind: TemporalEdgeChangeKind;
			if (!bEdge) {
				edgeChangeKind = 'added';
				edgeAddedCount++;
			} else if (hasEdgeDataChanged(tEdge.edgeData, bEdge.edgeData)) {
				edgeChangeKind = 'modified';
				edgeModifiedCount++;
			} else {
				edgeChangeKind = 'unchanged';
			}

			edges.push({
				edgeId: tEdge.edgeId,
				sourceEntityId: tEdge.sourceEntityId,
				targetEntityId: tEdge.targetEntityId,
				sourcePath: srcPath,
				targetPath: tgtPath,
				kind: tEdge.kind,
				changeKind: edgeChangeKind,
				edgeData: tEdge.edgeData as any,
			});
		}

		// Check for removed edges
		if (baseEdges) {
			for (const bEdge of baseEdges) {
				if (!matchedBaseEdgeIds.has(bEdge.edgeId)) {
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
		renamedModifiedCount,
		unchangedCount,
		edgeAddedCount,
		edgeRemovedCount,
		edgeModifiedCount,
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

function hasNodeContentChanged(te: TemporalEntitySnapshot, be?: TemporalEntitySnapshot): boolean {
	if (!be) {
		return false;
	}
	// 1. Direct blob OID / contentIdentity comparison
	const teBlob = te.blobOid || (te as any).contentIdentity;
	const beBlob = be.blobOid || (be as any).contentIdentity;
	if (teBlob && beBlob) {
		return teBlob !== beBlob;
	}

	// 2. Direct content hash comparison
	if (te.contentHash && be.contentHash) {
		return te.contentHash !== be.contentHash;
	}

	// 3. For in-place files (same path), if canonicalNodeId changed, content is modified
	if (te.path === be.path) {
		const teCanonical = (te as any).canonicalNodeId || te.nodeData?.id;
		const beCanonical = (be as any).canonicalNodeId || be.nodeData?.id;
		if (teCanonical && beCanonical && teCanonical !== beCanonical) {
			return true;
		}
	}

	// 4. Fallback: semantic comparison of nodeData excluding identity/path/layout fields
	if (te.nodeData && be.nodeData) {
		return hasNodeDataChanged(te.nodeData, be.nodeData);
	}

	return false;
}

function hasNodeDataChanged(a: any, b: any): boolean {
	if (!a && !b) return false;
	if (!a || !b) return true;

	if (a.kind && b.kind && a.kind !== b.kind) return true;

	const aMeta = a.meta || {};
	const bMeta = b.meta || {};

	if (aMeta.architectureLayer !== bMeta.architectureLayer) return true;
	if (aMeta.language !== bMeta.language) return true;
	if (aMeta.isComponent !== bMeta.isComponent) return true;
	if (aMeta.functionCount !== bMeta.functionCount) return true;
	if (aMeta.componentCount !== bMeta.componentCount) return true;

	if (!areStringArraysEquivalent(aMeta.exports, bMeta.exports)) return true;
	if (!areStringArraysEquivalent(aMeta.imports, bMeta.imports)) return true;

	return false;
}

function hasEdgeDataChanged(a: any, b: any): boolean {
	if (!a && !b) {
		return false;
	}
	if (!a || !b) {
		return true;
	}

	if (a.kind && b.kind && a.kind !== b.kind) {
		return true;
	}

	const aMeta = a.meta;
	const bMeta = b.meta;
	const aHasMeta = aMeta && Object.keys(aMeta).length > 0;
	const bHasMeta = bMeta && Object.keys(bMeta).length > 0;

	if (!aHasMeta && !bHasMeta) {
		return false;
	}
	if (!aHasMeta || !bHasMeta) {
		return true;
	}

	if (aMeta.importSource !== bMeta.importSource) return true;
	if (Boolean(aMeta.isDefault) !== Boolean(bMeta.isDefault)) return true;
	if (Boolean(aMeta.isDynamic) !== Boolean(bMeta.isDynamic)) return true;

	if (!areStringArraysEquivalent(aMeta.specifiers, bMeta.specifiers)) {
		return true;
	}

	const aKeys = Object.keys(aMeta).filter(k => k !== 'line' && k !== 'importSource' && k !== 'isDefault' && k !== 'isDynamic' && k !== 'specifiers');
	const bKeys = Object.keys(bMeta).filter(k => k !== 'line' && k !== 'importSource' && k !== 'isDefault' && k !== 'isDynamic' && k !== 'specifiers');

	if (aKeys.length !== bKeys.length) return true;
	for (const k of aKeys) {
		if (Array.isArray(aMeta[k]) && Array.isArray(bMeta[k])) {
			if (!areStringArraysEquivalent(aMeta[k], bMeta[k])) return true;
		} else if (aMeta[k] !== bMeta[k]) {
			return true;
		}
	}

	return false;
}

function areStringArraysEquivalent(a?: readonly string[], b?: readonly string[]): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	for (let i = 0; i < sortedA.length; i++) {
		if (sortedA[i] !== sortedB[i]) return false;
	}
	return true;
}
