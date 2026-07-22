/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function buildSupabaseAuthUrl(supabaseUrl: string, path: string): string {
	const base = supabaseUrl.replace(/\/$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}/auth/v1${suffix}`;
}

export function buildSupabaseRestUrl(supabaseUrl: string, table: string): string {
	const base = supabaseUrl.replace(/\/$/, '');
	return `${base}/rest/v1/${table}`;
}

/** Redact bearer tokens before logging. */
export function redactSensitiveForLog(text: string): string {
	return text
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
		.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}
