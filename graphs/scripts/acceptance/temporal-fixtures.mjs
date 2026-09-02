#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Temporal live acceptance git fixtures (testable without Playwright).
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** package.json + remaining module files after one seeded module deletion. */
export function expectedRepositoryHeadFileCount(moduleSeedCount) {
	return moduleSeedCount;
}

function git(cwd, args) {
	const finalArgs = args[0] === 'init' && !args.includes('--template=')
		? [...args, '--template=']
		: args;
	return execFileSync('git', finalArgs, { cwd, encoding: 'utf8' }).trim();
}

export function createFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-'));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.email', 'phase318@prebase.local']);
	git(dir, ['config', 'user.name', 'Phase 318']);
	mkdirSync(join(dir, 'src'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-live', private: true }, null, 2));
	writeFileSync(join(dir, 'src/index.js'), "import { greet } from './greet.js';\nimport { tally } from './tally.js';\nconsole.log(greet('world'), tally([1, 2, 3]));\n");
	writeFileSync(join(dir, 'src/greet.js'), "export function greet(name) { return `Hello, ${name}`; }\n");
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((sum, value) => sum + value, 0); }\n");
	git(dir, ['add', '--', 'package.json', 'src/index.js', 'src/greet.js', 'src/tally.js']);
	git(dir, ['commit', '-qm', 'feat: initial app']);
	for (let index = 1; index <= 8; index++) {
		writeFileSync(join(dir, 'src/greet.js'), `export function greet(name) { return \`Hello, \${name}\`; }\nexport const revision = ${index};\n`);
		git(dir, ['add', '--', 'src/greet.js']);
		git(dir, ['commit', '-qm', `feat: greet revision ${index}`]);
	}
	writeFileSync(join(dir, 'src/tally.js'), "export function tally(xs) { return xs.reduce((sum, value) => sum + value, 0) * 2; }\n");
	git(dir, ['add', '--', 'src/tally.js']);
	git(dir, ['commit', '-qm', 'fix: double tally']);

	const files = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
	const expectedModifiedPath = git(dir, ['diff', '--name-only', 'HEAD^', 'HEAD']);
	return {
		dir,
		head: git(dir, ['rev-parse', 'HEAD']),
		commits: Number(git(dir, ['rev-list', '--count', 'HEAD'])),
		files,
		expectedModifiedPath,
		firstParentSummary: git(dir, ['show', '--stat', '--oneline', '--format=%H %P %s', 'HEAD']),
	};
}

export function createLargeFixture() {
	const layers = ['core', 'ui', 'host', 'parser', 'runtime', 'desktop', 'magnus', 'cloud', 'test', 'adapters', 'layout', 'util'];
	const perLayer = 28;
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-large-'));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.email', 'phase3final@prebase.local']);
	git(dir, ['config', 'user.name', 'Phase 3 Final']);
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-large', private: true }, null, 2));
	git(dir, ['add', '--', 'package.json']);
	git(dir, ['commit', '-qm', 'chore: init']);

	const paths = [];
	for (const layer of layers) {
		mkdirSync(join(dir, 'src', layer), { recursive: true });
		for (let index = 0; index < perLayer; index++) {
			paths.push(`src/${layer}/mod-${String(index).padStart(2, '0')}.js`);
		}
	}

	const writeModule = (relative, extraImport) => {
		const parts = relative.split('/');
		const layer = parts[1];
		const index = Number(parts[2].replace(/[^\d]/g, ''));
		const nextInLayer = `./mod-${String((index + 1) % perLayer).padStart(2, '0')}.js`;
		const lines = [];
		if (index < perLayer - 1) {
			lines.push(`import { token as next } from '${nextInLayer}';`, 'void next;');
		} else {
			lines.push(`import { token as cycle } from './mod-00.js';`, 'void cycle;');
		}
		if (index % 7 === 0) {
			const crossLayer = layers[(layers.indexOf(layer) + 3) % layers.length];
			const modSuffix = String(index % perLayer).padStart(2, '0');
			lines.push(`import { token as cross } from '../${crossLayer}/mod-${modSuffix}.js';`, 'void cross;');
		}
		if (extraImport) {
			lines.push(extraImport);
		}
		lines.push(`export const token = '${relative}';`, `export function run() { return token; }`, '');
		writeFileSync(join(dir, relative), lines.join('\n'));
	};

	for (const relative of paths) {
		writeModule(relative);
	}
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'feat: import layered architecture']);

	for (let revision = 1; revision <= 45; revision++) {
		const relative = paths[(revision * 7) % paths.length];
		writeModule(relative, `export const revision = ${revision};`);
		git(dir, ['add', '--', relative]);
		git(dir, ['commit', '-qm', `fix: revise ${relative}`]);
	}

	const renamedFrom = paths[10];
	const renamedTo = renamedFrom.replace('.js', '.renamed.js');
	git(dir, ['mv', renamedFrom, renamedTo]);
	git(dir, ['commit', '-qm', `refactor: rename ${renamedFrom}`]);

	const deleted = paths[20];
	git(dir, ['rm', '-q', '--', deleted]);
	git(dir, ['commit', '-qm', `chore: delete ${deleted}`]);

	const touched = [paths[1], paths[40], paths[80], paths[120], paths[160], paths[200], paths[240], paths[300]];
	for (const relative of touched) {
		if (!relative || relative === deleted || relative === renamedFrom) {
			continue;
		}
		writeModule(relative, 'export const wave = 1;');
	}
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'feat: cross-community wave']);

	const files = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
	const moduleSeedCount = paths.length;
	return {
		dir,
		head: git(dir, ['rev-parse', 'HEAD']),
		commits: Number(git(dir, ['rev-list', '--count', 'HEAD'])),
		files,
		layerCount: layers.length,
		perLayer,
		moduleCount: moduleSeedCount,
		expectedModuleFilesRemaining: moduleSeedCount - 1,
		expectedHeadFileCount: expectedRepositoryHeadFileCount(moduleSeedCount),
		expectedModifiedPath: git(dir, ['diff', '--name-only', 'HEAD^', 'HEAD']),
		firstParentSummary: git(dir, ['show', '--stat', '--oneline', '--format=%H %P %s', 'HEAD']),
		scale: 'large',
	};
}

