/**
 * Authenticated hybrid web-context gateway (LinkUp discovery + Firecrawl enrichment).
 * Provider credentials stay in Edge Function secrets. Query text and result bodies are never stored.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
	WEB_CONTEXT_BUDGET,
	UNTRUSTED_WEB_WARNING,
	boundWebSources,
	dedupeCandidates,
	firecrawlMaxAgeMs,
	firecrawlSearchCategories,
	inferFreshness,
	publicHttpUrl,
	validatedSourceUrl,
	type Depth,
	type Freshness,
	type SourceCandidate,
} from "./web_context.ts";

const MAX_BODY_BYTES = 16_384;
const MAX_QUERY_LENGTH = 1_000;
const MAX_DOMAINS = 20;
const ALLOWED_ORIGINS = new Set(["null"]);
const SEARCH_KEYS = new Set(["query", "depth", "maxResults", "includeDomains", "excludeDomains", "fromDate", "toDate", "operation", "freshness"]);
const FETCH_KEYS = new Set(["operation", "url", "freshness"]);
type JsonRecord = Record<string, unknown>;

interface SearchInput {
	operation: "search";
	query: string;
	depth: Depth;
	maxResults: number;
	freshness: Freshness;
	includeDomains?: string[];
	excludeDomains?: string[];
	fromDate?: string;
	toDate?: string;
}

interface FetchInput {
	operation: "fetch";
	url: string;
	freshness: Freshness;
}

function requestIdFrom(req: Request): string {
	const candidate = req.headers.get("x-request-id") ?? "";
	return /^[A-Za-z0-9-]{1,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) {
		return false;
	}
	if (ALLOWED_ORIGINS.has(origin)) {
		return true;
	}
	try {
		const parsed = new URL(origin);
		return parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
	} catch {
		return false;
	}
}

function corsHeaders(req: Request): HeadersInit {
	const origin = req.headers.get("Origin");
	return {
		"Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "http://127.0.0.1",
		"Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Vary": "Origin",
	};
}

function json(req: Request, requestId: string, status: number, body: JsonRecord): Response {
	return new Response(JSON.stringify({ request_id: requestId, ...body }), {
		status,
		headers: { ...corsHeaders(req), "Content-Type": "application/json", "x-request-id": requestId },
	});
}

function bearerToken(req: Request): string | undefined {
	const header = req.headers.get("Authorization");
	return header?.startsWith("Bearer ") ? header.slice(7).trim() || undefined : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error("invalid_date");
	}
	const date = new Date(value).toISOString().slice(0, 10);
	if (date < "1970-01-01") {
		throw new Error("invalid_date");
	}
	return date;
}

function validDomains(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value) || value.length > MAX_DOMAINS) {
		throw new Error("invalid_domains");
	}
	return value.map(domain => {
		if (typeof domain !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
			throw new Error("invalid_domains");
		}
		return domain.toLowerCase();
	});
}

function parseInput(value: unknown): SearchInput | FetchInput {
	if (!isRecord(value)) {
		throw new Error("invalid_request");
	}
	const operation = value.operation === undefined ? "search" : value.operation;
	if (operation === "fetch") {
		if (Object.keys(value).some(key => !FETCH_KEYS.has(key))) {
			throw new Error("invalid_request");
		}
		if (typeof value.url !== "string" || !publicHttpUrl(value.url)) {
			throw new Error("invalid_url");
		}
		const freshness = value.freshness === undefined ? "normal" : value.freshness;
		if (freshness !== "normal" && freshness !== "fresh") {
			throw new Error("invalid_freshness");
		}
		return { operation: "fetch", url: value.url, freshness };
	}
	if (operation !== "search" || Object.keys(value).some(key => !SEARCH_KEYS.has(key))) {
		throw new Error("invalid_request");
	}
	if (typeof value.query !== "string" || !value.query.trim() || value.query.length > MAX_QUERY_LENGTH) {
		throw new Error("invalid_query");
	}
	const depth = value.depth === undefined ? "standard" : value.depth;
	if (depth !== "fast" && depth !== "standard" && depth !== "deep") {
		throw new Error("invalid_depth");
	}
	const maxResults = value.maxResults === undefined ? WEB_CONTEXT_BUDGET.scrapeCounts[depth] : value.maxResults;
	if (!Number.isInteger(maxResults) || (maxResults as number) < 1 || (maxResults as number) > 6) {
		throw new Error("invalid_max_results");
	}
	const freshness = value.freshness === undefined ? inferFreshness(value.query.trim()) : value.freshness;
	if (freshness !== "normal" && freshness !== "fresh") {
		throw new Error("invalid_freshness");
	}
	const fromDate = validDate(value.fromDate);
	const toDate = validDate(value.toDate);
	if (fromDate && toDate && fromDate > toDate) {
		throw new Error("invalid_date_range");
	}
	return {
		operation: "search",
		query: value.query.trim(),
		depth,
		maxResults: Math.min(maxResults as number, WEB_CONTEXT_BUDGET.scrapeCounts[depth]),
		freshness,
		includeDomains: validDomains(value.includeDomains),
		excludeDomains: validDomains(value.excludeDomains),
		fromDate,
		toDate,
	};
}

async function requireUser(req: Request, requestId: string): Promise<{ id: string } | Response> {
	const token = bearerToken(req);
	const url = Deno.env.get("SUPABASE_URL");
	const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
	if (!token) {
		return json(req, requestId, 401, { error: "unauthorized" });
	}
	if (!url || !anonKey) {
		return json(req, requestId, 503, { error: "misconfigured" });
	}
	const auth = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
	const { data, error } = await auth.auth.getUser(token);
	return error || !data.user ? json(req, requestId, 401, { error: "unauthorized" }) : { id: data.user.id };
}

function isResponse(value: { id: string } | Response): value is Response {
	return value instanceof Response;
}

function abortDelay(signal: AbortSignal, ms: number): Promise<void> {
	if (signal.aborted) {
		return Promise.reject(new Error("Cancelled"));
	}
	return new Promise((resolve, reject) => {
		const wait = setTimeout(() => {
			signal.removeEventListener("abort", cancel);
			resolve();
		}, ms);
		const cancel = () => {
			clearTimeout(wait);
			reject(new Error("Cancelled"));
		};
		signal.addEventListener("abort", cancel, { once: true });
	});
}

async function providerFetch(url: string, apiKey: string, body: unknown, timeoutMs: number, signal: AbortSignal): Promise<Response> {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	signal.addEventListener("abort", onAbort, { once: true });
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Cache-Control": "no-cache" },
			cache: "no-store",
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (error) {
		if (signal.aborted) {
			throw new Error("Cancelled");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener("abort", onAbort);
	}
}

async function linkupSearch(input: SearchInput, signal: AbortSignal): Promise<Response> {
	const apiKey = Deno.env.get("LINKUP_API_KEY");
	if (!apiKey) {
		throw new Error("provider_unavailable");
	}
	const { query, depth, maxResults, includeDomains, excludeDomains, fromDate, toDate } = input;
	return await providerFetch("https://api.linkup.so/v1/search", apiKey, {
		q: query,
		depth,
		maxResults,
		includeDomains,
		excludeDomains,
		fromDate,
		toDate,
		outputType: "searchResults",
	}, WEB_CONTEXT_BUDGET.linkupTimeoutMs[depth], signal);
}

function linkupSources(payload: unknown): SourceCandidate[] {
	const raw = isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
	const sources: SourceCandidate[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.url !== "string" || !publicHttpUrl(item.url)) {
			continue;
		}
		sources.push({
			title: typeof item.name === "string" ? item.name : item.url,
			url: item.url,
			excerpt: typeof item.content === "string" ? item.content : "",
			discoveredBy: ["linkup"],
		});
	}
	return sources;
}

function retryable(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

async function firecrawlScrape(url: string, maxAge: number, timeoutMs: number, signal: AbortSignal, storeInCache = true, onAttempt?: () => void): Promise<{ title: string; url: string; markdown: string }> {
	const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
	if (!apiKey) {
		throw new Error("firecrawl_unavailable");
	}
	if (!publicHttpUrl(url)) {
		throw new Error("invalid_url");
	}
	let last: Response | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (signal.aborted) {
			throw new Error("Cancelled");
		}
		onAttempt?.();
		last = await providerFetch("https://api.firecrawl.dev/v2/scrape", apiKey, {
			url,
			formats: ["markdown"],
			onlyMainContent: true,
			removeBase64Images: true,
			blockAds: true,
			storeInCache,
			maxAge,
			timeout: Math.min(timeoutMs, 20_000),
		}, timeoutMs, signal);
		if (last.ok || !retryable(last.status) || attempt === 1) {
			break;
		}
		const retryAfter = Number(last.headers.get("Retry-After") || 0);
		await abortDelay(signal, Math.min(1_500, retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1)));
	}
	if (!last?.ok) {
		if (last?.status === 401) {
			throw new Error("firecrawl_unavailable");
		}
		if (last?.status === 429) {
			throw new Error("firecrawl_rate_limited");
		}
		throw new Error(`firecrawl_scrape_failed:${last?.status ?? 0}`);
	}
	const payload = await last.json() as { data?: { markdown?: string; metadata?: { title?: string; url?: string; sourceURL?: string } } };
	const markdown = typeof payload.data?.markdown === "string" ? payload.data.markdown : "";
	const title = typeof payload.data?.metadata?.title === "string" ? payload.data.metadata.title : url;
	const resolved = typeof payload.data?.metadata?.url === "string" ? payload.data.metadata.url
		: typeof payload.data?.metadata?.sourceURL === "string" ? payload.data.metadata.sourceURL
			: url;
	if (!publicHttpUrl(resolved)) {
		throw new Error("invalid_url");
	}
	return { title, url: validatedSourceUrl(resolved) ?? resolved, markdown };
}

async function firecrawlSearchCompact(query: string, categories: Array<"github" | "research" | "pdf">, signal: AbortSignal): Promise<SourceCandidate[]> {
	const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
	if (!apiKey || categories.length === 0) {
		return [];
	}
	const response = await providerFetch("https://api.firecrawl.dev/v2/search", apiKey, {
		query,
		limit: 5,
		categories,
		timeout: 10_000,
	}, 10_000, signal);
	if (signal.aborted) {
		throw new Error("Cancelled");
	}
	if (!response.ok) {
		return [];
	}
	const payload = await response.json() as { data?: { web?: Array<{ title?: string; url?: string; description?: string }> } };
	const web = Array.isArray(payload.data?.web) ? payload.data.web : [];
	return web.flatMap(item => {
		if (typeof item.url !== "string" || typeof item.title !== "string" || !publicHttpUrl(item.url)) {
			return [];
		}
		return [{ title: item.title, url: item.url, excerpt: typeof item.description === "string" ? item.description : "", discoveredBy: ["firecrawl"] as const }];
	});
}

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	async function run(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
	return results;
}

Deno.serve(async req => {
	const requestId = requestIdFrom(req);
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(req) });
	}
	if (req.method !== "POST") {
		return json(req, requestId, 405, { error: "method_not_allowed" });
	}
	if (Number(req.headers.get("Content-Length")) > MAX_BODY_BYTES) {
		return json(req, requestId, 413, { error: "payload_too_large" });
	}
	let input: SearchInput | FetchInput;
	try {
		const raw = await req.text();
		if (raw.length > MAX_BODY_BYTES) {
			return json(req, requestId, 413, { error: "payload_too_large" });
		}
		input = parseInput(raw ? JSON.parse(raw) : {});
	} catch (error) {
		return json(req, requestId, 400, { error: error instanceof Error ? error.message : "invalid_request" });
	}
	const user = await requireUser(req, requestId);
	if (isResponse(user)) {
		return user;
	}
	const serviceUrl = Deno.env.get("SUPABASE_URL");
	const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	if (!serviceUrl || !serviceKey) {
		return json(req, requestId, 503, { error: "usage_check_unavailable" });
	}
	if (!Deno.env.get("FIRECRAWL_API_KEY") || (input.operation === "search" && !Deno.env.get("LINKUP_API_KEY"))) {
		return json(req, requestId, 503, { error: "provider_unavailable" });
	}
	const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const depth = input.operation === "fetch" ? "fast" : input.depth;
	const { error: quotaError } = await admin.rpc("reserve_web_search_quota", {
		p_user_id: user.id,
		p_request_id: requestId,
		p_depth: depth,
		p_operation: input.operation,
	});
	if (quotaError) {
		return json(req, requestId, 429, { error: "quota_exceeded" });
	}

	const fail = async (status: number, error: string) => {
		await admin.from("web_search_usage").update({ status: "failed" }).eq("request_id", requestId);
		return json(req, requestId, status, { error });
	};

	try {
		if (req.signal.aborted) {
			return await fail(499, "cancelled");
		}
		if (input.operation === "fetch") {
			let firecrawlScrapeOps = 0;
			const page = await firecrawlScrape(validatedSourceUrl(input.url) ?? input.url, firecrawlMaxAgeMs(input.freshness), WEB_CONTEXT_BUDGET.firecrawlTimeoutMs.fetch, req.signal, false, () => firecrawlScrapeOps++);
			const bounded = boundWebSources([{
				title: page.title,
				url: page.url,
				excerpt: page.markdown,
				discoveredBy: ["firecrawl"],
				contentVerifiedBy: "firecrawl",
			}], { maxSources: 1, excerptChars: WEB_CONTEXT_BUDGET.maxFetchChars });
			await admin.from("web_search_usage").update({
				status: "succeeded",
				source_count: bounded.sources.length,
				enriched_count: 1,
				operation_kind: "fetch",
				firecrawl_scrape_ops: firecrawlScrapeOps,
			}).eq("request_id", requestId);
			return json(req, requestId, 200, {
				...bounded,
				warning: UNTRUSTED_WEB_WARNING,
				enrichment: "full",
			});
		}

		let upstream: Response | undefined;
		for (let attempt = 0; attempt < 2; attempt++) {
			upstream = await linkupSearch(input, req.signal);
			if (upstream.ok || (upstream.status !== 429 && upstream.status < 500)) {
				break;
			}
			await abortDelay(req.signal, 250 * (attempt + 1));
		}
		if (!upstream?.ok) {
			return await fail(upstream?.status === 429 ? 429 : 502, "search_unavailable");
		}

		const discovered = linkupSources(await upstream.json());
		let firecrawlSearchOps = 0;
		const categories = firecrawlSearchCategories(input.query, input.depth);
		if (categories.length && Deno.env.get("FIRECRAWL_API_KEY")) {
			firecrawlSearchOps = 1;
			try {
				discovered.push(...await firecrawlSearchCompact(input.query, categories, req.signal));
			} catch (error) {
				if (error instanceof Error && error.message === "Cancelled") {
					throw error;
				}
				// Deep discovery is complementary; LinkUp ranking remains if Firecrawl Search fails.
			}
		}
		const unique = dedupeCandidates(discovered);
		const scrapeLimit = WEB_CONTEXT_BUDGET.scrapeCounts[input.depth];
		const targets = unique.slice(0, scrapeLimit);
		const maxAge = firecrawlMaxAgeMs(input.freshness);
		const timeoutMs = WEB_CONTEXT_BUDGET.firecrawlTimeoutMs[input.depth];
		let firecrawlUnavailable = 0;
		let firecrawlScrapeOps = 0;
		const scraped = await mapPool(targets, 2, async (target) => {
			if (req.signal.aborted) {
				throw new Error("Cancelled");
			}
			try {
				const page = await firecrawlScrape(target.url, maxAge, timeoutMs, req.signal, true, () => firecrawlScrapeOps++);
				return {
					...target,
					title: page.title || target.title,
					url: page.url,
					excerpt: page.markdown || target.excerpt,
					contentVerifiedBy: "firecrawl" as const,
				} satisfies SourceCandidate;
			} catch (error) {
				if (error instanceof Error && (error.message === "Cancelled" || error.message === "firecrawl_unavailable" || error.message === "firecrawl_rate_limited")) {
					if (error.message !== "Cancelled") {
						firecrawlUnavailable++;
					} else {
						throw error;
					}
				}
				return target;
			}
		});
		const verified = scraped.filter(item => item.contentVerifiedBy === "firecrawl").length;
		if (verified === 0 && targets.length > 0) {
			return await fail(502, firecrawlUnavailable ? "firecrawl_unavailable" : "enrichment_unavailable");
		}
		const bounded = boundWebSources(scraped, {
			maxSources: scrapeLimit,
			excerptChars: WEB_CONTEXT_BUDGET.excerptChars[input.depth],
		});
		await admin.from("web_search_usage").update({
			status: "succeeded",
			source_count: bounded.sources.length,
			enriched_count: verified,
			operation_kind: "search",
			linkup_ops: 1,
			firecrawl_search_ops: firecrawlSearchOps,
			firecrawl_scrape_ops: firecrawlScrapeOps,
		}).eq("request_id", requestId);
		return json(req, requestId, 200, {
			...bounded,
			warning: UNTRUSTED_WEB_WARNING,
			enrichment: verified === scraped.length ? "full" : "partial",
		});
	} catch (error) {
		if (error instanceof Error && error.message === "Cancelled") {
			return await fail(499, "cancelled");
		}
		return await fail(502, "search_unavailable");
	}
});
