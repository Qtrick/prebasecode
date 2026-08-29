/**
 * Isolated parseBatchSize comparison. Each candidate runs in a fresh process
 * so RSS cannot accumulate across sizes. Outer window is Promise.all over N
 * files — not N parser-utility processes.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalGraphAnalyzer } from '../src/core/canonical/canonicalGraphAnalyzer.js';
import { NodeCanonicalParseService } from '../src/node/canonicalParseService.js';
import type { IRepositoryContentSource, CancellationTokenLike, ScannedFileInventory } from '../src/core/canonical/contentSource.js';
import type { ScannedFile } from '../src/common/types/graphTypes.js';
import { phase3EvidenceMetadata } from '../../test/prebase/acceptance/phase3Evidence.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const graphsRoot = join(dirname(scriptPath), '..');
const repoRoot = join(graphsRoot, '..');
const sizes = [8, 16, 32, 64] as const;

class FixtureSource implements IRepositoryContentSource {
	readonly kind = 'working-tree';
	readonly identity = 'parser-batch-bench';
	readonly rootPath: string;
	readonly projectName = 'graphs-src';
	private readonly _files: Map<string, string>;

	constructor(files: Map<string, string>, rootPath: string) {
		this._files = files;
		this.rootPath = rootPath;
	}

	async listFiles(token?: CancellationTokenLike): Promise<ScannedFileInventory> {
		const files: ScannedFile[] = [];
		for (const relativePath of this._files.keys()) {
			if (token?.isCancellationRequested) {
				break;
			}
			files.push({
				absolutePath: `${this.rootPath}/${relativePath}`,
				relativePath,
				extension: relativePath.slice(relativePath.lastIndexOf('.')),
			});
		}
		return { files, isTruncated: false, discoveredCount: files.length, eligibleCount: files.length };
	}

	async readFile(relativePath: string): Promise<string | undefined> {
		return this._files.get(relativePath);
	}
}

function collectSourceFiles(dir: string, prefix = ''): Map<string, string> {
	const files = new Map<string, string>();
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
			continue;
		}
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) {
			for (const [path, content] of collectSourceFiles(absolute, relative)) {
				files.set(path, content);
			}
			continue;
		}
		if (/\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
			files.set(relative, readFileSync(absolute, 'utf8'));
		}
	}
	return files;
}

function eventLoopLagSample(): Promise<number> {
	const start = Date.now();
	return new Promise(resolve => {
		setImmediate(() => resolve(Date.now() - start));
	});
}

function percentile(values: number[], p: number): number {
	if (!values.length) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
	return sorted[index];
}

async function runChild(parseBatchSize: number) {
	const sourceRoot = join(graphsRoot, 'src');
	const files = collectSourceFiles(sourceRoot);
	let generated = 0;
	while (files.size < 1000) {
		generated += 1;
		const dir = ['core', 'host', 'view', 'node', 'common'][generated % 5];
		const stem = `bench_${String(generated).padStart(4, '0')}`;
		const relative = `${dir}/generated/${stem}.ts`;
		const previous = generated > 1
			? `import { n${generated - 1} } from '../generated/bench_${String(generated - 1).padStart(4, '0')}.js';\nvoid n${generated - 1};\n`
			: '';
		files.set(relative, `${previous}export const n${generated} = ${generated};\nexport function f${generated}(x: number) { return x + ${generated}; }\n`);
	}
	const source = new FixtureSource(files, sourceRoot);
	global.gc?.();
	const beforeMem = process.memoryUsage();
	const lags: number[] = [];
	const lagTimer = setInterval(() => {
		void eventLoopLagSample().then(ms => lags.push(ms));
	}, 25);
	const started = Date.now();
	const analyzer = new CanonicalGraphAnalyzer({ parseService: new NodeCanonicalParseService(), parseBatchSize });
	const snapshot = await analyzer.analyze(source);
	const wallMs = Date.now() - started;
	clearInterval(lagTimer);
	const afterMem = process.memoryUsage();
	process.stdout.write(JSON.stringify({
		parseBatchSize,
		wallMs,
		fileCount: files.size,
		nodes: snapshot?.nodes.length ?? 0,
		digest: snapshot?.digest ?? '',
		rssMb: Number((afterMem.rss / 1024 / 1024).toFixed(1)),
		rssDeltaMb: Number(((afterMem.rss - beforeMem.rss) / 1024 / 1024).toFixed(2)),
		heapDeltaMb: Number(((afterMem.heapUsed - beforeMem.heapUsed) / 1024 / 1024).toFixed(2)),
		eventLoopLagP50Ms: percentile(lags, 50),
		eventLoopLagP95Ms: percentile(lags, 95),
	}));
}

function spawnCandidate(parseBatchSize: number) {
	const result = spawnSync(process.execPath, [
		'--experimental-strip-types',
		'--import', './graphs/scripts/graphs-test-setup.mjs',
		'--import', './graphs/scripts/graphs-test-register.mjs',
		scriptPath,
		'--child',
		String(parseBatchSize),
	], {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `parser bench child exited ${result.status}`);
	}
	return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
		parseBatchSize: number;
		wallMs: number;
		fileCount: number;
		nodes: number;
		digest: string;
		rssMb: number;
		rssDeltaMb: number;
		heapDeltaMb: number;
		eventLoopLagP50Ms: number;
		eventLoopLagP95Ms: number;
	};
}

function choosePareto(rows: Array<{ parseBatchSize: number; wallMedianMs: number; peakRssMedianMb: number }>) {
	const bySize = new Map(rows.map(row => [row.parseBatchSize, row]));
	const size32 = bySize.get(32);
	const fastest = [...rows].sort((a, b) => a.wallMedianMs - b.wallMedianMs || a.peakRssMedianMb - b.peakRssMedianMb)[0];
	if (!size32) {
		return fastest.parseBatchSize;
	}
	if (fastest.parseBatchSize === 32) {
		return 32;
	}
	const wallGain = (size32.wallMedianMs - fastest.wallMedianMs) / Math.max(1, size32.wallMedianMs);
	const rssCost = fastest.peakRssMedianMb / Math.max(1, size32.peakRssMedianMb);
	if (wallGain < 0.05) {
		return 32;
	}
	if (rssCost > 1.4) {
		return 32;
	}
	return fastest.parseBatchSize;
}

if (process.argv.includes('--child')) {
	const parseBatchSize = Number(process.argv.at(-1));
	await runChild(parseBatchSize);
} else {
	const repetitions = 3;
	const rows = [];
	for (const parseBatchSize of sizes) {
		spawnCandidate(parseBatchSize);
		const samples = [];
		for (let index = 0; index < repetitions; index++) {
			samples.push(spawnCandidate(parseBatchSize));
		}
		const walls = samples.map(sample => sample.wallMs);
		const rss = samples.map(sample => sample.rssMb);
		const rssDelta = samples.map(sample => sample.rssDeltaMb);
		const lagP95 = samples.map(sample => sample.eventLoopLagP95Ms);
		rows.push({
			parseBatchSize,
			fileCount: samples[0].fileCount,
			nodes: samples[0].nodes,
			digest: samples[0].digest,
			repetitions,
			wallMedianMs: percentile(walls, 50),
			wallP95Ms: percentile(walls, 95),
			peakRssMedianMb: percentile(rss, 50),
			rssDeltaMedianMb: percentile(rssDelta, 50),
			eventLoopLagP95MedianMs: percentile(lagP95, 50),
			samples,
			note: 'Fresh process per sample, including one discarded warmup. Fixture is graphs/src plus generated files to reach 1000 TypeScript sources. parseBatchSize is the outer Promise.all window; parseBatch remains sequential inside each worker.',
		});
	}
	const result = {
		...phase3EvidenceMetadata(repoRoot, 'parser-benchmark'),
		ok: true,
		methodology: 'fresh-process warmup + 3 repetitions, median/p95, ~1000 TS files (graphs/src plus generated). Outer parseBatchSize is Promise.all over files, not N parser-utility processes.',
		chosenParseBatchSize: choosePareto(rows),
		rows,
	};
	const outDir = join(repoRoot, 'reports/graph-acceptance/phase-3-final/performance');
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'parser-batch.json'), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
