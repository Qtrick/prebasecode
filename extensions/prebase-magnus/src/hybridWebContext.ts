/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { executeLocalLinkupSearch, type LinkupCancellationToken, type LinkupTransport, type LocalLinkupSearchRequest } from './localLinkupClient';
import { scrapePublicUrl, searchFirecrawlCompact, type FirecrawlTransport } from './localFirecrawlClient';
import {
	UNTRUSTED_WEB_WARNING,
	WEB_CONTEXT_BUDGET,
	boundWebSources,
	dedupeCandidates,
	excerptLimitForDepth,
	firecrawlMaxAgeMs,
	firecrawlSearchCategories,
	inferFreshness,
	publicHttpUrl,
	scrapeLimitForDepth,
	sourceDedupeKey,
	validatedSourceUrl,
	type BoundedWebSource,
	type Freshness,
	type SearchDepth,
	type WebSourceCandidate,
} from './webContextCore';

export interface HybridWebContextResponse {
	request_id: string;
	sources: BoundedWebSource[];
	warning: string;
	truncated: boolean;
	enrichment: 'full' | 'partial' | 'unavailable';
	/** Provider calls attempted, including bounded retries. */
	operations: { linkup: number; firecrawlSearch: number; firecrawlScrape: number };
}

export interface HybridWebContextDeps {
	linkupKey: string;
	firecrawlKey: string;
	token?: LinkupCancellationToken;
	linkupTransport?: LinkupTransport;
	firecrawlTransport?: FirecrawlTransport;
	cache?: Map<string, HybridWebContextResponse>;
}

function cacheGet(cache: Map<string, HybridWebContextResponse> | undefined, key: string): HybridWebContextResponse | undefined {
	return cache?.get(key);
}

function cacheSet(cache: Map<string, HybridWebContextResponse> | undefined, key: string, value: HybridWebContextResponse): void {
	if (!cache) {
		return;
	}
	if (cache.size >= 16) {
		const first = cache.keys().next().value;
		if (typeof first === 'string') {
			cache.delete(first);
		}
	}
	cache.set(key, value);
}

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	async function run(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
	return results;
}

