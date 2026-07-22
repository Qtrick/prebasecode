/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PreBaseCloudErrorCode =
	| 'unconfigured'
	| 'network'
	| 'auth'
	| 'http'
	| 'invalid_response';

export class PreBaseCloudError extends Error {
	constructor(
		readonly code: PreBaseCloudErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'PreBaseCloudError';
	}
}

export function cloudErrorMessageFromBody(parsed: {
	error?: string;
	error_description?: string;
	msg?: string;
	message?: string;
}, fallback: string): string {
	return (
		parsed.error_description ||
		parsed.msg ||
		parsed.message ||
		parsed.error ||
		fallback
	);
}
