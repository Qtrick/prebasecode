/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suite, test } from 'mocha';
import { interpolateWebviewScript } from '../../host/workbench/temporalRuntimeContracts.js';

/**
 * Production-truth structural tests.
 *
 * These guard contracts that live in shipped source text rather than runtime values:
 * - Settings UI and configuration contributions must tell users the truth about
 *   which keys are inert (deprecated) versus actually applied.
 * - The sandboxed webview script is generated from graphEditor.ts; deleted legacy
 *   symbols must never silently reappear there without their shared-resolver replacement.
 */

function readRepoFile(relPathFromGraphsTests: string): string {
	return readFileSync(new URL(relPathFromGraphsTests, import.meta.url), 'utf8');
}

function extractWebviewScript(): string {
	const editorSource = readRepoFile('../../host/workbench/graphEditor.ts');
	const html = editorSource.slice(editorSource.indexOf('<script nonce="${nonce}">'));
	const script = html.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script, 'webview script must be present in graphEditor.ts');
	return interpolateWebviewScript(script, '7', 'network');
}

suite('Graph settings & webview production truth', () => {

	test('graphSettingsUi exposes no "Reserved — not applied" rows: every rendered control is wired', () => {
		const ui = readRepoFile('../../host/workbench/settings/graphSettingsUi.ts');
		assert.ok(!ui.includes('Reserved'),
			'graphSettingsUi must not advertise any setting as Reserved/unapplied — remove the row or wire the setting');
		assert.ok(!ui.match(/not applied|not read by/i),
			'graphSettingsUi hints must not claim settings are ignored while still rendering them as controls');
	});

	test('inert graph settings carry deprecationMessage so VS Code marks them honestly', () => {
		const contribution = readRepoFile('../../host/workbench/graphConfigurationContribution.ts');
		const inertKeys = [
			'GraphShowEdgeLabels',
			'GraphFolderExpansionRadius',
			'GraphVisibleRelatedConnections',
			'GraphNetworkCharge',
			'GraphNetworkAlphaDecay',
			'GraphRenderThrottleMs',
			'GraphNetworkLodNodeThreshold',
			'GraphNetworkSimulationTicks',
			'InteractionNodeDragDelayMs',
		] as const;

		for (const key of inertKeys) {
			const entry = contribution.match(new RegExp(`\\[PreBaseGraphConfigKeys\\.${key}\\]:\\s*\\{([\\s\\S]*?)\\},\\n`));
			assert.ok(entry, `configuration entry for ${key} exists`);
			assert.ok(entry[1].includes('deprecationMessage'),
				`${key} is documented as inert and must declare a deprecationMessage`);
		}

		// Physics strength is genuinely applied host-side now; it must NOT be deprecated.
		const physics = contribution.match(/\[PreBaseGraphConfigKeys\.GraphNetworkPhysicsStrength\]:\s*\{([\s\S]*?)\},\n/);
		assert.ok(physics, 'GraphNetworkPhysicsStrength entry exists');
		assert.ok(!physics[1].includes('deprecationMessage'),
			'GraphNetworkPhysicsStrength is applied host-side and must not be marked deprecated');
		assert.ok(!physics[1].match(/Reserved|not applied/),
			`GraphNetworkPhysicsStrength description must describe real behavior, got: ${physics[1]}`);
	});

	test('webview script consumes the shared edge resolver and contains no resurrected dead caches', () => {
		const script = extractWebviewScript();
		assert.ok(script.includes('resolveNetworkEdgeVisual'),
			'draw path must call the injected authoritative resolveNetworkEdgeVisual');

		for (const deadSymbol of ['nodeIncidentEdgesMap', 'staticEdgeDescriptorCache', 'evaluateNetworkEdge']) {
			assert.ok(!script.includes(deadSymbol),
				`webview script must not reference deleted symbol ${deadSymbol} (edge visuals moved to the shared resolver)`);
		}
	});
});
