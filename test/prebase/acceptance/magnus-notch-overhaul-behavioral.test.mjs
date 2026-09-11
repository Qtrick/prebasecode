/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Behavioral test suite for Magnus Notch overhaul, fail-closed dormancy, and product identity.
 *--------------------------------------------------------------------------------------------*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');

// 1. Native Notch Overhaul Behavioral Tests
test('Magnus Notch Overhaul: PrebaseNotchPanel overrides canBecomeKeyWindow for background/minimized quick messaging', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Must define PrebaseNotchPanel subclass of NSPanel
	assert.match(mm, /@interface\s+PrebaseNotchPanel\s*:\s*NSPanel/, 'Must declare PrebaseNotchPanel : NSPanel');
	assert.match(mm, /@implementation\s+PrebaseNotchPanel[\s\S]*- \(BOOL\)canBecomeKeyWindow\s*\{\s*return YES;\s*\}/,
		'PrebaseNotchPanel must override canBecomeKeyWindow to return YES');
	assert.match(mm, /@implementation\s+PrebaseNotchPanel[\s\S]*- \(BOOL\)canBecomeMainWindow\s*\{\s*return NO;\s*\}/,
		'PrebaseNotchPanel must override canBecomeMainWindow to return NO (stays auxiliary hud)');

	// Controller panel property must use PrebaseNotchPanel
	assert.match(mm, /@property\s*\([^)]*\)\s*PrebaseNotchPanel\s*\*panel;/, 'Controller panel must be typed as PrebaseNotchPanel');

	// buildPanel must instantiate PrebaseNotchPanel
	assert.match(mm, /self\.panel\s*=\s*\[\[PrebaseNotchPanel\s+alloc\]\s+initWithContentRect:/,
		'buildPanel must allocate PrebaseNotchPanel instead of raw NSPanel');
});

