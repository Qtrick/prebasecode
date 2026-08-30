import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, test } from 'node:test';
import {
	PHASE3_EVIDENCE_SCHEMA_VERSION,
	SOURCE_FINGERPRINT_PATHSPECS,
	computeSourceFingerprint,
	currentSourceIdentity,
	isExcludedFingerprintPath,
	isHashableWorkingTreeFile,
	listSourceFingerprintFiles,
	phase3EvidenceMetadata,
} from './phase3Evidence.mjs';
import {
	PHASE3_PRODUCERS,
	PHASE3_REQUIRED_EVIDENCE,
	activeSoakProducerTimeoutMs,
	classifyRequiredEvidence,
	producerForArtifact,
	producersForArtifacts,
	scenarioOk,
} from './prebase-phase3-final-gate.mjs';
import {
	PHASE3_ASSURANCE_COMMANDS,
	PHASE3_ASSURANCE_TIMEOUT_MS,
	assuranceCommandLabel,
	assuranceEvidenceOk,
} from './prebase-phase3-assurance.mjs';
import { lifecycleFailures } from './prebase-process-leak-diag.mjs';
import { processState, processTree, terminateOwnedProcessTree } from './workbenchHarness.mjs';

const acceptanceDir = dirname(fileURLToPath(import.meta.url));
const repo = join(acceptanceDir, '../../..');
const trackedSource = join(repo, 'test/prebase/fixtures/desktop-electron/preload.js');
const parkedTracked = `${trackedSource}.fingerprint-parked`;
const untrackedProbe = join(repo, 'test/prebase/tmp-fingerprint-probe.mjs');
const secretProbe = join(repo, 'test/prebase/.env.fingerprint-probe');
const reportPng = join(repo, 'reports/graph-acceptance/phase-3-final/tmp-fingerprint-probe.png');
const reportJson = join(repo, 'reports/graph-acceptance/phase-3-final/tmp-fingerprint-probe.json');
const symlinkProbe = join(repo, 'test/prebase/tmp-fingerprint-symlink.mjs');
const directoryProbe = join(repo, 'test/prebase/tmp-fingerprint-dir');

function unlinkIfExists(path) {
	try { unlinkSync(path); } catch { /* absent */ }
}

function restoreTrackedSource(original) {
	if (existsSync(parkedTracked) && !existsSync(trackedSource)) {
		renameSync(parkedTracked, trackedSource);
	}
	unlinkIfExists(parkedTracked);
	if (original) {
		writeFileSync(trackedSource, original);
	}
}

function cleanupProbes() {
	unlinkIfExists(untrackedProbe);
	unlinkIfExists(secretProbe);
	unlinkIfExists(reportPng);
	unlinkIfExists(reportJson);
	unlinkIfExists(symlinkProbe);
	try { rmSync(directoryProbe, { recursive: true, force: true }); } catch { /* absent */ }
}

function passingAssuranceCommands() {
	return PHASE3_ASSURANCE_COMMANDS.map(command => ({
		command: assuranceCommandLabel(command),
		exitCode: 0,
		durationMs: 1,
		passed: true,
		log: 'reports/graph-acceptance/phase-3-final/assurance-logs/command.log',
	}));
}

function passingEvidence(spec, identity) {
	return {
		ok: true,
		scenario: spec.id,
		sourceHead: identity.sourceHead,
		sourceFingerprint: identity.sourceFingerprint,
		evidenceKind: spec.evidenceKind,
		durationMs: spec.minDurationMs,
	};
}

function passingLifecycle(overrides = {}) {
	const quit = { remaining: 'gone', terminationPath: 'workbench', usedSigkill: false };
	const surfaces = ['maps', 'code-graph', 'temporal', 'runtime', 'magnus'].map(id => ({ id, opened: true, closed: true }));
	const sample = () => ({ processCount: 14, webContents: { liveCount: 6 } });
	return {
		cold: { processCount: 7, webContents: { liveCount: 3 } },
		warm: { processCount: 14, webContents: { liveCount: 6 } },
		cycles: [1, 2, 3, 4, 5, 6].map(sample),
		closedPrimarySidebar: true,
		surfaces,
		quit,
		...overrides,
	};
}

const trackedOriginal = readFileSync(trackedSource);
cleanupProbes();
restoreTrackedSource(trackedOriginal);

