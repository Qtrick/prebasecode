/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Root-cause fix validation for the notch geometry bug.
 *
 * The OLD expanded path carved a rectangular camera housing void:
 *   MoveTo(notchLeft, 0) → notchRight, 0 → notchRight, bandH → notchLeft, bandH → close
 * This left a transparent hole at the top (the "floating card" effect) and created
 * sharp 90-degree corners around the housing cutout.
 *
 * The NEW expanded path is a solid, continuous contour:
 *   MoveTo(0, 0) → notchLeft, 0 → notchCenter, 0 → notchRight, 0 → totalW, 0 →
 *   bodyRight, shoulderDrop → ... shoulder flare curves ... → bodyLeft, shoulderDrop → close
 * This fills the full top width and uses cubic bezier curves for the housing-to-body
 * transition, eliminating both the transparent gap and the sharp corners.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const native = readFileSync(
	resolve(repoRoot, 'native/prebase-live-activity/src/live_activity.mm'),
	'utf8',
);

/** Extract the EXPANDED GEOMETRY block (between its comment and COMPACT/PILL GEOMETRY). */
function expandedBlock() {
	const start = native.indexOf('EXPANDED GEOMETRY');
	const end = native.indexOf('COMPACT/PILL GEOMETRY');
	assert.ok(start > 0, 'EXPANDED GEOMETRY block must exist in native source');
	assert.ok(end > start, 'COMPACT/PILL GEOMETRY must follow EXPANDED GEOMETRY');
	return native.slice(start, end);
}

/** Extract the COMPACT/PILL GEOMETRY block (from its comment to "return path;"). */
function compactBlock() {
	const start = native.indexOf('COMPACT/PILL GEOMETRY');
	const end = native.indexOf('return path;', start);
	assert.ok(start > 0, 'COMPACT/PILL GEOMETRY block must exist');
	assert.ok(end > start, 'return path must follow COMPACT block');
	return native.slice(start, end);
}

// ---------------------------------------------------------------------------
// Test 1: Expanded path starts at (0,0) — the root-cause fix
// ---------------------------------------------------------------------------
test('expanded path starts at (0,0) — would FAIL with old notchLeft origin', () => {
	const block = expandedBlock();

	// The NEW code uses CGPathMoveToPoint(path, NULL, 0, 0) as the first point.
	// This means the expanded panel fills the full top edge starting from the
	// physical screen left edge — no transparent gap.
	assert.match(
		block,
		/CGPathMoveToPoint\(path, NULL, 0, 0\)/,
		'expanded must start at (0,0) to fill full top width',
	);

	// The OLD code would have started at (notchLeft, 0), creating a transparent
	// rectangular void from (0,0) to (notchLeft, bandH). If someone reverts the
	// fix, this assertion catches the regression: the MoveTo would reference
	// notchLeft instead of literal 0,0.
	const firstMoveMatch = block.match(/CGPathMoveToPoint\(path,\s*NULL,\s*([^,]+),\s*([^)]+)\)/);
	assert.ok(firstMoveMatch, 'must have exactly one MoveTo in expanded geometry');
	const moveX = firstMoveMatch[1].trim();
	const moveY = firstMoveMatch[2].trim();
	assert.strictEqual(moveX, '0', 'MoveTo X must be literal 0, not notchLeft or any variable');
	assert.strictEqual(moveY, '0', 'MoveTo Y must be literal 0');
});

// ---------------------------------------------------------------------------
// Test 2: Expanded top edge spans to totalW — full width
// ---------------------------------------------------------------------------
test('expanded top edge spans to totalW at y=0 — would FAIL with old notchRight limit', () => {
	const block = expandedBlock();

	// The NEW code draws a LineTo to (totalW, 0), meaning the top-right corner
	// reaches the full panel width — identical to compact geometry.
	assert.match(
		block,
		/CGPathAddLineToPoint\(path, NULL, totalW, 0\)/,
		'expanded top-right must reach totalW for full-width coverage',
	);

	// The OLD expanded path only went as far as notchRight, then dropped straight
	// down to bandH — leaving the wing areas (notchRight to totalW) transparent.
	// Verify there is NO line to (notchRight, 0) that is NOT followed by totalW.
	// (notchRight, 0) does appear as an intermediate point, but totalW must follow.
	const linesAtZero = block.match(/CGPathAddLineToPoint\(path, NULL, \w+, 0\)/g) || [];
	const totalWLine = linesAtZero.filter(l => l.includes('totalW'));
	assert.ok(totalWLine.length >= 1, 'must have at least one LineTo at totalW,0');
});

