/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Pure geometry helpers for Magnus Live Activity shoulder curves and layout tokens.
 *--------------------------------------------------------------------------------------------*/

#pragma once

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

namespace prebase {
namespace live_activity {

/** Kappa constant for cubic Bezier approximation of circular arcs. */
static constexpr CGFloat kKappa = 0.5522847498307933984022516322796;


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
	b.cp1 = CGPointMake(totalW - flare * kKappa, visTopY);
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
	b.cp1 = CGPointMake(bodyLeft, visDrop - drop * kKappa);
	b.cp2 = CGPointMake(bodyLeft * kKappa, visTopY);
	b.p3 = CGPointMake(0.0, visTopY);
	return b;
}

} // namespace live_activity
} // namespace prebase
