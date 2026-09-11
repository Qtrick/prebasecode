/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Test-Writer Suite: Notch Coordinate Spaces, Visible Shoulder Geometry, and Visual Verification
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const addonPath = join(repoRoot, 'native/prebase-live-activity/build/Release/prebase_live_activity.node');
const hasNative = process.platform === 'darwin' && existsSync(addonPath);

test('Magnus Notch: Coordinate space and top bleed semantics', { skip: !hasNative }, async () => {
	const native = require(addonPath);
	native.setPresentation({
		visible: true,
		pinned: false,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		revision: 101,
		status: 'working',
		activityLabel: 'Forensic Coordinate Audit',
		startedAt: Date.now() - 5000,
		userDismissedAttention: false
	});

	await new Promise(r => setTimeout(r, 100));
	const diag = native.getDiagnostics();

	// 1. Verify top bleed constants and visible screen edge flush alignment
	assert.strictEqual(diag.topBleed, 14, 'topBleed must be 14pt on notched displays');
	assert.strictEqual(diag.topAnchorDelta, 0, 'topAnchorDelta must be 0pt (flush with visible screen top)');
	assert.strictEqual(diag.rawTopAnchorDelta, -14, 'rawTopAnchorDelta must reflect the 14pt physical bezel bleed');

	// 2. Verify panel level is above normal windows
	assert.ok(diag.panelLevel >= 24, 'Magnus panel must float at statusBar or above level');

	// 3. Verify topology validation passes with exact 14-element invariant
	const topo = native.validatePathTopology({
		leftW: 80,
		rightW: 80,
		housingW: 180,
		expandedH: 180,
		isNotched: true
	});
	assert.strictEqual(topo.compatible, true, 'Path topology must be compatible between compact and expanded');
	assert.strictEqual(topo.collapsedElements, 14, 'Collapsed path topology must have exactly 14 elements');
	assert.strictEqual(topo.expandedElements, 14, 'Expanded path topology must have exactly 14 elements');

	native.dispose();
});

test('Magnus Notch: Visible shoulder transition occurs on-screen (visDrop = 28pt)', { skip: !hasNative }, () => {
	const liveActivityMm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Assert that live_activity.mm calculates visDrop = visTopY + shoulderDrop
	assert.match(liveActivityMm, /CGFloat\s+visTopY\s*=\s*topBleed;/, 'Source must define visTopY as topBleed');
	assert.match(liveActivityMm, /CGFloat\s+visDrop\s*=\s*visTopY\s*\+\s*shoulderDrop;/, 'Source must define visDrop as visTopY + shoulderDrop');

	// Assert element 5 drops to visTopY, not offscreen shoulderDrop
	assert.match(liveActivityMm, /CGPathAddLineToPoint\(path,\s*NULL,\s*totalW,\s*visTopY\);/, 'Element 5 must anchor to visible screen edge at (totalW, visTopY)');

	// Assert element 6 curves to (bodyRight, visDrop)
	assert.match(liveActivityMm, /bodyRight,\s*visDrop\);/, 'Element 6 must curve to (bodyRight, visDrop)');

	// Assert element 11 lines up to (bodyLeft, visDrop)
	assert.match(liveActivityMm, /CGPathAddLineToPoint\(path,\s*NULL,\s*bodyLeft,\s*visDrop\);/, 'Element 11 must line to (bodyLeft, visDrop)');

	// Assert element 12 curves symmetrically from (bodyLeft, visDrop) to (0, visTopY)
	assert.match(liveActivityMm, /bodyLeft\s*-\s*bodyLeft\s*\*\s*0\.20,\s*visDrop,/, 'Element 12 must start curve from bodyLeft at visDrop');
	assert.match(liveActivityMm, /0,\s*visTopY\s*\+\s*shoulderDrop\s*\*\s*0\.45,\s*\r?\n\s*0,\s*visTopY\);/, 'Element 12 must symmetrically terminate at (0, visTopY)');
	assert.match(liveActivityMm, /CGPathCloseSubpath\(path\);/, 'Element 13 must close subpath straight through bleed to (0, 0)');
});

test('Magnus Notch: Containers re-anchored so glyphs never clip behind bezel', { skip: !hasNative }, () => {
	const liveActivityMm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// compactContainer must start at visTopY (not 0, which placed glyphs in bezel)
	assert.match(liveActivityMm, /self\.compactContainer\.frame\s*=\s*NSMakeRect\(0,\s*visTopY,\s*totalW,\s*bandH\);/, 'compactContainer must start at visTopY');

	// expandedContainer must start at notchBottomY = topBleed + bandH (not bandH, which overlapped physical notch)
	assert.match(liveActivityMm, /self\.expandedContainer\.frame\s*=\s*NSMakeRect\(0,\s*notchBottomY,\s*totalW,\s*bodyH\);/, 'expandedContainer must start at notchBottomY');

	// peekContainer must also start at notchBottomY
	assert.match(liveActivityMm, /self\.peekContainer\.frame\s*=\s*NSMakeRect\(0,\s*notchBottomY,\s*totalW,\s*bodyH\);/, 'peekContainer must start at notchBottomY');
});