after(() => {
	restoreTrackedSource(trackedOriginal);
	cleanupProbes();
});

describe('phase 3 evidence identity against real git/fs', { concurrency: false }, () => {
	test('same HEAD + changed tracked source rejects old evidence (fingerprint mismatch)', { timeout: 120_000 }, () => {
		const before = currentSourceIdentity(repo);
		const oldEvidence = { ok: true, scenario: 'core-ide', sourceHead: before.sourceHead, sourceFingerprint: before.sourceFingerprint };
		const oldAssurance = {
			ok: true,
			scenario: 'assurance',
			sourceHead: before.sourceHead,
			sourceFingerprint: before.sourceFingerprint,
			commands: passingAssuranceCommands(),
		};
		try {
			writeFileSync(trackedSource, Buffer.concat([trackedOriginal, Buffer.from('\n// phase3-fingerprint-probe\n')]));
			const after = currentSourceIdentity(repo);
			assert.equal(after.sourceHead, before.sourceHead, 'HEAD must stay the same for a dirty-tree freshness check');
			assert.notEqual(after.sourceFingerprint, before.sourceFingerprint);
			const stale = scenarioOk({ id: 'core-ide', sourceHead: after.sourceHead, sourceFingerprint: after.sourceFingerprint }, oldEvidence);
			assert.equal(stale.ok, false);
			assert.match(stale.reason, /fingerprint/);
			assert.equal(stale.reason.includes('HEAD does not match'), false, 'sourceHead-only freshness is a false positive');
			assert.equal(assuranceEvidenceOk({
				id: 'assurance',
				sourceHead: after.sourceHead,
				sourceFingerprint: after.sourceFingerprint,
			}, oldAssurance).ok, false);
		} finally {
			writeFileSync(trackedSource, trackedOriginal);
		}
	});

	test('same HEAD + changed report PNG under reports/ leaves source fingerprint unchanged', { timeout: 120_000 }, () => {
		const before = computeSourceFingerprint(repo);
		try {
			writeFileSync(reportPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));
			assert.equal(listSourceFingerprintFiles(repo).some(path => path.startsWith('reports/')), false);
			assert.equal(computeSourceFingerprint(repo), before);
		} finally {
			unlinkIfExists(reportPng);
		}
	});

	test('same HEAD + changed reports JSON leaves source fingerprint unchanged', { timeout: 120_000 }, () => {
		const before = computeSourceFingerprint(repo);
		try {
			writeFileSync(reportJson, `${JSON.stringify({ ok: true, planted: 'phase3-fingerprint-probe' })}\n`);
			assert.equal(listSourceFingerprintFiles(repo).some(path => path.includes('tmp-fingerprint-probe.json')), false);
			assert.equal(computeSourceFingerprint(repo), before);
		} finally {
			unlinkIfExists(reportJson);
		}
	});

	test('new untracked source file under a fingerprinted root changes the fingerprint', { timeout: 120_000 }, () => {
		const before = currentSourceIdentity(repo);
		try {
			writeFileSync(untrackedProbe, '// untracked fingerprint probe\n');
			const listed = listSourceFingerprintFiles(repo);
			assert.ok(listed.includes('test/prebase/tmp-fingerprint-probe.mjs'));
			const dirty = currentSourceIdentity(repo);
			assert.equal(dirty.sourceHead, before.sourceHead);
			assert.notEqual(dirty.sourceFingerprint, before.sourceFingerprint);
		} finally {
			unlinkIfExists(untrackedProbe);
		}
		assert.equal(computeSourceFingerprint(repo), before.sourceFingerprint);
		assert.equal(listSourceFingerprintFiles(repo).includes('test/prebase/tmp-fingerprint-probe.mjs'), false);
	});

	test('deleted tracked source file changes the fingerprint', { timeout: 120_000 }, () => {
		const relative = 'test/prebase/fixtures/desktop-electron/preload.js';
		const before = computeSourceFingerprint(repo);
		assert.ok(listSourceFingerprintFiles(repo).includes(relative));
		try {
			renameSync(trackedSource, parkedTracked);
			assert.equal(listSourceFingerprintFiles(repo).includes(relative), false);
			assert.notEqual(computeSourceFingerprint(repo), before);
		} finally {
			restoreTrackedSource(trackedOriginal);
		}
		assert.equal(computeSourceFingerprint(repo), before);
	});

	test('.env-named files are excluded from fingerprint listing and evidence metadata', { timeout: 120_000 }, () => {
		assert.equal(SOURCE_FINGERPRINT_PATHSPECS.some(spec => spec === 'reports' || spec.startsWith('reports/') || spec.includes('node_modules') || spec.includes('.env')), false);
		const listedBefore = listSourceFingerprintFiles(repo);
		assert.equal(listedBefore.some(path => /\.env(?:\/|$)/.test(path) || /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path)), false);
		assert.equal(listedBefore.some(path => path === 'reports' || path.startsWith('reports/') || path === 'node_modules' || path.startsWith('node_modules/') || path.includes('/node_modules/')), false);
		const sentinel = `PBFPSECRET_${randomBytes(16).toString('hex')}`;
		try {
			writeFileSync(secretProbe, `${sentinel}\n`);
			const listed = listSourceFingerprintFiles(repo);
			assert.equal(listed.some(path => /(?:^|\/)\.env/.test(path)), false);
			assert.equal(listed.includes('test/prebase/.env.fingerprint-probe'), false);
			const metadata = phase3EvidenceMetadata(repo, 'fingerprint-secret-probe');
			const serialized = JSON.stringify(metadata);
			assert.equal(serialized.includes(sentinel), false);
			assert.equal(metadata.schemaVersion, PHASE3_EVIDENCE_SCHEMA_VERSION);
			assert.match(metadata.sourceFingerprint, /^[0-9a-f]{64}$/);
		} finally {
			unlinkIfExists(secretProbe);
		}
	});

	test('skip helpers exclude reports, node_modules, secrets; listing skips symlinks and directories', { timeout: 120_000 }, () => {
		assert.equal(isExcludedFingerprintPath('reports/graph-acceptance/phase-3-final/core-ide.json'), true);
		assert.equal(isExcludedFingerprintPath('reports'), true);
		assert.equal(isExcludedFingerprintPath('node_modules/foo/index.js'), true);
		assert.equal(isExcludedFingerprintPath('graphs/node_modules/pkg/index.js'), true);
		assert.equal(isExcludedFingerprintPath('test/prebase/.env.fingerprint-probe'), true);
		assert.equal(isExcludedFingerprintPath('test/prebase/acceptance/phase3Evidence.mjs'), false);
		assert.equal(isHashableWorkingTreeFile(repo, 'test/prebase/acceptance/phase3Evidence.mjs'), true);
		const before = computeSourceFingerprint(repo);
		mkdirSync(directoryProbe, { recursive: true });
		assert.equal(lstatSync(directoryProbe).isFile(), false);
		assert.equal(isHashableWorkingTreeFile(repo, 'test/prebase/tmp-fingerprint-dir'), false);
		try {
			symlinkSync(trackedSource, symlinkProbe);
			assert.equal(lstatSync(symlinkProbe).isSymbolicLink(), true);
			assert.equal(isHashableWorkingTreeFile(repo, 'test/prebase/tmp-fingerprint-symlink.mjs'), false);
			const listed = listSourceFingerprintFiles(repo);
			assert.equal(listed.includes('test/prebase/tmp-fingerprint-symlink.mjs'), false);
			assert.equal(listed.includes('test/prebase/tmp-fingerprint-dir'), false);
			assert.equal(listed.some(path => path === 'node_modules' || path.startsWith('node_modules/') || path.includes('/node_modules/')), false);
			assert.equal(computeSourceFingerprint(repo), before);
		} finally {
			unlinkIfExists(symlinkProbe);
			try { rmSync(directoryProbe, { recursive: true, force: true }); } catch { /* absent */ }
		}
		assert.equal(computeSourceFingerprint(repo), before);
	});
});

