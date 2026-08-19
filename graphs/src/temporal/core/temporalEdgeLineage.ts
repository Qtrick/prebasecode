/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	GraphEdgeData,
	TemporalEdgeKind,
	TemporalEdgeSnapshot,
	TemporalEntitySnapshot,
} from '../common/temporalTypes.js';

export interface RawEdgeInfo {
	readonly sourcePath: string;
	readonly targetPath: string;
	readonly kind: TemporalEdgeKind;
	readonly weight?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface EdgeResolutionInput {
	readonly commitSha: string;
	readonly entitySnapshots: ReadonlyMap<string, TemporalEntitySnapshot>;
	readonly pathToEntityId: ReadonlyMap<string, string>;
	readonly rawEdges: readonly RawEdgeInfo[];
}

export function computeEdgeId(sourceEntityId: string, targetEntityId: string, kind: TemporalEdgeKind): string {
	return `${sourceEntityId}->${targetEntityId}:${kind}`;
}

export class TemporalEdgeLineageResolver {
	/**
	 * Resolves structural graph edges to stable cross-commit edge snapshots.
	 */
	resolveEdges(input: EdgeResolutionInput): Map<string, TemporalEdgeSnapshot> {
		const { commitSha, entitySnapshots, pathToEntityId, rawEdges } = input;
		const edgeMap = new Map<string, TemporalEdgeSnapshot>();

		for (const raw of rawEdges) {
			const sourceEntityId = pathToEntityId.get(raw.sourcePath);
			if (!sourceEntityId || !entitySnapshots.has(sourceEntityId)) {
				continue;
			}

			let targetEntityId = pathToEntityId.get(raw.targetPath);
			if (!targetEntityId) {
				const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.js'];
				for (const ext of extensions) {
					const candidate = `${raw.targetPath}${ext}`;
					if (pathToEntityId.has(candidate)) {
						targetEntityId = pathToEntityId.get(candidate);
						break;
					}
				}
			}
			if (!targetEntityId) {
				// Target might be external module or package
				targetEntityId = `ext_${raw.targetPath.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
			}

			const edgeId = computeEdgeId(sourceEntityId, targetEntityId, raw.kind);
			const sourceSnap = entitySnapshots.get(sourceEntityId);
			const targetSnap = entitySnapshots.get(targetEntityId);

			const edgeData: GraphEdgeData = {
				id: edgeId,
				source: sourceSnap ? sourceSnap.nodeData.id : sourceEntityId,
				target: targetSnap ? targetSnap.nodeData.id : targetEntityId,
				kind: 'import',
				meta: {
					importSource: raw.targetPath,
				},
			};

			edgeMap.set(edgeId, {
				edgeId,
				commitSha,
				sourceEntityId,
				targetEntityId,
				kind: raw.kind,
				edgeData,
			});
		}

		return edgeMap;
	}
}
