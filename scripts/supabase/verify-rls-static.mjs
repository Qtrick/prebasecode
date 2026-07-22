#!/usr/bin/env node
/**
 * Static adversarial RLS checklist for PreBase cloud tables.
 * Runtime two-user tests require a dedicated test project + Auth users;
 * this script documents required cases and fails if migrations lack ownership checks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migDir = path.join(root, 'supabase/migrations');
const sql = fs.readdirSync(migDir)
	.filter(f => f.endsWith('.sql'))
	.sort()
	.map(f => fs.readFileSync(path.join(migDir, f), 'utf8'))
	.join('\n');

const required = [
	{ id: 'profiles_own', re: /profiles_select_own[\s\S]*\(select auth\.uid\(\)\)\s*=\s*id/ },
	{ id: 'prefs_own', re: /user_preferences_select_own[\s\S]*\(select auth\.uid\(\)\)\s*=\s*user_id/ },
	{ id: 'sessions_own', re: /agent_sessions_select_own[\s\S]*\(select auth\.uid\(\)\)\s*=\s*user_id/ },
	{ id: 'runs_session_guard', re: /agent_runs_insert_own[\s\S]*agent_sessions/ },
	{ id: 'events_session_guard', re: /agent_events_insert_own[\s\S]*agent_sessions/ },
	{ id: 'usage_select_only', re: /agent_usage_select_own/ },
	{ id: 'usage_no_insert_policy', re: /create policy agent_usage_insert/i, forbid: true },
	{ id: 'no_using_true', re: /using\s*\(\s*true\s*\)/i, forbid: true },
];

const failures = [];
for (const r of required) {
	const hit = r.re.test(sql);
	if (r.forbid ? hit : !hit) {
		failures.push(r.id);
	}
}

const runtimeChecklist = [
	'Create User A and User B via Auth',
	'As A: insert profile, preferences, session, run, event',
	'As B: SELECT each table — expect 0 rows from A',
	'As B: UPDATE/DELETE A rows — expect deny',
	'As B: INSERT with user_id=A — expect deny',
	'Anonymous + publishable key only — expect deny on all user tables',
	'As A: INSERT into agent_usage — expect deny (server-only writes)',
];

if (failures.length) {
	console.error('verify:supabase-rls-static: FAIL', failures.join(', '));
	process.exit(1);
}

console.log('verify:supabase-rls-static: PASS (policy shape)');
console.log('Runtime adversarial checklist (manual / CI test project):');
for (const line of runtimeChecklist) {
	console.log(' -', line);
}
