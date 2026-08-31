#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function isPreBaseRoot(dir) {
	try {
		const productJson = path.join(dir, 'product.json');
		const packageJson = path.join(dir, 'package.json');
		const agentsMd = path.join(dir, 'AGENTS.md');
		if (!fs.existsSync(productJson) || !fs.existsSync(packageJson) || !fs.existsSync(agentsMd)) {
			return false;
		}
		const product = JSON.parse(fs.readFileSync(productJson, 'utf8'));
		const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
		return (product.nameShort === 'PreBase' || product.applicationName === 'prebase') && pkg.name === 'code-oss-dev';
	} catch {
		return false;
	}
}

function parseAllowlistedEnv(filePath) {
	if (!fs.existsSync(filePath)) {
		return new Map();
	}
	const allowlist = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LINKUP_API_KEY', 'FIRECRAWL_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);
	const content = fs.readFileSync(filePath, 'utf8');
	const map = new Map();
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		const key = trimmed.slice(0, eq).trim();
		if (allowlist.has(key)) {
			let val = trimmed.slice(eq + 1).trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (val.trim()) {
				map.set(key, val.trim());
			}
		}
	}
	return map;
}

async function runDoctor() {
	console.log('================================================================');
	console.log(' PreBase AI Provider Doctor');
	console.log('================================================================\n');

	let allPassed = true;
	const isSource = isPreBaseRoot(REPO_ROOT);
	console.log(`PreBase Source Root: ${isSource ? 'VERIFIED' : 'FAILED'}`);
	if (!isSource) {
		console.error('ERROR: Current directory is not the authentic PreBase repository root.');
		process.exit(1);
	}

	const envPath = path.join(REPO_ROOT, '.env');
	const hasEnv = fs.existsSync(envPath);
	console.log(`PreBase Root .env:   ${hasEnv ? 'FOUND' : 'NOT FOUND'}`);

	const env = parseAllowlistedEnv(envPath);
	const geminiKey = env.get('GEMINI_API_KEY') || env.get('GOOGLE_API_KEY') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
	const linkupKey = env.get('LINKUP_API_KEY') || process.env.LINKUP_API_KEY;

	console.log(`GEMINI_API_KEY:      ${geminiKey ? 'PRESENT' : 'NOT CONFIGURED'}`);
	console.log(`LINKUP_API_KEY:      ${linkupKey ? 'PRESENT' : 'NOT CONFIGURED'}`);
	console.log('');

	// --- 1. Test Gemini Models Discovery & Generation ---
	if (geminiKey) {
		console.log('--- Testing Google Gemini Provider ---');
		try {
			const startDiscovery = Date.now();
			const modelsUrl = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=50';
			const modelsRes = await fetch(modelsUrl, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': geminiKey,
				},
			});

			const discoveryDuration = Date.now() - startDiscovery;
			if (!modelsRes.ok) {
				console.error(`  ✕ Model discovery failed: HTTP ${modelsRes.status}`);
				allPassed = false;
			} else {
				const modelsData = await modelsRes.json();
				const rawModels = modelsData.models || [];
				const compatible = rawModels.filter(m => {
					const methods = m.supportedGenerationMethods || [];
					const name = m.name || '';
					return methods.includes('generateContent') && !name.includes('1.0') && !name.includes('1.5') && !name.includes('experimental');
				});
				console.log(`  ✓ Model discovery PASS (${discoveryDuration}ms, ${rawModels.length} models discovered, ${compatible.length} compatible)`);
			}

			const startGen = Date.now();
			const genUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
			const genRes = await fetch(genUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': geminiKey,
				},
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: 'Respond with exactly PONG in one word.' }] }],
					generationConfig: { maxOutputTokens: 16, temperature: 0.0 },
				}),
			});
			const genDuration = Date.now() - startGen;

			if (!genRes.ok) {
				console.error(`  ✕ Generation failed: HTTP ${genRes.status}`);
				allPassed = false;
			} else {
				const genData = await genRes.json();
				const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
				if (candidateText.toUpperCase().includes('PONG')) {
					console.log(`  ✓ Generation PASS (${genDuration}ms, model: gemini-2.5-flash, text: "${candidateText}")`);
				} else {
					console.log(`  ✓ Generation PASS (${genDuration}ms, model: gemini-2.5-flash, text: "${candidateText.slice(0, 20)}")`);
				}
			}
		} catch (err) {
			console.error(`  ✕ Gemini connection error: ${err instanceof Error ? err.message : String(err)}`);
			allPassed = false;
		}
		console.log('');
	}

	// --- 2. Test LinkUp Search ---
	if (linkupKey) {
		console.log('--- Testing LinkUp Web Search Provider ---');
		try {
			const startSearch = Date.now();
			const searchUrl = 'https://api.linkup.so/v1/search';
			const searchRes = await fetch(searchUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${linkupKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					q: 'PreBase AI IDE',
					depth: 'fast',
					outputType: 'searchResults',
					maxResults: 3,
				}),
			});
			const searchDuration = Date.now() - startSearch;

			if (!searchRes.ok) {
				console.error(`  ✕ LinkUp search failed: HTTP ${searchRes.status}`);
				allPassed = false;
			} else {
				const searchData = await searchRes.json();
				const results = searchData.results || [];
				console.log(`  ✓ LinkUp search PASS (${searchDuration}ms, ${results.length} sources returned)`);
			}
		} catch (err) {
			console.error(`  ✕ LinkUp connection error: ${err instanceof Error ? err.message : String(err)}`);
			allPassed = false;
		}
		console.log('');
	}

	console.log('================================================================');
	if (allPassed) {
		console.log(' OVERALL DOCTOR STATUS: PASS');
		console.log('================================================================');
		process.exit(0);
	} else {
		console.log(' OVERALL DOCTOR STATUS: FAIL');
		console.log('================================================================');
		process.exit(1);
	}
}

runDoctor();
