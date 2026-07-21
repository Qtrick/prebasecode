#!/usr/bin/env node
/**
 * Release signing prerequisite check for PreBase.
 * - Reports platform and whether required TOOL binaries exist.
 * - With --release: requires PREBASE_* env var NAMES to be set (never prints values).
 * - Does not invoke codesign, signtool, ESRP, or notarytool.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const releaseMode = process.argv.includes('--release');

/** @param {'error' | 'warn'} level */
function toolFinding(level, msg) {
	return { level: releaseMode ? level : 'warn', msg };
}

/** @param {string} name */
function envSet(name) {
	const v = process.env[name];
	return typeof v === 'string' && v.length > 0;
}

/** @param {string} cmd */
function commandExists(cmd) {
	const lookup = process.platform === 'win32' ? 'where' : 'which';
	const r = spawnSync(lookup, [cmd], { encoding: 'utf8', stdio: 'ignore' });
	return r.status === 0;
}

const platform = os.platform();
const arch = os.arch();

console.log(`signing-preflight: platform=${platform} arch=${arch}`);

/** @type {{ level: 'error' | 'warn' | 'ok', msg: string }[]} */
const findings = [];

if (platform === 'darwin') {
	if (!commandExists('xcode-select')) {
		findings.push(toolFinding('error', 'Xcode Command Line Tools (xcode-select) not available'));
	}
	if (!commandExists('codesign')) {
		findings.push(toolFinding('error', 'codesign not available'));
	}
	if (!commandExists('xcrun')) {
		findings.push({ level: 'warn', msg: 'xcrun not available (notarytool/stapler may be missing)' });
	}

	if (releaseMode) {
		if (!envSet('PREBASE_CODESIGN_IDENTITY')) {
			findings.push({ level: 'error', msg: 'Missing env: PREBASE_CODESIGN_IDENTITY' });
		}
		if (!envSet('PREBASE_APPLE_TEAM_ID')) {
			findings.push({ level: 'error', msg: 'Missing env: PREBASE_APPLE_TEAM_ID' });
		}
		if (!envSet('PREBASE_APPLE_NOTARY_KEY_ID') || !envSet('PREBASE_APPLE_NOTARY_ISSUER_ID')) {
			findings.push({ level: 'error', msg: 'Missing env: PREBASE_APPLE_NOTARY_KEY_ID and/or PREBASE_APPLE_NOTARY_ISSUER_ID' });
		}
		if (!envSet('PREBASE_APPLE_NOTARY_KEY') && !envSet('PREBASE_APPLE_NOTARY_KEY_PATH')) {
			findings.push({ level: 'error', msg: 'Missing env: PREBASE_APPLE_NOTARY_KEY or PREBASE_APPLE_NOTARY_KEY_PATH' });
		}
	} else {
		const macVars = [
			'PREBASE_CODESIGN_IDENTITY',
			'PREBASE_APPLE_TEAM_ID',
			'PREBASE_APPLE_NOTARY_KEY_ID',
			'PREBASE_APPLE_NOTARY_ISSUER_ID',
			'PREBASE_APPLE_NOTARY_KEY',
			'PREBASE_APPLE_NOTARY_KEY_PATH',
		];
		const unset = macVars.filter((n) => !envSet(n));
		if (unset.length === macVars.length) {
			findings.push({ level: 'warn', msg: `PreBase release signing vars not set (${unset.slice(0, 3).join(', ')}, …)` });
		}
	}
} else if (platform === 'win32') {
	if (!commandExists('signtool')) {
		findings.push({ level: 'warn', msg: 'signtool not found on PATH (install Windows SDK)' });
	}
	if (releaseMode) {
		const storeThumb = envSet('PREBASE_WIN_SIGN_CERT_SHA1');
		const pfx = envSet('PREBASE_WIN_SIGN_CERT_FILE') && envSet('PREBASE_WIN_SIGN_CERT_PASSWORD');
		if (!storeThumb && !pfx) {
			findings.push({
				level: 'error',
				msg: 'Missing env: PREBASE_WIN_SIGN_CERT_SHA1 or (PREBASE_WIN_SIGN_CERT_FILE + PREBASE_WIN_SIGN_CERT_PASSWORD)',
			});
		}
	}
} else if (platform === 'linux') {
	if (releaseMode && envSet('PREBASE_LINUX_GPG_KEY_ID') && !commandExists('gpg')) {
		findings.push({ level: 'error', msg: 'PREBASE_LINUX_GPG_KEY_ID set but gpg not available' });
	}
}

// Microsoft ESRP (informational only — not a PreBase release requirement)
const esrpNames = [
	'ESRP_CLIENT_ID',
	'ESRP_TENANT_ID',
	'EsrpCliDllPath',
	'VSCODE_ESRP_CLIENT_ID',
	'VSCODE_ESRP_TENANT_ID',
	'VSCODE_ESRP_SERVICE_CONNECTION_ID',
];
const esrpPresent = esrpNames.filter(envSet);
if (esrpPresent.length > 0 && esrpPresent.length < esrpNames.length) {
	findings.push({
		level: 'warn',
		msg: `Partial Microsoft ESRP env set (${esrpPresent.join(', ')}); upstream CI only — not PreBase production`,
	});
} else if (esrpPresent.length === esrpNames.length) {
	findings.push({
		level: 'warn',
		msg: 'Microsoft ESRP variables detected — reference/upstream CI; PreBase production must use PREBASE_* secrets',
	});
}

for (const f of findings) {
	const tag = f.level === 'error' ? 'ERROR' : f.level === 'warn' ? 'WARN' : 'OK';
	console.log(`${tag}: ${f.msg}`);
}

const errors = findings.filter((f) => f.level === 'error');
if (releaseMode && errors.length > 0) {
	console.error(`signing-preflight: ${errors.length} release prerequisite(s) missing`);
	process.exit(1);
}

console.log(releaseMode ? 'signing-preflight: release checks passed' : 'signing-preflight: informational pass (use --release to enforce)');
process.exit(0);
