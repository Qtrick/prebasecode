/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { publicHttpUrl } from './webContextCore';

const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_SEARCH = 'https://api.firecrawl.dev/v2/search';

export interface FirecrawlTransport {
	fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface FirecrawlCancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested?: (listener: () => void) => { dispose(): void };
}

export interface FirecrawlScrapeRequest {
	url: string;
	maxAge: number;
	timeoutMs: number;
	storeInCache?: boolean;
	onAttempt?: () => void;
}

export interface FirecrawlScrapeResult {
	url: string;
	title: string;
	markdown: string;
}

export interface FirecrawlSearchHit {
	title: string;
	url: string;
	description: string;
}

function abortable(token: FirecrawlCancellationToken | undefined, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	if (token?.isCancellationRequested) {
		controller.abort();
	}
	const subscription = token?.onCancellationRequested?.(() => controller.abort());
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	return {
		signal: controller.signal,
		dispose() {
			clearTimeout(timeout);
			subscription?.dispose();
		},
	};
}

async function firecrawlFetch(
	apiKey: string,
	url: string,
	body: unknown,
	token: FirecrawlCancellationToken | undefined,
	timeoutMs: number,
	transport: FirecrawlTransport,
): Promise<Response> {
	const handle = abortable(token, timeoutMs);
	try {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		const response = await transport.fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache',
			},
			cache: 'no-store',
			body: JSON.stringify(body),
			signal: handle.signal,
		});
		return response;
	} catch (error) {
		if (token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		if ((error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')) {
			throw new Error('Firecrawl request timed out.');
		}
		throw error;
	} finally {
		handle.dispose();
	}
}

function retryable(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

function abortableDelay(ms: number, token?: FirecrawlCancellationToken): Promise<void> {
	if (token?.isCancellationRequested) {
		return Promise.reject(new Error('Cancelled'));
	}
	return new Promise((resolve, reject) => {
		const wait = setTimeout(() => {
			subscription?.dispose();
			resolve();
		}, ms);
		const subscription = token?.onCancellationRequested?.(() => {
			clearTimeout(wait);
			reject(new Error('Cancelled'));
		});
	});
}

export async function scrapePublicUrl(
	apiKey: string,
	input: FirecrawlScrapeRequest,
	token?: FirecrawlCancellationToken,
	transport: FirecrawlTransport = globalThis,
): Promise<FirecrawlScrapeResult> {
	if (!publicHttpUrl(input.url)) {
		throw new Error('Web fetch only accepts public http(s) URLs.');
	}
	let last: Response | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		input.onAttempt?.();
		last = await firecrawlFetch(apiKey, FIRECRAWL_SCRAPE, {
			url: input.url,
			formats: ['markdown'],
			onlyMainContent: true,
			removeBase64Images: true,
			blockAds: true,
			storeInCache: input.storeInCache ?? true,
			maxAge: input.maxAge,
			timeout: Math.min(input.timeoutMs, 20_000),
		}, token, input.timeoutMs, transport);
		if (last.ok || !retryable(last.status) || attempt === 1) {
			break;
		}
		const retryAfter = Number(last.headers.get('Retry-After') || 0);
		await abortableDelay(Math.min(1_500, retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1)), token);
	}
	if (!last?.ok) {
		if (last?.status === 401) {
			throw new Error('Firecrawl authentication failed.');
		}
		if (last?.status === 429) {
			throw new Error('Firecrawl rate limit exceeded.');
		}
		throw new Error(`Firecrawl scrape failed (HTTP ${last?.status ?? 0}).`);
	}
	const payload = await last.json() as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string; url?: string; sourceURL?: string } } };
	const markdown = typeof payload.data?.markdown === 'string' ? payload.data.markdown : '';
	const title = typeof payload.data?.metadata?.title === 'string' ? payload.data.metadata.title : input.url;
	const url = typeof payload.data?.metadata?.url === 'string' ? payload.data.metadata.url
		: typeof payload.data?.metadata?.sourceURL === 'string' ? payload.data.metadata.sourceURL
			: input.url;
	if (!publicHttpUrl(url)) {
		throw new Error('Web fetch only accepts public http(s) URLs.');
	}
	return { url, title, markdown };
}

export async function searchFirecrawlCompact(
	apiKey: string,
	query: string,
	categories: Array<'github' | 'research' | 'pdf'>,
	token?: FirecrawlCancellationToken,
	transport: FirecrawlTransport = globalThis,
): Promise<FirecrawlSearchHit[]> {
	const response = await firecrawlFetch(apiKey, FIRECRAWL_SEARCH, {
		query,
		limit: 5,
		categories,
		timeout: 10_000,
	}, token, 10_000, transport);
	if (!response.ok) {
		throw new Error(`Firecrawl search failed (HTTP ${response.status}).`);
	}
	const payload = await response.json() as { data?: { web?: Array<{ title?: string; url?: string; description?: string }> } };
	const web = Array.isArray(payload.data?.web) ? payload.data.web : [];
	return web.flatMap(item => {
		if (typeof item.url !== 'string' || typeof item.title !== 'string' || !publicHttpUrl(item.url)) {
			return [];
		}
		return [{ title: item.title, url: item.url, description: typeof item.description === 'string' ? item.description : '' }];
	});
}
