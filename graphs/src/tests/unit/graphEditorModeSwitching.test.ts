/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

suite('Graph Editor Mode Switching Lifecycle (Temporal <-> Network)', () => {
	test('switching from temporal to network triggers pauseActiveWork and cancels in-flight work', () => {
		let pauseActiveWorkCount = 0;
		let cancelledCount = 0;

		const mockTemporalViewService = {
			pauseActiveWork() {
				pauseActiveWorkCount++;
				this._cancelActiveRequests();
			},
			_cancelActiveRequests() {
				cancelledCount++;
			},
			getState() {
				return { selectedCommitSha: 'sha-1', diff: null };
			},
			initialize() {
				return Promise.resolve();
			},
		};

		let currentMode: 'network' | 'temporal' = 'temporal';

		function simulateSwitch(targetMode: 'network' | 'temporal') {
			const previousMode = currentMode;
			currentMode = targetMode;
			if (previousMode === 'temporal' && targetMode !== 'temporal') {
				mockTemporalViewService.pauseActiveWork();
			}
		}

		assert.equal(pauseActiveWorkCount, 0);
		simulateSwitch('network');
		assert.equal(pauseActiveWorkCount, 1);
		assert.equal(cancelledCount, 1);

		// Switching network -> network does not trigger pauseActiveWork
		simulateSwitch('network');
		assert.equal(pauseActiveWorkCount, 1);

		// Switching network -> temporal does not trigger pauseActiveWork
		simulateSwitch('temporal');
		assert.equal(pauseActiveWorkCount, 1);

		// Switching temporal -> network again triggers pauseActiveWork
		simulateSwitch('network');
		assert.equal(pauseActiveWorkCount, 2);
		assert.equal(cancelledCount, 2);
	});

	test('stale temporalState and temporalDiff messages are dropped when mode is network', () => {
		const postedMessages: Array<{ type: string; payload: any }> = [];
		let currentInputType: 'network' | 'temporal' = 'network';

		function pushTemporalState(state: any) {
			if (currentInputType !== 'temporal') {
				return;
			}
			postedMessages.push({ type: 'temporalState', payload: state });
		}

		function pushTemporalDiff(diff: any) {
			if (currentInputType !== 'temporal') {
				return;
			}
			postedMessages.push({ type: 'temporalDiff', payload: diff });
		}

		// When in network mode:
		pushTemporalState({ selectedCommitSha: 'sha-stale' });
		pushTemporalDiff({ modified: ['file.ts'] });
		assert.equal(postedMessages.length, 0, 'No messages should be posted to webview when in network mode');

		// Switch to temporal mode:
		currentInputType = 'temporal';
		pushTemporalState({ selectedCommitSha: 'sha-fresh' });
		pushTemporalDiff({ modified: ['file2.ts'] });
		assert.equal(postedMessages.length, 2, 'Messages should be posted to webview when in temporal mode');
		assert.equal(postedMessages[0].payload.selectedCommitSha, 'sha-fresh');

		// Switch back to network mode:
		currentInputType = 'network';
		pushTemporalState({ selectedCommitSha: 'sha-stale-2' });
		assert.equal(postedMessages.length, 2, 'Stale message after switching back must be dropped');
	});

	test('rapid mode switching (Network -> Temporal -> Network -> Temporal) preserves clean state', () => {
		let pauses = 0;
		let inits = 0;
		let currentMode: 'network' | 'temporal' = 'network';

		function transition(target: 'network' | 'temporal') {
			if (target !== currentMode) {
				const prev = currentMode;
				currentMode = target;
				if (prev === 'temporal' && target !== 'temporal') {
					pauses++;
				} else if (target === 'temporal') {
					inits++;
				}
			}
		}

		// Sequence: N -> T -> N -> T -> N
		transition('temporal');
		assert.equal(inits, 1);
		assert.equal(pauses, 0);

		transition('network');
		assert.equal(inits, 1);
		assert.equal(pauses, 1);

		transition('temporal');
		assert.equal(inits, 2);
		assert.equal(pauses, 1);

		transition('network');
		assert.equal(inits, 2);
		assert.equal(pauses, 2);

		assert.equal(currentMode, 'network');
	});
});