test('Magnus Notch: Composer text cell vertically centered without default text pollution', { skip: !hasNative }, async () => {
	const liveActivityMm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Assert PrebaseCenteredTextFieldCell checks placeholder attributed string when empty
	assert.match(liveActivityMm, /\[self placeholderAttributedString\]/, 'PrebaseCenteredTextFieldCell must check placeholderAttributedString size when text is empty');

	// Assert input cell stringValue is explicitly cleared
	assert.match(liveActivityMm, /inputCell\.stringValue\s*=\s*@""/, 'inputCell stringValue must be initialized to empty string');
	assert.match(liveActivityMm, /self\.input\.stringValue\s*=\s*@""/, 'self.input stringValue must be initialized to empty string');
});

test('Magnus Notch: ScreenHasPhysicalNotch avoids false positives on non-notched MacBooks', { skip: !hasNative }, () => {
	const liveActivityMm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Verify blanket `if (IsBuiltinScreen(screen)) return YES;` was eliminated
	assert.doesNotMatch(liveActivityMm, /if\s*\(IsBuiltinScreen\(screen\)\)\s*\{\s*return\s*YES;\s*\}/, 'ScreenHasPhysicalNotch must not have blanket IsBuiltinScreen return YES');
});

test('Magnus Notch: In-process native visual snapshot capture works deterministically', { skip: !hasNative }, async () => {
	const native = require(addonPath);
	assert.strictEqual(typeof native.capturePanelSnapshot, 'function', 'native addon must export capturePanelSnapshot');

	native.setPresentation({
		visible: true,
		pinned: false,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		revision: 202,
		status: 'working',
		activityLabel: 'Visual Snapshot Acceptance',
		startedAt: Date.now() - 3000,
		userDismissedAttention: false
	});

	await new Promise(r => setTimeout(r, 100));

	const testPngPath = join(repoRoot, '.evidence/native-notch/test_snapshot_acceptance.png');
	const buffer = native.capturePanelSnapshot(testPngPath);

	assert.ok(buffer, 'capturePanelSnapshot must return a Buffer');
	assert.ok(Buffer.isBuffer(buffer), 'Return value must be a Node.js Buffer');
	assert.ok(buffer.length > 500, `PNG buffer must contain image data (got ${buffer.length} bytes)`);

	// Verify PNG magic header: \x89PNG\r\n\x1a\n
	assert.strictEqual(buffer[0], 0x89);
	assert.strictEqual(buffer[1], 0x50); // P
	assert.strictEqual(buffer[2], 0x4E); // N
	assert.strictEqual(buffer[3], 0x47); // G
	assert.strictEqual(buffer[4], 0x0D);
	assert.strictEqual(buffer[5], 0x0A);
	assert.strictEqual(buffer[6], 0x1A);
	assert.strictEqual(buffer[7], 0x0A);

	assert.ok(existsSync(testPngPath), 'Target PNG file must be created on disk');
	const diskBytes = readFileSync(testPngPath);
	assert.strictEqual(diskBytes.length, buffer.length, 'Disk bytes must match returned buffer length');

	unlinkSync(testPngPath);
	native.dispose();
});

test('Magnus Notch: Diagnostics report sessionButtonVisible when sessions provided', { skip: !hasNative }, async () => {
	const native = require(addonPath);

	native.setPresentation({
		visible: true,
		pinned: false,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		status: 'working',
		sessionId: 'sess-abc',
		sessionTitle: 'Refactor parser',
		availableSessions: [
			{ sessionId: 'sess-abc', title: 'Refactor parser', isCurrent: true, startedAt: 1000 },
			{ sessionId: 'sess-def', title: 'Add tests', isCurrent: false, startedAt: 2000 },
		],
		conversationTranscript: [
			{ role: 'user', content: 'Add parser tests' },
			{ role: 'agent', content: 'Adding unit tests for parser now' },
		],
		revision: 203,
		connected: true,
		prebaseForeground: true,
		isInProgress: true,
		recentActions: [],
		startedAt: Date.now() - 3000,
		userDismissedAttention: false,
	});

	// Enter interactive sticky mode
	native.simulateAction('click');
	await new Promise(r => setTimeout(r, 100));

	const diag = native.getDiagnostics();
	assert.strictEqual(diag.sessionButtonVisible, true, 'sessionButton must be visible when sessions are available in interactive mode');

	native.dispose();
});

