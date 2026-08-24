/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveNetworkEdgeVisual } from '../../view/network/networkEdgeVisual.js';

/**
 * Serializes a self-contained function for injection into the sandboxed production
 * webview (no module system, strict CSP — the frame cannot import TS modules).
 *
 * Mechanism: `Function.prototype.toString()` on the already-compiled function. This works
 * identically from `graphs/src` (strip-types execution) and from transpiled `out/` output
 * provided the function is self-contained: it must reference only its parameters, locals
 * and literals — never surrounding module scope. Parity tests execute BOTH the serialized
 * copy and the original module symbol, so portability breakage or semantic drift fails CI.
 *
 * Called at HTML-build time only; never on a per-frame path.
 */
export function serializeSelfContainedFunction(fn: (...args: unknown[]) => unknown): string {
	const src = fn.toString();
	if (src.includes('=>')) {
		throw new Error('serializeSelfContainedFunction: arrow functions are not portable output; rewrite with function keyword');
	}
	return src;
}

/** Serialized source of the authoritative Network edge visual resolver. */
export function serializeNetworkEdgeVisualSource(): string {
	return serializeSelfContainedFunction(resolveNetworkEdgeVisual as (...args: unknown[]) => unknown);
}
