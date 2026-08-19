/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphVersionMetadata } from '../../common/types/canonicalTypes.js';

export const GRAPH_SCHEMA_VERSION = 1;
export const GRAPH_ANALYZER_VERSION = 1;
export const GRAPH_IDENTITY_VERSION = 1;
export const GRAPH_LAYOUT_VERSION = 1;
export const GRAPH_ANALYSIS_PROFILE_VERSION = 1;

export function createCurrentVersionMetadata(): GraphVersionMetadata {
	return {
		graphSchemaVersion: GRAPH_SCHEMA_VERSION,
		analyzerVersion: GRAPH_ANALYZER_VERSION,
		identityVersion: GRAPH_IDENTITY_VERSION,
		layoutVersion: GRAPH_LAYOUT_VERSION,
		analysisProfileVersion: GRAPH_ANALYSIS_PROFILE_VERSION,
	};
}

export function isGraphSchemaCompatible(metadata: Partial<GraphVersionMetadata> | undefined): boolean {
	if (!metadata || typeof metadata.graphSchemaVersion !== 'number') {
		return false;
	}
	return metadata.graphSchemaVersion === GRAPH_SCHEMA_VERSION;
}

export function isAnalyzerCompatible(metadata: Partial<GraphVersionMetadata> | undefined): boolean {
	if (!metadata || typeof metadata.analyzerVersion !== 'number') {
		return false;
	}
	return metadata.analyzerVersion === GRAPH_ANALYZER_VERSION;
}

export function isComparableSnapshots(
	a: { versions?: Partial<GraphVersionMetadata> },
	b: { versions?: Partial<GraphVersionMetadata> }
): boolean {
	if (!a.versions || !b.versions) {
		return false; // Fail closed if semantic version metadata is missing
	}
	return (
		typeof a.versions.graphSchemaVersion === 'number' &&
		typeof b.versions.graphSchemaVersion === 'number' &&
		a.versions.graphSchemaVersion === b.versions.graphSchemaVersion &&
		a.versions.identityVersion === b.versions.identityVersion &&
		a.versions.analyzerVersion === b.versions.analyzerVersion &&
		(a.versions.analysisProfileVersion ?? 1) === (b.versions.analysisProfileVersion ?? 1)
	);
}
