/*---------------------------------------------------------------------------------------------
 *  Copyright (c) PreBase. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	computeStronglyConnectedComponents,
	condenseToDag,
	computeTopologicalDepths,
	computeAdaptiveCommunities,
} from '../../temporal/view/temporalGraphTopology.js';
import type { TemporalRenderNode, TemporalRenderEdge } from '../../temporal/view/temporalViewTypes.js';

suite('TemporalGraphTopology (Unit - SCC, DAG Condensation & Adaptive Communities)', () => {
	function makeNode(id: string, path: string, isEntry = false): TemporalRenderNode {
		return {
			entityId: id,
			canonicalNodeId: `can-${id}`,
			path,
			label: path.split('/').pop() || path,
			kind: 'file',
			x: 0,
			y: 0,
			changeKind: 'unchanged',
			meta: {
				isEntry,
			},
		};
	}

	function makeEdge(id: string, src: string, tgt: string, kind = 'imports'): TemporalRenderEdge {
		return {
			edgeId: id,
			sourceEntityId: src,
			targetEntityId: tgt,
			sourcePath: `src/${src}.ts`,
			targetPath: `src/${tgt}.ts`,
			kind,
			changeKind: 'unchanged',
		};
	}

	test('1. SCC Detection: Acyclic DAG yields all singleton SCCs', () => {
		const nodes = [
			makeNode('A', 'src/app.ts', true),
			makeNode('B', 'src/services/auth.ts'),
			makeNode('C', 'src/utils/crypto.ts'),
		];
		const edges = [
			makeEdge('e1', 'A', 'B'),
			makeEdge('e2', 'B', 'C'),
		];

		const sccs = computeStronglyConnectedComponents(nodes, edges);
		assert.equal(sccs.length, 3);
		assert.ok(sccs.every(s => !s.isCycle && s.members.length === 1));
	});

	test('2. SCC Detection: 2-node cycle and 3-node cycle correctly grouped', () => {
		const nodes = [
			makeNode('A', 'src/a.ts'),
			makeNode('B', 'src/b.ts'),
			makeNode('C', 'src/c.ts'),
			makeNode('D', 'src/d.ts'),
			makeNode('E', 'src/e.ts'),
		];
		const edges = [
			// 2-node cycle A <-> B
			makeEdge('e1', 'A', 'B'),
			makeEdge('e2', 'B', 'A'),
			// Edge to C
			makeEdge('e3', 'B', 'C'),
			// 3-node cycle C -> D -> E -> C
			makeEdge('e4', 'C', 'D'),
			makeEdge('e5', 'D', 'E'),
			makeEdge('e6', 'E', 'C'),
		];

		const sccs = computeStronglyConnectedComponents(nodes, edges);
		assert.equal(sccs.length, 2);

		const sccAB = sccs.find(s => s.members.includes('A'));
		assert.ok(sccAB);
		assert.deepEqual(sccAB.members, ['A', 'B']);
		assert.equal(sccAB.isCycle, true);

		const sccCDE = sccs.find(s => s.members.includes('C'));
		assert.ok(sccCDE);
		assert.deepEqual(sccCDE.members, ['C', 'D', 'E']);
		assert.equal(sccCDE.isCycle, true);
	});

	test('3. Permutation Invariance: Shuffled input nodes and edges produce identical SCCs and IDs', () => {
		const nodes = [
			makeNode('N1', 'src/n1.ts'),
			makeNode('N2', 'src/n2.ts'),
			makeNode('N3', 'src/n3.ts'),
			makeNode('N4', 'src/n4.ts'),
		];
		const edges = [
			makeEdge('e1', 'N1', 'N2'),
			makeEdge('e2', 'N2', 'N3'),
			makeEdge('e3', 'N3', 'N1'),
			makeEdge('e4', 'N3', 'N4'),
		];

		const sccRun1 = computeStronglyConnectedComponents(nodes, edges);

		// Reverse and shuffle
		const shuffledNodes = [nodes[3], nodes[1], nodes[0], nodes[2]];
		const shuffledEdges = [edges[3], edges[0], edges[2], edges[1]];
		const sccRun2 = computeStronglyConnectedComponents(shuffledNodes, shuffledEdges);

		assert.equal(sccRun1.length, sccRun2.length);
		for (let i = 0; i < sccRun1.length; i++) {
			assert.equal(sccRun1[i].id, sccRun2[i].id);
			assert.deepEqual(sccRun1[i].members, sccRun2[i].members);
		}
	});

	test('4. DAG Condensation: Creates cycle-free meta-graph', () => {
		const nodes = [
			makeNode('A', 'src/a.ts'),
			makeNode('B', 'src/b.ts'),
			makeNode('C', 'src/c.ts'),
		];
		const edges = [
			makeEdge('e1', 'A', 'B'),
			makeEdge('e2', 'B', 'A'),
			makeEdge('e3', 'B', 'C'),
		];

		const sccs = computeStronglyConnectedComponents(nodes, edges);
		const dag = condenseToDag(nodes, edges, sccs);

		assert.equal(dag.sccs.length, 2);
		const sccABId = dag.nodeToSccId.get('A')!;
		const sccCId = dag.nodeToSccId.get('C')!;
		assert.equal(dag.nodeToSccId.get('B'), sccABId);

		const abNeighbors = Array.from(dag.sccAdjacency.get(sccABId) || []);
		assert.deepEqual(abNeighbors, [sccCId]);
	});

	test('5. Topological Depths: Entry/producers receive depth 0 and downstream receives increasing depths', () => {
		const nodes = [
			makeNode('Entry', 'src/main.ts', true),
			makeNode('Service', 'src/services/itemService.ts'),
			makeNode('Repo', 'src/database/itemRepo.ts'),
		];
		const edges = [
			makeEdge('e1', 'Entry', 'Service'),
			makeEdge('e2', 'Service', 'Repo'),
		];

		const sccs = computeStronglyConnectedComponents(nodes, edges);
		const dag = condenseToDag(nodes, edges, sccs);
		const depths = computeTopologicalDepths(dag, nodes);

		assert.equal(depths.get('Entry'), 0);
		assert.equal(depths.get('Service'), 1);
		assert.equal(depths.get('Repo'), 2);
	});

	test('6. Adaptive Communities: Partitions codebase and keeps SCC cycles co-located', () => {
		const nodes = [
			makeNode('App', 'src/workbench/app.ts', true),
			makeNode('View', 'src/workbench/view.ts'),
			makeNode('Auth1', 'src/services/auth1.ts'),
			makeNode('Auth2', 'src/services/auth2.ts'),
			makeNode('Db', 'src/database/db.ts'),
		];
		const edges = [
			makeEdge('e1', 'App', 'View'),
			makeEdge('e2', 'App', 'Auth1'),
			// Cycle between Auth1 and Auth2
			makeEdge('e3', 'Auth1', 'Auth2'),
			makeEdge('e4', 'Auth2', 'Auth1'),
			makeEdge('e5', 'Auth2', 'Db'),
		];

		const communities = computeAdaptiveCommunities(nodes, edges);
		assert.ok(communities.length >= 2, 'Should create distinct communities');

		// Verify Auth1 and Auth2 are in the same community
		const authComm = communities.find(c => c.nodeIds.includes('Auth1'));
		assert.ok(authComm);
		assert.ok(authComm.nodeIds.includes('Auth2'), 'Cyclic dependencies must be co-located in the same community');
	});

	test('7. SCC Relocation Metadata Truth: Relocated nodes update community majority layer, depth, and hubs', () => {
		// A multi-node SCC where one node originally belongs to a different folder prefix
		// Primary node is Hub in src/services/hub.ts (entry node)
		// Secondary node is Worker in src/utils/worker.ts (utils layer)
		const nodes = [
			makeNode('Hub', 'src/services/hub.ts', true),
			makeNode('Worker', 'src/utils/worker.ts', false),
			makeNode('Helper', 'src/utils/helper.ts', false),
		];
		const edges = [
			makeEdge('e1', 'Hub', 'Worker'),
			makeEdge('e2', 'Worker', 'Hub'), // Cycle: Worker moves into Hub community
			makeEdge('e3', 'Worker', 'Helper'),
		];

		const communities = computeAdaptiveCommunities(nodes, edges);

		// Hub and Worker must be co-located in the services community
		const hubComm = communities.find(c => c.nodeIds.includes('Hub'));
		assert.ok(hubComm, 'Hub community must exist');
		assert.ok(hubComm.nodeIds.includes('Worker'), 'Worker must be co-located with Hub');
		assert.equal(hubComm.hasEntry, true);
		assert.equal(hubComm.totalDegree, 5);

		// The remaining utils community must contain only Helper
		const utilsComm = communities.find(c => c.nodeIds.includes('Helper'));
		assert.ok(utilsComm, 'Utils community must exist');
		assert.equal(utilsComm.nodeIds.length, 1);
		assert.equal(utilsComm.nodeIds[0], 'Helper');
		assert.equal(utilsComm.primaryHubId, 'Helper');
		assert.equal(utilsComm.totalDegree, 1);
		assert.equal(utilsComm.primaryLayer, 'utils');
	});
});

