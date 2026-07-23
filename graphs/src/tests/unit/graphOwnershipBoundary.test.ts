/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAPHS_SRC = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(GRAPHS_SRC, '../..');

suite('Graph ownership boundary (Phase A)', () => {
	test('Architecture Graph stays unavailable on active paths but preserved on disk (One-Graph-Type)', () => {
		assert.ok(
			!fs.existsSync(path.join(GRAPHS_SRC, 'layouts/architecture')),
			'graphs/src/layouts/architecture must not return as an active product path'
		);
		assert.ok(
			!fs.existsSync(path.join(GRAPHS_SRC, 'architecture')),
			'graphs/src/architecture must not return as an active product path'
		);
		assert.ok(
			!fs.existsSync(path.join(GRAPHS_SRC, 'layouts/shared')),
			'graphs/src/layouts/shared must not return as an active product path'
		);
		assert.ok(
			!fs.existsSync(path.join(GRAPHS_SRC, 'core/analysis/dependencyDepth.ts')),
			'dependencyDepth.ts must not live under active core/analysis'
		);
		assert.ok(
			!fs.existsSync(path.join(GRAPHS_SRC, 'tests/unit/architecturePick.test.ts')),
			'architecturePick.test.ts must not run as an active unit test'
		);

		const preservedRoot = path.join(GRAPHS_SRC, 'preserved/architecture');
		for (const rel of [
			'README.md',
			'ASSET_MANIFEST.md',
			'LEGACY_SETTINGS.md',
			'interaction/architecturePick.ts',
			'analysis/dependencyDepth.ts',
			'layouts/layoutEngine.ts',
			'layouts/hierarchy/hierarchyLayout.ts',
			'layouts/hierarchy/hierarchyDepthVisuals.ts',
			'layouts/shared/layoutConfig.ts',
			'layouts/shared/layoutConstraints.ts',
			'layouts/shared/layoutDepthColors.ts',
			'layouts/shared/layoutOrganization.ts',
			'tests/architecturePick.test.ts',
			'legacy-first-test/README.md',
			'legacy-first-test/components/graph/PyramidLabels.tsx',
			'legacy-first-test/components/nodes/ArchitectureNode.tsx',
		]) {
			assert.ok(
				fs.existsSync(path.join(preservedRoot, rel)),
				`missing preserved Architecture asset: preserved/architecture/${rel}`
			);
		}

		// Active sources must not import the preserved archive.
		const importRe = /(?:from\s+['"][^'"]*preserved\/architecture[^'"]*['"]|require\(\s*['"][^'"]*preserved\/architecture[^'"]*['"]\s*\))/;
		const walk = (dir: string, acc: string[] = []): string[] => {
			if (!fs.existsSync(dir)) {
				return acc;
			}
			for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, ent.name);
				if (ent.isDirectory()) {
					walk(full, acc);
				} else if (ent.isFile() && /\.(ts|tsx|js|mjs)$/.test(ent.name)) {
					acc.push(full);
				}
			}
			return acc;
		};
		for (const dir of ['common', 'core', 'layouts', 'host', 'commands', 'settings', 'tests']) {
			for (const file of walk(path.join(GRAPHS_SRC, dir))) {
				const text = fs.readFileSync(file, 'utf8');
				assert.ok(
					!importRe.test(text),
					`active source imports preserved Architecture: ${path.relative(REPO_ROOT, file)}`
				);
			}
		}
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
