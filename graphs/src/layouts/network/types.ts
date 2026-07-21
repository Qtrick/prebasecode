/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface NetworkLayoutNode {
	id: string;
	fileTypeId?: string;
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
	| 'clustered'
	| 'radial'

export interface Point3D {
	x: number
	y: number
	z: number
}
