/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export const TEMPORAL_STORE_CHANNEL_NAME = 'prebaseTemporalStore';

export interface ITemporalStoreMainService {
	/** Every main-process operation uses the same typed result envelope. */
	open(dbPath: string): Promise<string>;
	close(dbPath: string): Promise<string>;
	interrupt(dbPath: string): Promise<string>;
	invoke(dbPath: string, method: string, argumentsJson: string): Promise<string>;
	shutdown(): Promise<void>;
}

export type TemporalStoreIpcResponse =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly error: { readonly code: import('../../common/temporalErrors.js').TemporalErrorCode; readonly message: string } };

const MAP_MARKER = '$prebaseMap';

export function serializeTemporalStoreValue(value: unknown): string {
	// JSON.stringify(undefined) returns undefined rather than a transport value.
	// Store methods legitimately use undefined for a cache miss or void result, so
	// preserve it as the JSON null sentinel at this process boundary.
	return JSON.stringify(value, (_key, candidate) => candidate instanceof Map
		? { [MAP_MARKER]: Array.from(candidate.entries()) }
		: candidate) ?? 'null';
}

export function deserializeTemporalStoreValue<T>(value: string): T {
	return JSON.parse(value, (_key, candidate) => {
		if (candidate && typeof candidate === 'object' && Array.isArray(candidate[MAP_MARKER])) {
			return new Map(candidate[MAP_MARKER]);
		}
		return candidate;
	}) as T;
}