test('Magnus Notch Overhaul: C1 Tangent Continuous Shoulders in live_activity_layout.h and live_activity.mm', () => {
	const layoutH = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity_layout.h'), 'utf8');
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// live_activity.mm must import live_activity_layout.h
	assert.match(mm, /#import\s*"live_activity_layout\.h"/, 'live_activity.mm must import live_activity_layout.h');

	// live_activity_layout.h must define C1 tangent continuous Bezier calculators
	assert.match(layoutH, /inline\s+ConcaveShoulderBezier\s+ComputeRightShoulderBezier/,
		'live_activity_layout.h must define ComputeRightShoulderBezier');
	assert.match(layoutH, /inline\s+ConcaveShoulderBezier\s+ComputeLeftShoulderBezier/,
		'live_activity_layout.h must define ComputeLeftShoulderBezier');

	// Verify horizontal tangent at top bezel (visTopY): dy = 0
	assert.match(layoutH, /b\.cp1\s*=\s*CGPointMake\(totalW\s*-\s*flare\s*\*\s*kKappa,\s*visTopY\);/,
		'Right shoulder cp1 must maintain dy=0 at visTopY');
	assert.match(layoutH, /b\.cp2\s*=\s*CGPointMake\(bodyLeft\s*\*\s*kKappa,\s*visTopY\);/,
		'Left shoulder cp2 must maintain dy=0 at visTopY');

	// Verify vertical tangent entering side wall (bodyRight, visDrop): dx = 0
	assert.match(layoutH, /b\.cp2\s*=\s*CGPointMake\(bodyRight,\s*visDrop\s*-\s*drop\s*\*\s*kKappa\);/,
		'Right shoulder cp2 must maintain dx=0 entering bodyRight wall');
	assert.match(layoutH, /b\.cp1\s*=\s*CGPointMake\(bodyLeft,\s*visDrop\s*-\s*drop\s*\*\s*kKappa\);/,
		'Left shoulder cp1 must maintain dx=0 leaving bodyLeft wall');

	// live_activity.mm must use these helpers in CreateNotchedIslandPath
	assert.match(mm, /ComputeRightShoulderBezier\(totalW,\s*bodyRight,\s*visTopY,\s*visDrop\)/,
		'live_activity.mm must call ComputeRightShoulderBezier in element 6');
	assert.match(mm, /ComputeLeftShoulderBezier\(bodyLeft,\s*visTopY,\s*visDrop\)/,
		'live_activity.mm must call ComputeLeftShoulderBezier in element 12');
});

test('Magnus Notch Overhaul: Conversation projection measurement prevents truncation and composer clipping', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// geometrySignatureForBandH must include tc (transcript count)
	assert.match(mm, /NSInteger\s+transcriptCount\s*=\s*MIN\(\(NSInteger\)self\.content\.conversationTranscript\.count,\s*3\);/,
		'geometrySignatureForBandH must count visible transcript turns');
	assert.match(mm, /tc=%ld;/, 'geometry signature must include tc=%ld');

	// computeTargetContentHeight must measure conversationTranscript turns
	assert.match(mm, /if\s*\(self\.content\.conversationTranscript\.count\s*>\s*0\)\s*\{[\s\S]*SanitizeTextForContainment\(tText\)[\s\S]*MeasureTextHeight\(cleanText,\s*tFont,\s*contentW,\s*isUser\s*\?\s*2\s*:\s*3\)/,
		'computeTargetContentHeight must measure conversationTranscript turns');

	// Max height floor must cap comfortably at kExpandedHeightMax = 220
	assert.match(mm, /CGFloat\s+target\s*=\s*MIN\(kExpandedHeightMax,\s*MAX\(kExpandedHeightMin,\s*h\)\);/,
		'Target height must scale up to kExpandedHeightMax (220pt) to accommodate transcript');
});

test('Magnus Notch Overhaul: Outside-click dismissal installed for unpinned expanded notch', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Must declare globalClickMonitor
	assert.match(mm, /@property\s*\([^)]*\)\s*id\s+globalClickMonitor;/,
		'Controller must declare globalClickMonitor');

	// Must install NSEventMaskLeftMouseDown monitor in installMonitor
	assert.match(mm, /self\.globalClickMonitor\s*=\s*\[NSEvent\s+addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown/,
		'installMonitor must add global monitor for LeftMouseDown');

	// Outside click check: must collapse if not pinned and point outside panel
	assert.match(mm, /if\s*\(!strong\.pinned\s*&&\s*strong\.content\.expanded[\s\S]*!NSPointInRect\(p,\s*strong\.panel\.frame\)\)\s*\{\s*\[strong\s+collapseEmittingDismiss:YES\];\s*\}/,
		'Left mouse click outside panel frame must collapse unpinned expanded notch');

	// removeGlobalMonitorOnly must tear down globalClickMonitor
	assert.match(mm, /if\s*\(self\.globalClickMonitor\)\s*\{\s*\[NSEvent\s+removeMonitor:self\.globalClickMonitor\];\s*self\.globalClickMonitor\s*=\s*nil;\s*\}/,
		'removeGlobalMonitorOnly must remove globalClickMonitor');
});

// 2. Fail-Closed Dormancy Behavioral Tests
test('Agents Window Dormancy: CLI --agents and app startup fail-closed when prebaseAgentsWindowEnabled is disabled', () => {
	const appTs = readFileSync(join(repoRoot, 'src/vs/code/electron-main/app.ts'), 'utf8');
	assert.match(appTs, /if\s*\(args\['agents'\]\s*&&\s*isAgentsWindowEnabled\(this\.productService\)\)/,
		'app.ts must gate CLI --agents check on isAgentsWindowEnabled');

	const productJson = JSON.parse(readFileSync(join(repoRoot, 'product.json'), 'utf8'));
	assert.strictEqual(productJson.prebaseAgentsWindowEnabled, false,
		'product.json must set prebaseAgentsWindowEnabled to false by default');
});

test('Agents Window Dormancy: Welcome page agents banner fail-closed via isAgentsWindowEnabled', () => {
	const bannerTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsBanner.ts'), 'utf8');
	assert.match(bannerTs, /if\s*\(!isAgentsWindowEnabled\(product\)\)\s*\{\s*return false;\s*\}/,
		'canShowAgentsBanner must return false when !isAgentsWindowEnabled(product)');
});

// 3. Product Naming Truthfulness
test('Product Naming: LanguageModelProvider uses PreBase instead of Agents for unconfigured message', () => {
	const providerTs = readFileSync(join(repoRoot, 'extensions/prebase-magnus/src/languageModelProvider.ts'), 'utf8');
	assert.match(providerTs, /PreBase has no configured AI provider/,
		'languageModelProvider must report "PreBase has no configured AI provider", never "Agents"');
	assert.doesNotMatch(providerTs, /Agents has no configured AI provider/,
		'languageModelProvider must not refer to product as "Agents"');
});

