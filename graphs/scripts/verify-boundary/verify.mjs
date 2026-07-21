#!/usr/bin/env node
/**
 * Verify PreBase graph-owned implementation stays under root graphs/.
 * Allows documented host bootstrap files and the workbench symlink bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** @type {{ path: string, reason: string, owner: string, reviewDate: string, removalPlan: string }[]} */
const ALLOWLIST = [
	{
		path: 'src/vs/workbench/contrib/prebase/browser/prebase.contribution.ts',
		reason: 'Thin workbench bootstrap; calls registerPreBaseGraphContribution() only',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep as thin import/register only',
	},
	{
		path: 'src/vs/workbench/contrib/prebase/electron-browser/prebase.desktop.contribution.ts',
		reason: 'Desktop contribution entry',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep as import-only',
	},
	{
		path: 'src/vs/workbench/workbench.common.main.ts',
		reason: 'Workbench entrypoint import',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep',
	},
	{
		path: 'src/vs/workbench/workbench.desktop.main.ts',
		reason: 'Desktop entrypoint import',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep',
	},
	{
		path: 'src/vs/workbench/contrib/prebase/graphs',
		reason: 'Symlink bridge into graphs/src for VS Code src→out compile',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep while relative vs/ imports required',
	},
	{
		path: 'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts',
		reason: 'Settings shell still hosts Graph category UI; imports graphs types/service',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Extract graph settings panel into graphs/src/settings when practical',
	},
	{
		path: 'src/vs/workbench/contrib/prebase/browser/prebaseIcons.ts',
		reason: 'Shared PreBase icons including Maps/Architecture/Network glyphs',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Split graph icons into graphs/ when safe',
	},
	{
		path: 'src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts',
		reason: 'Mixed PreBase config bootstrap; imports registerPreBaseGraphConfiguration from graphs; terminalVisibility.* + runtime/home keys',
		owner: 'PreBase',
		reviewDate: '2026-08-20',
		removalPlan: 'Keep thin bootstrap; graph registry lives under graphs/',
	},
	{
		path: 'extensions/prebase-magnus',
		reason: 'Magnus extension invokes prebase.graph.* commands; not graph layout/render',
		owner: 'Magnus',
		reviewDate: '2026-08-20',
		removalPlan: 'Optional later move of tool wrappers',
	},
];

const FORBIDDEN_DIR_FRAGMENTS = [
	'src/vs/workbench/contrib/prebase/common/graph',
	'src/vs/workbench/contrib/prebase/browser/graphEditor',
	'src/vs/workbench/contrib/prebase/browser/prebaseGraph',
	'src/vs/workbench/contrib/prebase/browser/prebaseMaps',
];

const GRAPH_FILE_NAME_RE = /(?:^|\/)(graphEditor|graphEditorInput|prebaseGraphService|prebaseGraphDescriptionService|prebaseMapsView|networkLayout|architecturePick|hierarchyLayout)\.(ts|js|tsx|jsx)$/;

function isUnderGraphs(relPosix) {
	return relPosix === 'graphs' || relPosix.startsWith('graphs/');
}

function isAllowlisted(relPosix) {
	return ALLOWLIST.some((e) => relPosix === e.path || relPosix.startsWith(e.path.replace(/\/$/, '') + '/'));
}

function walk(dir, acc = []) {
	if (!fs.existsSync(dir)) {
		return acc;
	}
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'out' || ent.name === 'out-build') {
			continue;
		}
		const full = path.join(dir, ent.name);
		if (ent.isSymbolicLink()) {
			acc.push(full);
			continue;
		}
		if (ent.isDirectory()) {
			walk(full, acc);
		} else if (ent.isFile()) {
			acc.push(full);
		}
	}
	return acc;
}

const failures = [];

// 1) Forbidden legacy paths must not exist as real directories/files
for (const frag of FORBIDDEN_DIR_FRAGMENTS) {
	const full = path.join(REPO_ROOT, frag);
	if (fs.existsSync(full)) {
		const st = fs.lstatSync(full);
		if (!st.isSymbolicLink()) {
			failures.push(`Legacy graph path still present: ${frag}`);
		}
	}
}

// 2) Graph-named implementation files outside graphs/ (except allowlist)
const scanRoots = [
	path.join(REPO_ROOT, 'src/vs/workbench/contrib/prebase'),
];
for (const root of scanRoots) {
	for (const full of walk(root)) {
		const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
		if (rel.includes('/graphs/') || rel.endsWith('/graphs') || rel.includes('/prebase/graphs/')) {
			// Symlink tree — content lives under graphs/; skip
			continue;
		}
		if (GRAPH_FILE_NAME_RE.test(rel) && !isAllowlisted(rel) && !isUnderGraphs(rel)) {
			failures.push(`Graph-owned file outside graphs/: ${rel}`);
		}
	}
}

