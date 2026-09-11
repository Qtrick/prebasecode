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
	assert.match(appTs, /if\s*\(args\['agents'\]\s*&&\s*\(this\.productService\.prebaseAgentsWindowEnabled\s*!==\s*false\s*\|\|\s*process\.env\['PREBASE_ENABLE_AGENTS_WINDOW'\]\)\)/,
		'app.ts must gate CLI --agents check on prebaseAgentsWindowEnabled and env override');

	const productJson = JSON.parse(readFileSync(join(repoRoot, 'product.json'), 'utf8'));
	assert.strictEqual(productJson.prebaseAgentsWindowEnabled, false,
		'product.json must set prebaseAgentsWindowEnabled to false by default');
});

test('Agents Window Dormancy: Welcome page agents banner fail-closed via isAgentsWindowEnabled', () => {
	const bannerTs = readFileSync(join(repoRoot, 'src/vs/workbench/contrib/chat/browser/agentSessions/agentSessionsBanner.ts'), 'utf8');
	assert.match(bannerTs, /if\s*\(product\.prebaseAgentsWindowEnabled\s*===\s*false\)\s*\{\s*return false;\s*\}/,
		'canShowAgentsBanner must return false when product.prebaseAgentsWindowEnabled is false');
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
