/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeTemporalStructuralDiff } from '../../temporal/view/temporalStructuralDiff.js';
import type { TemporalEntitySnapshot, TemporalEdgeSnapshot } from '../../temporal/common/temporalTypes.js';
import type { GitExactDiffChange } from '../../history/git/gitTypes.js';

suite('TemporalComparisonTruth (Unit - Elimination of +493/-490 False Comparison)', () => {
	function makeSnapshot(
		entityId: string,
		path: string,
		canonicalId: string,
		blobOid?: string,
		contentHash?: string,
		meta?: any
	): TemporalEntitySnapshot {
		return {
			entityId,
			commitSha: 'commit-test',
			path,
			blobOid: blobOid || `blob_${path}`,
			contentHash: contentHash || `hash_${path}`,
			nodeData: {
				id: canonicalId,
				kind: 'file',
				label: path.split('/').pop() || path,
				path,
				meta: meta || {},
			} as any,
		};
	}

	function makeEdge(
		edgeId: string,
		sourceEntityId: string,
		targetEntityId: string,
		sourcePath: string,
		targetPath: string,
		kind = 'import'
	): TemporalEdgeSnapshot {
		return {
			edgeId,
			commitSha: 'commit-test',
			sourceEntityId,
			targetEntityId,
			kind: kind as any,
			edgeData: {
				id: edgeId,
				source: sourceEntityId,
				target: targetEntityId,
				kind,
				meta: {},
			},
			...({ sourcePath, targetPath } as any),
		};
	}

	test('1. Same 500 files with different cold-anchor entity IDs produces ZERO false adds/removes', () => {
		// Base indexed as cold anchor commit A -> entityIds have prefix ent_A_
		const baseEntities: TemporalEntitySnapshot[] = [];
		const baseEdges: TemporalEdgeSnapshot[] = [];
		for (let i = 0; i < 500; i++) {
			const path = `src/module_${Math.floor(i / 10)}/file_${i}.ts`;
			baseEntities.push(makeSnapshot(`ent_A_${i}`, path, `can_${i}`, `blob_${i}`));
		}
		for (let i = 0; i < 400; i++) {
			baseEdges.push(
				makeEdge(
					`edge_A_${i}`,
					`ent_A_${i}`,
					`ent_A_${(i + 1) % 500}`,
					baseEntities[i].path,
					baseEntities[(i + 1) % 500].path
				)
			);
		}

		// Target indexed as cold anchor commit B -> entityIds have completely distinct prefix ent_B_
		const targetEntities: TemporalEntitySnapshot[] = [];
		const targetEdges: TemporalEdgeSnapshot[] = [];
		for (let i = 0; i < 500; i++) {
			const path = `src/module_${Math.floor(i / 10)}/file_${i}.ts`;
			targetEntities.push(makeSnapshot(`ent_B_${i}`, path, `can_${i}`, `blob_${i}`));
		}
		for (let i = 0; i < 400; i++) {
			targetEdges.push(
				makeEdge(
					`edge_B_${i}`,
					`ent_B_${i}`,
					`ent_B_${(i + 1) % 500}`,
					targetEntities[i].path,
					targetEntities[(i + 1) % 500].path
				)
			);
		}

		const diff = computeTemporalStructuralDiff(
			'commit-B',
			targetEntities,
			targetEdges,
			'commit-A',
			baseEntities,
			baseEdges
		);

		// Must yield 0 adds, 0 removes, 0 modified, 500 unchanged (NOT +500/-500)
		assert.equal(diff.summary.addedCount, 0, 'addedCount must be 0 for identical cold-anchor snapshots');
		assert.equal(diff.summary.removedCount, 0, 'removedCount must be 0 for identical cold-anchor snapshots');
		assert.equal(diff.summary.modifiedCount, 0, 'modifiedCount must be 0 for identical cold-anchor snapshots');
		assert.equal(diff.summary.renamedCount, 0, 'renamedCount must be 0 for identical cold-anchor snapshots');
		assert.equal(diff.summary.unchangedCount, 500, 'unchangedCount must be exactly 500');

		// Edges must also match across comparison identity mapping (0 added, 0 removed)
		assert.equal(diff.summary.edgeAddedCount, 0, 'edgeAddedCount must be 0');
		assert.equal(diff.summary.edgeRemovedCount, 0, 'edgeRemovedCount must be 0');
		assert.equal(diff.summary.edgeModifiedCount, 0, 'edgeModifiedCount must be 0');
	});

	test('2. Single modified file among cold anchors yields exactly 1 modified', () => {
		const baseEntities = [
			makeSnapshot('ent_A_1', 'src/app.ts', 'can_1', 'blob_v1'),
			makeSnapshot('ent_A_2', 'src/util.ts', 'can_2', 'blob_util'),
		];
		const targetEntities = [
			makeSnapshot('ent_B_1', 'src/app.ts', 'can_1_mod', 'blob_v2'), // content changed
			makeSnapshot('ent_B_2', 'src/util.ts', 'can_2', 'blob_util'), // unchanged
		];

		const diff = computeTemporalStructuralDiff('commit-B', targetEntities, [], 'commit-A', baseEntities, []);

		assert.equal(diff.summary.modifiedCount, 1);
		assert.equal(diff.summary.unchangedCount, 1);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);

		const modifiedNode = diff.nodes.find(n => n.path === 'src/app.ts');
		assert.ok(modifiedNode);
		assert.equal(modifiedNode.changeKind, 'modified');
		assert.equal(modifiedNode.isModified, true);
	});

	test('3. Single added file and single deleted file across cold anchors', () => {
		const baseEntities = [
			makeSnapshot('ent_A_1', 'src/kept.ts', 'can_1', 'blob_1'),
			makeSnapshot('ent_A_2', 'src/deleted.ts', 'can_2', 'blob_2'),
		];
		const targetEntities = [
			makeSnapshot('ent_B_1', 'src/kept.ts', 'can_1', 'blob_1'),
			makeSnapshot('ent_B_3', 'src/added.ts', 'can_3', 'blob_3'),
		];

		const diff = computeTemporalStructuralDiff('commit-B', targetEntities, [], 'commit-A', baseEntities, []);

		assert.equal(diff.summary.addedCount, 1);
		assert.equal(diff.summary.removedCount, 1);
		assert.equal(diff.summary.unchangedCount, 1);

		const added = diff.nodes.find(n => n.path === 'src/added.ts');
		assert.equal(added?.changeKind, 'added');

		const removed = diff.nodes.find(n => n.path === 'src/deleted.ts');
		assert.equal(removed?.changeKind, 'removed');
	});

	test('4. Git Rename Evidence (diff-tree -M) pairs files accurately across path changes', () => {
		const baseEntities = [
			makeSnapshot('ent_A_1', 'src/oldName.ts', 'can_1', 'blob_same'),
			makeSnapshot('ent_A_2', 'src/common.ts', 'can_2', 'blob_common'),
		];
		const targetEntities = [
			makeSnapshot('ent_B_1', 'src/newName.ts', 'can_1', 'blob_same'),
			makeSnapshot('ent_B_2', 'src/common.ts', 'can_2', 'blob_common'),
		];

		const gitDiffChanges: GitExactDiffChange[] = [
			{
				kind: 'renamed',
				path: 'src/newName.ts',
				oldPath: 'src/oldName.ts',
				similarity: 100,
				oldBlobOid: 'blob_same',
				newBlobOid: 'blob_same',
			},
		];

		const diff = computeTemporalStructuralDiff(
			'commit-B',
			targetEntities,
			[],
			'commit-A',
			baseEntities,
			[],
			{ gitDiffChanges }
		);

		assert.equal(diff.summary.renamedCount, 1);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);
		assert.equal(diff.summary.unchangedCount, 1);

		const renamedNode = diff.nodes.find(n => n.path === 'src/newName.ts');
		assert.ok(renamedNode);
		assert.equal(renamedNode.changeKind, 'renamed');
		assert.equal(renamedNode.oldPath, 'src/oldName.ts');
		assert.equal(renamedNode.isModified, false);
	});

	test('5. Rename and edit detected simultaneously with isRenamedAndModified', () => {
		const baseEntities = [
			makeSnapshot('ent_A_1', 'src/legacyService.ts', 'can_1_v1', 'blob_v1'),
		];
		const targetEntities = [
			makeSnapshot('ent_B_1', 'src/services/modernService.ts', 'can_1_v2', 'blob_v2'),
		];

		const gitDiffChanges: GitExactDiffChange[] = [
			{
				kind: 'renamed',
				path: 'src/services/modernService.ts',
				oldPath: 'src/legacyService.ts',
				similarity: 82,
				oldBlobOid: 'blob_v1',
				newBlobOid: 'blob_v2',
			},
		];

		const diff = computeTemporalStructuralDiff(
			'commit-B',
			targetEntities,
			[],
			'commit-A',
			baseEntities,
			[],
			{ gitDiffChanges }
		);

		assert.equal(diff.summary.renamedCount, 1);
		assert.equal(diff.summary.renamedModifiedCount, 1);
		assert.equal(diff.summary.addedCount, 0);
		assert.equal(diff.summary.removedCount, 0);

		const node = diff.nodes[0];
		assert.equal(node.changeKind, 'renamed');
		assert.equal(node.isModified, true);
		assert.equal(node.meta?.isRenamedAndModified, true);
		assert.equal(node.oldPath, 'src/legacyService.ts');
	});

	test('6. Duplicate empty/template blobs fail closed without arbitrary incorrect pairing', () => {
		// Three empty __init__.py files in base, two in target
		const baseEntities = [
			makeSnapshot('ent_A_1', 'pkg_a/__init__.py', 'can_1', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
			makeSnapshot('ent_A_2', 'pkg_b/__init__.py', 'can_2', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
			makeSnapshot('ent_A_3', 'pkg_c/__init__.py', 'can_3', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
		];
		const targetEntities = [
			// pkg_a and pkg_b kept, pkg_c removed, pkg_d added
			makeSnapshot('ent_B_1', 'pkg_a/__init__.py', 'can_1', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
			makeSnapshot('ent_B_2', 'pkg_b/__init__.py', 'can_2', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
			makeSnapshot('ent_B_4', 'pkg_d/__init__.py', 'can_4', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'),
		];

		const diff = computeTemporalStructuralDiff('commit-B', targetEntities, [], 'commit-A', baseEntities, []);

		// pkg_a and pkg_b match by same-path (unchanged).
		// pkg_c was removed (1 remove) and pkg_d was added (1 add) — not paired as a rename because duplicate blob identity is ambiguous!
		assert.equal(diff.summary.unchangedCount, 2);
		assert.equal(diff.summary.addedCount, 1);
		assert.equal(diff.summary.removedCount, 1);
		assert.equal(diff.summary.renamedCount, 0);

		const added = diff.nodes.find(n => n.path === 'pkg_d/__init__.py');
		assert.equal(added?.changeKind, 'added');
		const removed = diff.nodes.find(n => n.path === 'pkg_c/__init__.py');
		assert.equal(removed?.changeKind, 'removed');
	});
});
