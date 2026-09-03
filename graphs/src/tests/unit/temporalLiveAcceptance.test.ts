/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, test } from 'mocha';

const runner = fileURLToPath(new URL('../../../scripts/acceptance/temporal-live.mjs', import.meta.url));

function validEvidence() {
	return {
		fixture: {
			commits: 10,
			files: ['package.json', 'src/greet.js', 'src/index.js', 'src/tally.js'],
			expectedModifiedPath: 'src/tally.js',
			head: 'target',
		},
		targetOpened: true,
		repoLoaded: true,
		fullMap: {
			selectedCommitSha: 'target',
			renderedCommitSha: 'target',
			receivedNodeCount: 4,
			visibleNodeCount: 4,
			nodesDrawn: 4,
			finiteCoordinateCount: 4,
			renderedLabelOverlapCount: 0,
			canvas: { distinctPixels: 200 },
			transform: { x: 400, y: 290, k: 1.2 },
		},
		focusChanges: {
			displayMode: 'changes',
			visibleNodeCount: 2,
			nodesDrawn: 2,
			renderedLabelOverlapCount: 0,
			summary: { modifiedCount: 1 },
			canvas: { distinctPixels: 100 },
		},
		unexpectedError: false,
		stuckIndexing: false,
		quit: { remaining: 'gone' },
	};
}

function evaluate(evidence: ReturnType<typeof validEvidence>) {
	const result = spawnSync(process.execPath, [runner, '--evaluate'], {
		input: JSON.stringify(evidence),
		encoding: 'utf8',
	});
	return {
		status: result.status,
		stderr: result.stderr,
		output: JSON.parse(result.stdout),
	};
}

suite('Temporal Live Acceptance Evaluation', () => {
	test('zero received and drawn nodes with an unopened target fails closed', () => {
		const evidence = validEvidence();
		evidence.targetOpened = false;
		evidence.fullMap.receivedNodeCount = 0;
		evidence.fullMap.visibleNodeCount = 0;
		evidence.fullMap.nodesDrawn = 0;
		evidence.fullMap.finiteCoordinateCount = 0;

		const result = evaluate(evidence);

		assert.equal(result.status, 1, result.stderr);
		assert.deepStrictEqual(result.output, {
			ok: false,
			failures: [
				'Temporal Graph target did not open',
				'Full Map received zero nodes',
				'Full Map exposed zero visible nodes',
				'Full Map drew zero nodes',
			],
		});
	});

	test('missing renderedLabelOverlapCount fails closed even when nodes are present', () => {
		const evidence = validEvidence();
		const fullMap = { ...evidence.fullMap } as Record<string, unknown>;
		const focusChanges = { ...evidence.focusChanges } as Record<string, unknown>;
		delete fullMap.renderedLabelOverlapCount;
		delete focusChanges.renderedLabelOverlapCount;
		evidence.fullMap = fullMap as typeof evidence.fullMap;
		evidence.focusChanges = focusChanges as typeof evidence.focusChanges;
		const result = evaluate(evidence);
		assert.equal(result.status, 1, result.stderr);
		assert.ok(result.output.failures.some((item: string) => /Full Map has rendered label overlaps/.test(item)));
		assert.ok(result.output.failures.some((item: string) => /Focus Changes has rendered label overlaps/.test(item)));
	});

	test('representative rendered evidence passes without failures', () => {
		const result = evaluate(validEvidence());

		assert.equal(result.status, 0, result.stderr);
		assert.deepStrictEqual(result.output, { ok: true, failures: [] });
	});
});
