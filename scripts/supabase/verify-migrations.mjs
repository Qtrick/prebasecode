#!/usr/bin/env node
/**
 * Static checks for supabase/migrations: presence, RLS coverage, no secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase/migrations');

const REQUIRED_MIGRATION_SUFFIXES = [
	'_init_profiles_and_preferences.sql',
	'_agent_sessions_runs_events.sql',
	'_usage_ledger.sql',
	'_agent_usage_privileges.sql',
	'_revoke_rls_auto_enable.sql',
];

const SECRET_PATTERNS = [
	/service_role_key\s*[:=]/i,
	/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
	/sb_secret_[A-Za-z0-9]+/,
	/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/,
];

/** Per-file check (no /g) — global regex + .test() in a loop skips matches via lastIndex. */
const INSECURE_POLICY_RE = /create\s+policy[\s\S]*?using\s*\(\s*true\s*\)/i;

function listMigrationFiles() {
	if (!fs.existsSync(MIGRATIONS_DIR)) {
		console.error('verify:supabase-migrations: missing supabase/migrations/');
		process.exit(1);
	}
	return fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
}

function tableNamesFromSql(sql) {
	const names = [];
	const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
	let m;
	while ((m = re.exec(sql)) !== null) {
		names.push(m[1]);
	}
	return names;
}

function main() {
	const files = listMigrationFiles();
	for (const suffix of REQUIRED_MIGRATION_SUFFIXES) {
		if (!files.some((f) => f.endsWith(suffix))) {
			console.error(`verify:supabase-migrations: missing migration *${suffix}`);
			process.exit(1);
		}
	}

	const combinedByFile = new Map(files.map((f) => [f, fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')]));
	const combinedAll = [...combinedByFile.values()].join('\n');

	for (const [file, sql] of combinedByFile) {
		for (const pattern of SECRET_PATTERNS) {
			if (pattern.test(sql)) {
				console.error(`verify:supabase-migrations: suspicious secret pattern in ${file}`);
				process.exit(1);
			}
		}
		if (INSECURE_POLICY_RE.test(sql)) {
			console.error(`verify:supabase-migrations: insecure policy (USING true) in ${file}`);
			process.exit(1);
		}
	}

	const tables = [];
	for (const sql of combinedByFile.values()) {
		tables.push(...tableNamesFromSql(sql));
	}

	const rlsTables = new Set();
	const rlsRe = /alter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security/gi;
	let r;
	while ((r = rlsRe.exec(combinedAll)) !== null) {
		rlsTables.add(r[1]);
	}

	const missingRls = [...new Set(tables)].filter((t) => !rlsTables.has(t));
	if (missingRls.length) {
		console.error('verify:supabase-migrations: tables without ENABLE ROW LEVEL SECURITY:', missingRls);
		process.exit(1);
	}

	const usageMutatingPolicyRe =
		/create\s+policy\s+[\w]+\s+on\s+public\.agent_usage\s+for\s+(insert|update|delete)\b/i;
	for (const [file, sql] of combinedByFile) {
		if (usageMutatingPolicyRe.test(sql)) {
			console.error(`verify:supabase-migrations: agent_usage must not allow client writes (policy in ${file})`);
			process.exit(1);
		}
	}

	const usageRevokeRe = /revoke\s+(insert|update|delete)[\s\S]*on\s+public\.agent_usage/i;
	if (!usageRevokeRe.test(combinedAll)) {
		console.error('verify:supabase-migrations: expected REVOKE write privileges on public.agent_usage');
		process.exit(1);
	}

	const rlsAutoEnableGuardRe =
		/rls_auto_enable[\s\S]*revoke\s+all\s+on\s+function\s+public\.rls_auto_enable/i;
	if (!rlsAutoEnableGuardRe.test(combinedAll)) {
		console.error('verify:supabase-migrations: expected guarded revoke for public.rls_auto_enable()');
		process.exit(1);
	}

	console.log(
		`verify:supabase-migrations: ${files.length} migrations, ${tables.length} tables, RLS OK`,
	);
}

main();
