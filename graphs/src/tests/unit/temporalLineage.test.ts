/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { suite, test } from 'mocha';
import { TemporalLineageResolver, type FileToResolve } from '../../temporal/core/temporalLineageResolver.js';
import { TemporalEdgeLineageResolver } from '../../temporal/core/temporalEdgeLineage.js';
import type { TemporalEntitySnapshot } from '../../temporal/common/temporalTypes.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';
import type { GraphNode } from '../../common/types/graphTypes.js';

function createDummyNode(path: string): GraphNode {
	return {
		id: path,
		kind: 'file',
		label: path.split('/').pop() || path,
		path,
		meta: {
			language: 'typescript',
			architectureLayer: 'domain',
		},
	};
}

suite('TemporalLineageResolver & TemporalEdgeLineage', () => {
	const resolver = new TemporalLineageResolver();
	const edgeResolver = new TemporalEdgeLineageResolver();

	test('Case 1: Unchanged file preserves entity ID and records same-canonical-id event', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_a_ts_c1', {
				entityId: 'ent_src_a_ts_c1',
				commitSha: 'commit1',
				path: 'src/a.ts',
				blobOid: 'blob_a1',
				nodeData: createDummyNode('src/a.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/a.ts', 'ent_src_a_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [{
			path: 'src/a.ts',
			blobOid: 'blob_a1',
			nodeData: createDummyNode('src/a.ts'),
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges: [],
		});

		assert.strictEqual(result.entitySnapshots.size, 1);
		assert.strictEqual(result.pathToEntityId.get('src/a.ts'), 'ent_src_a_ts_c1');
		assert.strictEqual(result.lineageEvents.length, 1);
		assert.strictEqual(result.lineageEvents[0].lineageCase, 'same-canonical-id');
		assert.strictEqual(result.lineageEvents[0].entityId, 'ent_src_a_ts_c1');
	});

	test('Case 2: Modified in place preserves entity ID and records modified-in-place event', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_a_ts_c1', {
				entityId: 'ent_src_a_ts_c1',
				commitSha: 'commit1',
				path: 'src/a.ts',
				blobOid: 'blob_a1',
				nodeData: createDummyNode('src/a.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/a.ts', 'ent_src_a_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [{
			path: 'src/a.ts',
			blobOid: 'blob_a2_modified',
			nodeData: createDummyNode('src/a.ts'),
		}];

		const diffChanges: GitExactDiffChange[] = [{
			kind: 'modified',
			path: 'src/a.ts',
			oldBlobOid: 'blob_a1',
			newBlobOid: 'blob_a2_modified',
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
		});

		assert.strictEqual(result.entitySnapshots.size, 1);
		assert.strictEqual(result.pathToEntityId.get('src/a.ts'), 'ent_src_a_ts_c1');
		assert.strictEqual(result.lineageEvents.length, 1);
		assert.strictEqual(result.lineageEvents[0].lineageCase, 'modified-in-place');
	});

	test('Case 3: Exact rename (R100) preserves entity ID at new path', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_old_ts_c1', {
				entityId: 'ent_src_old_ts_c1',
				commitSha: 'commit1',
				path: 'src/old.ts',
				blobOid: 'blob_same',
				nodeData: createDummyNode('src/old.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/old.ts', 'ent_src_old_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [{
			path: 'src/new.ts',
			blobOid: 'blob_same',
			nodeData: createDummyNode('src/new.ts'),
		}];

		const diffChanges: GitExactDiffChange[] = [{
			kind: 'renamed',
			path: 'src/new.ts',
			oldPath: 'src/old.ts',
			similarity: 100,
			oldBlobOid: 'blob_same',
			newBlobOid: 'blob_same',
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
		});

		assert.strictEqual(result.entitySnapshots.size, 1);
		assert.strictEqual(result.pathToEntityId.get('src/new.ts'), 'ent_src_old_ts_c1');
		assert.strictEqual(result.lineageEvents.length, 1);
		assert.strictEqual(result.lineageEvents[0].lineageCase, 'git-rename');
		assert.strictEqual(result.lineageEvents[0].evidence.oldPath, 'src/old.ts');
		assert.strictEqual(result.lineageEvents[0].evidence.newPath, 'src/new.ts');
	});

	test('Case 4: Rename + edit (R<100) preserves entity ID and records git-rename-edit event', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_old_ts_c1', {
				entityId: 'ent_src_old_ts_c1',
				commitSha: 'commit1',
				path: 'src/old.ts',
				blobOid: 'blob_old',
				nodeData: createDummyNode('src/old.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/old.ts', 'ent_src_old_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [{
			path: 'src/renamed_edited.ts',
			blobOid: 'blob_new_edit',
			nodeData: createDummyNode('src/renamed_edited.ts'),
		}];

		const diffChanges: GitExactDiffChange[] = [{
			kind: 'renamed',
			path: 'src/renamed_edited.ts',
			oldPath: 'src/old.ts',
			similarity: 82,
			oldBlobOid: 'blob_old',
			newBlobOid: 'blob_new_edit',
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
		});

		assert.strictEqual(result.entitySnapshots.size, 1);
		assert.strictEqual(result.pathToEntityId.get('src/renamed_edited.ts'), 'ent_src_old_ts_c1');
		assert.strictEqual(result.lineageEvents.length, 1);
		assert.strictEqual(result.lineageEvents[0].lineageCase, 'git-rename-edit');
		assert.strictEqual(result.lineageEvents[0].evidence.similarity, 82);
	});

	test('Case 6: Forked copy preserves source entity and generates fresh entity ID for target', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_orig_ts_c1', {
				entityId: 'ent_src_orig_ts_c1',
				commitSha: 'commit1',
				path: 'src/orig.ts',
				blobOid: 'blob_shared',
				nodeData: createDummyNode('src/orig.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/orig.ts', 'ent_src_orig_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [
			{
				path: 'src/orig.ts',
				blobOid: 'blob_shared',
				nodeData: createDummyNode('src/orig.ts'),
			},
			{
				path: 'src/copy.ts',
				blobOid: 'blob_shared',
				nodeData: createDummyNode('src/copy.ts'),
			},
		];

		const diffChanges: GitExactDiffChange[] = [{
			kind: 'copied',
			path: 'src/copy.ts',
			oldPath: 'src/orig.ts',
			similarity: 100,
			oldBlobOid: 'blob_shared',
			newBlobOid: 'blob_shared',
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
		});

		assert.strictEqual(result.entitySnapshots.size, 2);
		assert.strictEqual(result.pathToEntityId.get('src/orig.ts'), 'ent_src_orig_ts_c1');
		const copyEntityId = result.pathToEntityId.get('src/copy.ts')!;
		assert.notStrictEqual(copyEntityId, 'ent_src_orig_ts_c1');
		assert.ok(copyEntityId.includes('copy'));

		const copyEvent = result.lineageEvents.find(e => e.lineageCase === 'forked-copy');
		assert.ok(copyEvent);
		assert.strictEqual(copyEvent.evidence.sourceEntityId, 'ent_src_orig_ts_c1');
	});

	test('Case 7: Deleted file records terminated event', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_src_deleted_ts_c1', {
				entityId: 'ent_src_deleted_ts_c1',
				commitSha: 'commit1',
				path: 'src/deleted.ts',
				blobOid: 'blob_del',
				nodeData: createDummyNode('src/deleted.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/deleted.ts', 'ent_src_deleted_ts_c1'],
		]);

		const currentFiles: FileToResolve[] = [];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges: [{ kind: 'deleted', path: 'src/deleted.ts' }],
		});

		assert.strictEqual(result.entitySnapshots.size, 0);
		assert.deepStrictEqual(result.terminatedEntityIds, ['ent_src_deleted_ts_c1']);
		const termEvent = result.lineageEvents.find(e => e.lineageCase === 'terminated');
		assert.ok(termEvent);
		assert.strictEqual(termEvent.entityId, 'ent_src_deleted_ts_c1');
	});

	test('Case 8: Recreated file after deletion receives fresh entity ID', () => {
		const parentPathToEntityId = new Map<string, string>();
		const deletedHistory = new Set<string>(['ent_src_prior_ts_c0']);

		// Parent snapshot before recreation has a dummy placeholder in deleted history
		const priorSnapshotMap = new Map<string, TemporalEntitySnapshot>([
			['ent_src_prior_ts_c0', {
				entityId: 'ent_src_prior_ts_c0',
				commitSha: 'commit0',
				path: 'src/recreated.ts',
				blobOid: 'blob_old',
				nodeData: createDummyNode('src/recreated.ts'),
			}],
		]);

		const currentFiles: FileToResolve[] = [{
			path: 'src/recreated.ts',
			blobOid: 'blob_new_version',
			nodeData: createDummyNode('src/recreated.ts'),
		}];

		const result = resolver.resolveLineage({
			commitSha: 'commit3',
			parentCommitSha: 'commit2',
			parentEntityMap: priorSnapshotMap,
			parentPathToEntityId,
			currentFiles,
			diffChanges: [{ kind: 'added', path: 'src/recreated.ts' }],
			deletedEntityIdsInHistory: deletedHistory,
		});

		const newEntityId = result.pathToEntityId.get('src/recreated.ts')!;
		assert.notStrictEqual(newEntityId, 'ent_src_prior_ts_c0');
		assert.ok(newEntityId.includes('recreated'));
		const recreateEvent = result.lineageEvents.find(e => e.lineageCase === 'recreated-fresh');
		assert.ok(recreateEvent);
		assert.strictEqual(recreateEvent.evidence.sourceEntityId, 'ent_src_prior_ts_c0');
	});

	test('Case 11: Swapped paths correctly follows content/git evidence', () => {
		const parentSnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_path_a', {
				entityId: 'ent_path_a',
				commitSha: 'commit1',
				path: 'src/fileA.ts',
				blobOid: 'blob_a',
				nodeData: createDummyNode('src/fileA.ts'),
			}],
			['ent_path_b', {
				entityId: 'ent_path_b',
				commitSha: 'commit1',
				path: 'src/fileB.ts',
				blobOid: 'blob_b',
				nodeData: createDummyNode('src/fileB.ts'),
			}],
		]);
		const parentPathToEntityId = new Map<string, string>([
			['src/fileA.ts', 'ent_path_a'],
			['src/fileB.ts', 'ent_path_b'],
		]);

		const currentFiles: FileToResolve[] = [
			{ path: 'src/fileA.ts', blobOid: 'blob_b', nodeData: createDummyNode('src/fileA.ts') },
			{ path: 'src/fileB.ts', blobOid: 'blob_a', nodeData: createDummyNode('src/fileB.ts') },
		];

		const diffChanges: GitExactDiffChange[] = [
			{ kind: 'renamed', path: 'src/fileA.ts', oldPath: 'src/fileB.ts', oldBlobOid: 'blob_b', newBlobOid: 'blob_b', similarity: 100 },
			{ kind: 'renamed', path: 'src/fileB.ts', oldPath: 'src/fileA.ts', oldBlobOid: 'blob_a', newBlobOid: 'blob_a', similarity: 100 },
		];

		const result = resolver.resolveLineage({
			commitSha: 'commit2',
			parentCommitSha: 'commit1',
			parentEntityMap: parentSnapshots,
			parentPathToEntityId,
			currentFiles,
			diffChanges,
		});

		assert.strictEqual(result.pathToEntityId.get('src/fileA.ts'), 'ent_path_b');
		assert.strictEqual(result.pathToEntityId.get('src/fileB.ts'), 'ent_path_a');
		const swappedEvents = result.lineageEvents.filter(e => e.lineageCase === 'swapped-paths');
		assert.strictEqual(swappedEvents.length, 2);
	});

	test('TemporalEdgeLineageResolver binds edges across resolved entity IDs', () => {
		const entitySnapshots = new Map<string, TemporalEntitySnapshot>([
			['ent_a', { entityId: 'ent_a', commitSha: 'c1', path: 'src/a.ts', nodeData: createDummyNode('src/a.ts') }],
			['ent_b', { entityId: 'ent_b', commitSha: 'c1', path: 'src/b.ts', nodeData: createDummyNode('src/b.ts') }],
		]);
		const pathToEntityId = new Map<string, string>([
			['src/a.ts', 'ent_a'],
			['src/b.ts', 'ent_b'],
		]);

		const rawEdges = [
			{ sourcePath: 'src/a.ts', targetPath: 'src/b.ts', kind: 'imports' as const, weight: 2 },
			{ sourcePath: 'src/a.ts', targetPath: 'external-pkg', kind: 'imports' as const, weight: 1 },
		];

		const edgeMap = edgeResolver.resolveEdges({
			commitSha: 'c1',
			entitySnapshots,
			pathToEntityId,
			rawEdges,
		});

		assert.strictEqual(edgeMap.size, 2);
		assert.ok(edgeMap.has('ent_a->ent_b:imports'));
		assert.strictEqual(edgeMap.get('ent_a->ent_b:imports')!.edgeData.target, 'src/b.ts');
		assert.ok(edgeMap.has('ent_a->ext_external-pkg:imports'));
	});
});
