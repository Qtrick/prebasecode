import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const addonPath = resolve('native/prebase-live-activity/build/Release/prebase_live_activity.node');
const native = require(addonPath);

function drainMain(iterations = 4) {
	for (let i = 0; i < iterations; i++) {
		native.getDiagnostics();
	}
}

console.log('--- REPRODUCING QUESTION/APPROVAL -> RESOLVED/COMPLETED ---');

native.dispose();
native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

// 1. Question with 4 options
console.log('\n[Step 1] Setting Question with 4 options...');
native.setSnapshot({
	revision: 300,
	status: 'attention',
	currentActivity: 'Awaiting decision',
	latestShortMessage: 'Choose option',
	pendingInteraction: {
		kind: 'question',
		interactionId: 'q1',
		title: 'Choose option',
		message: 'Which option should we take?',
		options: [
			{ id: '1', label: 'Option 1' },
			{ id: '2', label: 'Option 2' },
			{ id: '3', label: 'Option 3' },
			{ id: '4', label: 'Option 4' },
		],
	},
});
drainMain(5);
const diag1 = native.getDiagnostics();
console.log('Step 1 Question:');
console.log('  panelFrame:', diag1.panelFrame);
console.log('  pinnedInteractiveHeight:', diag1.pinnedInteractiveHeight);

// 2. Resolve question -> transition to completed
console.log('\n[Step 2] Resolve question -> transition to completed...');
native.setSnapshot({
	revision: 301,
	status: 'completed',
	currentActivity: 'Graph acceptance complete',
	latestShortMessage: 'Done.',
});
drainMain(5);
const diag2 = native.getDiagnostics();
console.log('Step 2 Completed after Question:');
console.log('  panelFrame:', diag2.panelFrame);
console.log('  pinnedInteractiveHeight:', diag2.pinnedInteractiveHeight);
console.log('  DID IT SHRINK FROM QUESTION?', diag2.panelFrame?.height < diag1.panelFrame?.height ? 'YES' : 'NO (LOCKED AT QUESTION HEIGHT!)');

// 3. Approval -> resolve to working
console.log('\n[Step 3] Setting Approval...');
native.setSnapshot({
	revision: 302,
	status: 'attention',
	currentActivity: 'Awaiting approval',
	latestShortMessage: 'Approve run',
	pendingInteraction: {
		kind: 'approval',
		interactionId: 'appr1',
		title: 'Approve execution',
		message: 'Run the entire test suite?',
	},
});
drainMain(5);
const diag3 = native.getDiagnostics();
console.log('Step 3 Approval:');
console.log('  panelFrame:', diag3.panelFrame);
console.log('  pinnedInteractiveHeight:', diag3.pinnedInteractiveHeight);

// 4. Resolve approval -> transition to short working
console.log('\n[Step 4] Resolve approval -> short working...');
native.setSnapshot({
	revision: 303,
	status: 'working',
	currentActivity: 'Running test suite',
	latestShortMessage: 'Executing tests...',
});
drainMain(5);
const diag4 = native.getDiagnostics();
console.log('Step 4 Working after Approval:');
console.log('  panelFrame:', diag4.panelFrame);
console.log('  pinnedInteractiveHeight:', diag4.pinnedInteractiveHeight);
console.log('  DID IT SHRINK FROM APPROVAL?', diag4.panelFrame?.height < diag3.panelFrame?.height ? 'YES' : 'NO (LOCKED AT APPROVAL HEIGHT!)');

native.dispose();
