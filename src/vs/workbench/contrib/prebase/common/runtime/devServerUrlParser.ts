/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const URL_PATTERNS = [
	/Local:\s*(https?:\/\/[^\s]+)/i,
	/ready on\s+(https?:\/\/[^\s]+)/i,
	/started server on\s+(?:https?:\/\/)?(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/i,
	/listening on\s+(https?:\/\/[^\s]+)/i,
	/http:\/\/localhost:(\d+)/i,
	/http:\/\/127\.0\.0\.1:(\d+)/i,
	/https:\/\/localhost:(\d+)/i,
];

/** Parse dev-server URLs from terminal output lines. */
export function parseDevServerUrlsFromTerminal(output: string): string[] {
	const found = new Set<string>();
	for (const line of output.split('\n')) {
		for (const re of URL_PATTERNS) {
			const m = re.exec(line);
			if (!m) {
				continue;
			}
			if (m[1]?.startsWith('http')) {
				found.add(m[1].replace(/\/$/, '').replace(/[\],;'"]+$/, ''));
			} else if (m[1] && /^\d+$/.test(m[1])) {
				found.add(`http://localhost:${m[1]}`);
			}
		}
	}
	return [...found];
}

/** Return the most recently mentioned localhost URL from terminal buffer tail. */
export function latestDevServerUrl(output: string): string | null {
	const urls = parseDevServerUrlsFromTerminal(output.slice(-8000));
	return urls.length ? urls[urls.length - 1]! : null;
}
