/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
	extractMutationPathStrings,
	preflightMutationGuidance,
	registerGuidanceTargetsFromToolCalls,
	registerMutationTargetsFromToolCall,
	resolveGuidanceTarget,
	type MutationPreflightContext,
} from './projectGuidanceJit';
import { seedSessionFromSnapshot } from './projectGuidanceDelta';
import { ProjectGuidanceService } from './projectGuidanceService';
import { createProjectGuidanceSession, getProjectGuidanceSession, runWithProjectGuidanceSession } from './projectGuidanceSession';

const magnusDir = dirname(fileURLToPath(import.meta.url));
const jitTmpRoot = join(magnusDir, '../../../test/prebase/tmp/guidance-jit');
const monorepoFixture = join(magnusDir, '../../../test/prebase/fixtures/project-guidance-monorepo');

function makeReader(root: string) {
	return {
		exists: (path: string) => existsSync(path),
		readFile: (path: string) => readFileSync(path, 'utf8'),
		readDirectory: (path: string) => readdirSync(path),
		isTrusted: () => true,
	};
}

function tempRoot(prefix: string): string {
	mkdirSync(jitTmpRoot, { recursive: true });
		const root = mkdtempSync(join(jitTmpRoot, `${prefix}-`));
		mkdirSync(join(root, 'src'), { recursive: true });
		writeFileSync(join(root, 'src/main.ts'), 'export {};\n');
		return root;
}

