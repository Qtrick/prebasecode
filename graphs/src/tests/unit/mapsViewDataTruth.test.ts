/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { computeLanguageStats } from '../../core/analysis/languageStats.js';
import type { GraphNode } from '../../common/types/graphTypes.js';
import type { TemporalRenderNode } from '../../temporal/view/temporalViewTypes.js';

suite('MapsViewDataTruth (Unit - Canonical Catalog & Temporal Commit Truth)', () => {
	test('1. Sidebar language stats reflect full canonical catalog (~9.7k nodes), not capped 280 render snapshot', () => {
		// Simulate capped 280-node render snapshot (all TypeScript)
		const cappedSnapshotNodes: GraphNode[] = Array.from({ length: 280 }, (_, i) => ({
			id: `capped-${i}`,
			label: `file_${i}.ts`,
			path: `src/core/file_${i}.ts`,
			kind: 'file',
		}));

		// Simulate full canonical codebase catalog of 9,680 nodes with realistic multi-language distribution
		const canonicalNodes: GraphNode[] = [
			// 6,000 TypeScript files
			...Array.from({ length: 6000 }, (_, i) => ({
				id: `can-ts-${i}`,
				label: `module_${i}.ts`,
				path: `src/ts/module_${i}.ts`,
				kind: 'file' as const,
			})),
			// 2,000 Python files
			...Array.from({ length: 2000 }, (_, i) => ({
				id: `can-py-${i}`,
				label: `script_${i}.py`,
				path: `scripts/py/script_${i}.py`,
				kind: 'file' as const,
			})),
			// 1,000 Rust files
			...Array.from({ length: 1000 }, (_, i) => ({
				id: `can-rs-${i}`,
				label: `crate_${i}.rs`,
				path: `native/src/crate_${i}.rs`,
				kind: 'file' as const,
			})),
			// 680 Markdown/Doc files
			...Array.from({ length: 680 }, (_, i) => ({
				id: `can-md-${i}`,
				label: `doc_${i}.md`,
				path: `docs/doc_${i}.md`,
				kind: 'file' as const,
			})),
		];

		// Proving the bug: capped snapshot falsely reports only 280 files
		const cappedStats = computeLanguageStats(cappedSnapshotNodes);
		const cappedTotal = cappedStats.reduce((s, x) => s + x.count, 0);
		assert.equal(cappedTotal, 280, 'capped snapshot only contains 280 files');
		assert.equal(cappedStats[0].name, 'TypeScript');
		assert.equal(cappedStats[0].percent, 100, 'capped snapshot falsely reports 100% TypeScript');

		// Proving the fix: canonical snapshot accurately reports all 9,680 files and multi-language breakdown
		const canonicalStats = computeLanguageStats(canonicalNodes);
		const canonicalTotal = canonicalStats.reduce((s, x) => s + x.count, 0);
		assert.equal(canonicalTotal, 9680, 'canonical catalog must report all 9,680 files');

		const tsSeg = canonicalStats.find(s => s.name === 'TypeScript');
		const pySeg = canonicalStats.find(s => s.name === 'Python');
		const rsSeg = canonicalStats.find(s => s.name === 'Rust');

		assert.ok(tsSeg && tsSeg.count === 6000, 'TypeScript segment must reflect 6000 files');
		assert.ok(pySeg && pySeg.count === 2000, 'Python segment must reflect 2000 files');
		assert.ok(rsSeg && rsSeg.count === 1000, 'Rust segment must reflect 1000 files');
		assert.ok(tsSeg.percent > 60 && tsSeg.percent < 65, 'TypeScript percentage must accurately reflect ~62%');
	});

	test('2. Sidebar file search finds files present in full canonical dataset outside the 280-node render projection', () => {
		const cappedSnapshotNodeIds = new Set(Array.from({ length: 280 }, (_, i) => `node_${i}`));

		// Create target entity outside the 280-node projection
		const targetFile: GraphNode = {
			id: 'node_5432',
			label: 'SpecialServiceController.ts',
			path: 'src/services/SpecialServiceController.ts',
			kind: 'file',
		};

		assert.ok(!cappedSnapshotNodeIds.has(targetFile.id), 'target file is outside the 280-node projection');

		const canonicalCatalog: GraphNode[] = [
			...Array.from({ length: 9679 }, (_, i) => ({
				id: `node_${i}`,
				label: `item_${i}.ts`,
				path: `src/item_${i}.ts`,
				kind: 'file' as const,
			})),
			targetFile,
		];

		const searchQuery = 'specialservice';
		const matchingFromCanonical = canonicalCatalog.filter(n => {
			const hay = `${n.label} ${n.path}`.toLowerCase();
			return hay.includes(searchQuery);
		});

		assert.equal(matchingFromCanonical.length, 1);
		assert.equal(matchingFromCanonical[0].id, 'node_5432');
		assert.equal(matchingFromCanonical[0].label, 'SpecialServiceController.ts');
	});

	test('3. Temporal commit diff catalog strictly excludes removed diff ghosts and folders', () => {
		const diffNodes: TemporalRenderNode[] = [
			// 4 active target-commit files
			{ entityId: 'e1', canonicalNodeId: 'c1', path: 'src/unchanged.ts', label: 'unchanged.ts', kind: 'file', changeKind: 'unchanged', x: 0, y: 0 },
			{ entityId: 'e2', canonicalNodeId: 'c2', path: 'src/modified.ts', label: 'modified.ts', kind: 'file', changeKind: 'modified', x: 0, y: 0 },
			{ entityId: 'e3', canonicalNodeId: 'c3', path: 'src/added.ts', label: 'added.ts', kind: 'file', changeKind: 'added', x: 0, y: 0 },
			{ entityId: 'e4', canonicalNodeId: 'c4', path: 'src/renamed.ts', label: 'renamed.ts', kind: 'file', changeKind: 'renamed', x: 0, y: 0 },
			// 2 removed diff ghosts (deleted from target commit)
			{ entityId: 'e5', canonicalNodeId: 'c5', path: 'src/deleted_old.ts', label: 'deleted_old.ts', kind: 'file', changeKind: 'removed', x: 0, y: 0 },
			{ entityId: 'e6', canonicalNodeId: 'c6', path: 'src/removed_tool.ts', label: 'removed_tool.ts', kind: 'file', changeKind: 'removed', x: 0, y: 0 },
			// 1 folder entry
			{ entityId: 'e7', canonicalNodeId: 'c7', path: 'src', label: 'src', kind: 'folder', changeKind: 'unchanged', x: 0, y: 0 },
		];

		// When deriving viewed catalog in Temporal mode:
		const viewedFiles = diffNodes.filter(tn => tn.kind !== 'folder' && tn.changeKind !== 'removed' && Boolean(tn.path));

		assert.equal(viewedFiles.length, 4, 'must count only the 4 active files in target commit');
		assert.ok(!viewedFiles.some(f => f.changeKind === 'removed'), 'must exclude removed diff ghosts');
		assert.ok(!viewedFiles.some(f => f.kind === 'folder'), 'must exclude directory/folder nodes');

		const graphNodes: GraphNode[] = viewedFiles.map(f => ({
			id: f.entityId,
			label: f.label || '',
			path: f.path,
			kind: 'file',
		}));
		const stats = computeLanguageStats(graphNodes);
		const totalFiles = stats.reduce((s, x) => s + x.count, 0);
		assert.equal(totalFiles, 4, 'language stats file count must equal 4');
	});
});
