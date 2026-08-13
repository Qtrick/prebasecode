#!/usr/bin/env node
/**
 * Micro-benchmark for network layout algorithms (CPU only; not render FPS).
 * Usage (from repo root):
 *   node --experimental-strip-types --import=./graphs/scripts/graphs-test-register.mjs graphs/scripts/benchmark-network-layouts.mjs
 */
import { performance } from 'node:perf_hooks';
import {
	computeNetworkSphereRadius,
	layoutNetworkGraph,
} from '../src/layouts/network/index.js';

function makeGraph(n) {
	const nodes = Array.from({ length: n }, (_, i) => ({
		id: `n${i}`,
		fileTypeId: i % 2 === 0 ? 'typescript' : 'javascript',
		val: 1 + (i % 5),
		isEntry: i === 0,
	}));
	const links = [];
	for (let i = 1; i < n; i++) {
		links.push({ source: `n${i - 1}`, target: `n${i}` });
		if (i > 2) {
			links.push({ source: `n${i}`, target: `n${i % 3}` });
		}
	}
	return { nodes, links };
}

const modes = ['organic', 'sphere', 'constellation', 'clustered', 'radial'];
const sizes = [100, 280, 500, 1000, 2000];

console.log('network layout micro-benchmark (ms per run, median of iterations)');
console.log(`node ${process.version}; 5 samples through 500 nodes, 3 samples above`);
console.log('');

for (const n of sizes) {
	const { nodes, links } = makeGraph(n);
	const radius = computeNetworkSphereRadius(n, 1);
	const iterations = n > 500 ? 3 : 5;
	console.log(`--- ${n} nodes ---`);
	for (const mode of modes) {
		const samples = [];
		for (let i = 0; i < iterations; i++) {
			const t0 = performance.now();
			const layout = layoutNetworkGraph(mode, nodes, links, radius);
			samples.push(performance.now() - t0);
			if (layout.size !== n) {
				console.error(`${mode}@${n}: expected ${n} positions, got ${layout.size}`);
				process.exit(1);
			}
		}
		samples.sort((a, b) => a - b);
		const median = samples[Math.floor(samples.length / 2)];
		console.log(`${mode.padEnd(14)} ${median.toFixed(2)} ms`);
	}
	console.log('');
}