export function createCanonicalScaleFixture() {
	const COMMUNITY_COUNT = 55;
	const NODES_PER_COMMUNITY = 176;
	const LAYERS = ['frontend', 'ui', 'components', 'services', 'backend', 'api', 'database', 'utils', 'config', 'tests'];
	const dir = mkdtempSync(join(tmpdir(), 'pb-temporal-canonical-'));
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.email', 'phase3canonical@prebase.local']);
	git(dir, ['config', 'user.name', 'Phase 3 Canonical']);
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temporal-canonical', private: true }, null, 2));
	git(dir, ['add', '--', 'package.json']);
	git(dir, ['commit', '-qm', 'chore: init']);

	const paths = [];
	const writeModule = (relative, extraLines = []) => {
		const parts = relative.split('/');
		const commName = parts[1];
		const commIndex = Number(commName.replace(/\D/g, ''));
		const fileIndex = Number(parts[2].replace(/\D/g, ''));
		const layer = LAYERS[commIndex % LAYERS.length];
		const lines = [];
		if (fileIndex > 0) {
			lines.push(`import { token as prev } from './file_${fileIndex - 1}.ts';`, 'void prev;');
		}
		if (fileIndex % 2 === 0 && fileIndex >= 2) {
			lines.push(`import { token as hop2 } from './file_${fileIndex - 1}.ts';`, 'void hop2;');
		}
		if (fileIndex % 3 === 0 && fileIndex >= 3) {
			lines.push(`import { token as hop3 } from './file_${fileIndex - 2}.ts';`, 'void hop3;');
		}
		if (commIndex > 0 && fileIndex === 0) {
			const prevComm = `module_${String(commIndex - 1).padStart(2, '0')}`;
			lines.push(`import { token as inter } from '../${prevComm}/file_0.ts';`, 'void inter;');
		}
		for (const extra of extraLines) {
			lines.push(extra);
		}
		lines.push(`export const token = '${relative}';`, `export const layer = '${layer}';`, `export function run() { return token; }`, '');
		writeFileSync(join(dir, relative), lines.join('\n'));
	};

	for (let community = 0; community < COMMUNITY_COUNT; community++) {
		const commName = `module_${String(community).padStart(2, '0')}`;
		mkdirSync(join(dir, 'src', commName), { recursive: true });
		const batch = [];
		for (let index = 0; index < NODES_PER_COMMUNITY; index++) {
			const relative = `src/${commName}/file_${index}.ts`;
			paths.push(relative);
			writeModule(relative);
			batch.push(relative);
		}
		git(dir, ['add', '--', ...batch]);
		git(dir, ['commit', '-qm', `feat: seed ${commName}`]);
	}

	for (let revision = 1; revision <= 45; revision++) {
		const relative = paths[(revision * 137) % paths.length];
		writeModule(relative, [`export const revision = ${revision};`]);
		git(dir, ['add', '--', relative]);
		git(dir, ['commit', '-qm', `fix: revise ${relative}`]);
	}

	const renamedFrom = paths[500];
	const renamedTo = renamedFrom.replace('.ts', '.renamed.ts');
	git(dir, ['mv', renamedFrom, renamedTo]);
	git(dir, ['commit', '-qm', `refactor: rename ${renamedFrom}`]);

	const deleted = paths[1000];
	git(dir, ['rm', '-q', '--', deleted]);
	git(dir, ['commit', '-qm', `chore: delete ${deleted}`]);

	const touched = [paths[1], paths[500], paths[1500], paths[3000], paths[5000], paths[7000], paths[9000]];
	for (const relative of touched) {
		if (!relative || relative === deleted || relative === renamedFrom) {
			continue;
		}
		writeModule(relative, ['export const wave = 1;']);
	}
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-qm', 'feat: cross-community wave']);

	const files = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean);
	const moduleSeedCount = paths.length;
	return {
		dir,
		head: git(dir, ['rev-parse', 'HEAD']),
		commits: Number(git(dir, ['rev-list', '--count', 'HEAD'])),
		files,
		communityCount: COMMUNITY_COUNT,
		perCommunity: NODES_PER_COMMUNITY,
		moduleCount: moduleSeedCount,
		expectedModuleFilesRemaining: moduleSeedCount - 1,
		expectedHeadFileCount: expectedRepositoryHeadFileCount(moduleSeedCount),
		expectedModifiedPath: git(dir, ['diff', '--name-only', 'HEAD^', 'HEAD']),
		firstParentSummary: git(dir, ['show', '--stat', '--oneline', '--format=%H %P %s', 'HEAD']),
		scale: 'canonical-scale',
	};
}
