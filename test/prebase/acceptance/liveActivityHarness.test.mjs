/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const evidenceDir = resolve(repoRoot, '.evidence/native-notch');
mkdirSync(evidenceDir, { recursive: true });

const require = createRequire(import.meta.url);
const addonPath = resolve(repoRoot, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');

function getAddon() {
	if (!existsSync(addonPath)) {
		return null;
	}
	return require(addonPath);
}

function saveSnapshot(addon, filename) {
	const buf = addon.capturePanelSnapshot();
	assert.ok(buf && buf.length > 0, `Capture snapshot must produce non-empty PNG buffer for ${filename}`);
	const target = resolve(evidenceDir, filename);
	writeFileSync(target, buf);
	assert.ok(existsSync(target) && statSync(target).size > 100, `Snapshot file ${target} must be written to disk`);
	return target;
}

test('Live Activity Native Visual Acceptance Harness (States A-L)', async (t) => {
	const addon = getAddon();
	if (!addon) {
		t.skip('Native addon not compiled for this platform');
		return;
	}

	const sleep = (ms) => new Promise(r => setTimeout(r, ms));

	try {
		// -------------------------------------------------------------------------
		// State A: Compact Working
		// -------------------------------------------------------------------------
		await t.test('State A: Compact Working', async () => {
			addon.setSnapshot({
				status: 'working',
				displayMode: 'active',
				statusLabel: 'Working',
				presentationLabel: 'Working',
				activityLabel: 'Analyzing codebase architecture',
				currentActivity: 'Analyzing codebase architecture',
				metricsLabel: '42 files'
			});
			addon.setPresentation({ visible: true, pinned: false, reducedMotion: true });
			await sleep(50);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.panelVisible, true, 'Panel must be visible in compact working');
			assert.strictEqual(diag.topAnchorDelta, 0, 'Visible screen top anchor delta must be 0 (flush with bezel)');
			assert.strictEqual(diag.compactContainerVisible, true, 'Compact container must be visible');
			assert.strictEqual(diag.expandedContainerVisible, false, 'Expanded container must be hidden in compact');
			assert.strictEqual(diag.expanded, false, 'Expanded state must be false in compact');

			saveSnapshot(addon, 'A_compact_working.png');
		});

		// -------------------------------------------------------------------------
		// State B: Compact Waiting
		// -------------------------------------------------------------------------
		await t.test('State B: Compact Waiting', async () => {
			addon.setSnapshot({
				status: 'waiting',
				displayMode: 'active',
				statusLabel: 'Waiting',
				presentationLabel: 'Waiting',
				activityLabel: 'Awaiting user input',
				currentActivity: 'Awaiting user input',
				metricsLabel: 'idle'
			});
			addon.setPresentation({ visible: true, pinned: false, reducedMotion: true });
			await sleep(50);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.compactContainerVisible, true, 'Compact container must be visible in waiting');
			assert.strictEqual(diag.topAnchorDelta, 0, 'Visible screen top anchor delta must be 0');

			saveSnapshot(addon, 'B_compact_waiting.png');
		});

		// -------------------------------------------------------------------------
		// State C: Attention Peek
		// -------------------------------------------------------------------------
		await t.test('State C: Attention Peek', async () => {
			addon.setSnapshot({
				status: 'waiting',
				displayMode: 'active',
				pendingKind: 'question',
				pendingTitle: 'Which target architecture should Magnus build?',
				statusLabel: 'Question',
				presentationLabel: 'Question'
			});
			addon.simulateAction('peek');
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.peekContainerVisible, true, 'Peek container must be visible in peek state');
			assert.ok(diag.peekContainerAlpha > 0, 'Peek container alpha must be > 0');

			saveSnapshot(addon, 'C_attention_peek.png');
		});

		// -------------------------------------------------------------------------
		// State D: Working Expanded (Interactive)
		// -------------------------------------------------------------------------
		await t.test('State D: Working Expanded', async () => {
			addon.setSnapshot({
				status: 'working',
				displayMode: 'active',
				statusLabel: 'Working',
				presentationLabel: 'Working',
				activityLabel: 'Compiling shaders',
				currentActivity: 'Compiling shaders',
				latestMessage: 'Generating Metal pipeline state objects',
				latestShortMessage: 'Generating Metal pipeline state objects'
			});
			addon.setPresentation({ visible: true, pinned: true, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.expanded, true, 'Expanded must be true');
			assert.strictEqual(diag.expandedContainerVisible, true, 'Expanded container must be visible');
			assert.strictEqual(diag.compactContainerVisible, false, 'Compact container must be hidden when expanded');
			assert.ok(diag.bodyBounds.height > 60, 'Body height must be substantial (> 60pt)');
			assert.ok(diag.composerVisible, 'Composer input must be visible in working interactive');
			assert.ok(diag.openInPreBaseVisible, 'Open in PreBase button must be visible');
			assert.ok(diag.pinButtonVisible, 'Pin button must be visible');

			// Geometric separation: content viewport must not overlap composer
			if (diag.contentViewport && diag.composerFrame) {
				const viewportBottom = diag.contentViewport.y + diag.contentViewport.height;
				assert.ok(viewportBottom <= diag.composerFrame.y + 4,
					`Content viewport bottom (${viewportBottom}) must not invade composer top (${diag.composerFrame.y})`);
			}

			saveSnapshot(addon, 'D_working_expanded.png');
		});

		// -------------------------------------------------------------------------
		// State E: Long Working Content (Containment Test)
		// -------------------------------------------------------------------------
		await t.test('State E: Long Working Content Containment', async () => {
			addon.setSnapshot({
				status: 'working',
				displayMode: 'active',
				statusLabel: 'Working',
				presentationLabel: 'Working',
				activityLabel: 'Inspecting /Users/qunyingfan/Prebasecode/src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts',
				currentActivity: 'Inspecting /Users/qunyingfan/Prebasecode/src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts',
				latestMessage: 'Reconciling abstract syntax tree nodes across 48 modules in repository workspace without escaping panel borders',
				latestShortMessage: 'Reconciling abstract syntax tree nodes across 48 modules in repository workspace without escaping panel borders'
			});
			addon.setPresentation({ visible: true, pinned: true, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.expanded, true, 'Expanded must be true for long content');
			assert.ok(diag.contentScrollViewVisible, 'Scroll view must be active for long content');
			assert.ok(diag.bodyBounds.width >= diag.contentViewport.width, 'Body width must contain content viewport');

			saveSnapshot(addon, 'E_long_working_content.png');
		});

		// -------------------------------------------------------------------------
		// State F: Question with Multiple Options
		// -------------------------------------------------------------------------
		await t.test('State F: Question with Multiple Options', async () => {
			addon.setSnapshot({
				status: 'waiting',
				displayMode: 'active',
				pendingKind: 'question',
				pendingTitle: 'Which build configuration would you like to run?',
				pendingOptions: [
					{ id: 'opt_arm64', label: 'macOS arm64' },
					{ id: 'opt_x64', label: 'macOS x86_64' },
					{ id: 'opt_universal', label: 'Universal 2' },
					{ id: 'opt_custom', label: 'Custom flags' }
				]
			});
			addon.setPresentation({ visible: true, pinned: true, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.composerVisible, false, 'Composer must be hidden for predefined option questions');
			assert.strictEqual(diag.approvalControlsVisible, false, 'Approval controls must be hidden for questions');
			assert.ok(diag.optionButtonFrames.length >= 3, 'Option buttons must be laid out for choices');

			// Check option buttons are inside body bounds
			for (const optFrame of diag.optionButtonFrames) {
				assert.ok(optFrame.x >= 0, 'Option button must not extend past left margin');
				assert.ok(optFrame.x + optFrame.width <= diag.bodyBounds.width + 1,
					`Option button right (${optFrame.x + optFrame.width}) must fit inside body width (${diag.bodyBounds.width})`);
			}

			saveSnapshot(addon, 'F_question_options.png');
		});

		// -------------------------------------------------------------------------
		// State G: Approval (Destructive Attention State)
		// -------------------------------------------------------------------------
		await t.test('State G: Approval Destructive State', async () => {
			addon.setSnapshot({
				status: 'waiting',
				displayMode: 'active',
				pendingKind: 'approval',
				pendingDestructive: true,
				pendingTitle: 'Delete build output and clean worktree?',
				pendingMessage: 'This will purge /Users/qunyingfan/Prebasecode/build/Release and cannot be undone.'
			});
			addon.setPresentation({ visible: true, pinned: true, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.approvalControlsVisible, true, 'Approval controls must be visible');
			assert.strictEqual(diag.composerVisible, false, 'Composer must be hidden during approval');
			assert.match(diag.approveButtonTitle, /Approve/, 'Approve button must display Approve verb');
			assert.strictEqual(diag.denyButtonTitle, 'Deny', 'Deny button must display Deny verb');
			assert.ok(diag.denyButtonFrame && diag.approveButtonFrame, 'Both buttons must have valid frames');

			// Verify Deny and Approve frames do not overlap and sit inside body bounds
			const denyRight = diag.denyButtonFrame.x + diag.denyButtonFrame.width;
			assert.ok(denyRight <= diag.approveButtonFrame.x,
				`Deny right edge (${denyRight}) must not overlap Approve left edge (${diag.approveButtonFrame.x})`);
			assert.ok(diag.approveButtonFrame.x + diag.approveButtonFrame.width <= diag.bodyBounds.width + 1,
				'Approve button must fit inside body width');

			saveSnapshot(addon, 'G_approval_destructive.png');
		});

		// -------------------------------------------------------------------------
		// State H: Completed (Terminal State)
		// -------------------------------------------------------------------------
		await t.test('State H: Terminal Completed', async () => {
			addon.setSnapshot({
				status: 'completed',
				displayMode: 'active',
				statusLabel: 'Completed',
				activityLabel: 'All tasks settled successfully'
			});
			addon.setPresentation({ visible: true, pinned: false, reducedMotion: true });
			await sleep(50);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.compactContainerVisible, true, 'Compact container must be visible in completed');
			assert.ok(diag.statusLabel === 'Done' || diag.statusLabel === 'Completed',
				`Status label must reflect Done or Completed (was ${diag.statusLabel})`);

			saveSnapshot(addon, 'H_terminal_completed.png');
		});

		// -------------------------------------------------------------------------
		// State I: Failed (Terminal State)
		// -------------------------------------------------------------------------
		await t.test('State I: Terminal Failed', async () => {
			addon.setSnapshot({
				status: 'failed',
				displayMode: 'active',
				statusLabel: 'Failed',
				activityLabel: 'Compilation failed: syntax error'
			});
			addon.setPresentation({ visible: true, pinned: false, reducedMotion: true });
			await sleep(50);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.compactContainerVisible, true, 'Compact container must be visible in failed');
			assert.strictEqual(diag.statusLabel, 'Failed', 'Status label must reflect Failed');

			saveSnapshot(addon, 'I_terminal_failed.png');
		});

		// -------------------------------------------------------------------------
		// State J: Pinned Expanded State
		// -------------------------------------------------------------------------
		await t.test('State J: Pinned Expanded', async () => {
			addon.setSnapshot({
				status: 'working',
				displayMode: 'active',
				statusLabel: 'Working',
				activityLabel: 'Pinned monitoring session'
			});
			addon.setPresentation({ visible: true, pinned: true, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.pinned, true, 'Pinned must be true');
			assert.strictEqual(diag.expanded, true, 'Expanded must be true when pinned');

			saveSnapshot(addon, 'J_pinned_expanded.png');
		});

		// -------------------------------------------------------------------------
		// State K: Compact to Expanded Transition Topology
		// -------------------------------------------------------------------------
		await t.test('State K: Compact to Expanded Transition Topology', async () => {
			const topo = addon.validatePathTopology({ isNotched: true });
			assert.strictEqual(topo.compatible, true, 'Path topology must be morph-compatible');
			assert.strictEqual(topo.collapsedElements, 14, 'Collapsed element count must be 14');
			assert.strictEqual(topo.expandedElements, 14, 'Expanded element count must be 14');

			saveSnapshot(addon, 'K_compact_to_expanded.png');
		});

		// -------------------------------------------------------------------------
		// State L: Expanded to Compact Transition
		// -------------------------------------------------------------------------
		await t.test('State L: Expanded to Compact Collapse', async () => {
			addon.setPresentation({ visible: true, pinned: false, reducedMotion: true });
			await sleep(60);

			const diag = addon.getDiagnostics();
			assert.strictEqual(diag.expanded, false, 'Expanded must be false after unpin/collapse');
			assert.strictEqual(diag.compactContainerVisible, true, 'Compact container must re-appear');

			saveSnapshot(addon, 'L_expanded_to_compact.png');
		});
	} finally {
		addon.dispose();
	}
});
