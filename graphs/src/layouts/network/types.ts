/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkLayoutNode {
	id: string;
	fileTypeId?: string;
	architectureLayer?: string;
	path?: string;
	val?: number;
	isEntry?: boolean;
}

export interface NetworkLayoutLink {
	source: string;
	target: string;
}

export type NetworkLayoutMode =
	| 'organic'
	| 'sphere'
	| 'constellation'
	| 'clustered';

/** Persisted values that are no longer product modes. */
export const LEGACY_NETWORK_LAYOUT_MODES = ['radial'] as const;

export interface Point3D {
	x: number;
	y: number;
	z: number;
}

/** Runtime controls consumed by deterministic Network layout engines. */
export interface NetworkLayoutRuntimeConfig {
	sphereRadius: number;
	/** Effective per-node radius; nodes are separated by roughly twice this value. */
	collisionRadius: number;
	/** Preferred center-to-center length for links when a layout applies link relaxation. */
	linkDistance: number;
	/** Scales bounded link relaxation without changing a layout's semantic structure. */
	forceStrength: number;
}