// 4. Dead Code Removal — layout solver and duplicate metrics
test('Architecture: SolveInteractiveLayout and ComputeSilhouetteMetrics removed (dead code eliminated)', () => {
	const layoutH = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity_layout.h'), 'utf8');

	// SolveInteractiveLayout must NOT exist — it was dead code never called by production
	assert.doesNotMatch(layoutH, /SolveInteractiveLayout/,
		'SolveInteractiveLayout must be removed (was dead code, never called by live_activity.mm)');
	assert.doesNotMatch(layoutH, /ResolvedInteractiveLayout/,
		'ResolvedInteractiveLayout struct must be removed (was dead code)');
	assert.doesNotMatch(layoutH, /ComputeSilhouetteMetrics/,
		'ComputeSilhouetteMetrics must be removed (was dead code, never called by live_activity.mm)');

	// Header must still contain the essential geometry helpers
	assert.match(layoutH, /ComputeRightShoulderBezier/,
		'Header must retain ComputeRightShoulderBezier (used by production)');
	assert.match(layoutH, /ComputeLeftShoulderBezier/,
		'Header must retain ComputeLeftShoulderBezier (used by production)');
	assert.doesNotMatch(layoutH, /LayoutTokens/,
		'LayoutTokens struct must be removed (Ponytail cleanup: dead abstraction)');
});

test('Architecture: Single authoritative shoulder metrics — no duplicate ComputeSilhouetteMetrics', () => {
	const layoutH = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity_layout.h'), 'utf8');
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Header must NOT define ComputeSilhouetteMetrics
	assert.doesNotMatch(layoutH, /ComputeSilhouetteMetrics/,
		'Header must not define ComputeSilhouetteMetrics (production uses ComputeSilhouetteShoulderMetrics)');

	// Production code must define ComputeSilhouetteShoulderMetrics as the single authority
	assert.match(mm, /static\s+SilhouetteShoulderMetrics\s+ComputeSilhouetteShoulderMetrics/,
		'live_activity.mm must define ComputeSilhouetteShoulderMetrics as single authority');

	// Production must NOT call any header-defined metrics function
	assert.doesNotMatch(mm, /ComputeSilhouetteMetrics\s*\(/,
		'live_activity.mm must not call header ComputeSilhouetteMetrics');
});

// 5. Layout Geometry Invariants
test('Layout Invariants: scroll viewport must not overlap footer controls', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// refreshContentSubviewsPreservingPresentation must compute footerReserve from live control stack
	assert.match(mm, /CGFloat\s+measuredFooter\s*=\s*self\.controller\s*\n\s*\?\s*\[self\.controller\s+computeControlsStackHeight\]\s*\+\s*kContentFooterGutter/,
		'measuredFooter must be computed from live computeControlsStackHeight + gutter');

	// footerReserve must be MAX of reserved and measured
	assert.match(mm, /CGFloat\s+footerReserve\s*=\s*MAX\(self\.reservedFooterHeight,\s*measuredFooter\);/,
		'footerReserve must be MAX of reservedFooterHeight and measuredFooter');

	// Available scroll must subtract footerReserve + gutter from bodyHeight
	assert.match(mm, /CGFloat\s+availableScroll\s*=\s*bodyHeight\s*-\s*footerReserve\s*-\s*scrollTop;/,
		'Available scroll must be bodyHeight minus footerReserve minus scrollTop');
});

test('Layout Invariants: header row and status badge must not collide', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Status badge width must be bounded to 40% of header width
	assert.match(mm, /CGFloat\s+statusW\s*=\s*MIN\(headerW\s*\*\s*0\.40,/,
		'Status badge width must be bounded to 40% of header width');

	// Title width must be headerW minus statusW minus gap
	assert.match(mm, /CGFloat\s+titleW\s*=\s*MAX\(48,\s*headerW\s*-\s*statusW\s*-\s*8\);/,
		'Title width must leave room for status badge (8pt gap)');

	// Status badge must be right-aligned
	assert.match(mm, /NSMakeRect\(totalW\s*-\s*headerInset\s*-\s*statusW,\s*y,\s*statusW,\s*kHeaderRowHeight\)/,
		'Status badge must be positioned at trailing edge');
});