export async function executeHybridWebSearch(
	input: LocalLinkupSearchRequest & { freshness?: Freshness },
	deps: HybridWebContextDeps,
): Promise<HybridWebContextResponse> {
	if (!deps.linkupKey || !deps.firecrawlKey) {
		throw new Error('Hybrid web context requires both LinkUp and Firecrawl credentials.');
	}
	const depth: SearchDepth = input.depth ?? 'standard';
	const freshness = inferFreshness(input.query, input.freshness);
	const cache = deps.cache;
	const cacheKey = JSON.stringify({
		k: 'search',
		q: input.query,
		depth,
		freshness,
		max: input.maxResults ?? null,
		include: input.includeDomains ?? null,
		exclude: input.excludeDomains ?? null,
		from: input.fromDate ?? null,
		to: input.toDate ?? null,
	});
	const cached = cacheGet(cache, cacheKey);
	if (cached) {
		return cached;
	}

	const linkup = await executeLocalLinkupSearch(deps.linkupKey, input, deps.token, deps.linkupTransport);
	const operations = { linkup: 1, firecrawlSearch: 0, firecrawlScrape: 0 };
	const discovered: WebSourceCandidate[] = linkup.sources.flatMap(source => {
		if (!publicHttpUrl(source.url)) {
			return [];
		}
		return [{
			title: source.title,
			url: source.url,
			excerpt: source.excerpt,
			discoveredBy: ['linkup'] as const,
		}];
	});

	const categories = firecrawlSearchCategories(input.query, depth);
	if (categories.length) {
		operations.firecrawlSearch = 1;
		try {
			const hits = await searchFirecrawlCompact(deps.firecrawlKey, input.query, categories, deps.token, deps.firecrawlTransport);
			for (const hit of hits) {
				discovered.push({ title: hit.title, url: hit.url, excerpt: hit.description, discoveredBy: ['firecrawl'] });
			}
		} catch (error) {
			if (error instanceof Error && error.message === 'Cancelled') {
				throw error;
			}
			// Deep discovery is complementary; LinkUp ranking remains if Firecrawl Search fails.
		}
	}

	const scrapeTargets = dedupeCandidates(discovered).slice(0, scrapeLimitForDepth(depth));
	const maxAge = firecrawlMaxAgeMs(freshness);
	const timeoutMs = WEB_CONTEXT_BUDGET.firecrawlTimeoutMs[depth];
	let firecrawlUnavailable = 0;
	const scraped = await mapPool(scrapeTargets, 2, async (target) => {
		if (deps.token?.isCancellationRequested) {
			throw new Error('Cancelled');
		}
		try {
			const page = await scrapePublicUrl(deps.firecrawlKey, { url: target.url, maxAge, timeoutMs, onAttempt: () => operations.firecrawlScrape++ }, deps.token, deps.firecrawlTransport);
			return {
				...target,
				title: page.title || target.title,
				url: validatedSourceUrl(page.url) ?? target.url,
				excerpt: page.markdown || target.excerpt,
				contentVerifiedBy: 'firecrawl' as const,
			} satisfies WebSourceCandidate;
		} catch (error) {
			if (error instanceof Error && error.message === 'Cancelled') {
				throw error;
			}
			if (error instanceof Error && /authentication failed|rate limit exceeded/.test(error.message)) {
				firecrawlUnavailable++;
			}
			return target;
		}
	});

	const verified = scraped.filter(item => item.contentVerifiedBy === 'firecrawl').length;
	if (verified === 0 && scrapeTargets.length > 0) {
		throw new Error(firecrawlUnavailable ? 'Firecrawl is unavailable for hybrid web context.' : 'Firecrawl could not enrich any discovered sources.');
	}

	const bounded = boundWebSources(scraped, {
		maxSources: scrapeLimitForDepth(depth),
		excerptChars: excerptLimitForDepth(depth),
	});
	const result: HybridWebContextResponse = {
		request_id: linkup.request_id,
		sources: bounded.sources,
		warning: UNTRUSTED_WEB_WARNING,
		truncated: bounded.truncated || linkup.truncated,
		enrichment: verified === scraped.length ? 'full' : 'partial',
		operations,
	};
	cacheSet(cache, cacheKey, result);
	return result;
}

export async function executeHybridWebFetch(
	input: { url: string; freshness?: Freshness },
	deps: HybridWebContextDeps,
): Promise<HybridWebContextResponse> {
	if (!deps.firecrawlKey) {
		throw new Error('Web fetch requires a Firecrawl credential.');
	}
	const parsed = publicHttpUrl(input.url);
	if (!parsed) {
		throw new Error('Web fetch only accepts public http(s) URLs.');
	}
	const fetchUrl = validatedSourceUrl(input.url) ?? parsed.toString();
	const freshness = input.freshness ?? 'normal';
	const cache = deps.cache;
	const cacheKey = JSON.stringify({ k: 'fetch', url: sourceDedupeKey(fetchUrl) ?? fetchUrl, freshness });
	const cached = cacheGet(cache, cacheKey);
	if (cached) {
		return cached;
	}
	let firecrawlScrapeAttempts = 0;
	const page = await scrapePublicUrl(deps.firecrawlKey, {
		url: fetchUrl,
		maxAge: firecrawlMaxAgeMs(freshness),
		timeoutMs: WEB_CONTEXT_BUDGET.firecrawlTimeoutMs.fetch,
		storeInCache: false,
		onAttempt: () => firecrawlScrapeAttempts++,
	}, deps.token, deps.firecrawlTransport);
	const bounded = boundWebSources([{
		title: page.title,
		url: validatedSourceUrl(page.url) ?? fetchUrl,
		excerpt: page.markdown,
		discoveredBy: ['firecrawl'],
		contentVerifiedBy: 'firecrawl',
	}], { maxSources: 1, excerptChars: WEB_CONTEXT_BUDGET.maxFetchChars });
	const result: HybridWebContextResponse = {
		request_id: crypto.randomUUID(),
		sources: bounded.sources,
		warning: UNTRUSTED_WEB_WARNING,
		truncated: bounded.truncated,
		enrichment: 'full',
		operations: { linkup: 0, firecrawlSearch: 0, firecrawlScrape: firecrawlScrapeAttempts },
	};
	cacheSet(cache, cacheKey, result);
	return result;
}
