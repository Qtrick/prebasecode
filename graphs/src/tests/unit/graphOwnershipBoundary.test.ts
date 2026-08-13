/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPHS_SRC = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(GRAPHS_SRC, '../..');

suite('Graph ownership boundary (Phase A)', () => {
	test('compiled graph editor input normalizes a legacy Architecture restore to the Code Graph', async () => {
		const compiledInput = path.join(
			REPO_ROOT,
			'out/vs/workbench/contrib/prebase/graphs/host/workbench/graphEditorInput.js'
		);
		assert.ok(fs.existsSync(compiledInput), 'compiled graph editor input missing; run npm run transpile-client');

		const { PreBaseGraphEditorInput } = await import(pathToFileURL(compiledInput).href);
		const restored = PreBaseGraphEditorInput.create('architecture');
		assert.deepStrictEqual({
			graphType: restored.graphType,
			name: restored.getName(),
			resource: restored.resource.path,
		}, {
			graphType: 'network',
			name: 'Code Graph',
			resource: '/network',
		});
	});

	test('graphs/src/core has no flat shim .ts files', () => {
		const coreDir = path.join(GRAPHS_SRC, 'core');
		assert.ok(fs.existsSync(coreDir), 'graphs/src/core must exist');
		const flat = fs.readdirSync(coreDir).filter((name) => {
			const full = path.join(coreDir, name);
			return fs.statSync(full).isFile() && /\.(ts|js|tsx|jsx)$/.test(name);
		});
		assert.deepStrictEqual(flat, [], `unexpected flat core files: ${flat.join(', ')}`);
	});

	test('graphSettingsUi.ts exports public Settings UI surface', () => {
		const uiPath = path.join(GRAPHS_SRC, 'host/workbench/settings/graphSettingsUi.ts');
		assert.ok(fs.existsSync(uiPath), 'graphSettingsUi.ts missing');
		const text = fs.readFileSync(uiPath, 'utf8');
		for (const name of [
			'export interface IPreBaseGraphSettingsUiHost',
			'export function renderGraphCategory',
			'export function renderGraphInteractionControls',
			'export function renderGraphPerformanceCategory',
			'export function renderGraphAdvanced',
			'export function renderGraphReduceMotionRow',
			'export const GRAPH_SUPPORTED_LANGUAGES',
		]) {
			assert.ok(text.includes(name), `missing ${name}`);
		}
	});

	test('settings/ui.ts re-exports Settings UI helpers; settings/index.ts stays DOM-free', () => {
		const indexPath = path.join(GRAPHS_SRC, 'settings/index.ts');
		const indexText = fs.readFileSync(indexPath, 'utf8');
		assert.ok(!/from\s+['"][^'"]*graphSettingsUi/.test(indexText), 'settings/index.ts must not import graphSettingsUi');
		assert.ok(indexText.includes('registerPreBaseGraphConfiguration'));

		const uiPath = path.join(GRAPHS_SRC, 'settings/ui.ts');
		const uiText = fs.readFileSync(uiPath, 'utf8');
		assert.ok(uiText.includes("from '../host/workbench/settings/graphSettingsUi.js'"));
		assert.ok(uiText.includes('renderGraphCategory'));
		assert.ok(uiText.includes('IPreBaseGraphSettingsUiHost'));
	});

	test('prebaseSettingsEditor routes through graphSettingsUi and does not bind PreBaseGraphConfigKeys', () => {
		const editorPath = path.join(
			REPO_ROOT,
			'src/vs/workbench/contrib/prebase/browser/prebaseSettingsEditor.ts'
		);
		const text = fs.readFileSync(editorPath, 'utf8');
		assert.ok(text.includes('graphSettingsUi'));
		assert.ok(!/\bPreBaseGraphConfigKeys\b/.test(text));
		assert.ok(text.includes('InteractionTerminalVisibility'));
	});
});
