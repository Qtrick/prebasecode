/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskFillValue, redactSecretText, type DesktopAssertCondition, type DesktopInteractAction, type DesktopLocator } from './desktopLocators.js';
import type { DesktopAutomationBackend, DesktopFramework } from './desktopTypes.js';

export interface DesktopTestStep {
	index: number;
	kind: 'interact' | 'assert' | 'inspect' | 'screenshot' | 'start' | 'stop' | 'restart';
	action?: DesktopInteractAction | DesktopAssertCondition | string;
	locator?: DesktopLocator;
	resolvedTarget?: string;
	startedAt: number;
	durationMs: number;
	ok: boolean;
	failure?: string;
	screenshotPath?: string;
}

export interface DesktopTestRun {
	id: string;
	framework: DesktopFramework;
	mode: 'renderer' | 'fullApp';
	backend: DesktopAutomationBackend;
	workspaceRoot: string;
	startedAt: number;
	endedAt?: number;
	steps: DesktopTestStep[];
	cleanup?: 'clean' | 'error' | 'cancelled';
}

const MAX_STEPS = 200;

export function createDesktopTestRun(input: Omit<DesktopTestRun, 'steps' | 'startedAt'> & { startedAt?: number }): DesktopTestRun {
	return {
		...input,
		startedAt: input.startedAt ?? Date.now(),
		steps: [],
	};
}

export function recordDesktopTestStep(run: DesktopTestRun, step: Omit<DesktopTestStep, 'index'>): DesktopTestStep {
	const recorded: DesktopTestStep = { ...step, index: run.steps.length };
	if (recorded.locator && (recorded.action === 'fill' || recorded.action === 'type') && recorded.resolvedTarget) {
		recorded.resolvedTarget = maskFillValue(recorded.locator, recorded.resolvedTarget);
	}
	if (recorded.failure) {
		recorded.failure = redactSecretText(recorded.failure);
	}
	run.steps.push(recorded);
	if (run.steps.length > MAX_STEPS) {
		run.steps.shift();
		run.steps.forEach((item, index) => { item.index = index; });
	}
	return recorded;
}

export function summarizeDesktopTestRun(run: DesktopTestRun): Record<string, unknown> {
	const failed = run.steps.filter(step => !step.ok);
	const screenshots = run.steps.filter(step => step.screenshotPath).length;
	return {
		id: run.id,
		framework: run.framework,
		mode: run.mode,
		backend: run.backend,
		passedSteps: run.steps.filter(step => step.ok).length,
		failedSteps: failed.length,
		duration: (run.endedAt ?? Date.now()) - run.startedAt,
		screenshotCount: screenshots,
		cleanup: run.cleanup ?? 'pending',
		lastFailure: failed.at(-1)?.failure,
	};
}
