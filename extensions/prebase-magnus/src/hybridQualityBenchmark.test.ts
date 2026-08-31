/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test } from 'node:test';
import { executeHybridWebSearch } from './hybridWebContext';
import { boundWebSources, WEB_CONTEXT_BUDGET, type SearchDepth } from './webContextCore';
import type { LinkupTransport } from './localLinkupClient';
import type { FirecrawlTransport } from './localFirecrawlClient';

const evidencePath = join(dirname(fileURLToPath(import.meta.url)), '../../../reports/graph-acceptance/phase-3-final/magnus/hybrid-quality-benchmark.json');

const PAGES: Record<string, { title: string; markdown: string }> = {
	'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html': {
		title: 'TypeScript 5.9',
		markdown: '# TypeScript 5.9\n\nTypeScript 5.9 is the current stable release. Use `npm install -D typescript` to get it.',
	},
	'https://code.visualstudio.com/api/extension-guides/language-model': {
		title: 'Language Model API',
		markdown: '# Language Model tools\n\nRegister tools with `vscode.lm.registerTool` and implement `invoke`. Cite this page, not the retriever.',
	},
	'https://github.com/microsoft/vscode/issues/1': {
		title: 'vscode#1',
		markdown: '# LanguageModelTool invokeTool\n\nExample: `await vscode.lm.invokeTool("prebase_web_search", { query })`.',
	},
	'https://arxiv.org/pdf/1706.03762': {
		title: 'Attention Is All You Need',
		markdown: '# Attention Is All You Need\n\nVaswani et al. introduce the Transformer. DOI 10.48550/arXiv.1706.03762.',
	},
	'https://www.electronjs.org/blog/electron-39-0': {
		title: 'Electron 39.0',
		markdown: '# Electron 39.0\n\nReleased this week. Chromium and Node versions are listed on this official blog post.',
	},
};

const CASES: Array<{
	id: string;
	query: string;
	depth: SearchDepth;
	linkup: Array<{ name: string; url: string; content: string }>;
	expectUrl: string;
	expectPhrase: string;
}> = [
	{
		id: 'current-version',
		query: 'current TypeScript stable version',
		depth: 'fast',
		linkup: [
			{ name: 'TS 5.9 notes', url: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html', content: 'release notes' },
			{ name: 'Mirror', url: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html?utm_source=x', content: 'dup' },
		],
		expectUrl: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html',
		expectPhrase: 'current stable release',
	},
	{
		id: 'official-docs',
		query: 'VS Code language model tools API official documentation',
		depth: 'standard',
		linkup: [
			{ name: 'LM API', url: 'https://code.visualstudio.com/api/extension-guides/language-model', content: 'tools overview snippet' },
		],
		expectUrl: 'https://code.visualstudio.com/api/extension-guides/language-model',
		expectPhrase: 'vscode.lm.registerTool',
	},
	{
		id: 'coding',
		query: 'github issue in repo vscode LanguageModelTool invokeTool',
		depth: 'deep',
		linkup: [{ name: 'Issue', url: 'https://github.com/microsoft/vscode/issues/1', content: 'bug report blurb' }],
		expectUrl: 'https://github.com/microsoft/vscode/issues/1',
		expectPhrase: 'invokeTool',
	},
	{
		id: 'research',
		query: 'arxiv transformer attention is all you need pdf',
		depth: 'deep',
		linkup: [{ name: 'Paper', url: 'https://arxiv.org/pdf/1706.03762', content: 'abstract snippet' }],
		expectUrl: 'https://arxiv.org/pdf/1706.03762',
		expectPhrase: 'Transformer',
	},
	{
		id: 'news',
		query: 'latest Electron release notes today',
		depth: 'standard',
		linkup: [{ name: 'Blog', url: 'https://www.electronjs.org/blog/electron-39-0', content: 'new version' }],
		expectUrl: 'https://www.electronjs.org/blog/electron-39-0',
		expectPhrase: 'Released this week',
	},
];

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(),
		json: async () => body,
	} as Response;
}

function linkupTransport(results: Array<{ name: string; url: string; content: string }>): LinkupTransport {
	return { fetch: async () => jsonResponse({ results }) };
}

