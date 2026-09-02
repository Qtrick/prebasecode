/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkRotation {
	readonly yaw: number;
	readonly pitch: number;
}

export interface NetworkTransform {
	readonly x: number;
	readonly y: number;
	readonly k: number;
}

export interface NetworkWorldPosition {
	readonly x: number;
	readonly y: number;
	readonly z?: number;
}

export interface NetworkRenderMetricsSnapshot {
	readonly transform: NetworkTransform;
	readonly rotation?: NetworkRotation;
	readonly lodTier?: string;
	readonly labelsDrawn?: number;
	readonly labelCount?: number;
	readonly edgesDrawn?: number;
	readonly nodesDrawn?: number;
	readonly projectedBounds?: {
		readonly minX: number;
		readonly minY: number;
		readonly maxX: number;
		readonly maxY: number;
		readonly width: number;
		readonly height: number;
	} | null;
	readonly screenUtilization?: number;
}
