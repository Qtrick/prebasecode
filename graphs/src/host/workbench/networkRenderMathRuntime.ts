/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { serializeSelfContainedFunction } from './networkEdgeVisualRuntime.js';
import {
	computeDepthAlpha,
	computeNetworkFitTransform,
	computeNetworkLabelWorldFontSize,
	computeNetworkPickRadius,
	computeNetworkVisualRadius,
} from '../../view/network/networkRenderMath.js';

export function serializeNetworkVisualRadiusSource(): string {
	return serializeSelfContainedFunction(computeNetworkVisualRadius as (...args: unknown[]) => unknown);
}

export function serializeNetworkPickRadiusSource(): string {
	return serializeSelfContainedFunction(computeNetworkPickRadius as (...args: unknown[]) => unknown);
}

export function serializeNetworkFitTransformSource(): string {
	return serializeSelfContainedFunction(computeNetworkFitTransform as (...args: unknown[]) => unknown);
}

export function serializeNetworkDepthAlphaSource(): string {
	return serializeSelfContainedFunction(computeDepthAlpha as (...args: unknown[]) => unknown);
}

export function serializeNetworkLabelWorldFontSizeSource(): string {
	return serializeSelfContainedFunction(computeNetworkLabelWorldFontSize as (...args: unknown[]) => unknown);
}
