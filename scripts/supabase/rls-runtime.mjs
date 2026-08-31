#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_ENV = [
	'PREBASE_RLS_TEST_NON_PRODUCTION',
	'PREBASE_RLS_TEST_URL',
	'PREBASE_RLS_TEST_PUBLISHABLE_KEY',
	'PREBASE_RLS_TEST_USER_A_EMAIL',
	'PREBASE_RLS_TEST_USER_A_PASSWORD',
	'PREBASE_RLS_TEST_USER_B_EMAIL',
	'PREBASE_RLS_TEST_USER_B_PASSWORD',
];
const ACTIVATION_VALUE = 'acknowledged';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

function artifactPath() {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const directory = process.env.PREBASE_RLS_TEST_ARTIFACT_DIR || path.join(ROOT, 'reports', 'rls-runtime');
	return path.join(directory, `rls-runtime-${timestamp}.json`);
}

async function writeArtifact(file, artifact) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
}

function publicError(error) {
	if (error instanceof Error) {
		return error.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
	}
	return String(error).slice(0, 300);
}

function loadConfiguration() {
	const provided = REQUIRED_ENV.filter(name => process.env[name]);
	if (provided.length === 0) {
		return { kind: 'skip', reason: 'Dedicated non-production RLS credentials are not configured.' };
	}
	const missing = REQUIRED_ENV.filter(name => !process.env[name]);
	if (missing.length) {
		throw new Error(`Partial RLS runtime configuration; missing ${missing.join(', ')}.`);
	}
	if (process.env.PREBASE_RLS_TEST_NON_PRODUCTION !== ACTIVATION_VALUE) {
		throw new Error(`PREBASE_RLS_TEST_NON_PRODUCTION must be exactly '${ACTIVATION_VALUE}'.`);
	}
	let baseUrl;
	try {
		baseUrl = new URL(process.env.PREBASE_RLS_TEST_URL);
	} catch {
		throw new Error('PREBASE_RLS_TEST_URL must be a valid HTTPS URL or a local HTTP URL.');
	}
	const localHttp = baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(baseUrl.hostname);
	if (!(baseUrl.protocol === 'https:' || localHttp) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
		throw new Error('PREBASE_RLS_TEST_URL must be an HTTPS URL or a local HTTP URL without credentials, query, or fragment.');
	}
	baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/`;
	return {
		kind: 'run',
		baseUrl,
		publishableKey: process.env.PREBASE_RLS_TEST_PUBLISHABLE_KEY,
		userA: { email: process.env.PREBASE_RLS_TEST_USER_A_EMAIL, password: process.env.PREBASE_RLS_TEST_USER_A_PASSWORD },
		userB: { email: process.env.PREBASE_RLS_TEST_USER_B_EMAIL, password: process.env.PREBASE_RLS_TEST_USER_B_PASSWORD },
	};
}

function endpoint(config, relative) {
	return new URL(relative, config.baseUrl).toString();
}

async function request(url, options = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		const body = await response.text();
		if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
			throw new Error(`RLS harness response exceeds the ${MAX_RESPONSE_BYTES / 1024} KiB limit.`);
		}
		let json;
		if (body) {
			try {
				json = JSON.parse(body);
			} catch {
				json = undefined;
			}
		}
		return { status: response.status, json };
	} finally {
		clearTimeout(timer);
	}
}

async function signIn(config, credentials) {
	const response = await request(endpoint(config, 'auth/v1/token?grant_type=password'), {
		method: 'POST',
		headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
		body: JSON.stringify(credentials),
	});
	const accessToken = response.json?.access_token;
	const userId = response.json?.user?.id;
	if (response.status !== 200 || typeof accessToken !== 'string' || typeof userId !== 'string') {
		throw new Error(`Dedicated test-user sign-in failed (HTTP ${response.status}).`);
	}
	return { accessToken, userId };
}

function restUrl(config, table, query = '') {
	return endpoint(config, `rest/v1/${table}${query ? `?${query}` : ''}`);
}

function userHeaders(config, user, extra = {}) {
	return { apikey: config.publishableKey, authorization: `Bearer ${user.accessToken}`, ...extra };
}

async function rest(config, user, table, method, query, body, extraHeaders = {}) {
	return request(restUrl(config, table, query), {
		method,
		headers: userHeaders(config, user, {
			'content-type': 'application/json',
			prefer: 'return=representation',
			...extraHeaders,
		}),
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function anonymousRead(config, table, query) {
	return request(restUrl(config, table, query), { headers: { apikey: config.publishableKey } });
}

function assertRows(response, expected, name) {
	if (response.status !== 200 || !Array.isArray(response.json) || response.json.length !== expected) {
		throw new Error(`${name}: expected ${expected} row(s), received HTTP ${response.status}.`);
	}
	return response.json;
}

function readOptionalRow(response, name) {
	if (response.status !== 200 || !Array.isArray(response.json) || response.json.length > 1) {
		throw new Error(`${name}: expected at most one row, received HTTP ${response.status}.`);
	}
	return response.json[0];
}

function assertNoVisibleRows(response, name) {
	if (response.status >= 200 && response.status < 300 && (!Array.isArray(response.json) || response.json.length !== 0)) {
		throw new Error(`${name}: unauthorized rows were visible.`);
	}
}

function assertDeniedWrite(response, name) {
	if (response.status >= 200 && response.status < 300) {
		throw new Error(`${name}: unauthorized write was accepted (HTTP ${response.status}).`);
	}
}

async function main() {
	const file = artifactPath();
	const artifact = {
		schemaVersion: 1,
		kind: 'prebase-supabase-rls-runtime',
		startedAt: new Date().toISOString(),
		status: 'running',
		cases: [],
	};
	const record = (id, status, detail) => artifact.cases.push({ id, status, ...(detail ? { detail } : {}) });
	const cleanup = [];

	try {
		const config = loadConfiguration();
		if (config.kind === 'skip') {
			artifact.status = 'skip';
			artifact.reason = config.reason;
			return;
		}

		const a = await signIn(config, config.userA);
		const b = await signIn(config, config.userB);
		if (a.userId === b.userId) {
			throw new Error('RLS runtime harness requires two distinct dedicated users.');
		}
		record('authenticate-two-distinct-users', 'pass');

		const marker = `prebase-rls-${crypto.randomUUID()}`;
		const ids = { session: crypto.randomUUID(), run: crypto.randomUUID(), event: crypto.randomUUID() };
		const profileBefore = readOptionalRow(await rest(config, a, 'profiles', 'GET', `id=eq.${a.userId}&select=id,display_name,avatar_url`), 'read profile snapshot');
		const preferencesBefore = readOptionalRow(await rest(config, a, 'user_preferences', 'GET', `user_id=eq.${a.userId}&select=user_id,preferences,schema_version`), 'read preferences snapshot');

		if (profileBefore) {
			assertRows(await rest(config, a, 'profiles', 'PATCH', `id=eq.${a.userId}`, { display_name: marker, avatar_url: null }), 1, 'write owned profile');
		} else {
			assertRows(await rest(config, a, 'profiles', 'POST', '', { id: a.userId, display_name: marker, avatar_url: null }), 1, 'create owned profile');
		}
		cleanup.push(async () => {
			if (profileBefore) {
				assertRows(await rest(config, a, 'profiles', 'PATCH', `id=eq.${a.userId}`, { display_name: profileBefore.display_name, avatar_url: profileBefore.avatar_url }), 1, 'restore profile');
			} else {
				assertRows(await rest(config, a, 'profiles', 'DELETE', `id=eq.${a.userId}`), 1, 'cleanup profile');
			}
		});
		if (preferencesBefore) {
			assertRows(await rest(config, a, 'user_preferences', 'PATCH', `user_id=eq.${a.userId}`, { preferences: { rls_harness: marker }, schema_version: preferencesBefore.schema_version }), 1, 'write owned preferences');
		} else {
			assertRows(await rest(config, a, 'user_preferences', 'POST', '', { user_id: a.userId, preferences: { rls_harness: marker }, schema_version: 1 }), 1, 'create owned preferences');
		}
		cleanup.push(async () => {
			if (preferencesBefore) {
				assertRows(await rest(config, a, 'user_preferences', 'PATCH', `user_id=eq.${a.userId}`, { preferences: preferencesBefore.preferences, schema_version: preferencesBefore.schema_version }), 1, 'restore preferences');
			} else {
				assertRows(await rest(config, a, 'user_preferences', 'DELETE', `user_id=eq.${a.userId}`), 1, 'cleanup preferences');
			}
		});
		assertRows(await rest(config, a, 'agent_sessions', 'POST', '', { id: ids.session, user_id: a.userId, title: marker }), 1, 'create owned session');
		cleanup.push(async () => { assertRows(await rest(config, a, 'agent_sessions', 'DELETE', `id=eq.${ids.session}`), 1, 'cleanup session'); });
		assertRows(await rest(config, a, 'agent_runs', 'POST', '', { id: ids.run, session_id: ids.session, user_id: a.userId, task_text: marker, status: 'pending' }), 1, 'create owned run');
		cleanup.push(async () => { assertRows(await rest(config, a, 'agent_runs', 'DELETE', `id=eq.${ids.run}`), 1, 'cleanup run'); });
		assertRows(await rest(config, a, 'agent_events', 'POST', '', { id: ids.event, session_id: ids.session, run_id: ids.run, user_id: a.userId, sequence_number: 1, event_type: 'rls_harness', content: { marker } }), 1, 'create owned event');
		cleanup.push(async () => { assertRows(await rest(config, a, 'agent_events', 'DELETE', `id=eq.${ids.event}`), 1, 'cleanup event'); });
		record('a-create-and-read-owned-profile-preferences-session-run-event', 'pass');

		const ownedRows = [
			['profiles', `id=eq.${a.userId}`],
			['user_preferences', `user_id=eq.${a.userId}`],
			['agent_sessions', `id=eq.${ids.session}`],
			['agent_runs', `id=eq.${ids.run}`],
			['agent_events', `id=eq.${ids.event}`],
		];
		for (const [table, query] of ownedRows) {
			assertNoVisibleRows(await rest(config, b, table, 'GET', `${query}&select=*`), `B select ${table}`);
			assertNoVisibleRows(await anonymousRead(config, table, `${query}&select=*`), `anonymous select ${table}`);
		}
		for (const table of ['agent_usage', 'web_search_usage']) {
			assertNoVisibleRows(await rest(config, b, table, 'GET', `user_id=eq.${a.userId}&select=*`), `B select ${table}`);
			assertNoVisibleRows(await anonymousRead(config, table, `user_id=eq.${a.userId}&select=*`), `anonymous select ${table}`);
		}
		record('b-and-anonymous-cannot-read-a-data', 'pass');

		for (const [table, query, patch] of [
			['profiles', `id=eq.${a.userId}`, { display_name: `forbidden-${marker}` }],
			['user_preferences', `user_id=eq.${a.userId}`, { preferences: { forbidden: marker } }],
			['agent_sessions', `id=eq.${ids.session}`, { title: `forbidden-${marker}` }],
			['agent_runs', `id=eq.${ids.run}`, { task_text: `forbidden-${marker}` }],
			['agent_events', `id=eq.${ids.event}`, { event_type: 'forbidden' }],
		]) {
			const changed = await rest(config, b, table, 'PATCH', query, patch);
			if (changed.status >= 200 && changed.status < 300) {
				assertRows(changed, 0, `B update ${table}`);
			}
			const removed = await rest(config, b, table, 'DELETE', query);
			if (removed.status >= 200 && removed.status < 300) {
				assertRows(removed, 0, `B delete ${table}`);
			}
		}
		for (const [table, query] of ownedRows) {
			assertRows(await rest(config, a, table, 'GET', `${query}&select=*`), 1, `A row survived B mutation attempt on ${table}`);
		}
		record('b-cannot-update-or-delete-a-data', 'pass');

		assertDeniedWrite(await rest(config, b, 'agent_sessions', 'POST', '', { id: crypto.randomUUID(), user_id: a.userId, title: marker }), 'B forge session for A');
		assertDeniedWrite(await rest(config, b, 'agent_runs', 'POST', '', { id: crypto.randomUUID(), session_id: ids.session, user_id: a.userId, task_text: marker, status: 'pending' }), 'B forge run for A');
		assertDeniedWrite(await rest(config, b, 'agent_events', 'POST', '', { id: crypto.randomUUID(), session_id: ids.session, run_id: ids.run, user_id: a.userId, sequence_number: 2, event_type: 'forbidden', content: {} }), 'B forge event for A');
		assertDeniedWrite(await rest(config, a, 'agent_usage', 'POST', '', { user_id: a.userId, request_id: marker, model: 'rls-harness' }), 'A client write to agent_usage');
		assertDeniedWrite(await rest(config, a, 'web_search_usage', 'POST', '', { user_id: a.userId, request_id: marker, depth: 'fast', units: 1 }), 'A client write to web_search_usage');
		record('forged-cross-user-and-server-ledger-writes-are-denied', 'pass');

		assertRows(await rest(config, a, 'agent_sessions', 'PATCH', `id=eq.${ids.session}`, { title: `${marker}-updated` }), 1, 'A update own session');
		record('a-can-update-own-session', 'pass');
		artifact.status = 'pass';
	} catch (error) {
		artifact.status = 'fail';
		artifact.error = publicError(error);
	} finally {
		if (cleanup.length) {
			try {
				for (const clean of [...cleanup].reverse()) {
					await clean();
				}
				record('cleanup-and-restore', 'pass');
			} catch (error) {
				record('cleanup-and-restore', 'fail', publicError(error));
				artifact.status = 'fail';
			}
		}
		artifact.completedAt = new Date().toISOString();
		await writeArtifact(file, artifact);
		console.log(`supabase:rls-runtime: ${artifact.status.toUpperCase()} (${file})`);
	}

	if (artifact.status === 'fail') {
		process.exitCode = 1;
	}
}

await main();