describe('phase 3 gate / lifecycle / timeout contracts', () => {
	test('every required evidence artifact has a producer and core-ide is one producer of three', () => {
		for (const spec of PHASE3_REQUIRED_EVIDENCE) {
			assert.ok(producerForArtifact(spec.id), `${spec.id} has no producer`);
		}
		const coreIde = PHASE3_PRODUCERS.find(item => item.id === 'core-ide');
		assert.deepEqual(coreIde?.artifacts, ['core-ide', 'code-graph', 'themes-a11y']);
		assert.deepEqual(producersForArtifacts(['core-ide', 'code-graph', 'themes-a11y']).map(item => item.id), ['core-ide']);
		assert.equal(PHASE3_PRODUCERS.filter(item => item.id === 'core-ide').length, 1);
	});

	test('active soak producer timeout exceeds configured PREBASE_ACTIVE_SOAK_MS', () => {
		const configured = 20 * 60 * 1000;
		assert.ok(activeSoakProducerTimeoutMs({ PREBASE_ACTIVE_SOAK_MS: String(configured) }) > configured);
		assert.equal(activeSoakProducerTimeoutMs({ PREBASE_ACTIVE_SOAK_MS: String(configured) }), configured + 4 * 60 * 1000);
		assert.ok(activeSoakProducerTimeoutMs({}) > 12 * 60 * 1000);
	});

	test('diagnostic evidenceKind cannot satisfy evidenceKind final even with current identity', () => {
		const entry = PHASE3_REQUIRED_EVIDENCE.find(item => item.id === 'active-soak');
		assert.ok(entry?.evidenceKind === 'final');
		const identity = { sourceHead: 'head', sourceFingerprint: 'fp' };
		const diagnostic = {
			...passingEvidence(entry, identity),
			evidenceKind: 'diagnostic',
			durationMs: entry.minDurationMs,
		};
		const verdict = scenarioOk({ ...entry, ...identity }, diagnostic);
		assert.equal(verdict.ok, false);
		assert.match(verdict.reason, /expected final evidence/);
	});

	test('matching HEAD with a stale fingerprint classifies every required artifact as stale', () => {
		const identity = { sourceHead: 'current-head', sourceFingerprint: 'fp-current' };
		const staleById = new Map(PHASE3_REQUIRED_EVIDENCE.map(spec => [spec.id, passingEvidence(spec, {
			sourceHead: identity.sourceHead,
			sourceFingerprint: 'fp-old',
		})]));
		const stale = classifyRequiredEvidence(identity, staleById);
		assert.equal(stale.length, PHASE3_REQUIRED_EVIDENCE.length);
		assert.ok(stale.every(item => /fingerprint/.test(item.reason)));
		const planned = producersForArtifacts(stale.map(item => item.id));
		for (const spec of PHASE3_REQUIRED_EVIDENCE) {
			assert.ok(planned.some(producer => producer.artifacts.includes(spec.id)), `--rerun-stale must cover ${spec.id}`);
		}
		assert.equal(planned.filter(item => item.id === 'core-ide').length, 1);
		const current = classifyRequiredEvidence(identity, new Map(PHASE3_REQUIRED_EVIDENCE.map(spec => [spec.id, passingEvidence(spec, identity)])));
		assert.deepEqual(current, []);
	});

	test('assuranceEvidenceOk rejects a sourceHead-only identity even when evidence fingerprint is present', () => {
		const identity = { id: 'assurance', sourceHead: 'current-head', sourceFingerprint: 'fp-current' };
		const evidence = {
			ok: true,
			scenario: 'assurance',
			sourceHead: identity.sourceHead,
			sourceFingerprint: 'fp-stale',
			commands: passingAssuranceCommands(),
		};
		assert.equal(assuranceEvidenceOk(identity.sourceHead, evidence).ok, false, 'string overload must not skip fingerprint matching');
		assert.equal(assuranceEvidenceOk({ id: 'assurance', sourceHead: identity.sourceHead }, evidence).ok, false);
		assert.equal(assuranceEvidenceOk(identity, evidence).ok, false);
		assert.equal(assuranceEvidenceOk(identity, { ...evidence, sourceFingerprint: identity.sourceFingerprint }).ok, true);
	});

	test('assurance timeout map covers every assurance command', () => {
		assert.ok(PHASE3_ASSURANCE_TIMEOUT_MS);
		for (const command of PHASE3_ASSURANCE_COMMANDS) {
			const label = assuranceCommandLabel(command);
			assert.ok(Number.isFinite(PHASE3_ASSURANCE_TIMEOUT_MS[label]) && PHASE3_ASSURANCE_TIMEOUT_MS[label] > 0, `${label} missing from PHASE3_ASSURANCE_TIMEOUT_MS`);
		}
	});

	test('lifecycle closeSidebar is in the production harness and per-surface open/close is required', () => {
		const leak = readFileSync(join(acceptanceDir, 'prebase-process-leak-diag.mjs'), 'utf8');
		assert.match(leak, /async function closeWorkbenchSurfaces/);
		assert.match(leak, /workbench\.action\.closeSidebar/);
		assert.match(leak, /closedPrimarySidebar/);
		assert.match(leak, /sidebarVisible !== true/);
		const contribution = readFileSync(join(repo, 'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts'), 'utf8');
		assert.match(contribution, /sidebarVisible: layoutService\.isVisible\(Parts\.SIDEBAR_PART\)/);
		assert.ok(lifecycleFailures(passingLifecycle({ surfaces: [] })).some(item => /per-surface/.test(item)));
		assert.ok(lifecycleFailures(passingLifecycle({
			surfaces: [{ id: 'maps', opened: false, closed: true }, { id: 'code-graph', opened: true, closed: true }, { id: 'temporal', opened: true, closed: true }, { id: 'runtime', opened: true, closed: true }, { id: 'magnus', opened: true, closed: true }],
		})).some(item => /did not open maps/.test(item)));
		assert.ok(lifecycleFailures(passingLifecycle({
			surfaces: [{ id: 'maps', opened: true, closed: false }, { id: 'code-graph', opened: true, closed: true }, { id: 'temporal', opened: true, closed: true }, { id: 'runtime', opened: true, closed: true }, { id: 'magnus', opened: true, closed: true }],
		})).some(item => /did not close maps/.test(item)));
	});

	test('gate timeout terminates the owned process tree rather than only child.kill', () => {
		assert.equal(typeof terminateOwnedProcessTree, 'function');
		const gate = readFileSync(join(acceptanceDir, 'prebase-phase3-final-gate.mjs'), 'utf8');
		assert.match(gate, /terminateOwnedProcessTree\(child\.pid\)/);
		assert.match(gate, /live rerun timed out after/);
		assert.doesNotMatch(gate, /child\.kill\(/);
		assert.match(gate, /for \(const producer of planned\)/);
		assert.match(gate, /await runProcess\(/);
		assert.doesNotMatch(gate, /Promise\.all\(\s*planned/);
		assert.match(gate, /argv\.includes\('--rerun-all'\) \|\| argv\.includes\('--rerun-live'\)/);
		assert.match(gate, /planned\.push\(\.\.\.PHASE3_PRODUCERS\)/);
		assert.match(gate, /planned\.push\(\.\.\.producersForArtifacts\(stale\.map/);
		assert.match(gate, /scenarioOk\(\{ id: 'assurance', sourceHead: identity\.sourceHead, sourceFingerprint: identity\.sourceFingerprint \}/);
		assert.match(gate, /return assuranceEvidenceOk\(entry, evidence\)/);
		const harness = readFileSync(join(acceptanceDir, 'workbenchHarness.mjs'), 'utf8');
		const start = harness.indexOf('export async function terminateOwnedProcessTree');
		assert.ok(start >= 0);
		const body = harness.slice(start, harness.indexOf('export async function gracefulWorkbenchQuit'));
		assert.match(body, /signalProcessTree\(rootPid, 'SIGTERM'/);
		assert.match(body, /signalProcessTree\(rootPid, 'SIGKILL'/);
		assert.match(body, /collectOwnedPids\(rootPid/);
		assert.doesNotMatch(body, /process\.kill\(rootPid/);
	});

	test('terminateOwnedProcessTree SIGTERM/SIGKILL walks descendants, not only the root', { timeout: 15_000 }, async () => {
		assert.notEqual(processState(process.pid), 'gone', 'ps must observe this process; run unsandboxed');
		const hang = 'process.on("SIGTERM",function(){});setInterval(function(){},1e9)';
		const parent = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(hang)}],{stdio:'ignore'});process.on('SIGTERM',function(){});process.stdout.write(String(c.pid));setInterval(function(){},1e9);`], { stdio: ['ignore', 'pipe', 'ignore'] });
		let descendantPid;
		try {
			descendantPid = Number(await new Promise((resolve, reject) => {
				let output = '';
				let settled = false;
				parent.stdout.on('data', chunk => {
					output += chunk;
					if (!settled && /^\d+$/.test(output.trim())) {
						settled = true;
						resolve(output.trim());
					}
				});
				parent.on('error', error => {
					if (!settled) {
						settled = true;
						reject(error);
					}
				});
				parent.on('exit', code => {
					if (!settled) {
						settled = true;
						reject(new Error(`tree parent exited before pid (${code})`));
					}
				});
			}));
			assert.ok(Number.isFinite(parent.pid) && parent.pid > 0);
			assert.ok(Number.isFinite(descendantPid) && descendantPid > 0);
			assert.notEqual(processState(parent.pid), 'gone');
			assert.notEqual(processState(descendantPid), 'gone');
			const result = await terminateOwnedProcessTree(parent.pid, { termMs: 400, killMs: 800 });
			assert.equal(result.usedSigkill, true);
			assert.ok(result.ownedPids.includes(parent.pid));
			assert.ok(result.ownedPids.includes(descendantPid), 'descendant must be in the owned tree before kill');
			assert.equal(processState(parent.pid), 'gone');
			assert.equal(processState(descendantPid), 'gone');
			assert.deepEqual(result.leftoverPids, []);
		} finally {
			for (const pid of [descendantPid, parent.pid]) {
				if (Number.isFinite(pid) && pid > 0) {
					try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
				}
			}
		}
	});

	test('processTree walks the owned root only and does not collect an unrelated sibling', { timeout: 15_000 }, async () => {
		assert.notEqual(processState(process.pid), 'gone', 'ps must observe this process; run unsandboxed');
		const hang = 'process.on("SIGTERM",function(){});setInterval(function(){},1e9)';
		const owned = spawn(process.execPath, ['-e', hang], { stdio: 'ignore' });
		const unrelated = spawn(process.execPath, ['-e', hang], { stdio: 'ignore' });
		try {
			assert.ok(Number.isFinite(owned.pid) && owned.pid > 0);
			assert.ok(Number.isFinite(unrelated.pid) && unrelated.pid > 0);
			assert.notEqual(processState(owned.pid), 'gone');
			assert.notEqual(processState(unrelated.pid), 'gone');
			const tree = processTree(owned.pid);
			const pids = tree.map(row => row.pid);
			assert.ok(pids.includes(owned.pid), 'owned root must be in its process tree');
			assert.equal(pids.includes(unrelated.pid), false, 'unrelated sibling must not be targeted as leftover');
			assert.equal(pids.includes(process.pid), false, 'the test runner must not be in the owned tree');
		} finally {
			for (const child of [owned, unrelated]) {
				try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
			}
		}
	});
});

describe('phase 3 UI contracts not covered by sourceHead-only freshness', () => {
	test('inert density and sidebar-width settings are hidden from PreBase Settings', () => {
		const settings = readFileSync(join(repo, 'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts'), 'utf8');
		assert.doesNotMatch(settings, /PreBaseConfigKeys\.UiDensity|prebase\.ui\.density/);
		assert.doesNotMatch(settings, /UiSidebarMinWidth|UiSidebarMaxWidth|UiSidebarLeftWidth|UiSidebarCollapsedWidth|UiSidebarInspectorWidth/);
		assert.doesNotMatch(settings, /sidebarMinWidth|sidebarMaxWidth|sidebarLeftWidth|sidebarCollapsedWidth|sidebarInspectorWidth/);
		assert.doesNotMatch(settings, /webSearchAvailable|Web search is available|hosted web context is available/i);
		const schema = readFileSync(join(repo, 'src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts'), 'utf8');
		for (const key of ['UiDensity', 'UiSidebarMinWidth', 'UiSidebarMaxWidth', 'UiSidebarLeftWidth', 'UiSidebarCollapsedWidth', 'UiSidebarInspectorWidth']) {
			const start = schema.indexOf(`[PreBaseConfigKeys.${key}]`);
			assert.ok(start >= 0, `${key} missing from schema`);
			assert.match(schema.slice(start, start + 900), /included: false/);
			assert.match(schema.slice(start, start + 900), /deprecationMessage/);
		}
	});

	test('Maps disclosure uses Codicon chevrons and aria-expanded rather than triangle glyphs', () => {
		const maps = readFileSync(join(repo, 'graphs/src/host/workbench/prebaseMapsView.ts'), 'utf8');
		assert.match(maps, /header\.setAttribute\('aria-expanded', String\(expanded\)\)/);
		assert.match(maps, /codicon-chevron-down/);
		assert.match(maps, /codicon-chevron-right/);
		assert.doesNotMatch(maps, /▸|▾/);
	});
});