function firecrawlTransport(): FirecrawlTransport {
	return {
		fetch: async (input, init) => {
			const url = String(input);
			const body = JSON.parse(String(init?.body)) as { url?: string; query?: string };
			if (url.includes('/search')) {
				return jsonResponse({ data: { web: [] } });
			}
			const resolved = Object.entries(PAGES).find(([pageUrl]) => canonicalMatch(String(body.url), pageUrl));
			if (!resolved) {
				return jsonResponse({ success: false }, 404);
			}
			return jsonResponse({
				success: true,
				data: { markdown: resolved[1].markdown, metadata: { title: resolved[1].title, url: resolved[0] } },
			});
		},
	};
}

function canonicalMatch(requested: string, known: string): boolean {
	try {
		const a = new URL(requested);
		const b = new URL(known);
		return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
	} catch {
		return false;
	}
}

suite('hybrid quality vs LinkUp-only snippets', () => {
	test('hybrid enrichment improves citations and stays inside the 16k tool budget', async () => {
		const rows = [];
		for (const item of CASES) {
			const discovery = boundWebSources(
				item.linkup.map(result => ({
					title: result.name,
					url: result.url,
					excerpt: result.content,
					discoveredBy: ['linkup'] as const,
				})),
				{ maxSources: 6, excerptChars: WEB_CONTEXT_BUDGET.excerptChars[item.depth] },
			);
			const started = Date.now();
			const hybrid = await executeHybridWebSearch(
				{ query: item.query, depth: item.depth },
				{
					linkupKey: 'linkup-key',
					firecrawlKey: 'fc-key',
					linkupTransport: linkupTransport(item.linkup),
					firecrawlTransport: firecrawlTransport(),
				},
			);
			const latencyMs = Date.now() - started;
			const discoveryPayload = JSON.stringify(discovery.sources);
			const hybridPayload = JSON.stringify(hybrid.sources);
			const hybridHasPhrase = hybrid.sources.some(source => source.excerpt.includes(item.expectPhrase));
			const discoveryHasPhrase = discovery.sources.some(source => source.excerpt.includes(item.expectPhrase));
			const hybridHasUrl = hybrid.sources.some(source => source.url.includes(new URL(item.expectUrl).hostname.replace(/^www\./, '')) || source.url === item.expectUrl);
			assert.equal(hybrid.enrichment, 'full');
			assert.ok(hybrid.operations.linkup >= 1);
			assert.ok(hybrid.operations.firecrawlScrape >= 1);
			assert.ok(hybridPayload.length < 16_000, hybridPayload.length);
			assert.ok(hybridHasUrl, hybrid.sources.map(source => source.url).join(','));
			assert.equal(hybridHasPhrase, true);
			assert.equal(discoveryHasPhrase, false);
			assert.ok(!hybridPayload.includes('linkup-key'));
			assert.ok(!hybridPayload.includes('fc-key'));
			rows.push({
				id: item.id,
				depth: item.depth,
				linkupOnly: {
					sourceCount: discovery.sources.length,
					payloadChars: discoveryPayload.length,
					containsVerifiedPhrase: discoveryHasPhrase,
					operations: { linkup: 1, firecrawlSearch: 0, firecrawlScrape: 0 },
				},
				hybrid: {
					sourceCount: hybrid.sources.length,
					payloadChars: hybridPayload.length,
					enriched: hybrid.operations.firecrawlScrape,
					truncated: hybrid.truncated,
					latencyMs,
					containsVerifiedPhrase: hybridHasPhrase,
					citationUrls: hybrid.sources.map(source => source.url),
					operations: hybrid.operations,
				},
			});
		}
		mkdirSync(dirname(evidencePath), { recursive: true });
		writeFileSync(evidencePath, JSON.stringify({
			at: new Date().toISOString(),
			mode: 'deterministic-fixtures',
			note: 'Compares LinkUp snippet-only envelopes with LinkUp+Firecrawl hybrid on the same ranked URLs. Not a live provider score.',
			rows,
		}, null, 2));
		assert.equal(rows.length, CASES.length);
		assert.ok(rows.every(row => row.hybrid.containsVerifiedPhrase && !row.linkupOnly.containsVerifiedPhrase));
	});
});
