/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Deterministic layout solver and pure geometry helpers for Magnus Live Activity.
 *--------------------------------------------------------------------------------------------*/

#pragma once

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <vector>

namespace prebase {
namespace live_activity {

/** Kappa constant for cubic Bezier approximation of circular arcs. */
static constexpr CGFloat kKappa = 0.5522847498307933984022516322796;

/** Layout tokens and metrics. */
struct LayoutTokens {
	static constexpr CGFloat kHeaderRowHeight = 16.0;
	static constexpr CGFloat kContentGap = 3.0;
	static constexpr CGFloat kContentInsetTop = 6.0;
	static constexpr CGFloat kContentFooterGutter = 8.0;
	static constexpr CGFloat kControlHeight = 28.0;
	static constexpr CGFloat kIconControlSize = 28.0;
	static constexpr CGFloat kControlGap = 6.0;
	static constexpr CGFloat kActionRowHeight = 15.0;
	static constexpr CGFloat kComposerCornerRadius = 12.0;
	static constexpr CGFloat kBottomCornerRadius = 18.0;
	static constexpr CGFloat kContentMinScrollHeight = 24.0;
	static constexpr CGFloat kExpandedHeightMin = 72.0;
	static constexpr CGFloat kExpandedHeightMax = 220.0;
};

/** Shared shoulder metrics for path construction + diagnostics (single source of truth). */
struct SilhouetteMetrics {
	CGFloat wingLeftX;
	CGFloat wingRightX;
	CGFloat flare;
	CGFloat opticalInset;
	CGFloat effShoulderR;
	CGFloat shoulderDrop;
	CGFloat visTopY;
	CGFloat visDrop;
	CGFloat bodyLeft;
	CGFloat bodyRight;
};

/** Computes deterministic silhouette shoulder metrics. */
inline SilhouetteMetrics ComputeSilhouetteMetrics(
	CGFloat totalW,
	CGFloat topBleed,
	CGFloat shoulderDrop,
	CGFloat effShoulderR,
	BOOL isExpanded)
{
	SilhouetteMetrics m = {};
	CGFloat effR = isExpanded ? effShoulderR : 6.0;
	m.effShoulderR = effR;
	m.opticalInset = effR + 2.0;
	m.flare = effR;
	m.wingLeftX = effR;
	m.wingRightX = totalW - effR;
	m.shoulderDrop = effR;
	m.visTopY = isExpanded ? 0.0 : topBleed;
	m.visDrop = m.visTopY + m.shoulderDrop;
	m.bodyLeft = effR;
	m.bodyRight = totalW - effR;
	return m;
}

/** Cubic Bezier control points for C1 tangent-continuous concave shoulder. */
struct ConcaveShoulderBezier {
	CGPoint p0;
	CGPoint cp1;
	CGPoint cp2;
	CGPoint p3;
};

/** Computes right concave shoulder with C1 tangent continuity.
 *  Starts horizontal at (totalW, visTopY) and ends strictly vertical at (bodyRight, visDrop). */
inline ConcaveShoulderBezier ComputeRightShoulderBezier(CGFloat totalW, CGFloat bodyRight, CGFloat visTopY, CGFloat visDrop)
{
	CGFloat flare = totalW - bodyRight;
	CGFloat drop = visDrop - visTopY;
	ConcaveShoulderBezier b;
	b.p0 = CGPointMake(totalW, visTopY);
	// Horizontal tangent at top bezel: dy = 0
	b.cp1 = CGPointMake(totalW - flare * kKappa, visTopY);
	// Vertical tangent entering side wall: dx = 0
	b.cp2 = CGPointMake(bodyRight, visDrop - drop * kKappa);
	b.p3 = CGPointMake(bodyRight, visDrop);
	return b;
}

/** Computes left concave shoulder with C1 tangent continuity.
 *  Starts strictly vertical from side wall at (bodyLeft, visDrop) and ends horizontal at (0, visTopY). */
inline ConcaveShoulderBezier ComputeLeftShoulderBezier(CGFloat bodyLeft, CGFloat visTopY, CGFloat visDrop)
{
	CGFloat drop = visDrop - visTopY;
	ConcaveShoulderBezier b;
	b.p0 = CGPointMake(bodyLeft, visDrop);
	// Vertical tangent leaving side wall: dx = 0
	b.cp1 = CGPointMake(bodyLeft, visDrop - drop * kKappa);
	// Horizontal tangent joining top bezel: dy = 0
	b.cp2 = CGPointMake(bodyLeft * kKappa, visTopY);
	b.p3 = CGPointMake(0.0, visTopY);
	return b;
}

/** Resolved layout regions for the expanded interactive surface. */
struct ResolvedInteractiveLayout {
	CGRect headerBounds;
	CGRect sessionButtonBounds;
	CGRect statusBadgeBounds;
	CGRect scrollBounds;
	CGRect footerBounds;
	CGRect composerBounds;
	CGRect pinButtonBounds;
	CGRect openButtonBounds;
	CGRect approveButtonBounds;
	CGRect denyButtonBounds;
	std::vector<CGRect> optionButtonBounds;
	CGFloat documentHeight;
};

/** Solves vertical and horizontal constraints deterministically without magic one-off offsets. */
inline ResolvedInteractiveLayout SolveInteractiveLayout(
	CGSize panelSize,
	CGFloat notchBottomY,
	CGFloat headerInset,
	CGFloat footerInset,
	CGFloat footerControlsHeight,
	CGFloat measuredDocHeight,
	BOOL hasSessionButton,
	CGFloat sessionButtonMeasuredW,
	CGFloat statusBadgeMeasuredW,
	BOOL isApproval,
	BOOL isQuestion,
	NSInteger optionCount,
	BOOL pendingDestructive)
{
	ResolvedInteractiveLayout r = {};
	CGFloat totalW = panelSize.width;
	CGFloat totalH = panelSize.height;
	CGFloat bodyHeight = std::max(0.0, totalH - notchBottomY);

	// 1. Header region
	CGFloat headerY = LayoutTokens::kContentInsetTop;
	CGFloat headerW = std::max(40.0, totalW - headerInset * 2.0);
	CGFloat statusW = std::min(headerW * 0.40, std::max(44.0, statusBadgeMeasuredW + 4.0));
	CGFloat titleW = std::max(48.0, headerW - statusW - 8.0);

	r.headerBounds = CGRectMake(headerInset, headerY, headerW, LayoutTokens::kHeaderRowHeight);
	r.statusBadgeBounds = CGRectMake(totalW - headerInset - statusW, headerY, statusW, LayoutTokens::kHeaderRowHeight);

	if (hasSessionButton) {
		CGFloat sessionW = std::min(titleW, std::max(60.0, sessionButtonMeasuredW));
		r.sessionButtonBounds = CGRectMake(headerInset, headerY - 2.0, sessionW, LayoutTokens::kHeaderRowHeight + 4.0);
	} else {
		r.sessionButtonBounds = CGRectMake(headerInset, headerY, titleW, LayoutTokens::kHeaderRowHeight);
	}

	// 2. Footer region (enclosing all footer controls)
	CGFloat footerTopY = std::max(headerY + LayoutTokens::kHeaderRowHeight + LayoutTokens::kContentGap + LayoutTokens::kContentMinScrollHeight,
	                              bodyHeight - footerControlsHeight);
	CGFloat footerHeight = std::max(0.0, bodyHeight - footerTopY);
	r.footerBounds = CGRectMake(footerInset, footerTopY, std::max(40.0, totalW - footerInset * 2.0), footerHeight);

	// 3. Scrollable content viewport strictly guaranteed to never overlap footer
	CGFloat scrollTop = headerY + LayoutTokens::kHeaderRowHeight + LayoutTokens::kContentGap;
	CGFloat availableScroll = std::max(0.0, footerTopY - LayoutTokens::kContentFooterGutter - scrollTop);
	r.scrollBounds = CGRectMake(0.0, scrollTop, totalW, availableScroll);
	r.documentHeight = std::max(availableScroll, measuredDocHeight);

	// 4. Controls placement inside footer
	CGFloat usableW = r.footerBounds.size.width;
	CGFloat bottomY = r.footerBounds.origin.y;

	if (isApproval) {
		CGFloat apprGap = 8.0;
		CGFloat denyW = std::floor((usableW - apprGap) / 2.0);
		CGFloat approveW = usableW - apprGap - denyW;
		r.denyButtonBounds = CGRectMake(footerInset, bottomY, denyW, LayoutTokens::kControlHeight);
		r.approveButtonBounds = CGRectMake(footerInset + denyW + apprGap, bottomY, approveW, LayoutTokens::kControlHeight);
	} else if (isQuestion && optionCount > 0) {
		NSInteger maxDirect = optionCount > 4 ? 3 : optionCount;
		CGFloat gap = LayoutTokens::kControlGap;
		CGFloat colW = std::floor((usableW - gap) / 2.0);
		CGFloat x = footerInset;
		CGFloat rowY = bottomY;
		NSInteger col = 0;

		for (NSInteger i = 0; i < maxDirect; i++) {
			CGFloat width = colW;
			if (optionCount == 1) {
				width = usableW;
			} else if (optionCount == 3 && i == 2) {
				width = usableW;
			} else if (col == 1) {
				width = usableW - colW - gap;
			}
			if (col >= 2 || (optionCount == 3 && i == 2)) {
				col = 0;
				x = footerInset;
				rowY += (LayoutTokens::kControlHeight + 4.0);
			}
			r.optionButtonBounds.push_back(CGRectMake(x, rowY, width, LayoutTokens::kControlHeight));
			x += width + gap;
			col++;
		}
		if (optionCount > 4) {
			CGFloat moreW = usableW - colW - gap;
			if (col >= 2) {
				x = footerInset;
				rowY += (LayoutTokens::kControlHeight + 4.0);
			}
			r.optionButtonBounds.push_back(CGRectMake(x, rowY, moreW, LayoutTokens::kControlHeight));
		}
	} else {
		// Composer + Pin + Open
		CGFloat gap = LayoutTokens::kControlGap;
		CGFloat trailing = LayoutTokens::kIconControlSize * 2.0 + gap * 2.0;
		CGFloat composerW = std::max(72.0, usableW - trailing);
		CGFloat iconY = bottomY + (LayoutTokens::kControlHeight - LayoutTokens::kIconControlSize) * 0.5;

		r.composerBounds = CGRectMake(footerInset, bottomY, composerW, LayoutTokens::kControlHeight);
		r.pinButtonBounds = CGRectMake(footerInset + composerW + gap, iconY, LayoutTokens::kIconControlSize, LayoutTokens::kIconControlSize);
		r.openButtonBounds = CGRectMake(footerInset + composerW + gap + LayoutTokens::kIconControlSize + gap, iconY, LayoutTokens::kIconControlSize, LayoutTokens::kIconControlSize);
	}

	return r;
}

} // namespace live_activity
} // namespace prebase