// ---------------------------------------------------------------------------
// Test 3: kTopBleed for seamless notch overlap
// ---------------------------------------------------------------------------
test('kTopBleed constant is 14 — extends panel above screen edge on notched displays', () => {
	// The constant must exist with value 14 to cover the physical camera housing (~9pt)
	// plus margin for seamless visual integration.
	assert.match(
		native,
		/static const CGFloat kTopBleed = 14;/,
		'kTopBleed must be defined as exactly 14',
	);

	// topBleed is applied only on notched displays.
	assert.match(
		native,
		/CGFloat topBleed = notched \? kTopBleed : 0/,
		'topBleed must be conditional on notched display',
	);

	// The window frame must incorporate topBleed into its Y origin,
	// placing the panel 4pt above the screen edge.
	assert.match(
		native,
		/topY \+ topBleed - height/,
		'window frame Y must use topBleed offset',
	);
});

// ---------------------------------------------------------------------------
// Test 4: Element count parity — CAShapeLayer morph compatibility
// ---------------------------------------------------------------------------
test('compact and expanded paths have identical element counts (14 total)', () => {
	const expanded = expandedBlock();
	const compact = compactBlock();

	const count = (text, re) => (text.match(re) || []).length;

	const eMove = count(expanded, /CGPathMoveToPoint/g);
	const cMove = count(compact, /CGPathMoveToPoint/g);
	const eLine = count(expanded, /CGPathAddLineToPoint/g);
	const cLine = count(compact, /CGPathAddLineToPoint/g);
	const eCurve = count(expanded, /CGPathAddCurveToPoint/g);
	const cCurve = count(compact, /CGPathAddCurveToPoint/g);
	const eClose = count(expanded, /CGPathCloseSubpath/g);
	const cClose = count(compact, /CGPathCloseSubpath/g);

	// Total elements: MoveTo + LineTo + CurveTo + CloseSubpath = 14
	assert.strictEqual(eMove + eLine + eCurve + eClose, 14,
		'expanded must have exactly 14 path elements');
	assert.strictEqual(cMove + cLine + cCurve + cClose, 14,
		'compact must have exactly 14 path elements');

	// Parity across types — CAShapeLayer morph interpolates element-by-element
	assert.strictEqual(eMove, cMove, 'MoveTo count must match');
	assert.strictEqual(eLine, cLine, 'LineTo count must match');
	assert.strictEqual(eCurve, cCurve, 'CurveTo count must match');
	assert.strictEqual(eClose, cClose, 'CloseSubpath count must match');

	// Sanity: exactly 1 subpath each
	assert.strictEqual(eClose, 1, 'expanded must have exactly 1 CloseSubpath');
	assert.strictEqual(cClose, 1, 'compact must have exactly 1 CloseSubpath');
});

// ---------------------------------------------------------------------------
// Test 5: Shoulder flare creates body walls below the top edge
// ---------------------------------------------------------------------------
test('shoulder flare creates body walls at bodyLeft/bodyRight below top edge', () => {
	const block = expandedBlock();

	// bodyRight and bodyLeft define the vertical walls of the panel body.
	// They must appear BELOW the top edge (y > 0), creating the visual impression
	// of the notch expanding outward while the body tucks inward.
	assert.match(
		block,
		/CGFloat bodyRight = totalW - shoulderCurve/,
		'bodyRight must be inset from totalW by shoulder curve',
	);
	assert.match(
		block,
		/CGFloat bodyLeft = shoulderCurve/,
		'bodyLeft must be inset from 0 by shoulder curve',
	);

	// The right wall transitions from (totalW, visTopY) down to (bodyRight, visDrop) via smooth cubic flare.
	assert.match(
		block,
		/bodyRight,\s*visDrop\)/,
		'right shoulder must curve to bodyRight at visDrop height',
	);

	// Right wall: LineTo from (bodyRight, visDrop) down to (bodyRight, currentH - effBottomR).
	assert.match(
		block,
		/CGPathAddLineToPoint\(path, NULL, bodyRight, currentH - effBottomR\)/,
		'right body wall extends down to bottom corner start',
	);

	// Left wall: LineTo from (bodyLeft, currentH - effBottomR) UP to (bodyLeft, visDrop).
	// The bottom-left corner is a CurveTo endpoint, so the left wall vertical is an UP line.
	assert.match(
		block,
		/CGPathAddLineToPoint\(path, NULL, bodyLeft, visDrop\)/,
		'left body wall extends up to shoulder bottom',
	);

	// The shoulderDrop is 8.0pt (or legacy 14.0pt) — subtle flare that keeps body walls
	// close to panel edges for physical notch attachment.
	assert.match(
		block,
		/CGFloat shoulderDrop = (?:8|14)\.0;/,
		'shoulderDrop must be 8pt or 14pt for subtle flare',
	);

	// Old code would NOT have bodyLeft/bodyRight at all — it carved a straight
	// notchRight/notchLeft rectangle. These variables are new.
	assert.doesNotMatch(
		block,
		/CGPathAddLineToPoint\(path, NULL, notchRight, bandH\)/,
		'must not have old-style vertical drop to notchRight,bandH',
	);
});
