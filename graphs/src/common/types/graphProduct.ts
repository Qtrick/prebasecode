/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Product graph type. Phase D unifies Architecture/Network into one Code Graph.
 * Legacy `'architecture' | 'network'` remain for restore/serializer coerce until fully dropped.
 */
export type PreBaseGraphType = 'architecture' | 'network' | 'code';

/** True when the Network/Code canvas path should render. */
export function isCodeGraphCanvas(t: PreBaseGraphType | string | null | undefined): boolean {
	return t === 'code' || t === 'network';
}

/**
 * Legacy restore / open-path coercion: architecture, network, missing, and unknown → `'code'`.
 * Single product surface; Architecture LayoutEngine sources are preserved under
 * `graphs/src/preserved/architecture/` and are not imported by the active runtime.
 */
export function normalizeToCodeGraphType(_raw: unknown): PreBaseGraphType {
	return 'code';
}
