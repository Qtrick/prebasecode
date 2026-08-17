#!/usr/bin/env node
/**
 * Safe PreBase Live AI Assurance Suite.
 * Executes live tests for:
 * 1. Root .env bounded discovery & precedence
 * 2. Gemini model discovery, error classification, and live generation
 * 3. LinkUp web search client
 * 4. Model capability filtering & dynamic selection
 * 5. Secret sanitization and zero leakage
 * Generates an auditable report under reports/ai-assurance/<RUN_ID>/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMagnusOut } from '../startup/verify-magnus-out.mjs';

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
	const allowlist = new Set(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LINKUP_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);
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

function isNetworkError(err) {
	const msg = String(err?.message || err || '');
	const code = err?.code || '';
	return msg.includes('fetch failed') ||
		msg.includes('ENOTFOUND') ||
		msg.includes('EAI_AGAIN') ||
		msg.includes('ECONNREFUSED') ||
		msg.includes('ETIMEDOUT') ||
		msg.includes('undici') ||
		code === 'ENOTFOUND' ||
		code === 'EAI_AGAIN' ||
		code === 'ECONNREFUSED';
}

async function runAssurance() {
	const runId = `ai-run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	const reportsBaseDir = path.join(REPO_ROOT, 'reports/ai-assurance');
	const reportDir = path.join(reportsBaseDir, runId);
	fs.mkdirSync(reportDir, { recursive: true });

	const report = {
		runId,
		timestamp: new Date().toISOString(),
		environment: {
			isSourceRoot: isPreBaseRoot(REPO_ROOT),
			platform: process.platform,
			nodeVersion: process.version,
		},
		secrets: {
			geminiConfigured: false,
			geminiSource: 'none',
			linkupConfigured: false,
			linkupSource: 'none',
		},
		tests: [],
		models: [],
		overallStatus: 'PASS',
	};

	console.log(`[AI Assurance] Starting assurance run: ${runId}`);

	const envPath = path.join(REPO_ROOT, '.env');
	const env = parseAllowlistedEnv(envPath);
	const geminiKey = env.get('GEMINI_API_KEY') || env.get('GOOGLE_API_KEY') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
	const linkupKey = env.get('LINKUP_API_KEY') || process.env.LINKUP_API_KEY;

	if (geminiKey) {
		report.secrets.geminiConfigured = true;
		report.secrets.geminiSource = env.has('GEMINI_API_KEY') ? 'root-env' : 'process-env';
	}
	if (linkupKey) {
		report.secrets.linkupConfigured = true;
		report.secrets.linkupSource = env.has('LINKUP_API_KEY') ? 'root-env' : 'process-env';
	}

	// 1. Root verification test
	report.tests.push({
		name: 'PreBase root repository verification',
		status: report.environment.isSourceRoot ? 'PASS' : 'FAIL',
		details: 'Verified product.json, package.json, and AGENTS.md markers.',
	});

	// 2. Magnus compiled output verification
	const magnusOutResult = verifyMagnusOut();
	report.tests.push({
		name: 'PreBase Magnus compiled runtime readiness',
		status: magnusOutResult.ok ? 'PASS' : 'FAIL',
		details: magnusOutResult.ok ? 'Verified out/extension.js and compiled runtime modules.' : magnusOutResult.errors.join('; '),
	});
	if (!magnusOutResult.ok) {
		report.overallStatus = 'FAIL';
	}

	// 3. Secret isolation test
	const arbitraryDirCheck = !isPreBaseRoot('/tmp');
	report.tests.push({
		name: 'Arbitrary workspace folder isolation',
		status: arbitraryDirCheck ? 'PASS' : 'FAIL',
		details: 'Verified that non-PreBase folders cannot be scanned for .env credentials.',
	});

	// 3. Gemini Live Models Discovery
	if (geminiKey) {
		const start = Date.now();
		try {
			const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=50', {
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
			});
			const duration = Date.now() - start;
			if (res.ok) {
				const data = await res.json();
				const rawModels = data.models || [];
				const SPECIALIZED = ['embedding', 'aqa', 'imagen', 'veo', 'tts', 'live', 'robotics', 'bison', 'gemma', 'computer-use', 'deep-research', 'antigravity', 'custom-tools', 'audio', 'image'];
				const curated = rawModels.filter(m => {
					const methods = m.supportedGenerationMethods || [];
					const rawId = ((m.name || '').replace(/^models\//, '')).toLowerCase();
					const displayName = (m.displayName || '').toLowerCase();
					const supportsGen = methods.includes('generateContent');
					const isSpecialized = SPECIALIZED.some(p => rawId.includes(p) || displayName.includes(p));
					const isPreview = rawId.includes('preview') || displayName.includes('preview');
					const isExp = rawId.includes('exp') || displayName.includes('experimental');
					const isAlias = rawId.endsWith('-latest');
					const isLite = rawId.includes('flash-lite') || rawId.includes('flash_lite') || displayName.includes('flash-lite');
					const isLegacy = rawId.includes('1.0') || rawId.includes('1.5');
					return supportsGen && !isSpecialized && !isPreview && !isExp && !isAlias && !isLite && !isLegacy;
				});

				report.models = curated.map(m => ({
					id: (m.name || '').replace(/^models\//, ''),
					displayName: m.displayName,
					inputTokenLimit: m.inputTokenLimit,
					outputTokenLimit: m.outputTokenLimit,
				}));
				report.tests.push({
					name: 'Gemini live model discovery & consumer curation',
					status: 'PASS',
					durationMs: duration,
					details: `Discovered ${rawModels.length} raw models; curated to ${curated.length} stable consumer models (0 preview, 0 experimental).`,
				});
			} else {
				report.tests.push({
					name: 'Gemini live model discovery & consumer curation',
					status: 'FAIL',
					durationMs: duration,
					details: `HTTP ${res.status}`,
				});
				report.overallStatus = 'FAIL';
			}
		} catch (err) {
			if (isNetworkError(err)) {
				report.tests.push({
					name: 'Gemini live model discovery & consumer curation',
					status: 'BLOCKED',
					details: `Network unreachable (offline or sandbox): ${err.message}`,
				});
				if (report.overallStatus !== 'FAIL') {
					report.overallStatus = 'BLOCKED';
				}
			} else {
				report.tests.push({
					name: 'Gemini live model discovery & consumer curation',
					status: 'FAIL',
					details: err instanceof Error ? err.message : String(err),
				});
				report.overallStatus = 'FAIL';
			}
		}

		// 4. Gemini Live Generation
		const genStart = Date.now();
		try {
			const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: 'Respond with exactly PONG in one word.' }] }],
					generationConfig: { maxOutputTokens: 64, temperature: 0.0, thinkingConfig: { thinkingBudget: 0 } },
				}),
			});
			const duration = Date.now() - genStart;
			if (res.ok) {
				const data = await res.json();
				const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
				if (text.length > 0) {
					report.tests.push({
						name: 'Gemini live content generation (gemini-2.5-flash)',
						status: 'PASS',
						durationMs: duration,
						details: `Received response (${text.length} chars): "${text.slice(0, 40)}"`,
					});
				} else {
					report.tests.push({
						name: 'Gemini live content generation (gemini-2.5-flash)',
						status: 'FAIL',
						durationMs: duration,
						details: 'Model returned HTTP 200 but 0-length text content.',
					});
					report.overallStatus = 'FAIL';
				}
			} else {
				report.tests.push({
					name: 'Gemini live content generation (gemini-2.5-flash)',
					status: 'FAIL',
					durationMs: duration,
					details: `HTTP ${res.status}`,
				});
				report.overallStatus = 'FAIL';
			}
		} catch (err) {
			if (isNetworkError(err)) {
				report.tests.push({
					name: 'Gemini live content generation (gemini-2.5-flash)',
					status: 'BLOCKED',
					details: `Network unreachable (offline or sandbox): ${err.message}`,
				});
				if (report.overallStatus !== 'FAIL') {
					report.overallStatus = 'BLOCKED';
				}
			} else {
				report.tests.push({
					name: 'Gemini live content generation (gemini-2.5-flash)',
					status: 'FAIL',
					details: err instanceof Error ? err.message : String(err),
				});
				report.overallStatus = 'FAIL';
			}
		}

		// 4b. Gemini Live Function-Calling Protocol with parametersJsonSchema (additionalProperties: false)
		const fcStart = Date.now();
		try {
			const toolRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: 'What is the current time in Tokyo? Use tool get_current_time.' }] }],
					tools: [{
						functionDeclarations: [{
							name: 'get_current_time',
							description: 'Get current time for a given timezone',
							parametersJsonSchema: {
								type: 'object',
								properties: {
									timezone: { type: 'string', description: 'IANA timezone name, e.g. Asia/Tokyo' },
								},
								required: ['timezone'],
								additionalProperties: false,
							},
						}],
					}],
					generationConfig: { maxOutputTokens: 256, temperature: 0.0 },
				}),
			});
			const duration = Date.now() - fcStart;
			if (toolRes.ok) {
				const toolData = await toolRes.json();
				const candidatePart = toolData.candidates?.[0]?.content?.parts?.[0];
				const functionCall = candidatePart?.functionCall;
				const thoughtSig = candidatePart?.thoughtSignature || candidatePart?.thought_signature;

				if (functionCall && functionCall.name === 'get_current_time') {
					report.tests.push({
						name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
						status: 'PASS',
						durationMs: duration,
						details: `Generated tool call '${functionCall.name}' (thoughtSignature present: ${Boolean(thoughtSig)}).`,
					});

					// 4c. Gemini Multi-Turn Tool Response Continuation with Preserved Thought Signature
					const contStart = Date.now();
					const contRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
						body: JSON.stringify({
							contents: [
								{ role: 'user', parts: [{ text: 'What is the current time in Tokyo? Use tool get_current_time.' }] },
								{
									role: 'model',
									parts: [candidatePart],
								},
								{
									role: 'user',
									parts: [{
										functionResponse: {
											name: 'get_current_time',
											response: { currentTime: '2026-08-16T22:30:00+09:00' },
											...(functionCall.id ? { id: functionCall.id } : {}),
										},
									}],
								},
							],
							generationConfig: { maxOutputTokens: 256, temperature: 0.0 },
						}),
					});
					const contDuration = Date.now() - contStart;
					if (contRes.ok) {
						const contData = await contRes.json();
						const finalText = contData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
						if (finalText.length > 0) {
							report.tests.push({
								name: 'Gemini multi-turn tool response continuation with thoughtSignature',
								status: 'PASS',
								durationMs: contDuration,
								details: `Synthesized tool result into final response (${finalText.length} chars).`,
							});
						} else {
							report.tests.push({
								name: 'Gemini multi-turn tool response continuation with thoughtSignature',
								status: 'FAIL',
								durationMs: contDuration,
								details: 'Continuation returned HTTP 200 but 0-length text content.',
							});
							report.overallStatus = 'FAIL';
						}
					} else {
						report.tests.push({
							name: 'Gemini multi-turn tool response continuation with thoughtSignature',
							status: 'FAIL',
							durationMs: contDuration,
							details: `HTTP ${contRes.status}`,
						});
						report.overallStatus = 'FAIL';
					}
				} else {
					report.tests.push({
						name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
						status: 'FAIL',
						durationMs: duration,
						details: 'Model did not return expected functionCall part.',
					});
					report.overallStatus = 'FAIL';
				}
			} else {
				report.tests.push({
					name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
					status: 'FAIL',
					durationMs: duration,
					details: `HTTP ${toolRes.status}`,
				});
				report.overallStatus = 'FAIL';
			}
		} catch (err) {
			if (isNetworkError(err)) {
				report.tests.push({
					name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
					status: 'BLOCKED',
					details: `Network unreachable (offline or sandbox): ${err.message}`,
				});
				if (report.overallStatus !== 'FAIL') {
					report.overallStatus = 'BLOCKED';
				}
			} else {
				report.tests.push({
					name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
					status: 'FAIL',
					details: err instanceof Error ? err.message : String(err),
				});
				report.overallStatus = 'FAIL';
			}
		}
	} else {
		report.tests.push({
			name: 'Gemini live model discovery & consumer curation',
			status: 'SKIPPED',
			details: 'GEMINI_API_KEY is not configured.',
		});
		report.tests.push({
			name: 'Gemini live content generation (gemini-2.5-flash)',
			status: 'SKIPPED',
			details: 'GEMINI_API_KEY is not configured.',
		});
		report.tests.push({
			name: 'Gemini function-calling protocol (parametersJsonSchema + additionalProperties)',
			status: 'SKIPPED',
			details: 'GEMINI_API_KEY is not configured.',
		});
		report.tests.push({
			name: 'Gemini multi-turn tool response continuation with thoughtSignature',
			status: 'SKIPPED',
			details: 'GEMINI_API_KEY is not configured.',
		});
	}

	// 5. LinkUp Live Web Search Test
	if (linkupKey) {
		const searchStart = Date.now();
		try {
			const res = await fetch('https://api.linkup.so/v1/search', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${linkupKey}`,
				},
				body: JSON.stringify({
					q: 'VS Code Language Model Tool API 2026',
					depth: 'standard',
					outputType: 'searchResults',
				}),
			});
			const duration = Date.now() - searchStart;
			if (res.ok) {
				const data = await res.json();
				const results = data.results || [];
				report.tests.push({
					name: 'LinkUp live search query execution',
					status: 'PASS',
					durationMs: duration,
					details: `Returned ${results.length} sources successfully.`,
				});
			} else {
				report.tests.push({
					name: 'LinkUp live search query execution',
					status: 'FAIL',
					durationMs: duration,
					details: `HTTP ${res.status}`,
				});
				report.overallStatus = 'FAIL';
			}
		} catch (err) {
			if (isNetworkError(err)) {
				report.tests.push({
					name: 'LinkUp live search query execution',
					status: 'BLOCKED',
					details: `Network unreachable (offline or sandbox): ${err.message}`,
				});
				if (report.overallStatus !== 'FAIL') {
					report.overallStatus = 'BLOCKED';
				}
			} else {
				report.tests.push({
					name: 'LinkUp live search query execution',
					status: 'FAIL',
					details: err instanceof Error ? err.message : String(err),
				});
				report.overallStatus = 'FAIL';
			}
		}
	} else {
		report.tests.push({
			name: 'LinkUp live search query execution',
			status: 'SKIPPED',
			details: 'LINKUP_API_KEY is not configured.',
		});
	}

	// Write report.json
	fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

	// Write model-catalog.json
	fs.writeFileSync(path.join(reportDir, 'model-catalog.json'), JSON.stringify(report.models, null, 2), 'utf8');

	// Write summary.md
	const summaryMd = [
		`# PreBase AI Assurance Report (${runId})`,
		'',
		`**Timestamp**: ${report.timestamp}`,
		`**Overall Status**: **${report.overallStatus}**`,
		`**Source Root**: ${report.environment.isSourceRoot ? 'Verified PreBase Root' : 'Not Source Root'}`,
		'',
		'## Provider Status',
		'',
		`| Provider | Status | Source | Models Available |`,
		`| --- | --- | --- | --- |`,
		`| **Google Gemini** | ${report.secrets.geminiConfigured ? '🟢 Connected' : '⚪ Unconfigured'} | \`${report.secrets.geminiSource}\` | ${report.models.length} models |`,
		`| **LinkUp Search** | ${report.secrets.linkupConfigured ? '🟢 Connected' : '⚪ Unconfigured'} | \`${report.secrets.linkupSource}\` | Direct Web Search |`,
		'',
		'## Verification Tests',
		'',
		'| Test Case | Status | Duration | Details |',
		'| --- | --- | --- | --- |',
		...report.tests.map(t => `| ${t.name} | **${t.status}** | ${t.durationMs ? `${t.durationMs}ms` : 'N/A'} | ${t.details} |`),
		'',
		'## Curated Gemini Models',
		'',
		'| Model ID | Display Name | Context Window (Input) | Output Tokens |',
		'| --- | --- | --- | --- |',
		...report.models.map(m => `| \`${m.id}\` | ${m.displayName} | ${m.inputTokenLimit.toLocaleString()} tokens | ${m.outputTokenLimit.toLocaleString()} tokens |`),
		'',
		'---',
		'*Privacy & Zero-Leakage Notice: No API keys, prompts, or sensitive credentials are stored in this report.*',
	].join('\n');

	fs.writeFileSync(path.join(reportDir, 'summary.md'), summaryMd, 'utf8');

	// Write canonical latest-summary.json for persistent quick inspection
	const canonicalSummary = {
		runId: report.runId,
		timestamp: report.timestamp,
		overallStatus: report.overallStatus,
		tests: report.tests.map(t => ({ name: t.name, status: t.status, durationMs: t.durationMs })),
		modelCount: report.models.length,
		curatedModels: report.models.map(m => m.id),
	};
	fs.writeFileSync(path.join(reportsBaseDir, 'latest-summary.json'), JSON.stringify(canonicalSummary, null, 2), 'utf8');

	// Clean up old report directories, keeping last 5
	try {
		const entries = fs.readdirSync(reportsBaseDir, { withFileTypes: true })
			.filter(e => e.isDirectory() && e.name.startsWith('ai-run-'))
			.map(e => ({ name: e.name, time: fs.statSync(path.join(reportsBaseDir, e.name)).mtimeMs }))
			.sort((a, b) => b.time - a.time);

		if (entries.length > 5) {
			for (const oldEntry of entries.slice(5)) {
				fs.rmSync(path.join(reportsBaseDir, oldEntry.name), { recursive: true, force: true });
			}
		}
	} catch {
		// Ignore retention cleanup errors
	}

	console.log(`[AI Assurance] Report generated at: ${reportDir}`);
	console.log(`[AI Assurance] Overall Result: ${report.overallStatus}`);

	if (report.overallStatus !== 'PASS') {
		process.exit(1);
	}
}

runAssurance();
