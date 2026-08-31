/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
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

	test('Network Radial is retired from Settings, Maps chips, persist rewrite, and imports', () => {
		const contribution = readRepoFile('../../host/workbench/graphConfigurationContribution.ts');
		const maps = readRepoFile('../../host/workbench/prebaseMapsView.ts');
		const service = readRepoFile('../../host/workbench/prebaseGraphService.ts');
		const layoutIndex = readRepoFile('../../layouts/network/index.ts');
		const editor = readRepoFile('../../host/workbench/graphEditor.ts');

		const enumBlock = contribution.match(/\[PreBaseGraphConfigKeys\.GraphNetworkLayoutMode\]:\s*\{([\s\S]*?)\},\n/);
		assert.ok(enumBlock, 'GraphNetworkLayoutMode setting exists');
		assert.match(enumBlock[1], /enum:\s*\[\s*'organic',\s*'sphere',\s*'constellation',\s*'clustered'\s*\]/);
		assert.doesNotMatch(enumBlock[1], /radial/i);

		const chipModes = maps.match(/const modes: \{ id: string; label: string \}\[\] = \[([\s\S]*?)\];/);
		assert.ok(chipModes, 'Maps Network Layout chips exist');
		assert.doesNotMatch(chipModes[1], /radial/i);
		assert.match(chipModes[1], /organic/);
		assert.match(chipModes[1], /clustered/);

		assert.match(service, /normalizeNetworkLayoutMode\(mode\)/);
		assert.match(service, /if \(mode !== normalized\) \{[\s\S]*?updateValue\(PreBaseGraphConfigKeys\.GraphNetworkLayoutMode, normalized\)/);
		assert.match(maps, /normalizeNetworkLayoutMode\(networkLayoutRaw\)/);
		assert.match(maps, /if \(networkLayoutRaw !== networkLayout\) \{[\s\S]*?updateValue\(PreBaseGraphConfigKeys\.GraphNetworkLayoutMode, networkLayout\)/);

		assert.doesNotMatch(layoutIndex, /radialLayout/);
		assert.doesNotMatch(layoutIndex, /from ['"]\.\/radialLayout/);
		assert.doesNotMatch(editor, /radialLayout/);
		assert.doesNotMatch(editor, /networkLayoutMode === ['"]radial['"]/);
	});

	test('webview script consumes the shared edge resolver and contains no resurrected dead caches', () => {
		const script = extractWebviewScript();
		assert.ok(script.includes('resolveNetworkEdgeVisual'),
			'draw path must call the injected authoritative resolveNetworkEdgeVisual');

		for (const deadSymbol of ['nodeIncidentEdgesMap', 'staticEdgeDescriptorCache', 'evaluateNetworkEdge']) {
			assert.ok(!script.includes(deadSymbol),
				`webview script must not reference deleted symbol ${deadSymbol} (edge visuals moved to the shared resolver)`);
		}

		assert.ok(script.includes('projectTemporalVisibleSet'), 'draw and pick must use the injected node-level LOD projection');
		assert.ok(script.includes('pickTemporalNode'), 'Temporal click path must pick through pickTemporalNode');
		assert.match(script, /isTemporal\(\)\s*\n?\s*\? pickTemporalNode/);
		assert.ok(script.includes('computeCommunityAggregateEdges'), 'overview edges must reuse temporalEdgeLod');
		assert.doesNotMatch(script, /function computeNodeClusterAggregates|function aggregateLeaves\(/);
	});
});
