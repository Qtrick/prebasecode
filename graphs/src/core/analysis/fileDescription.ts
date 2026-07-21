/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { GraphNode } from '../../common/types/graphTypes.js';

export function inferFileDescription(node: GraphNode): string {
	const path = (node.path ?? node.label).toLowerCase();
	const name = node.label.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
	const layer = node.meta?.architectureLayer;

	if (node.isEntry) {
		return 'Application entry point — the root module where execution or rendering begins.';
	}
	if (layer === 'auth') {
		return 'Authentication and session handling for user identity and access control.';
	}
	if (layer === 'api') {
		return 'API route or endpoint layer — defines how external clients interact with backend logic.';
	}
	if (layer === 'database') {
		return 'Data persistence layer — models, schemas, or database access utilities.';
	}
	if (layer === 'services') {
		return `Service module "${name}" — encapsulates business logic used across the application.`;
	}
	if (layer === 'components' || node.kind === 'component') {
		return `UI component "${name}" — renders interface elements and composes the visual tree.`;
	}
	if (layer === 'ui' || /page\.(tsx|jsx)$/.test(path)) {
		return `Page or screen module "${name}" — top-level route or view composition.`;
	}
	if (/hook/i.test(name) || path.includes('/hooks/')) {
		return `React hook "${name}" — reusable stateful logic for components.`;
	}
	if (/store|context|provider/i.test(name)) {
		return `State module "${name}" — manages shared application state or context.`;
	}
	if (/util|helper|lib/i.test(path)) {
		return `Utility module "${name}" — shared helpers and low-level functions.`;
	}
	if (/config|vite|webpack|eslint/.test(path)) {
		return 'Project configuration — build, lint, or environment setup.';
	}
	if (/test|spec/.test(path)) {
		return `Test file for "${name}" — automated checks and specifications.`;
	}
	if (/layout/i.test(name)) {
		return `Layout shell "${name}" — wraps pages with shared chrome and navigation.`;
	}
	if (node.meta?.isComponent) {
		return `Component "${name}" — part of the React component hierarchy.`;
	}

	const importCount = node.meta?.imports?.length ?? 0;
	const exportCount = node.meta?.exports?.length ?? 0;
	if (importCount > 5) {
		return `Central module "${name}" with many dependencies — likely coordinates multiple subsystems.`;
	}
	if (exportCount > 3) {
		return `Shared module "${name}" — exports multiple symbols consumed by other files.`;
	}

	return `Source file "${node.label}" — part of the ${layer ?? 'application'} architecture.`;
}
