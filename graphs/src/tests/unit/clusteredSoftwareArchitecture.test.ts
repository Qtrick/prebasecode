/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { getSoftwareArchitectureClusterKey, layoutClustered } from '../../layouts/network/clusteredLayout.js';
import type { NetworkLayoutNode, NetworkLayoutLink, NetworkLayoutRuntimeConfig } from '../../layouts/network/types.js';

suite('Software Architecture Clustered Layout (Unit - Phase 3.8)', () => {
	test('1. Entry nodes are always classified to entry cluster regardless of language', () => {
		const tsEntry: NetworkLayoutNode = { id: 'file:src/main.ts', path: 'src/main.ts', isEntry: true, fileTypeId: 'typescript' };
		const rustEntry: NetworkLayoutNode = { id: 'file:src-tauri/src/main.rs', path: 'src-tauri/src/main.rs', isEntry: true, fileTypeId: 'rust' };
		const pyEntry: NetworkLayoutNode = { id: 'file:app.py', path: 'app.py', isEntry: true, fileTypeId: 'python' };

		assert.equal(getSoftwareArchitectureClusterKey(tsEntry), 'entry');
		assert.equal(getSoftwareArchitectureClusterKey(rustEntry), 'entry');
		assert.equal(getSoftwareArchitectureClusterKey(pyEntry), 'entry');
	});

	test('2. Architecture layers (components, services, api, database) override language fileTypeId', () => {
		const compNode: NetworkLayoutNode = {
			id: 'file:src/components/Header.tsx',
			path: 'src/components/Header.tsx',
			architectureLayer: 'components',
			fileTypeId: 'typescript',
		};
		const serviceNode: NetworkLayoutNode = {
			id: 'file:src/services/auth.ts',
			path: 'src/services/auth.ts',
			architectureLayer: 'services',
			fileTypeId: 'typescript',
		};
		const dbNode: NetworkLayoutNode = {
			id: 'file:src/database/schema.rs',
			path: 'src/database/schema.rs',
			architectureLayer: 'database',
			fileTypeId: 'rust',
		};

		assert.equal(getSoftwareArchitectureClusterKey(compNode), 'components');
		assert.equal(getSoftwareArchitectureClusterKey(serviceNode), 'services');
		assert.equal(getSoftwareArchitectureClusterKey(dbNode), 'database');
	});

	test('3. Meaningful top-level directory/module is inferred when layer is not pre-assigned', () => {
		const appNode: NetworkLayoutNode = {
			id: 'file:apps/web/index.html',
			path: 'apps/web/index.html',
			fileTypeId: 'html',
		};
		const tauriNode: NetworkLayoutNode = {
			id: 'file:src-tauri/src/lib.rs',
			path: 'src-tauri/src/lib.rs',
			fileTypeId: 'rust',
		};
		const scriptNode: NetworkLayoutNode = {
			id: 'file:scripts/build.mjs',
			path: 'scripts/build.mjs',
			fileTypeId: 'javascript',
		};

		assert.equal(getSoftwareArchitectureClusterKey(appNode), 'apps');
		assert.equal(getSoftwareArchitectureClusterKey(tauriNode), 'src-tauri');
		assert.equal(getSoftwareArchitectureClusterKey(scriptNode), 'scripts');
	});

	test('4. Multi-language monorepo does NOT collapse all files into massive monolithic language blobs', () => {
		const nodes: NetworkLayoutNode[] = [
			{ id: '1', path: 'src/components/Button.tsx', fileTypeId: 'typescript' },
			{ id: '2', path: 'src/components/Modal.tsx', fileTypeId: 'typescript' },
			{ id: '3', path: 'src/services/api.ts', fileTypeId: 'typescript' },
			{ id: '4', path: 'src/services/cache.ts', fileTypeId: 'typescript' },
			{ id: '5', path: 'src-tauri/src/db.rs', fileTypeId: 'rust' },
			{ id: '6', path: 'src-tauri/src/window.rs', fileTypeId: 'rust' },
		];

		const clusterKeys = new Set(nodes.map(n => getSoftwareArchitectureClusterKey(n)));
		assert.ok(clusterKeys.size >= 3, `Expected at least 3 architectural clusters, got ${clusterKeys.size}: ${[...clusterKeys].join(', ')}`);
		assert.ok(clusterKeys.has('components'));
		assert.ok(clusterKeys.has('services'));
	});

	test('5. layoutClustered produces deterministic, finite 3D coordinates on sphere', () => {
		const nodes: NetworkLayoutNode[] = [
			{ id: 'node_entry', path: 'src/main.ts', isEntry: true, fileTypeId: 'typescript' },
			{ id: 'node_comp_1', path: 'src/components/Card.tsx', fileTypeId: 'typescript' },
			{ id: 'node_comp_2', path: 'src/components/Grid.tsx', fileTypeId: 'typescript' },
			{ id: 'node_svc_1', path: 'src/services/data.ts', fileTypeId: 'typescript' },
			{ id: 'node_db_1', path: 'src-tauri/src/db.rs', fileTypeId: 'rust' },
		];
		const links: NetworkLayoutLink[] = [
			{ source: 'node_entry', target: 'node_comp_1' },
			{ source: 'node_comp_1', target: 'node_svc_1' },
			{ source: 'node_svc_1', target: 'node_db_1' },
		];
		const config: NetworkLayoutRuntimeConfig = {
			sphereRadius: 150,
			collisionRadius: 24,
			linkDistance: 80,
			forceStrength: 0.35,
		};

		const positions1 = layoutClustered(nodes, links, config);
		const positions2 = layoutClustered(nodes, links, config);

		assert.equal(positions1.size, 5);
		for (const n of nodes) {
			const p1 = positions1.get(n.id);
			const p2 = positions2.get(n.id);
			assert.ok(p1, `Missing position for ${n.id}`);
			assert.ok(p2, `Missing position 2 for ${n.id}`);

			assert.ok(Number.isFinite(p1!.x));
			assert.ok(Number.isFinite(p1!.y));
			assert.ok(Number.isFinite(p1!.z));

			assert.equal(p1!.x, p2!.x);
			assert.equal(p1!.y, p2!.y);
			assert.equal(p1!.z, p2!.z);
		}
	});
});
