import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { registerGuidanceTargetsFromToolCalls, resolveGuidanceTarget } from './projectGuidanceJit';
import { createProjectGuidanceSession, getProjectGuidanceSession, runWithProjectGuidanceSession } from './projectGuidanceSession';

const magnusDir = dirname(fileURLToPath(import.meta.url));
const jitTmpRoot = join(magnusDir, '../../../test/prebase/tmp/guidance-jit');

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
});