describe('projectGuidanceJit', () => {
	test('registerGuidanceTargetsFromToolCalls adds targets after workspace read_file', async () => {
		const root = tempRoot('jit');
		try {
			const folders = [{ uri: { fsPath: root } }];
			const session = createProjectGuidanceSession();
			await runWithProjectGuidanceSession(session, async () => {
				const added = registerGuidanceTargetsFromToolCalls([
					{ name: 'prebase_workspace_read_file', args: { path: 'src/main.ts' } },
				], folders);
				assert.equal(added.length, 1);
				assert.equal(added[0].workspaceRoot, root);
				assert.equal(added[0].relativePath, 'src/main.ts');
				assert.deepEqual(session.getTargetPathsForRoot(root), ['src/main.ts']);
				const duplicate = registerGuidanceTargetsFromToolCalls([
					{ name: 'prebase_workspace_read_file', args: { path: 'src/main.ts' } },
				], folders);
				assert.equal(duplicate.length, 0);
			});
			assert.equal(getProjectGuidanceSession(), undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('resolveGuidanceTarget picks the workspace root that contains the file', () => {
		const rootA = tempRoot('jit-a');
		const rootB = tempRoot('jit-b');
		try {
			mkdirSync(join(rootA, 'shared'), { recursive: true });
			mkdirSync(join(rootB, 'shared'), { recursive: true });
			writeFileSync(join(rootA, 'shared/file.ts'), 'a');
			writeFileSync(join(rootB, 'shared/file.ts'), 'b');
			const folders = [{ uri: { fsPath: rootA } }, { uri: { fsPath: rootB } }];
			const targetA = resolveGuidanceTarget(join(rootA, 'shared/file.ts'), folders);
			const targetB = resolveGuidanceTarget(join(rootB, 'shared/file.ts'), folders);
			assert.equal(targetA?.workspaceRoot, rootA);
			assert.equal(targetB?.workspaceRoot, rootB);
			assert.equal(targetA?.relativePath, 'shared/file.ts');
			assert.equal(targetB?.relativePath, 'shared/file.ts');
		} finally {
			rmSync(rootA, { recursive: true, force: true });
			rmSync(rootB, { recursive: true, force: true });
		}
	});

	test('registerGuidanceTargetsFromToolCalls ignores non-workspace tools', () => {
		const session = createProjectGuidanceSession();
		runWithProjectGuidanceSession(session, () => {
			const added = registerGuidanceTargetsFromToolCalls([
				{ name: 'prebase_web_search', args: { query: 'foo' } },
			], [{ uri: { fsPath: '/tmp/x' } }]);
			assert.equal(added.length, 0);
			assert.equal(session.getTargets().length, 0);
		});
	});

	test('registerGuidanceTargetsFromToolCalls is a no-op without an active guidance session', () => {
		assert.equal(getProjectGuidanceSession(), undefined);
		const root = tempRoot('jit-nosession');
		try {
			const added = registerGuidanceTargetsFromToolCalls([
				{ name: 'prebase_workspace_read_file', args: { path: 'src/main.ts' } },
			], [{ uri: { fsPath: root } }]);
			assert.equal(added.length, 0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('registerGuidanceTargetsFromToolCalls covers workspace search/list/definition tools', () => {
		const root = tempRoot('jit-tools');
		try {
			writeFileSync(join(root, 'src/a.ts'), 'export {};\n');
			writeFileSync(join(root, 'src/b.ts'), 'export {};\n');
			const session = createProjectGuidanceSession();
			runWithProjectGuidanceSession(session, () => {
				const added = registerGuidanceTargetsFromToolCalls([
					{ name: 'prebase_workspace_search_text', args: { path: 'src/a.ts', query: 'export' } },
					{ name: 'prebase_workspace_list_files', args: { path: 'src' } },
					{ name: 'prebase_workspace_get_definition', args: { filePath: 'src/b.ts' } },
					{ name: 'prebase_project_guidance', args: { operation: 'get_for_paths', paths: ['src/a.ts'] } },
				], [{ uri: { fsPath: root } }]);
				assert.ok(added.some(item => item.relativePath === 'src/a.ts'));
				assert.ok(added.some(item => item.relativePath === 'src/b.ts' || item.relativePath === 'src'));
				assert.ok(session.getTargetPathsForRoot(root).includes('src/a.ts'));
				assert.equal(session.getTargetPathsForRoot(root).includes('graphs/src/foo.ts'), false);
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('extractMutationPathStrings collects rename from/to and apply batch file paths', () => {
		const renamePaths = extractMutationPathStrings({
			name: 'prebase_edit_rename_file',
			args: { from: 'graphs/src/foo.ts', to: 'graphs/src/bar.ts' },
			index: 0,
		});
		assert.deepEqual(renamePaths, ['graphs/src/foo.ts', 'graphs/src/bar.ts']);

		const batchPaths = extractMutationPathStrings({
			name: 'prebase_edit_apply',
			args: {
				files: [
					{ path: 'graphs/src/foo.ts', expectedVersion: 1, edits: [] },
					{ path: 'src/main.ts', expectedVersion: 1, edits: [] },
				],
			},
			index: 0,
		});
		assert.deepEqual(batchPaths, ['graphs/src/foo.ts', 'src/main.ts']);
	});

	test('registerMutationTargetsFromToolCall registers both rename paths', () => {
		const root = monorepoFixture;
		const session = createProjectGuidanceSession();
		runWithProjectGuidanceSession(session, () => {
			const added = registerMutationTargetsFromToolCall({
				name: 'prebase_edit_rename_file',
				args: { from: 'graphs/src/foo.ts', to: 'graphs/src/bar.ts' },
				index: 0,
			}, [{ uri: { fsPath: root } }], root);
			assert.equal(added.length, 2);
			const paths = session.getTargetPathsForRoot(root).sort();
			assert.deepEqual(paths, ['graphs/src/bar.ts', 'graphs/src/foo.ts']);
		});
	});

	test('preflightMutationGuidance defers when path-specific guidance newly applies', async () => {
		const root = monorepoFixture;
		const service = new ProjectGuidanceService(makeReader(root));
		const session = createProjectGuidanceSession();
		const initial = await service.getSnapshot(root);
		seedSessionFromSnapshot(initial, session);
		let currentSnapshot = initial;
		const ctx: MutationPreflightContext = {
			service,
			session,
			enabled: true,
			getPreviousSnapshot: () => currentSnapshot,
			updateSnapshot: snapshot => { currentSnapshot = snapshot; },
		};
		await runWithProjectGuidanceSession(session, async () => {
			const outcome = await preflightMutationGuidance({
				name: 'prebase_edit_apply_file',
				args: { path: 'graphs/src/foo.ts', content: 'export {};\n' },
				index: 0,
			}, [{ uri: { fsPath: root } }], root, ctx);
			assert.equal(outcome.defer, true);
			assert.deepEqual(outcome.paths, ['graphs/src/foo.ts']);
			assert.match(outcome.deltaBlock ?? '', /Graph path rule/);
			assert.ok(outcome.updatedSnapshot?.pathApplicable.some(item => item.text.includes('Graph path rule')));
		});
	});

	test('preflightMutationGuidance allows reissue after guidance is loaded', async () => {
		const root = monorepoFixture;
		const service = new ProjectGuidanceService(makeReader(root));
		const session = createProjectGuidanceSession();
		const initial = await service.getSnapshot(root);
		seedSessionFromSnapshot(initial, session);
		let currentSnapshot = initial;
		const ctx: MutationPreflightContext = {
			service,
			session,
			enabled: true,
			getPreviousSnapshot: () => currentSnapshot,
			updateSnapshot: snapshot => { currentSnapshot = snapshot; },
		};
		const call = {
			name: 'prebase_edit_apply_file',
			args: { path: 'graphs/src/foo.ts', content: 'export {};\n' },
			index: 0,
		};
		await runWithProjectGuidanceSession(session, async () => {
			const deferred = await preflightMutationGuidance(call, [{ uri: { fsPath: root } }], root, ctx);
			assert.equal(deferred.defer, true);
			const reissue = await preflightMutationGuidance(call, [{ uri: { fsPath: root } }], root, ctx);
			assert.equal(reissue.defer, false);
			assert.deepEqual(reissue.paths, ['graphs/src/foo.ts']);
		});
	});

	test('preflightMutationGuidance defers apply batch when any path triggers new guidance', async () => {
		const root = monorepoFixture;
		const service = new ProjectGuidanceService(makeReader(root));
		const session = createProjectGuidanceSession();
		const initial = await service.getSnapshot(root);
		seedSessionFromSnapshot(initial, session);
		let currentSnapshot = initial;
		const ctx: MutationPreflightContext = {
			service,
			session,
			enabled: true,
			getPreviousSnapshot: () => currentSnapshot,
			updateSnapshot: snapshot => { currentSnapshot = snapshot; },
		};
		await runWithProjectGuidanceSession(session, async () => {
			const outcome = await preflightMutationGuidance({
				name: 'prebase_edit_apply',
				args: {
					files: [
						{ path: 'graphs/src/foo.ts', expectedVersion: 1, edits: [{ start: {}, end: {}, text: 'x' }] },
						{ path: 'src/main.ts', expectedVersion: 1, edits: [{ start: {}, end: {}, text: 'y' }] },
					],
				},
				index: 0,
			}, [{ uri: { fsPath: root } }], root, ctx);
			assert.equal(outcome.defer, true);
			assert.deepEqual(outcome.paths, ['graphs/src/foo.ts', 'src/main.ts']);
			assert.match(outcome.deltaBlock ?? '', /Graph path rule/);
		});
	});

	test('preflightMutationGuidance is a no-op when disabled', async () => {
		const root = monorepoFixture;
		const service = new ProjectGuidanceService(makeReader(root));
		const session = createProjectGuidanceSession();
		const initial = await service.getSnapshot(root);
		const ctx: MutationPreflightContext = {
			service,
			session,
			enabled: false,
			getPreviousSnapshot: () => initial,
			updateSnapshot: () => {},
		};
		await runWithProjectGuidanceSession(session, async () => {
			const outcome = await preflightMutationGuidance({
				name: 'prebase_edit_apply_file',
				args: { path: 'graphs/src/foo.ts', content: 'x' },
				index: 0,
			}, [{ uri: { fsPath: root } }], root, ctx);
			assert.equal(outcome.defer, false);
			assert.deepEqual(outcome.paths, []);
		});
	});
});
