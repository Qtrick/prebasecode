import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const addonPath = resolve('native/prebase-live-activity/build/Release/prebase_live_activity.node');
const native = require(addonPath);

async function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

function drainMain(iterations = 4) {
	for (let i = 0; i < iterations; i++) {
		native.getDiagnostics();
	}
}

console.log('--- REPRODUCING STALE GEOMETRY & GIANT SLAB ---');

native.dispose();
native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });

// 1. Long content
console.log('\n[Step 1] Setting LONG content fixture...');
native.setSnapshot({
	revision: 100,
	status: 'working',
	currentActivity: 'Validating long-form graph interaction recovery across Temporal Full Map, Network Fit View, and multi-layout acceptance while preserving viewport readability and idle rotation constraints for large projects',
	latestShortMessage: 'Magnus finished the graph interaction pass and is validating the remaining acceptance cases against organic, sphere, constellation, and clustered layouts with deliberately long diagnostic commentary that must remain inside the island content viewport without pushing footer controls outside the silhouette.',
	recentActions: [
		{ id: 'a1', label: 'Action 1', at: Date.now() - 30000 },
		{ id: 'a2', label: 'Action 2', at: Date.now() - 20000 },
		{ id: 'a3', label: 'Action 3', at: Date.now() - 10000 },
	],
});
drainMain(5);
const diag1 = native.getDiagnostics();
console.log('Step 1 Long Content:');
console.log('  panelFrame:', diag1.panelFrame);
console.log('  requestedFrame:', diag1.requestedFrame);
console.log('  pinnedInteractiveHeight:', diag1.pinnedInteractiveHeight);
console.log('  lastGeometrySignature:', diag1.lastGeometrySignature);

// 2. Transition to SHORT working content
console.log('\n[Step 2] Transitioning to SHORT working content fixture (1 short line, 0 actions)...');
native.setSnapshot({
	revision: 101,
	status: 'working',
	currentActivity: 'Running graph interaction tests',
	latestShortMessage: 'Short message',
	recentActions: [],
});
drainMain(5);
const diag2 = native.getDiagnostics();
console.log('Step 2 Short Content:');
console.log('  panelFrame:', diag2.panelFrame);
console.log('  requestedFrame:', diag2.requestedFrame);
console.log('  pinnedInteractiveHeight:', diag2.pinnedInteractiveHeight);
console.log('  lastGeometrySignature:', diag2.lastGeometrySignature);
console.log('  DID IT SHRINK?', diag2.panelFrame?.height < diag1.panelFrame?.height ? 'YES' : 'NO (STALE HEIGHT LOCKED!)');

// 3. Transition to COMPLETED
console.log('\n[Step 3] Transitioning to COMPLETED fixture...');
native.setSnapshot({
	revision: 102,
	status: 'completed',
	currentActivity: 'Graph acceptance pass complete',
	latestShortMessage: 'All suites passed.',
	recentActions: [],
});
drainMain(5);
const diag3 = native.getDiagnostics();
console.log('Step 3 Completed:');
console.log('  panelFrame:', diag3.panelFrame);
console.log('  requestedFrame:', diag3.requestedFrame);
console.log('  pinnedInteractiveHeight:', diag3.pinnedInteractiveHeight);
console.log('  lastGeometrySignature:', diag3.lastGeometrySignature);
console.log('  IS COMPLETED COMPACT?', diag3.panelFrame?.height <= 100 ? 'YES' : 'NO (STALE SLAB!)');

// 4. Fresh short working without prior long content
console.log('\n[Step 4] Fresh short working without prior long content (clean native)...');
native.dispose();
native.setPresentation({ visible: true, pinned: true, reducedMotion: true, display: 'builtin' });
native.setSnapshot({
	revision: 200,
	status: 'working',
	currentActivity: 'Running graph interaction tests',
	latestShortMessage: 'Short message',
	recentActions: [],
});
drainMain(5);
const diag4 = native.getDiagnostics();
console.log('Step 4 Clean Short Working:');
console.log('  panelFrame:', diag4.panelFrame);
console.log('  requestedFrame:', diag4.requestedFrame);
console.log('  pinnedInteractiveHeight:', diag4.pinnedInteractiveHeight);

native.dispose();
