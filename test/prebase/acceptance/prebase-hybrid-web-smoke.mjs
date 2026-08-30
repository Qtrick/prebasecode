#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local BYOK hybrid smoke. Never prints credential values.
 * Uses LinkUp discovery + Firecrawl scrape when both keys resolve.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { phase3EvidenceMetadata } from './phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(scriptPath), '../../..');
const evidencePath = join(repo, 'reports/graph-acceptance/phase-3-final/magnus/hybrid-web-smoke.json');

const QUERIES = [
	{ id: 'current-version', query: 'current TypeScript stable version', depth: 'fast' },
	{ id: 'official-docs', query: 'VS Code language model tools API official documentation', depth: 'standard' },
	{ id: 'coding', query: 'github vscode LanguageModelTool invokeTool example', depth: 'deep' },
	{ id: 'research', query: 'arxiv transformer attention is all you need pdf', depth: 'deep' },
	{ id: 'news', query: 'latest Electron release notes today', depth: 'standard' },
];

async function loadHybrid() {
	const register = pathToFileURL(join(repo, 'scripts/assurance/prebase-test-register.mjs')).href;
	await import(register);
	const core = await import(pathToFileURL(join(repo, 'extensions/prebase-magnus/src/secretResolver.ts')).href);
	const hybrid = await import(pathToFileURL(join(repo, 'extensions/prebase-magnus/src/hybridWebContext.ts')).href);
	return { core, hybrid };
}

async function main() {
	mkdirSync(dirname(evidencePath), { recursive: true });
	const { core, hybrid } = await loadHybrid();
	const resolver = new core.PreBaseSecretResolver();
	const linkup = resolver.resolveToolProviderKey?.('linkup') ?? resolver.resolveLinkupKey();
	const firecrawl = resolver.resolveToolProviderKey?.('firecrawl');
	const evidence = {
		...phase3EvidenceMetadata(repo, 'hybrid-web-smoke'),
		linkupConfigured: Boolean(linkup?.key),
		firecrawlConfigured: Boolean(firecrawl?.key),
		hybridAttempted: false,
		runs: [],
		failures: [],
	};
	if (!linkup?.key || !firecrawl?.key) {
		evidence.failures.push('local hybrid skipped: both LINKUP_API_KEY and FIRECRAWL_API_KEY must resolve');
		writeFileSync(evidencePath, JSON.stringify({ ...evidence, ok: false, skipped: true }, null, 2));
		console.log(JSON.stringify({ skipped: true, linkupConfigured: evidence.linkupConfigured, firecrawlConfigured: evidence.firecrawlConfigured }));
		return;
	}
	evidence.hybridAttempted = true;
	for (const item of QUERIES) {
		const started = Date.now();
		try {
			const result = await hybrid.executeHybridWebSearch({ query: item.query, depth: item.depth }, {
				linkupKey: linkup.key,
				firecrawlKey: firecrawl.key,
			});
			const payload = JSON.stringify(result);
			evidence.runs.push({
				id: item.id,
				depth: item.depth,
				ok: true,
				latencyMs: Date.now() - started,
				sourceCount: result.sources.length,
				enriched: result.operations.firecrawlScrape,
				truncated: result.truncated,
				enrichment: result.enrichment,
				payloadChars: payload.length,
				operations: result.operations,
				urls: result.sources.map(source => source.url),
				hasSecretLeak: /Bearer |sk-|fc-[a-z0-9]{8}/i.test(payload) || payload.includes(linkup.key) || payload.includes(firecrawl.key),
			});
		} catch (error) {
			evidence.runs.push({
				id: item.id,
				depth: item.depth,
				ok: false,
				latencyMs: Date.now() - started,
				error: error instanceof Error ? error.message.replace(linkup.key, '[redacted]').replace(firecrawl.key, '[redacted]') : 'failed',
			});
		}
	}
	const fetchStarted = Date.now();
	try {
		const fetched = await hybrid.executeHybridWebFetch({ url: 'https://example.com' }, {
			linkupKey: '',
			firecrawlKey: firecrawl.key,
		});
		evidence.runs.push({
			id: 'known-url-fetch',
			depth: 'fetch',
			ok: fetched.operations.firecrawlScrape === 1 && fetched.sources[0]?.url?.startsWith('http'),
			latencyMs: Date.now() - fetchStarted,
			sourceCount: fetched.sources.length,
			enriched: fetched.operations.firecrawlScrape,
			truncated: fetched.truncated,
			enrichment: fetched.enrichment,
			payloadChars: JSON.stringify(fetched).length,
			operations: fetched.operations,
			urls: fetched.sources.map(source => source.url),
			hasSecretLeak: JSON.stringify(fetched).includes(firecrawl.key),
		});
	} catch (error) {
		evidence.runs.push({
			id: 'known-url-fetch',
			depth: 'fetch',
			ok: false,
			latencyMs: Date.now() - fetchStarted,
			error: error instanceof Error ? error.message.replace(firecrawl.key, '[redacted]') : 'failed',
		});
	}

	const cancelToken = { isCancellationRequested: true };
	try {
		await hybrid.executeHybridWebSearch({ query: 'current typescript version', depth: 'fast' }, {
			linkupKey: linkup.key,
			firecrawlKey: firecrawl.key,
			token: cancelToken,
		});
		evidence.failures.push('cancellation did not abort hybrid search');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		evidence.runs.push({ id: 'cancellation', depth: 'fast', ok: /cancel/i.test(message), latencyMs: 0 });
		if (!/cancel/i.test(message)) {
			evidence.failures.push(`cancellation produced unexpected error: ${message.replace(linkup.key, '[redacted]').replace(firecrawl.key, '[redacted]')}`);
		}
	}

	try {
		await hybrid.executeHybridWebFetch({ url: 'http://127.0.0.1/secret' }, {
			linkupKey: '',
			firecrawlKey: firecrawl.key,
		});
		evidence.failures.push('private URL fetch was not rejected');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		evidence.runs.push({ id: 'private-url', depth: 'fetch', ok: /public http/i.test(message), latencyMs: 0 });
		if (!/public http/i.test(message)) {
			evidence.failures.push(`private URL produced unexpected error: ${message}`);
		}
	}

	if (evidence.runs.some(run => run.hasSecretLeak)) {
		evidence.failures.push('hybrid result leaked a provider credential');
	}
	if (!evidence.runs.some(run => run.ok && run.enriched > 0 && run.operations?.linkup > 0)) {
		evidence.failures.push('no run produced hybrid LinkUp discovery plus Firecrawl enrichment');
	}
	const result = { ...evidence, ok: evidence.failures.length === 0 };
	writeFileSync(evidencePath, JSON.stringify(result, null, 2));
	if (evidence.failures.length) {
		console.error(JSON.stringify({ ok: false, failures: evidence.failures, runCount: evidence.runs.length }));
		process.exit(1);
	}
	console.log(JSON.stringify({ ok: true, runs: evidence.runs.map(run => ({ id: run.id, ok: run.ok, latencyMs: run.latencyMs, enriched: run.enriched, payloadChars: run.payloadChars })) }));
}

main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
