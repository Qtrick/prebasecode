/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal CancellationToken shim for graph unit tests when out/vs is not compiled.
 * Matches the surface used by graphs host services under strip-types execution.
 */
export interface CancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested: (listener: (e: void) => unknown, thisArgs?: unknown) => { dispose(): void };
}

const noopDisposable = { dispose() {} };
const noneEvent = Object.freeze(() => noopDisposable);
const shortcutEvent = Object.freeze((callback: (e: void) => unknown, context?: unknown) => {
	const handle = setTimeout(callback.bind(context), 0);
	return { dispose() { clearTimeout(handle); } };
});

function isCancellationToken(thing: unknown): thing is CancellationToken {
	if (thing === CancellationToken.None || thing === CancellationToken.Cancelled) {
		return true;
	}
	if (!thing || typeof thing !== 'object') {
		return false;
	}
	return typeof (thing as CancellationToken).isCancellationRequested === 'boolean'
		&& typeof (thing as CancellationToken).onCancellationRequested === 'function';
}

export const CancellationToken = {
	isCancellationToken,
	None: Object.freeze({
		isCancellationRequested: false,
		onCancellationRequested: noneEvent,
	}),
	Cancelled: Object.freeze({
		isCancellationRequested: true,
		onCancellationRequested: shortcutEvent,
	}),
};