// 3) Ensure authoritative package exists
if (!fs.existsSync(path.join(REPO_ROOT, 'graphs/src/common/types/graphTypes.ts'))) {
	failures.push('Missing graphs/src/common/types/graphTypes.ts — graphs package incomplete');
}
if (!fs.existsSync(path.join(REPO_ROOT, 'graphs/src/host/workbench/graphEditor.ts'))) {
	failures.push('Missing graphs/src/host/workbench/graphEditor.ts');
}
if (!fs.existsSync(path.join(REPO_ROOT, 'graphs/src/host/workbench/graphContribution.ts'))) {
	failures.push('Missing graphs/src/host/workbench/graphContribution.ts');
}

const GRAPH_COMMAND_DEF_ID_RE = /\bid:\s*['"`]prebase\.graph\.[^'"`]+['"`]/g;
const REGISTER_ACTION2_RE = /registerAction2\s*\(/;

const COMMAND_DEF_SCAN_ROOTS = [
	path.join(REPO_ROOT, 'src/vs/workbench'),
	path.join(REPO_ROOT, 'extensions'),
];

for (const root of COMMAND_DEF_SCAN_ROOTS) {
	if (!fs.existsSync(root)) {
		continue;
	}
	for (const full of walk(root)) {
		if (!/\.(ts|tsx|js|jsx|mjs)$/.test(full)) {
			continue;
		}
		const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
		if (isUnderGraphs(rel) || rel.includes('/prebase/graphs/')) {
			continue;
		}
		if (isAllowlisted(rel)) {
			continue;
		}
		const content = fs.readFileSync(full, 'utf8');
		if (!REGISTER_ACTION2_RE.test(content)) {
			continue;
		}
		const matches = content.match(GRAPH_COMMAND_DEF_ID_RE);
		if (matches?.length) {
			failures.push(`Graph command Action2 definition outside graphs/: ${rel} (${[...new Set(matches)].join(', ')})`);
		}
	}
}

// 5) Mixed bootstrap must not register graph setting properties
const PREBASE_CONFIG_BOOTSTRAP = path.join(REPO_ROOT, 'src/vs/workbench/contrib/prebase/common/prebaseConfiguration.ts');
if (fs.existsSync(PREBASE_CONFIG_BOOTSTRAP)) {
	const bootstrapContent = fs.readFileSync(PREBASE_CONFIG_BOOTSTRAP, 'utf8');
	if (/['"`]prebase\.graph\.[^'"`]+['"`]\s*:/.test(bootstrapContent)) {
		failures.push('Graph setting property definitions found in prebaseConfiguration.ts — use graphs/src/host/workbench/graphConfigurationContribution.ts');
	}
	const graphInteractionInBootstrap = /['"`]prebase\.interaction\.(?:panSensitivity|zoomSensitivity|networkDragDirection|nodeDragDelayMs)['"`]\s*:/.test(bootstrapContent);
	if (graphInteractionInBootstrap) {
		failures.push('Graph interaction keys must register from graphs/, not prebaseConfiguration.ts');
	}
}

// 6) Graph package must not register a second prebaseInteraction section (terminal visibility only in bootstrap)
const GRAPH_CONFIG_CONTRIB = path.join(REPO_ROOT, 'graphs/src/host/workbench/graphConfigurationContribution.ts');
if (fs.existsSync(GRAPH_CONFIG_CONTRIB)) {
	const graphConfigContent = fs.readFileSync(GRAPH_CONFIG_CONTRIB, 'utf8');
	if (/id:\s*['"`]prebaseInteraction['"`]/.test(graphConfigContent)) {
		failures.push('graphConfigurationContribution.ts must not register id prebaseInteraction (reserved for terminal visibility in prebaseConfiguration.ts)');
	}
}

// 7) Symlink bridge must point at graphs/src
const link = path.join(REPO_ROOT, 'src/vs/workbench/contrib/prebase/graphs');
if (!fs.existsSync(link)) {
	failures.push('Missing workbench graphs symlink at src/vs/workbench/contrib/prebase/graphs');
} else {
	const st = fs.lstatSync(link);
	if (!st.isSymbolicLink()) {
		failures.push('src/vs/workbench/contrib/prebase/graphs must be a symlink to graphs/src');
	} else {
		const target = fs.readlinkSync(link);
		const resolved = path.resolve(path.dirname(link), target);
		const expected = path.join(REPO_ROOT, 'graphs/src');
		if (path.normalize(resolved) !== path.normalize(expected)) {
			failures.push(`graphs symlink resolves to ${resolved}, expected ${expected} (readlink=${target})`);
		}
	}
}

if (failures.length) {
	console.error('Graph boundary check FAILED:');
	for (const f of failures) {
		console.error(' -', f);
	}
	console.error('\nAllowlist entries (documented exceptions):');
	for (const e of ALLOWLIST) {
		console.error(` - ${e.path}: ${e.reason} (review ${e.reviewDate})`);
	}
	process.exit(1);
}

console.log('Graph boundary check OK');
console.log(`Allowlist exceptions: ${ALLOWLIST.length}`);
process.exit(0);