test('Layout Invariants: expanded content uses canonical presentation state for geometry', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// computeTargetContentHeight must use canonicalTargetPresentationState
	assert.match(mm, /PrebasePresentationState\s+state\s*=\s*\[self\s+canonicalTargetPresentationState\];[\s\S]*computeTargetContentHeight/,
		'computeTargetContentHeight must use canonicalTargetPresentationState');

	// geometrySignatureForBandH must incorporate semantic state, not raw text
	assert.match(mm, /geometrySignatureForBandH[\s\S]*expanded\s*\?\s*1\s*:\s*0/,
		'Geometry signature must incorporate expanded state');
	assert.match(mm, /geometrySignatureForBandH[\s\S]*status,/,
		'Geometry signature must incorporate status');
	assert.match(mm, /geometrySignatureForBandH[\s\S]*kind=/,
		'Geometry signature must incorporate pending kind');
});

test('Layout Invariants: content footer gutter prevents scroll content bleeding under controls', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// kContentFooterGutter must be defined
	assert.match(mm, /static\s+const\s+CGFloat\s+kContentFooterGutter\s*=\s*8;/,
		'kContentFooterGutter must be 8pt');

	// Footer reserve must include the gutter
	assert.match(mm, /h\s*\+=\s*\[self\s+computeControlsStackHeight\];[\s\S]*h\s*\+=\s*kContentFooterGutter;/,
		'computeTargetContentHeight must add kContentFooterGutter after footer controls');
});

// 6. Presentation State Machine
test('Presentation State: canonical state resolution is deterministic', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Must define all presentation states
	const states = ['Hidden', 'Compact', 'AttentionCompact', 'Peek', 'AttentionPeek',
		'InteractiveWorking', 'InteractiveQuestion', 'InteractiveApproval',
		'TerminalCompleted', 'TerminalFailed'];
	for (const state of states) {
		assert.match(mm, new RegExp(`PrebasePresentationState${state}`),
			`Must define PrebasePresentationState${state}`);
	}

	// canonicalPresentationState must check visible first
	assert.match(mm, /canonicalPresentationState[\s\S]*if\s*\(!self\.visible\)\s*\{\s*return\s+PrebasePresentationStateHidden/,
		'canonicalPresentationState must return Hidden when not visible');

	// Must have canonicalTargetPresentationState (separate from canonicalPresentationState)
	assert.match(mm, /- \(PrebasePresentationState\)canonicalTargetPresentationState/,
		'Must have separate canonicalTargetPresentationState');
});

// 7. Action In-flight Duplicate Prevention
test('Action In-Flight: duplicate submission blocked while action is in flight', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// approve: must check actionInFlight
	assert.match(mm, /- \(void\)approve:\(id\)sender\s*\{[\s\S]*if\s*\(self\.actionInFlight\)\s*\{\s*return;\s*\}/,
		'approve must check actionInFlight before proceeding');

	// deny: must check actionInFlight
	assert.match(mm, /- \(void\)deny:\(id\)sender\s*\{[\s\S]*if\s*\(self\.actionInFlight\)\s*\{\s*return;\s*\}/,
		'deny must check actionInFlight before proceeding');

	// answerOption: must check actionInFlight
	assert.match(mm, /- \(void\)answerOption:\(id\)sender[\s\S]*if\s*\(self\.actionInFlight\)\s*\{\s*return;\s*\}/,
		'answerOption must check actionInFlight before proceeding');

	// beginActionInFlight must disable controls
	assert.match(mm, /beginActionInFlight[\s\S]*self\.approveButton\.enabled\s*=\s*NO/,
		'beginActionInFlight must disable approveButton');
	assert.match(mm, /beginActionInFlight[\s\S]*self\.denyButton\.enabled\s*=\s*NO/,
		'beginActionInFlight must disable denyButton');

	// In-flight timeout must exist
	assert.match(mm, /kActionInFlightTimeout\s*=\s*8\.0/,
		'Action in-flight timeout must be 8 seconds');
});

// 8. Text Containment — SanitizeTextForContainment
test('Text Containment: SanitizeTextForContainment handles pathological tokens', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Must define SanitizeTextForContainment
	assert.match(mm, /static\s+NSString\s+\*SanitizeTextForContainment\(NSString\s+\*text\)/,
		'Must define SanitizeTextForContainment');

	// Must insert zero-width break opportunities for pathological tokens
	assert.match(mm, /unichar\s+zeroWidthSpace\s*=\s*0x200B;/,
		'Must use U+200B zero-width space for break opportunities');

	// Must break after URL/path separators (/, \, ?, &, =, _, -, #, :)
	assert.match(mm, /ch\s*==\s*'[\/\\?&=_#:-]'/,
		'Must break after URL/path separators');

	// Must handle long runs of mixed alphanumeric at 24 chars
	assert.match(mm, /runLength\s*>=\s*24/,
		'Must break mixed alphanumeric runs at 24 chars');
});