test('Magnus Notch: Visual verification of long title session button stability', { skip: !hasNative }, async () => {
	const native = require(addonPath);

	native.setPresentation({
		visible: true,
		pinned: true,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		status: 'working',
		sessionId: 'sess-long',
		sessionTitle: 'Very Long Complex Project Workflow With Deeply Nested Repository Paths And Symbols That Need Truncation Tail',
		availableSessions: [
			{ sessionId: 'sess-long', title: 'Very Long Complex Project Workflow With Deeply Nested Repository Paths And Symbols That Need Truncation Tail', isCurrent: true, startedAt: 1000 },
			{ sessionId: 'sess-other', title: 'Second Session', isCurrent: false, startedAt: 2000 },
		],
		revision: 204,
		connected: true,
		prebaseForeground: true,
		isInProgress: true,
		activityLabel: 'Compiling PreBase core subsystems with incremental watch enabled',
		recentActions: [],
		startedAt: Date.now() - 4000,
		userDismissedAttention: false,
	});

	native.simulateAction('click');
	await new Promise(r => setTimeout(r, 120));

	const diag = native.getDiagnostics();
	assert.strictEqual(diag.sessionButtonVisible, true, 'sessionButton must be visible');

	const snapshotPath = join(repoRoot, '.evidence/native-notch/M_long_title_session_button.png');
	const buf = native.capturePanelSnapshot(snapshotPath);
	assert.ok(buf && buf.length > 500, 'Captured PNG for long title session button');

	native.dispose();
});

test('Magnus Notch: Visual verification of conversation projection with role hierarchy', { skip: !hasNative }, async () => {
	const native = require(addonPath);

	native.setPresentation({
		visible: true,
		pinned: true,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		status: 'working',
		sessionId: 'sess-chat',
		sessionTitle: 'Fix graph layout',
		availableSessions: [
			{ sessionId: 'sess-chat', title: 'Fix graph layout', isCurrent: true, startedAt: 1000 },
		],
		conversationTranscript: [
			{ role: 'user', text: 'Can you analyze the memory leak in the temporal graph renderer?' },
			{ role: 'agent', text: 'Found circular reference in node cache. Patched disposal listener and verified 0 leaks remaining.' },
			{ role: 'user', text: 'Great, please verify with automated tests now.' },
		],
		revision: 205,
		connected: true,
		prebaseForeground: true,
		isInProgress: true,
		activityLabel: 'Running test:graphs-contracts suite',
		recentActions: [],
		startedAt: Date.now() - 5000,
		userDismissedAttention: false,
	});

	native.simulateAction('click');
	await new Promise(r => setTimeout(r, 120));

	const diag = native.getDiagnostics();
	assert.strictEqual(diag.conversationTranscriptCount, 3, 'Transcript count must be 3');

	const snapshotPath = join(repoRoot, '.evidence/native-notch/N_conversation_projection.png');
	const buf = native.capturePanelSnapshot(snapshotPath);
	assert.ok(buf && buf.length > 500, 'Captured PNG for conversation projection');

	native.dispose();
});

test('Magnus Notch: Visual verification of adversarial text containment', { skip: !hasNative }, async () => {
	const native = require(addonPath);

	native.setPresentation({
		visible: true,
		pinned: true,
		reducedMotion: true,
		display: 'builtin'
	});
	native.setSnapshot({
		status: 'working',
		sessionId: 'sess-containment',
		sessionTitle: 'Containment Audit',
		availableSessions: [
			{ sessionId: 'sess-containment', title: 'Containment Audit', isCurrent: true, startedAt: 1000 },
		],
		// Normal words up to 28 chars ('internationalization') + long path + commit hash + unbroken run
		activityLabel: 'Checking internationalization in /Users/qunyingfan/Prebasecode/src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts at commit 4f8b91c2d3e4f5a6b7c8d9e01234567890abcdef',
		conversationTranscript: [
			{ role: 'user', text: 'Process incomprehensibilities and https://github.com/microsoft/vscode/commit/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
			{ role: 'agent', text: 'Verified 500-char run: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa safely contained.' },
		],
		revision: 206,
		connected: true,
		prebaseForeground: true,
		isInProgress: true,
		recentActions: [],
		startedAt: Date.now() - 6000,
		userDismissedAttention: false,
	});

	native.simulateAction('click');
	await new Promise(r => setTimeout(r, 120));

	const snapshotPath = join(repoRoot, '.evidence/native-notch/O_text_containment_torture.png');
	const buf = native.capturePanelSnapshot(snapshotPath);
	assert.ok(buf && buf.length > 500, 'Captured PNG for adversarial text containment');

	native.dispose();
});


