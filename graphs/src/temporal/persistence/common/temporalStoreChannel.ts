/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export const TEMPORAL_STORE_CHANNEL_NAME = 'prebaseTemporalStore';

export interface ITemporalStoreMainService {
	open(dbPath: string): Promise<void>;
	close(dbPath: string): Promise<void>;
	invoke(dbPath: string, method: string, argumentsJson: string): Promise<string>;
}

const MAP_MARKER = '$prebaseMap';

export function serializeTemporalStoreValue(value: unknown): string {
	return JSON.stringify(value, (_key, candidate) => candidate instanceof Map
		? { [MAP_MARKER]: Array.from(candidate.entries()) }
		: candidate);
}

export function deserializeTemporalStoreValue<T>(value: string): T {
	return JSON.parse(value, (_key, candidate) => {
		if (candidate && typeof candidate === 'object' && Array.isArray(candidate[MAP_MARKER])) {
			return new Map(candidate[MAP_MARKER]);
		}
		return candidate;
	}) as T;
}