// 9. Quick Messaging & Minimized / Backgrounded Interaction
test('Quick Messaging: Background/minimized click triggers sticky interactive and acquires key focus', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// Global click monitor handles clicks inside collapsedHit when not expanded
	assert.match(mm, /else\s+if\s*\(!strong\.content\.expanded\s*&&\s*strong\.visible\)\s*\{[\s\S]*NSPointInRect\(p,\s*strong\.collapsedHit\)\)\s*\{[\s\S]*enterInteractiveSticky/,
		'Global click monitor must allow clicks on collapsed notch to enter interactive sticky mode');

	// expandInteractive makes panel key and focuses input for immediate typing
	assert.match(mm, /makeKeyAndOrderFront:nil/,
		'expandInteractive must make panel key window');
	assert.match(mm, /makeFirstResponder:self\.input/,
		'expandInteractive must make self.input the first responder');

	// globalClickMonitor must be retained across expand transitions to collapse on outside click
	assert.doesNotMatch(mm, /removeGlobalMonitorOnly\s*\{[^}]*self\.globalClickMonitor/,
		'removeGlobalMonitorOnly must not destroy globalClickMonitor (only removeMonitors cleans it up)');
});

// 10. Session Switching & Empty New Session Persistence
test('Session Management: Newly created sessions persist in switcher and attach Magnus agent', () => {
	const ts = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivityContribution.ts'), 'utf8');
	const sessionTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/prebase/browser/magnusLiveActivitySession.ts'), 'utf8');

	// _createdMagnusSessionIds set tracks sessions created via notch
	assert.match(ts, /_createdMagnusSessionIds\s*=\s*new\s+Set<string>\(\)/,
		'Contribution must maintain _createdMagnusSessionIds set');

	// createSession adds to _createdMagnusSessionIds
	assert.match(ts, /command\.kind\s*===\s*'createSession'[\s\S]*_createdMagnusSessionIds\.add\(model\.sessionId\)/,
		'createSession must add session id to _createdMagnusSessionIds');

	// listMagnusSessions includes created sessions even if model has 0 requests
	assert.match(ts, /isCreatedMagnus\s*=\s*createdMagnusSessionIds\s*!==\s*undefined\s*&&\s*createdMagnusSessionIds\.has\(model\.sessionId\)/,
		'listMagnusSessions must retain created Magnus sessions');

	// selectSession finds created sessions even if unselected
	assert.match(ts, /this\._createdMagnusSessionIds\.has\(m\.sessionId\)/,
		'selectSession must allow selecting created Magnus sessions');

	// First followUp attaches prebase.magnus.agent
	assert.match(sessionTs, /const\s+options\s*=\s*isInitialRequest\s*\?\s*\{\s*agentId:\s*'prebase\.magnus\.agent'\s*\}\s*:\s*undefined/,
		'First follow-up must attach prebase.magnus.agent');
});

// 11. Authoritative 6pt Shoulder Geometry Alignment
test('Shoulder Geometry: Single authoritative 6pt shoulder across native, calculation, and contracts', () => {
	const mm = readFileSync(join(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'), 'utf8');

	// ComputeSilhouetteShoulderMetrics sets effR = 6.0
	assert.match(mm, /CGFloat\s+effR\s*=\s*6\.0;/,
		'Authoritative shoulder radius must be 6.0pt');

	// computeTargetContentHeight uses 6.0
	assert.match(mm, /ContentSafeInsetX\(self\.content\.notched,\s*6\.0,\s*YES\)/,
		'computeTargetContentHeight must use authoritative 6.0pt shoulder');

	// CreateNotchedIslandPath uses 8.0 drop and effShoulderR
	assert.match(mm, /shoulderDrop\s*=\s*8\.0;/,
		'Expanded shoulder drop must be 8.0pt');
});

