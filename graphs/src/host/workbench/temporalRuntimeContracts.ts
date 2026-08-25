/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { serializeSelfContainedFunction, serializeNetworkEdgeVisualSource } from './networkEdgeVisualRuntime.js';
import { computeTemporalUnifiedStatus } from '../../temporal/view/temporalStatusModel.js';
import {
	computeTemporalFocusContext,
	computeTemporalVisualRadius,
	computeTemporalFitTransform,
} from '../../view/temporal/temporalFocusContext.js';

import {
	computeCommunityAggregateEdges,
	computeEdgeLodStyle,
} from '../../temporal/view/temporalEdgeLod.js';
import {
	computeVisibleLabels,
} from '../../temporal/view/temporalLabelLod.js';

/**
 * Serialized source of the authoritative Temporal unified status resolver.
 * Injected into the production webview so host, sidebar, and webview share 100% exact semantics.
 */
export function serializeTemporalUnifiedStatusSource(): string {
	return serializeSelfContainedFunction(computeTemporalUnifiedStatus as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Focus+Context projection computation.
 */
export function serializeTemporalFocusContextSource(): string {
	return serializeSelfContainedFunction(computeTemporalFocusContext as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Temporal node visual radius computation.
 */
export function serializeTemporalVisualRadiusSource(): string {
	return serializeSelfContainedFunction(computeTemporalVisualRadius as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Temporal Fit View transform computation.
 */
export function serializeTemporalFitTransformSource(): string {
	return serializeSelfContainedFunction(computeTemporalFitTransform as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Temporal Community Aggregate Edges computation.
 */
export function serializeTemporalCommunityAggregateEdgesSource(): string {
	return serializeSelfContainedFunction(computeCommunityAggregateEdges as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Temporal Edge LOD Style computation.
 */
export function serializeTemporalEdgeLodStyleSource(): string {
	return serializeSelfContainedFunction(computeEdgeLodStyle as (...args: unknown[]) => unknown);
}

/**
 * Serialized source of the authoritative Temporal Visible Labels LOD computation.
 */
export function serializeTemporalVisibleLabelsSource(): string {
	return serializeSelfContainedFunction(computeVisibleLabels as (...args: unknown[]) => unknown);
}

/**
 * Helper for test harnesses to interpolate all injected functions into extracted webview scripts.
 */
export function interpolateWebviewScript(script: string, generation = '42', initialGraphType = 'network'): string {
	return script
		.replace('${generation}', generation)
		.replace('${initialGraphType}', initialGraphType)
		.replace('${serializeNetworkEdgeVisualSource()}', serializeNetworkEdgeVisualSource())
		.replace('${serializeTemporalUnifiedStatusSource()}', serializeTemporalUnifiedStatusSource())
		.replace('${serializeTemporalFocusContextSource()}', serializeTemporalFocusContextSource())
		.replace('${serializeTemporalVisualRadiusSource()}', serializeTemporalVisualRadiusSource())
		.replace('${serializeTemporalFitTransformSource()}', serializeTemporalFitTransformSource())
		.replace('${serializeTemporalCommunityAggregateEdgesSource()}', serializeTemporalCommunityAggregateEdgesSource())
		.replace('${serializeTemporalEdgeLodStyleSource()}', serializeTemporalEdgeLodStyleSource())
		.replace('${serializeTemporalVisibleLabelsSource()}', serializeTemporalVisibleLabelsSource());
}

