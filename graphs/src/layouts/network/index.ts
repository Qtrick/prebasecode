/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type {
	NetworkLayoutLink,
	NetworkLayoutMode,
	NetworkLayoutNode,
	NetworkLayoutRuntimeConfig,
	Point3D,
} from './types.js';

import type { NetworkLayoutLink, NetworkLayoutMode, NetworkLayoutNode, NetworkLayoutRuntimeConfig, Point3D } from './types.js';
import { LEGACY_NETWORK_LAYOUT_MODES } from './types.js';
import { layoutClustered } from './clusteredLayout.js';
import { layoutConstellation } from './constellationLayout.js';
import { layoutOrganic } from './organicLayout.js';
import { layoutSphere } from './sphereLayout.js';

export { LEGACY_NETWORK_LAYOUT_MODES } from './types.js';

export const NETWORK_LAYOUT_MODES: readonly NetworkLayoutMode[] = ['organic', 'sphere', 'constellation', 'clustered'];
export const DEFAULT_NETWORK_LAYOUT_MODE: NetworkLayoutMode = 'organic';

/** Maps unknown or retired persisted values (including `"radial"`) to a supported mode. */
export function normalizeNetworkLayoutMode(mode: string | undefined | null): NetworkLayoutMode {
	if (mode && (NETWORK_LAYOUT_MODES as readonly string[]).includes(mode)) {
		return mode as NetworkLayoutMode;
	}
	return DEFAULT_NETWORK_LAYOUT_MODE;
}

export function isLegacyNetworkLayoutMode(mode: string | undefined | null): boolean {
	return typeof mode === 'string' && (LEGACY_NETWORK_LAYOUT_MODES as readonly string[]).includes(mode);
}

export function computeNetworkSphereRadius(nodeCount: number, spreadScale: number): number {
	return Math.max(190, Math.min(310, Math.sqrt(Math.max(1, nodeCount)) * 22)) * spreadScale;
}

export const DEFAULT_NETWORK_LAYOUT_CONFIG: NetworkLayoutRuntimeConfig = {
	sphereRadius: 240,
	collisionRadius: 24,
	linkDistance: 80,
	forceStrength: 0.35,
};

function normalizeNetworkLayoutConfig(configOrRadius: NetworkLayoutRuntimeConfig | number | undefined): NetworkLayoutRuntimeConfig {
	const supplied: Partial<NetworkLayoutRuntimeConfig> | undefined = typeof configOrRadius === 'number' ? { sphereRadius: configOrRadius } : configOrRadius;
	return {
		sphereRadius: Math.max(40, supplied?.sphereRadius ?? DEFAULT_NETWORK_LAYOUT_CONFIG.sphereRadius),
		collisionRadius: Math.max(2, supplied?.collisionRadius ?? DEFAULT_NETWORK_LAYOUT_CONFIG.collisionRadius),
		linkDistance: Math.max(4, supplied?.linkDistance ?? DEFAULT_NETWORK_LAYOUT_CONFIG.linkDistance),
		forceStrength: Math.max(0, Math.min(2, supplied?.forceStrength ?? DEFAULT_NETWORK_LAYOUT_CONFIG.forceStrength)),
	};
}

export function layoutNetworkGraph(
	mode: NetworkLayoutMode,
	nodes: NetworkLayoutNode[],
	links: NetworkLayoutLink[],
	configOrRadius: NetworkLayoutRuntimeConfig | number = DEFAULT_NETWORK_LAYOUT_CONFIG
): Map<string, Point3D> {
	const config = normalizeNetworkLayoutConfig(configOrRadius);
	switch (mode) {
		case 'sphere':
			return layoutSphere(nodes, links, config);
		case 'constellation':
			return layoutConstellation(nodes, links, config);
		case 'clustered':
			return layoutClustered(nodes, links, config);
		case 'organic':
		default:
			return layoutOrganic(nodes, links, config);
	}
}

export const NETWORK_LAYOUT_OPTIONS: {
	id: NetworkLayoutMode;
	label: string;
	blurb: string;
}[] = [
	{
		id: 'organic',
		label: 'Organic',
		blurb: 'Balanced natural cloud — default startup arrangement.'
	},
	{
		id: 'sphere',
		label: 'Sphere',
		blurb: 'Tight even 3D shell with minimal link pull.'
	},
	{
		id: 'constellation',
		label: 'Constellation',
		blurb: 'Connected files pull closer in 3D space.'
	},
	{
		id: 'clustered',
		label: 'Clustered',
		blurb: 'Groups by file type in separate 3D clusters.'
	}
];
