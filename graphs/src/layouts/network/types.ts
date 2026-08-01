/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkLayoutNode {
	id: string;
	fileTypeId?: string;
	/** Label-propagation community id (Community Force layout). */
	communityId?: number;
	val?: number;
	isEntry?: boolean;
}

export interface NetworkLayoutLink {
	source: string;
	target: string;
}

export type NetworkLayoutMode =
	| 'community'
	| 'organic'
	| 'sphere'
	| 'constellation'
	| 'clustered'
	| 'radial';

export interface Point3D {
	x: number;
	y: number;
	z: number;
}
